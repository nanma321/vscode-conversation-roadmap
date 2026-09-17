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
import {
  NODE_STATUSES,
  NODE_TYPES,
  NodeStatus,
  NodeType,
  Roadmap,
  RoadmapEdge,
  RoadmapNode,
  SourceReference,
} from "./model/types";
import { HEX_COLOR_PATTERN } from "./model/colorPattern";
import { RoadmapHistory } from "./model/roadmapHistory";
import type { TurnRecord } from "./turnStore";

/** Every message shape the graph Webview may send to the extension host. */
export type WebviewToHostMessage =
  | { type: "moveNode"; nodeId: string; position: { x: number; y: number } }
  | { type: "renameNode"; nodeId: string; title: string }
  | { type: "updateStatus"; nodeId: string; status: NodeStatus }
  | { type: "updateNodeType"; nodeId: string; nodeType: NodeType }
  | { type: "updateNotes"; nodeId: string; notes: string }
  | { type: "updateTags"; nodeId: string; tags: string[] }
  | { type: "updateColor"; nodeId: string; color: string | null }
  | { type: "toggleHighlight"; nodeId: string; highlighted: boolean }
  /** Creates a user-defined ("manual") edge between two existing nodes (Phase 6). Distinct from the AI-generated "topic"/"branch" edges the summarizer creates. */
  | { type: "addEdge"; source: string; target: string; label?: string }
  /** Updates an existing edge's endpoints, label, and semantic/display kind. */
  | { type: "updateEdge"; edgeId: string; source: string; target: string; kind: RoadmapEdge["kind"]; label?: string }
  /** Removes a single edge. Destructive - the Webview must confirm with the user before sending this. */
  | { type: "deleteEdge"; edgeId: string }
  /** Merges `sourceNodeId` into `targetNodeId`, combining their provenance/tags/notes and removing the source node. Destructive - the Webview must confirm with the user before sending this. */
  | { type: "mergeNodes"; sourceNodeId: string; targetNodeId: string; title?: string }
  /** Splits the source turns listed in `sourceRefTurnIds` off of `nodeId` into a new node titled `title`, connected back to the original node by a manual edge. */
  | { type: "splitNode"; nodeId: string; title: string; sourceRefTurnIds: string[] }
  /**
   * Starts a new branch from `nodeId` (Phase 7 "Resume from here"): creates a
   * fresh child node linked to the source node by a "branch" edge, seeded with
   * an optional follow-up `question`. The source node and its path are left
   * unchanged. The host also opens a new `@roadmap` interaction from this.
   */
  | { type: "resumeFromNode"; nodeId: string; question?: string }
  /** Restores the roadmap to the state it was in immediately before the most recent transaction. */
  | { type: "undo" }
  /** Re-applies the most recently undone transaction. */
  | { type: "redo" }
  /** Requests host-confirmed deletion of all roadmap graphs while retaining captured transcripts. */
  | { type: "clearAllRoadmaps" }
  | { type: "selectNode"; nodeId: string | null }
  | { type: "requestState" };

/**
 * Every message the extension host sends *to* the graph Webview. The host is
 * trusted, so these are not run through a validator (unlike
 * {@link WebviewToHostMessage}), but are still declared here as the single
 * source of truth for the wire protocol shared by both sides.
 */
