/**
 * The model response schema for incremental summarization (Phase 4).
 *
 * This is the contract between the structured summarization prompt (see
 * `prompt.ts`) and the rest of the extension: the language model is asked
 * to reply with JSON matching {@link ModelSummaryResponse}, and
 * {@link validateModelSummaryResponse} is the single gate all such
 * responses pass through before being trusted, mirroring how
 * `model/schema.ts` gates persisted documents. Per the Key Engineering
 * Principles, invalid model output must never be applied - see
 * `applySummary.ts` for how a failed validation here leaves the previous
 * graph unchanged.
 */
import { NODE_STATUSES, NODE_TYPES, NodeStatus, NodeType } from "../model/types";

/** The kind of thing an extracted node represents. `"topic"` is a conversational thread; the rest are items found within one. */
export type ExtractedNodeKind = NodeType;

/**
 * How an extracted node relates to the existing graph:
 * - `"continue"`: this is an update to the existing node `targetNodeId` (conservative default - prefer this over creating new nodes).
 * - `"topic"`: a new node, sequentially following `targetNodeId` (or the graph root, if `targetNodeId` is omitted) via a "topic" edge.
 * - `"branch"`: a new node, created as an explicit topic shift/branch off of `targetNodeId` via a "branch" edge.
 */
export type NodeRelation = "continue" | "topic" | "branch";

/** One node the model believes should exist in (or be updated in) the roadmap graph, derived from one or more source turns. */
export interface ExtractedNode {
  /** Identifier unique within this response only, used so later entries in the same response can reference nodes created earlier in it (e.g. a branch off a topic created in the same batch). */
  localId: string;
  kind: ExtractedNodeKind;
  /** Short user-facing title. Required and non-empty. */
  title: string;
  /** Summary text for this node. Required and non-empty - an empty summary is not useful. */
  summary: string;
  /** Optional lifecycle status; defaults to `"open"` when omitted. */
  status?: NodeStatus;
  /** Optional tags to attach; merged (never removing existing tags) when continuing an existing node. */
  tags?: string[];
  /**
   * Ids of turns (from the batch of turns given to the model) this node was
   * derived from. Must be non-empty - every generated node must cite at
   * least one source turn - and every id must be one of the turns actually
   * given to the model in this batch.
   */
  sourceTurnIds: string[];
  relation: NodeRelation;
  /**
   * Required for `"continue"` and `"branch"`, optional for `"topic"` (a
   * `"topic"` node with no `targetNodeId` starts a new, unconnected root
   * thread - intended for when the roadmap has no nodes yet, or the model is
   * deliberately starting an independent topic). This is not structurally
   * enforced by the applier: any `"topic"` node without a `targetNodeId` is
   * accepted regardless of existing graph state, trusting the model's
   * judgement per the prompt's instructions. Refers either to an existing
   * roadmap node id, or to another node's `localId` from earlier in this
   * same response.
   */
  targetNodeId?: string;
}

/** The top-level shape a model response must have. */
export interface ModelSummaryResponse {
  schemaVersion: 1;
  nodes: ExtractedNode[];
}

/** The result of validating an unknown value against {@link ModelSummaryResponse}. */
export interface SummaryValidationResult {
  valid: boolean;
  /** Human-readable, path-prefixed error messages. Empty when `valid` is true. */
  errors: string[];
  /** The validated value, narrowed to {@link ModelSummaryResponse}. Only meaningful when `valid` is true. */
  value?: ModelSummaryResponse;
}

