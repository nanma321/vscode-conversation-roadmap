/**
 * Domain model for the persisted roadmap graph (Phase 2).
 *
 * These interfaces describe the durable, versioned data that survives an
 * extension restart and round-trips through export/import (Phase 8). They
 * are intentionally decoupled from `vscode` so they can be validated and
 * unit-tested without the extension host, mirroring the approach already
 * used by `turnStore.ts`.
 *
 * `TurnRecord` (see `turnStore.ts`) remains the Phase 1/3 capture format for
 * raw `@roadmap` request/response exchanges. `Turn` below is the domain-model
 * representation of that same exchange once it is addressable from the
 * graph (via {@link SourceReference}), so a node's provenance can always be
 * traced back to the exact source messages it was generated from.
 */

/** Current version of the on-disk roadmap document schema. Bump on any breaking shape change and add a migration (see `migrations.ts`). */
export const CURRENT_SCHEMA_VERSION = 1;

/** Supported lifecycle states, shared by validation, filtering, and editing controls. */
export const NODE_STATUSES = ["open", "in-progress", "done", "blocked"] as const;

/** Lifecycle status of a roadmap node, set by summarization (Phase 4) or the user (Phase 5/6). */
export type NodeStatus = (typeof NODE_STATUSES)[number];

/**
 * What kind of thing a node represents, as extracted by incremental
 * summarization (Phase 4): a topic (the default, a conversational thread)
 * or one of the specific item categories the summarizer looks for within a
 * topic. Optional/absent on nodes persisted before this field existed,
 * which are treated as `"topic"` nodes.
 */
export const NODE_TYPES = ["topic", "decision", "question", "task", "outcome", "blocker"] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** How an edge was created; used to distinguish semantic graph structure from pure layout (Phase 6). */
export type EdgeKind = "topic" | "branch" | "manual";

/**
 * A pointer from a roadmap node back to the exact captured turn(s) it was
 * derived from. Preserving this is a Key Engineering Principle: every
 * generated node must be traceable to its source messages.
 */
export interface SourceReference {
  /** Id of the {@link TurnRecord}/{@link Turn} this reference points to. */
  turnId: string;
  /** Session the referenced turn belongs to, so lookups don't require scanning every session. */
  sessionId: string;
}

/** The domain-model representation of one captured `@roadmap` request/response exchange. */
export interface Turn {
  /** Stable identifier for this turn. Matches `TurnRecord.id` for turns captured via `turnStore.ts`. */
  id: string;
  /** Identifier grouping turns that belong to the same chat conversation. */
  sessionId: string;
  /** ISO-8601 timestamp of when the turn was recorded. */
  timestamp: string;
  /** The user's request text, exactly as received by the participant handler. */
  request: string;
  /** The concatenated response text produced by the participant, if any. */
  response: string;
  /** Whether the response completed successfully (false for cancelled/errored turns). */
  completed: boolean;
  /** Supported references (e.g. files or selections) attached to the request. Matches `TurnRecord.references`. */
  references: TurnReference[];
}

/** Matches `TurnRecord`'s `TurnReference` shape (see `turnStore.ts`) at the domain-model level. */
export interface TurnReference {
  /** Identifier for this kind of reference, as assigned by VS Code. */
  id: string;
  /** Optional human-readable description of the reference, if supplied. */
  description?: string;
  /** Which supported shape the original reference value had. */
  kind: "text" | "uri" | "location";
  /** Serialized textual representation of the reference's value. */
  value: string;
}

/** 2D layout position for a node in the graph Webview (Phase 5). Manual positions must never be silently overwritten. */
export interface NodePosition {
  x: number;
  y: number;
}

/** A single node in the roadmap graph: a topic, decision, question, task, or outcome derived from one or more turns. */
export interface RoadmapNode {
  /** Stable identifier for this node, unique within its roadmap. */
  id: string;
  /** Short user-facing title. */
  title: string;
  /** Longer-form summary text (may be AI-generated or user-edited). */
  summary: string;
  /** Current lifecycle status. */
  status: NodeStatus;
  /** True after the user changes status, preventing later automatic summaries from overwriting it. */
  statusEdited?: boolean;
  /** True for the most recently created node or creation batch, until a newer node is created. */
  isNew?: boolean;
  /**
   * What kind of thing this node represents (topic, decision, question, task,
   * outcome, or blocker). Optional for backward compatibility with documents
   * persisted before Phase 4; absent means `"topic"`.
   */
  nodeType?: NodeType;
  /** Free-form user tags for filtering/search (Phase 8). */
  tags: string[];
  /** User-authored notes, distinct from the (possibly AI-generated) summary. Never overwritten automatically. */
  notes: string;
  /** Manual layout position, if the user has moved this node; undefined means "let the layout engine place it". */
  position?: NodePosition;
  /**
   * User-chosen display color for this node in the graph Webview (Phase 5),
   * as a `#rgb` or `#rrggbb` hex string. Undefined means "use the default
   * color for this node's type/status". Never set automatically.
   */
  color?: string;
  /**
   * Whether the user has highlighted this node in the graph Webview (Phase
   * 5), e.g. to call out a node of current interest. Purely a user-facing
   * affordance; never set automatically.
   */
  highlighted?: boolean;
  /** Source turns this node was derived from. Must contain at least one entry for AI-generated nodes. */
  sourceRefs: SourceReference[];
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent edit. */
  updatedAt: string;
}

/** A directed connection between two nodes in the graph. */
export interface RoadmapEdge {
  /** Stable identifier for this edge, unique within its roadmap. */
  id: string;
  /** Id of the source {@link RoadmapNode}. */
  source: string;
  /** Id of the target {@link RoadmapNode}. */
  target: string;
  /** How this edge was created; used to distinguish semantic structure from visual layout. */
  kind: EdgeKind;
  /** Optional user-facing label for the edge. */
  label?: string;
}

/** Per-roadmap user preferences that should persist alongside the graph. */
export interface RoadmapSettings {
  /** Whether incremental AI summarization (Phase 4) is enabled for this roadmap. */
  autoSummarize: boolean;
  /** Whether the graph layout is recomputed automatically or left to manual positions. */
  layout: "auto" | "manual";
}

/** A single roadmap graph: one or more sessions' worth of nodes and edges plus settings. */
export interface Roadmap {
  /** Stable identifier for this roadmap. */
  id: string;
  /** User-facing title. */
  title: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent edit. */
  updatedAt: string;
  /** Nodes in this roadmap's graph. */
  nodes: RoadmapNode[];
  /** Edges connecting this roadmap's nodes. */
  edges: RoadmapEdge[];
  /** Per-roadmap settings. */
  settings: RoadmapSettings;
}

/**
 * The versioned, on-disk document shape. This is the unit of persistence,
 * schema validation, migration, and export/import (Phase 8). `version`
 * identifies the schema this document conforms to; see `migrations.ts` for
 * how older versions are upgraded to {@link CURRENT_SCHEMA_VERSION}.
 */
export interface RoadmapDocument {
  version: number;
  roadmaps: Roadmap[];
}

/** Returns a new, empty settings object with documented defaults. */
export function createDefaultSettings(): RoadmapSettings {
  return { autoSummarize: true, layout: "auto" };
}

/** Returns a new, empty roadmap document at the current schema version. */
export function createEmptyDocument(): RoadmapDocument {
  return { version: CURRENT_SCHEMA_VERSION, roadmaps: [] };
}