export type HostToWebviewMessage =
  | { type: "state"; roadmap: Roadmap; turns: TurnRecord[]; canUndo: boolean; canRedo: boolean }
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

    case "clearAllRoadmaps":
      return { valid: true, errors: [], value: { type: "clearAllRoadmaps" } };

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

    case "updateStatus": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (typeof value.status !== "string" || !NODE_STATUSES.includes(value.status as NodeStatus)) {
        pushErr(errors, "message.status", `must be one of ${NODE_STATUSES.join(", ")}`);
      }
      return finish(errors, () => ({
        type: "updateStatus",
        nodeId: value.nodeId as string,
        status: value.status as NodeStatus,
      }));
    }

    case "updateNodeType": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (typeof value.nodeType !== "string" || !NODE_TYPES.includes(value.nodeType as NodeType)) {
        pushErr(errors, "message.nodeType", `must be one of ${NODE_TYPES.join(", ")}`);
      }
      return finish(errors, () => ({
        type: "updateNodeType",
        nodeId: value.nodeId as string,
        nodeType: value.nodeType as NodeType,
      }));
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

    case "addEdge": {
      if (!isNonEmptyString(value.source)) {
        pushErr(errors, "message.source", "must be a non-empty string");
      }
      if (!isNonEmptyString(value.target)) {
        pushErr(errors, "message.target", "must be a non-empty string");
      }
      if (isNonEmptyString(value.source) && isNonEmptyString(value.target) && value.source === value.target) {
        pushErr(errors, "message.target", "must not be the same node as message.source (no self-loop edges)");
      }
      if (value.label !== undefined && typeof value.label !== "string") {
        pushErr(errors, "message.label", "must be a string when present");
      }
      return finish(errors, () => ({
        type: "addEdge",
        source: value.source as string,
        target: value.target as string,
        label: value.label as string | undefined,
      }));
    }

    case "updateEdge": {
      if (!isNonEmptyString(value.edgeId)) {
        pushErr(errors, "message.edgeId", "must be a non-empty string");
      }
      if (!isNonEmptyString(value.source)) {
        pushErr(errors, "message.source", "must be a non-empty string");
      }
      if (!isNonEmptyString(value.target)) {
        pushErr(errors, "message.target", "must be a non-empty string");
      }
      if (isNonEmptyString(value.source) && isNonEmptyString(value.target) && value.source === value.target) {
        pushErr(errors, "message.target", "must not be the same node as message.source (no self-loop edges)");
      }
      if (value.kind !== "topic" && value.kind !== "branch" && value.kind !== "manual") {
        pushErr(errors, "message.kind", 'must be "topic", "branch", or "manual"');
      }
      if (value.label !== undefined && typeof value.label !== "string") {
        pushErr(errors, "message.label", "must be a string when present");
      }
      return finish(errors, () => ({
        type: "updateEdge",
        edgeId: value.edgeId as string,
        source: value.source as string,
        target: value.target as string,
        kind: value.kind as RoadmapEdge["kind"],
        label: value.label as string | undefined,
      }));
    }

    case "deleteEdge": {
      if (!isNonEmptyString(value.edgeId)) {
        pushErr(errors, "message.edgeId", "must be a non-empty string");
      }
      return finish(errors, () => ({ type: "deleteEdge", edgeId: value.edgeId as string }));
    }

    case "mergeNodes": {
      if (!isNonEmptyString(value.sourceNodeId)) {
        pushErr(errors, "message.sourceNodeId", "must be a non-empty string");
      }
      if (!isNonEmptyString(value.targetNodeId)) {
        pushErr(errors, "message.targetNodeId", "must be a non-empty string");
      }
      if (
        isNonEmptyString(value.sourceNodeId) &&
        isNonEmptyString(value.targetNodeId) &&
        value.sourceNodeId === value.targetNodeId
      ) {
        pushErr(errors, "message.targetNodeId", "must differ from message.sourceNodeId (cannot merge a node into itself)");
      }
      if (value.title !== undefined && (typeof value.title !== "string" || value.title.trim().length === 0)) {
        pushErr(errors, "message.title", "must be a non-empty string when present");
      }
      return finish(errors, () => ({
        type: "mergeNodes",
        sourceNodeId: value.sourceNodeId as string,
        targetNodeId: value.targetNodeId as string,
        title: typeof value.title === "string" ? value.title.trim() : undefined,
      }));
    }

    case "splitNode": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (typeof value.title !== "string" || value.title.trim().length === 0) {
        pushErr(errors, "message.title", "must be a non-empty string");
      }
      if (
        !Array.isArray(value.sourceRefTurnIds) ||
        value.sourceRefTurnIds.length === 0 ||
        !value.sourceRefTurnIds.every((id) => typeof id === "string" && id.length > 0)
      ) {
        pushErr(errors, "message.sourceRefTurnIds", "must be a non-empty array of non-empty strings");
      }
      return finish(errors, () => ({
        type: "splitNode",
        nodeId: value.nodeId as string,
        title: (value.title as string).trim(),
        sourceRefTurnIds: [...(value.sourceRefTurnIds as string[])],
      }));
    }

    case "undo":
      return { valid: true, errors: [], value: { type: "undo" } };

    case "resumeFromNode": {
      if (!isNonEmptyString(value.nodeId)) {
        pushErr(errors, "message.nodeId", "must be a non-empty string");
      }
      if (value.question !== undefined && typeof value.question !== "string") {
        pushErr(errors, "message.question", "must be a string when present");
      }
      return finish(errors, () => ({
        type: "resumeFromNode",
        nodeId: value.nodeId as string,
        question: value.question as string | undefined,
      }));
    }

    case "redo":
      return { valid: true, errors: [], value: { type: "redo" } };

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

