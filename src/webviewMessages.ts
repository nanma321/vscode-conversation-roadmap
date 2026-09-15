/**
 * Validation and application of messages sent *from* the graph Webview
 * (Phase 5) *to* the extension host.
 *
 * Per the Key Engineering Principles - "validate all AI-generated and
 * imported data" and "never overwrite user-authored graph changes
 * automatically" - a Webview is untrusted input just like a model response
 * or an imported file: it runs arbitrary script and its messages must never
 * be trusted at face value. `applyWebviewMessage` mirrors the shape of
 * `summarizeIncrementally` (see `summarization/applySummary.ts`): it
 * validates first, and on any problem returns the *original* roadmap
 * unchanged alongside the errors that explain why, so a malformed or
 * malicious message can never corrupt the persisted graph.
 *
 * This module has no dependency on `vscode` or the DOM so it can be
 * unit-tested in isolation, matching the pattern used throughout the rest
 * of the extension host.
 */
import { Roadmap, RoadmapNode } from "./model/types";
import { HEX_COLOR_PATTERN } from "./model/colorPattern";
import type { TurnRecord } from "./turnStore";

/** Every message shape the graph Webview may send to the extension host. */
export type WebviewToHostMessage =
  | { type: "moveNode"; nodeId: string; position: { x: number; y: number } }
  | { type: "renameNode"; nodeId: string; title: string }
  | { type: "updateNotes"; nodeId: string; notes: string }
  | { type: "updateTags"; nodeId: string; tags: string[] }
  | { type: "updateColor"; nodeId: string; color: string | null }
  | { type: "toggleHighlight"; nodeId: string; highlighted: boolean }
  | { type: "selectNode"; nodeId: string | null }
  | { type: "requestState" };

/**
 * Every message the extension host sends *to* the graph Webview. The host is
 * trusted, so these are not run through a validator (unlike
 * {@link WebviewToHostMessage}), but are still declared here as the single
 * source of truth for the wire protocol shared by both sides.
 */
export type HostToWebviewMessage =
  | { type: "state"; roadmap: Roadmap; turns: TurnRecord[] }
  | { type: "error"; message: string };

/** The result of validating an unknown value as a {@link WebviewToHostMessage}. */
export interface MessageValidationResult {
  valid: boolean;
  /** Human-readable error messages. Empty when `valid` is true. */
  errors: string[];
  /** The validated message, narrowed to {@link WebviewToHostMessage}. Only meaningful when `valid` is true. */
  value?: WebviewToHostMessage;
}

/** The outcome of applying a raw (untrusted) Webview message to a roadmap. */
export interface ApplyMessageResult {
  /** The updated roadmap if the message was valid and changed the graph, otherwise the original `roadmap`, unchanged. */
  roadmap: Roadmap;
  /** Human-readable error messages. Empty unless the message was invalid. */
  errors: string[];
  /** True only when the message was valid and persisted state actually changed. */
  changed: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validates an arbitrary value received via `webview.onDidReceiveMessage` as
 * a {@link WebviewToHostMessage}. Never throws: unknown or malformed input
 * simply fails validation with descriptive errors.
 */
export function validateWebviewMessage(value: unknown): MessageValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return { valid: false, errors: ["message: must be an object"] };
  }
  const type = value.type;
  if (typeof type !== "string") {
    return { valid: false, errors: ["message.type: must be a string"] };
  }

  switch (type) {
    case "requestState":
      return { valid: true, errors: [], value: { type: "requestState" } };

    case "selectNode": {
      if (value.nodeId !== null && !isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string or null");
      }
      return finish(errors, () => ({ type: "selectNode", nodeId: (value.nodeId as string | null) ?? null }));
    }

    case "moveNode": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      const position = value.position;
      if (!isPlainObject(position) || typeof position.x !== "number" || !Number.isFinite(position.x) ||
        typeof position.y !== "number" || !Number.isFinite(position.y)) {
        pushErr(errors, "message.position", "must be an object with finite numeric x and y");
      }
      return finish(errors, () => ({
        type: "moveNode",
        nodeId: value.nodeId as string,
        position: { x: (position as { x: number; y: number }).x, y: (position as { x: number; y: number }).y },
      }));
    }

    case "renameNode": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (typeof value.title !== "string" || value.title.trim().length === 0) {
        pushErr(errors, "message.title", "must be a non-empty string");
      }
      return finish(errors, () => ({ type: "renameNode", nodeId: value.nodeId as string, title: (value.title as string).trim() }));
    }

    case "updateNotes": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (typeof value.notes !== "string") {
        pushErr(errors, "message.notes", "must be a string");
      }
      return finish(errors, () => ({ type: "updateNotes", nodeId: value.nodeId as string, notes: value.notes as string }));
    }

    case "updateTags": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) {
        pushErr(errors, "message.tags", "must be an array of strings");
      }
      return finish(errors, () => ({ type: "updateTags", nodeId: value.nodeId as string, tags: [...(value.tags as string[])] }));
    }

    case "updateColor": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (value.color !== null && (typeof value.color !== "string" || !HEX_COLOR_PATTERN.test(value.color))) {
        pushErr(errors, "message.color", "must be a #rgb or #rrggbb hex color string, or null to clear it");
      }
      return finish(errors, () => ({ type: "updateColor", nodeId: value.nodeId as string, color: value.color as string | null }));
    }

    case "toggleHighlight": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (typeof value.highlighted !== "boolean") {
        pushErr(errors, "message.highlighted", "must be a boolean");
      }
      return finish(errors, () => ({
        type: "toggleHighlight",
        nodeId: value.nodeId as string,
        highlighted: value.highlighted as boolean,
      }));
    }

    default:
      return { valid: false, errors: [`message.type: unrecognized message type "${type}"`] };
  }
}