const EXTRACTED_NODE_KINDS: readonly ExtractedNodeKind[] = NODE_TYPES;
const NODE_RELATIONS: readonly NodeRelation[] = ["continue", "topic", "branch"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function pushError(errors: string[], path: string, message: string): void {
  errors.push(`${path}: ${message}`);
}

function validateExtractedNode(
  value: unknown,
  path: string,
  errors: string[],
  knownTurnIds: ReadonlySet<string>,
  seenLocalIds: Set<string>
): value is ExtractedNode {
  if (!isPlainObject(value)) {
    pushError(errors, path, "must be an object");
    return false;
  }
  let ok = true;

  if (!isNonEmptyString(value.localId)) {
    pushError(errors, `${path}.localId`, "must be a non-empty string");
    ok = false;
  } else if (seenLocalIds.has(value.localId)) {
    pushError(errors, `${path}.localId`, `duplicate localId "${value.localId}" within this response`);
    ok = false;
  } else {
    seenLocalIds.add(value.localId);
  }

  if (typeof value.kind !== "string" || !EXTRACTED_NODE_KINDS.includes(value.kind as ExtractedNodeKind)) {
    pushError(errors, `${path}.kind`, `must be one of ${EXTRACTED_NODE_KINDS.join(", ")}`);
    ok = false;
  }

  if (!isNonEmptyString(value.title)) {
    pushError(errors, `${path}.title`, "must be a non-empty string");
    ok = false;
  }

  if (!isNonEmptyString(value.summary)) {
    pushError(errors, `${path}.summary`, "must be a non-empty string");
    ok = false;
  }

  if (value.status !== undefined && (typeof value.status !== "string" || !NODE_STATUSES.includes(value.status as NodeStatus))) {
    pushError(errors, `${path}.status`, `must be one of ${NODE_STATUSES.join(", ")} when present`);
    ok = false;
  }

  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string"))) {
    pushError(errors, `${path}.tags`, "must be an array of strings when present");
    ok = false;
  }

  if (!Array.isArray(value.sourceTurnIds) || value.sourceTurnIds.length === 0) {
    pushError(errors, `${path}.sourceTurnIds`, "must be a non-empty array of turn ids - every node must cite a source turn");
    ok = false;
  } else {
    value.sourceTurnIds.forEach((turnId, i) => {
      if (typeof turnId !== "string" || turnId.length === 0) {
        pushError(errors, `${path}.sourceTurnIds[${i}]`, "must be a non-empty string");
        ok = false;
      } else if (!knownTurnIds.has(turnId)) {
        pushError(errors, `${path}.sourceTurnIds[${i}]`, `references turn id "${turnId}" not present in the given turn batch`);
        ok = false;
      }
    });
  }

  if (typeof value.relation !== "string" || !NODE_RELATIONS.includes(value.relation as NodeRelation)) {
    pushError(errors, `${path}.relation`, `must be one of ${NODE_RELATIONS.join(", ")}`);
    ok = false;
  } else {
    const relation = value.relation as NodeRelation;
    if ((relation === "continue" || relation === "branch") && !isNonEmptyString(value.targetNodeId)) {
      pushError(errors, `${path}.targetNodeId`, `must be a non-empty string when relation is "${relation}"`);
      ok = false;
    }
    if (value.targetNodeId !== undefined && !isNonEmptyString(value.targetNodeId)) {
      pushError(errors, `${path}.targetNodeId`, "must be a non-empty string when present");
      ok = false;
    }
  }

  return ok;
}

/**
 * Validates an arbitrary parsed-JSON value (the raw model output) as a
 * {@link ModelSummaryResponse}. `knownTurnIds` must be the ids of exactly
 * the turns given to the model in this batch, so any `sourceTurnIds` entry
 * that isn't one of them is rejected - the model may only cite turns it was
 * actually shown.
 *
 * This performs structural/enum validation only; cross-node reference
 * resolution (whether a `targetNodeId` actually resolves to an existing
 * roadmap node or an earlier node in this same response) is the
 * responsibility of `applySummary.ts`, since it requires knowledge of the
 * existing roadmap graph.
 */
export function validateModelSummaryResponse(
  raw: unknown,
  knownTurnIds: ReadonlySet<string>
): SummaryValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { valid: false, errors: ["response: must be an object"] };
  }

  if (raw.schemaVersion !== 1) {
    pushError(errors, "response.schemaVersion", `must equal 1; got ${JSON.stringify(raw.schemaVersion)}`);
  }

  if (!Array.isArray(raw.nodes)) {
    pushError(errors, "response.nodes", "must be an array");
  } else {
    const seenLocalIds = new Set<string>();
    raw.nodes.forEach((node, i) => {
      validateExtractedNode(node, `response.nodes[${i}]`, errors, knownTurnIds, seenLocalIds);
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], value: raw as unknown as ModelSummaryResponse };
}