/** Generates an id of the form `${prefix}-${n}` that does not collide with any id already in `existingIds`. */
function generateUniqueId(prefix: string, existingIds: ReadonlySet<string>): string {
  let candidate: string;
  let n = existingIds.size + 1;
  do {
    candidate = `${prefix}-${n}`;
    n += 1;
  } while (existingIds.has(candidate));
  return candidate;
}

/** Two source references are the same underlying turn if both their `turnId` and `sessionId` match. */
function sameSourceRef(a: SourceReference, b: SourceReference): boolean {
  return a.turnId === b.turnId && a.sessionId === b.sessionId;
}

/**
 * Unions two nodes' source references without ever dropping a reference:
 * every entry from both `a` and `b` appears in the result, with only exact
 * duplicates (same turn *and* session) collapsed. This is what makes merge
 * provenance-preserving - every source turn either node was derived from is
 * still traceable from the merged node afterwards.
 */
function unionSourceRefs(a: SourceReference[], b: SourceReference[]): SourceReference[] {
  const merged = [...a];
  for (const ref of b) {
    if (!merged.some((existing) => sameSourceRef(existing, ref))) {
      merged.push(ref);
    }
  }
  return merged;
}

function mergeSummaries(targetSummary: string, sourceSummary: string): string {
  const target = targetSummary.trim();
  const source = sourceSummary.trim();
  if (!target) {
    return source;
  }
  if (!source || source === target) {
    return target;
  }
  return `${target}\n\n${source}`;
}

function clearNewMarkers(nodes: RoadmapNode[]): RoadmapNode[] {
  return nodes.map((node) => (node.isNew ? { ...node, isNew: undefined } : node));
}

/**
 * Validates `rawMessage` (untrusted input from the Webview) and, if valid,
 * applies the edit it describes to `roadmap`. Returns the original
 * `roadmap` unchanged (with `changed: false`) whenever the message is
 * malformed or refers to a node/edge id that does not exist in `roadmap`,
 * and for messages that carry no persisted edit (`selectNode`,
 * `requestState`, or an `undo`/`redo` with nothing to undo/redo).
 *
 * `history`, if provided, is used to record each applied transaction (so a
 * later `undo` message can restore the roadmap to exactly its state before
 * that transaction) and to resolve `undo`/`redo` messages themselves. Each
 * call site that wants working undo/redo across multiple messages must pass
 * the *same* {@link RoadmapHistory} instance every time; callers that don't
 * care about undo/redo (e.g. most existing tests) can omit it entirely.
 *
 * Field-level edits (`moveNode`, `renameNode`, etc.) only ever touch the
 * single targeted node's edited field(s) plus its `updatedAt` timestamp -
 * every other field on that node, every other node, and the roadmap's own
 * edges/settings are passed through unchanged, so a user edit can never
 * clobber unrelated state (including AI-generated summaries or other
 * in-flight edits). Structural edits (`addEdge`, `deleteEdge`,
 * `mergeNodes`, `splitNode`) never drop a node's `sourceRefs` - provenance
 * is always redistributed, never discarded.
 */