function pushErr(errors: string[], path: string, message: string): void {
  errors.push(`${path}: ${message}`);
}

function finish(errors: string[], build: () => WebviewToHostMessage): MessageValidationResult {
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], value: build() };
}

/**
 * Validates `rawMessage` (untrusted input from the Webview) and, if valid,
 * applies the edit it describes to `roadmap`. Returns the original
 * `roadmap` unchanged (with `changed: false`) whenever the message is
 * malformed or refers to a node id that does not exist in `roadmap`, and
 * for messages that carry no persisted edit (`selectNode`, `requestState`).
 *
 * Only ever touches the single targeted node's edited field(s) plus its
 * `updatedAt` timestamp - every other field on that node, every other node,
 * and the roadmap's own edges/settings are passed through unchanged, so a
 * user edit can never clobber unrelated state (including AI-generated
 * summaries or other in-flight edits).
 */
export function applyWebviewMessage(roadmap: Roadmap, rawMessage: unknown): ApplyMessageResult {
  const validation = validateWebviewMessage(rawMessage);
  if (!validation.valid || !validation.value) {
    return { roadmap, errors: validation.errors, changed: false };
  }
  const message = validation.value;

  if (message.type === "selectNode" || message.type === "requestState") {
    // Transient view state only; nothing to persist.
    return { roadmap, errors: [], changed: false };
  }

  const nodeIndex = roadmap.nodes.findIndex((n) => n.id === message.nodeId);
  if (nodeIndex === -1) {
    return { roadmap, errors: [`message.nodeId: no node with id "${message.nodeId}" exists in this roadmap`], changed: false };
  }

  const now = new Date().toISOString();
  const existing = roadmap.nodes[nodeIndex];
  let updated: RoadmapNode;

  switch (message.type) {
    case "moveNode":
      updated = { ...existing, position: { x: message.position.x, y: message.position.y }, updatedAt: now };
      break;
    case "renameNode":
      updated = { ...existing, title: message.title, updatedAt: now };
      break;
    case "updateNotes":
      updated = { ...existing, notes: message.notes, updatedAt: now };
      break;
    case "updateTags":
      updated = { ...existing, tags: message.tags, updatedAt: now };
      break;
    case "updateColor":
      updated = { ...existing, color: message.color ?? undefined, updatedAt: now };
      break;
    case "toggleHighlight":
      updated = { ...existing, highlighted: message.highlighted, updatedAt: now };
      break;
    default: {
      // Exhaustiveness guard: TypeScript ensures every branch above is handled.
      const neverMessage: never = message;
      return { roadmap, errors: [`message.type: unhandled message ${JSON.stringify(neverMessage)}`], changed: false };
    }
  }

  const nodes = [...roadmap.nodes];
  nodes[nodeIndex] = updated;
  return { roadmap: { ...roadmap, nodes, updatedAt: now }, errors: [], changed: true };
}