export function applyWebviewMessage(
  roadmap: Roadmap,
  rawMessage: unknown,
  history?: RoadmapHistory
): ApplyMessageResult {
  const validation = validateWebviewMessage(rawMessage);
  if (!validation.valid || !validation.value) {
    return { roadmap, errors: validation.errors, changed: false };
  }
  const message = validation.value;

  if (
    message.type === "selectNode" ||
    message.type === "requestState" ||
    message.type === "clearAllRoadmaps"
  ) {
    // Transient or host-owned actions; nothing for this pure roadmap applier
    // to persist. The extension host handles clearAllRoadmaps after showing
    // its trusted modal confirmation.
    return { roadmap, errors: [], changed: false };
  }

  if (message.type === "undo") {
    const previous = history?.undo(roadmap);
    if (!previous) {
      return { roadmap, errors: ["undo: no prior state to restore"], changed: false };
    }
    return { roadmap: previous, errors: [], changed: true };
  }

  if (message.type === "redo") {
    const next = history?.redo(roadmap);
    if (!next) {
      return { roadmap, errors: ["redo: no undone state to restore"], changed: false };
    }
    return { roadmap: next, errors: [], changed: true };
  }

  const now = new Date().toISOString();

  if (message.type === "addEdge") {
    if (!roadmap.nodes.some((n) => n.id === message.source)) {
      return { roadmap, errors: [`message.source: no node with id "${message.source}" exists in this roadmap`], changed: false };
    }
    if (!roadmap.nodes.some((n) => n.id === message.target)) {
      return { roadmap, errors: [`message.target: no node with id "${message.target}" exists in this roadmap`], changed: false };
    }
    if (roadmap.edges.some((e) => e.source === message.source && e.target === message.target)) {
      return { roadmap, errors: [`an edge from "${message.source}" to "${message.target}" already exists`], changed: false };
    }
    const edgeIds = new Set(roadmap.edges.map((e) => e.id));
    const edge: RoadmapEdge = {
      id: generateUniqueId("edge", edgeIds),
      source: message.source,
      target: message.target,
      // User-created edges are always "manual" so the graph can always
      // distinguish this semantic-but-user-authored structure from the
      // AI-generated "topic"/"branch" edges and from pure visual layout.
      kind: "manual",
      label: message.label,
    };
    history?.record(roadmap);
    return { roadmap: { ...roadmap, edges: [...roadmap.edges, edge], updatedAt: now }, errors: [], changed: true };
  }

  if (message.type === "updateEdge") {
    const edgeIndex = roadmap.edges.findIndex((edge) => edge.id === message.edgeId);
    if (edgeIndex === -1) {
      return { roadmap, errors: [`message.edgeId: no edge with id "${message.edgeId}" exists in this roadmap`], changed: false };
    }
    if (!roadmap.nodes.some((node) => node.id === message.source)) {
      return { roadmap, errors: [`message.source: no node with id "${message.source}" exists in this roadmap`], changed: false };
    }
    if (!roadmap.nodes.some((node) => node.id === message.target)) {
      return { roadmap, errors: [`message.target: no node with id "${message.target}" exists in this roadmap`], changed: false };
    }
    if (
      roadmap.edges.some(
        (edge) => edge.id !== message.edgeId && edge.source === message.source && edge.target === message.target
      )
    ) {
      return { roadmap, errors: [`an edge from "${message.source}" to "${message.target}" already exists`], changed: false };
    }

    const existing = roadmap.edges[edgeIndex];
    const label = message.label?.trim() || undefined;
    if (
      existing.source === message.source &&
      existing.target === message.target &&
      existing.kind === message.kind &&
      existing.label === label
    ) {
      return { roadmap, errors: [], changed: false };
    }

    const edges = [...roadmap.edges];
    edges[edgeIndex] = {
      ...existing,
      source: message.source,
      target: message.target,
      kind: message.kind,
      label,
    };
    history?.record(roadmap);
    return { roadmap: { ...roadmap, edges, updatedAt: now }, errors: [], changed: true };
  }

  if (message.type === "deleteEdge") {
    if (!roadmap.edges.some((e) => e.id === message.edgeId)) {
      return { roadmap, errors: [`message.edgeId: no edge with id "${message.edgeId}" exists in this roadmap`], changed: false };
    }
    history?.record(roadmap);
    const edges = roadmap.edges.filter((e) => e.id !== message.edgeId);
    return { roadmap: { ...roadmap, edges, updatedAt: now }, errors: [], changed: true };
  }

  if (message.type === "mergeNodes") {
    const source = roadmap.nodes.find((n) => n.id === message.sourceNodeId);
    if (!source) {
      return { roadmap, errors: [`message.sourceNodeId: no node with id "${message.sourceNodeId}" exists in this roadmap`], changed: false };
    }
    const target = roadmap.nodes.find((n) => n.id === message.targetNodeId);
    if (!target) {
      return { roadmap, errors: [`message.targetNodeId: no node with id "${message.targetNodeId}" exists in this roadmap`], changed: false };
    }

    const mergedNotes = [target.notes, source.notes].map((n) => n.trim()).filter((n) => n.length > 0).join("\n\n");
    const mergedNode: RoadmapNode = {
      ...target,
      title: message.title ?? target.title,
      summary: mergeSummaries(target.summary, source.summary),
      isNew: source.isNew || target.isNew ? true : undefined,
      tags: Array.from(new Set([...target.tags, ...source.tags])),
      notes: mergedNotes,
      sourceRefs: unionSourceRefs(target.sourceRefs, source.sourceRefs),
      updatedAt: now,
    };

    // Redirect any edge touching the removed source node to the target
    // node instead of dropping it, then discard any edge that has become a
    // self-loop or an exact duplicate of another edge as a result.
    const redirected = roadmap.edges.map((e) => ({
      ...e,
      source: e.source === message.sourceNodeId ? message.targetNodeId : e.source,
      target: e.target === message.sourceNodeId ? message.targetNodeId : e.target,
    }));
    const seen = new Set<string>();
    const edges = redirected.filter((e) => {
      if (e.source === e.target) {
        return false;
      }
      const key = `${e.source}->${e.target}->${e.kind}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const nodes = roadmap.nodes
      .filter((n) => n.id !== message.sourceNodeId)
      .map((n) => (n.id === message.targetNodeId ? mergedNode : n));

    history?.record(roadmap);
    return { roadmap: { ...roadmap, nodes, edges, updatedAt: now }, errors: [], changed: true };
  }

  if (message.type === "resumeFromNode") {
    const node = roadmap.nodes.find((n) => n.id === message.nodeId);
    if (!node) {
      return { roadmap, errors: [`message.nodeId: no node with id "${message.nodeId}" exists in this roadmap`], changed: false };
    }
    const question = (message.question ?? "").trim();

    // Duplicate guard (plan: "Prevent duplicate ... context"): if an identical
    // resume branch already exists from this node - a "branch" child that has
    // not yet accumulated any captured turns and carries the same follow-up
    // question - do not create a second one (e.g. from an accidental
    // double-send). Distinct follow-ups are always allowed.
    const duplicate = roadmap.edges
      .filter((e) => e.kind === "branch" && e.source === node.id)
      .map((e) => roadmap.nodes.find((n) => n.id === e.target))
      .some((child) => child !== undefined && child.sourceRefs.length === 0 && (child.notes ?? "").trim() === question);
    if (duplicate) {
      return { roadmap, errors: ["a matching resume branch already exists from this node"], changed: false };
    }

    const nodeIds = new Set(roadmap.nodes.map((n) => n.id));
    const branchNode: RoadmapNode = {
      id: generateUniqueId("node", nodeIds),
      title: `Resume: ${node.title}`,
      summary: "",
      status: "open",
      nodeType: "topic",
      isNew: true,
      tags: [],
      // The user's follow-up question (if any) is stored as notes so the intent
      // of the branch is captured even before the resumed turn is answered.
      notes: question,
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    const edgeIds = new Set(roadmap.edges.map((e) => e.id));
    const branchEdge: RoadmapEdge = {
      id: generateUniqueId("edge", edgeIds),
      source: node.id,
      target: branchNode.id,
      // A "branch" edge (not "manual") records that this child was created by
      // resuming from the source node, keeping the branch traceable to its
      // origin per the Phase 7 exit criteria.
      kind: "branch",
      label: "resume",
    };

    history?.record(roadmap);
    return {
      roadmap: {
        ...roadmap,
        nodes: [...clearNewMarkers(roadmap.nodes), branchNode],
        edges: [...roadmap.edges, branchEdge],
        updatedAt: now,
      },
      errors: [],
      changed: true,
    };
  }

  if (message.type === "splitNode") {
    const nodeIndex = roadmap.nodes.findIndex((n) => n.id === message.nodeId);
    if (nodeIndex === -1) {
      return { roadmap, errors: [`message.nodeId: no node with id "${message.nodeId}" exists in this roadmap`], changed: false };
    }
    const node = roadmap.nodes[nodeIndex];
    const requestedIds = new Set(message.sourceRefTurnIds);
    const movedRefs = node.sourceRefs.filter((ref) => requestedIds.has(ref.turnId));
    if (movedRefs.length === 0) {
      return {
        roadmap,
        errors: [`message.sourceRefTurnIds: none of the requested turn ids belong to node "${message.nodeId}"`],
        changed: false,
      };
    }
    const remainingRefs = node.sourceRefs.filter((ref) => !requestedIds.has(ref.turnId));

    const nodeIds = new Set(roadmap.nodes.map((n) => n.id));
    const newNode: RoadmapNode = {
      id: generateUniqueId("node", nodeIds),
      title: message.title,
      summary: "",
      status: "open",
      isNew: true,
      tags: [],
      notes: "",
      sourceRefs: movedRefs,
      createdAt: now,
      updatedAt: now,
    };
    const updatedOriginal: RoadmapNode = {
      ...node,
      isNew: undefined,
      sourceRefs: remainingRefs,
      updatedAt: now,
    };

    const edgeIds = new Set(roadmap.edges.map((e) => e.id));
    const splitEdge: RoadmapEdge = {
      id: generateUniqueId("edge", edgeIds),
      source: node.id,
      target: newNode.id,
      // A split is a user-driven structural edit, not an AI-generated
      // topic/branch, so the connecting edge is "manual" like other
      // user-defined edges.
      kind: "manual",
    };

    const nodes = clearNewMarkers(roadmap.nodes);
    nodes[nodeIndex] = updatedOriginal;
    nodes.push(newNode);

    history?.record(roadmap);
    return { roadmap: { ...roadmap, nodes, edges: [...roadmap.edges, splitEdge], updatedAt: now }, errors: [], changed: true };
  }

  const nodeIndex = roadmap.nodes.findIndex((n) => n.id === message.nodeId);
  if (nodeIndex === -1) {
    return { roadmap, errors: [`message.nodeId: no node with id "${message.nodeId}" exists in this roadmap`], changed: false };
  }

  const existing = roadmap.nodes[nodeIndex];
  let updated: RoadmapNode;

  switch (message.type) {
    case "moveNode":
      updated = { ...existing, position: { x: message.position.x, y: message.position.y }, updatedAt: now };
      break;
    case "renameNode":
      updated = { ...existing, title: message.title, updatedAt: now };
      break;
    case "updateStatus":
      updated = { ...existing, status: message.status, statusEdited: true, updatedAt: now };
      break;
    case "updateNodeType":
      updated = { ...existing, nodeType: message.nodeType, updatedAt: now };
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

  history?.record(roadmap);
  const nodes = [...roadmap.nodes];
  nodes[nodeIndex] = updated;
  return { roadmap: { ...roadmap, nodes, updatedAt: now }, errors: [], changed: true };
}
