/**
 * Resume-context construction (Phase 7).
 *
 * "Resume from here" lets a user start a *new* branch of conversation seeded
 * with the context that led up to a selected roadmap node. This module builds
 * that context deterministically from the selected node and its ancestor path
 * through the graph, and formats both a human-readable preview (shown to the
 * user before anything is sent, per the product design: "Explain what context
 * will be sent before a resume operation") and the final `@roadmap`-addressed
 * query.
 *
 * It is intentionally free of any dependency on `vscode` or the DOM so the
 * exact same construction runs in three places without drift:
 *   - the Webview, to render the preview,
 *   - the extension host, to build the query it hands to the chat, and
 *   - unit tests, in isolation.
 *
 * Two safeguards are built in (plan: "Prevent duplicate or oversized
 * context"):
 *   - de-duplication: a turn referenced by more than one node on the path is
 *     included only once, and graph cycles cannot cause infinite traversal, and
 *   - size bounding: the number of included turns and the total character
 *     count are capped; the oldest (farthest-ancestor) turns are dropped first
 *     because the selected node's own context is the most relevant, and the
 *     result is flagged as truncated so the preview can say so.
 */
import { Roadmap, TurnReference } from "../model/types";

/** A minimal view of a captured turn needed to build resume context. Matches the relevant subset of `TurnRecord`/`Turn`. */
export interface ResumeSourceTurn {
  id: string;
  sessionId: string;
  request: string;
  response: string;
  references?: TurnReference[];
}

/** One turn included in the resume context, tagged with the node it was reached through. */
export interface ResumeContextTurn {
  turnId: string;
  sessionId: string;
  nodeId: string;
  nodeTitle: string;
  request: string;
  response: string;
}

/** The fully constructed resume context for a selected node. */
export interface ResumeContext {
  /** The node the user chose to resume from. */
  sourceNodeId: string;
  sourceNodeTitle: string;
  /** Ordered node ids on the ancestor path, farthest ancestor first, selected node last. */
  pathNodeIds: string[];
  /** De-duplicated turns that make up the context, in path order (oldest first). */
  turns: ResumeContextTurn[];
  /** Human-readable preview text shown to the user before sending. */
  previewText: string;
  /** True when size caps dropped one or more turns (or truncated text). */
  truncated: boolean;
  /** How many turns were dropped by the size caps. */
  droppedTurnCount: number;
}

/** Tunable safeguards against oversized context. */
export interface ResumeContextOptions {
  /** Maximum number of turns to include; oldest are dropped first. */
  maxTurns?: number;
  /** Maximum total characters of assembled turn text; oldest turns are dropped, then the last is truncated, to fit. */
  maxChars?: number;
}

export const DEFAULT_MAX_TURNS = 24;
export const DEFAULT_MAX_CHARS = 12000;
const RESUME_MARKER_PATTERN =
  /<!--\s*conversation-roadmap:resume=([A-Za-z0-9._:-]{1,200})\s*-->/;
const ANY_RESUME_MARKER_PATTERN =
  /<!--\s*conversation-roadmap:resume=[\s\S]*?-->/g;

/**
 * Collects the selected node plus all of its transitive ancestors (nodes that
 * can reach it by following edges), ordered farthest-ancestor-first with the
 * selected node last. Visiting is de-duplicated and bounded by the node count
 * so a cyclic graph cannot cause infinite traversal.
 */
function collectPathNodeIds(roadmap: Roadmap, selectedNodeId: string): string[] {
  const nodeExists = (id: string): boolean => roadmap.nodes.some((n) => n.id === id);
  const parentsOf = new Map<string, string[]>();
  for (const edge of roadmap.edges) {
    const list = parentsOf.get(edge.target) ?? [];
    list.push(edge.source);
    parentsOf.set(edge.target, list);
  }

  // Longest-path distance from the selected node, bounded to avoid cycles.
  const distance = new Map<string, number>();
  distance.set(selectedNodeId, 0);
  const queue: string[] = [selectedNodeId];
  const maxDistance = roadmap.nodes.length;
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentDistance = distance.get(current) as number;
    if (currentDistance >= maxDistance) {
      // Reached the node-count bound; any further expansion must be revisiting
      // a cycle rather than discovering a genuinely deeper ancestor.
      continue;
    }
    for (const parent of parentsOf.get(current) ?? []) {
      const candidate = currentDistance + 1;
      if (!distance.has(parent) || candidate > (distance.get(parent) as number)) {
        distance.set(parent, candidate);
        queue.push(parent);
      }
    }
  }

  return [...distance.entries()]
    .filter(([id]) => nodeExists(id))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

function formatPreview(context: Omit<ResumeContext, "previewText">): string {
  const lines: string[] = [];
  lines.push(`Resuming from roadmap node: "${context.sourceNodeTitle}"`);
  lines.push("");
  lines.push("This will start a NEW branch seeded with the context below. Your");
  lines.push("original conversation and roadmap path are left unchanged.");
  lines.push("");
  if (context.turns.length === 0) {
    lines.push("(No source messages are recorded on this path yet.)");
  } else {
    lines.push("Context from the conversation path leading to this point:");
    lines.push("");
    context.turns.forEach((turn, index) => {
      lines.push(`[${index + 1}] ${turn.nodeTitle}`);
      lines.push(`Request: ${turn.request}`);
      lines.push(`Response: ${turn.response || "(no response)"}`);
      lines.push("");
    });
  }
  if (context.truncated) {
    lines.push(
      `(Context was trimmed to stay within size limits; ${context.droppedTurnCount} earlier turn(s) omitted.)`
    );
  }
  return lines.join("\n").trimEnd();
}

/**
 * Builds the resume context for `selectedNodeId`. Returns an empty-turn
 * context (never throws) when the node does not exist, so callers can render a
 * harmless preview rather than crash on stale selection.
 */
export function buildResumeContext(
  roadmap: Roadmap,
  selectedNodeId: string,
  turnsById: ReadonlyMap<string, ResumeSourceTurn>,
  options: ResumeContextOptions = {}
): ResumeContext {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  const selected = roadmap.nodes.find((n) => n.id === selectedNodeId);
  const sourceNodeTitle = selected?.title ?? "(unknown node)";

  if (!selected) {
    const empty: Omit<ResumeContext, "previewText"> = {
      sourceNodeId: selectedNodeId,
      sourceNodeTitle,
      pathNodeIds: [],
      turns: [],
      truncated: false,
      droppedTurnCount: 0,
    };
    return { ...empty, previewText: formatPreview(empty) };
  }

  const pathNodeIds = collectPathNodeIds(roadmap, selectedNodeId);

  // Gather turns in path order (oldest ancestor first), de-duplicating any turn
  // referenced by more than one node so it is never included twice.
  const seenTurnKeys = new Set<string>();
  const collected: ResumeContextTurn[] = [];
  for (const nodeId of pathNodeIds) {
    const node = roadmap.nodes.find((n) => n.id === nodeId);
    if (!node) {
      continue;
    }
    for (const ref of node.sourceRefs) {
      const key = `${ref.sessionId}::${ref.turnId}`;
      if (seenTurnKeys.has(key)) {
        continue;
      }
      const turn = turnsById.get(ref.turnId);
      if (!turn) {
        continue;
      }
      seenTurnKeys.add(key);
      collected.push({
        turnId: turn.id,
        sessionId: turn.sessionId,
        nodeId: node.id,
        nodeTitle: node.title,
        request: turn.request,
        response: turn.response,
      });
    }
  }

  let droppedTurnCount = 0;
  let turns = collected;

  // Cap 1: number of turns. Keep the most recent (closest to the selected
  // node), dropping the oldest first.
  if (turns.length > maxTurns) {
    droppedTurnCount += turns.length - maxTurns;
    turns = turns.slice(turns.length - maxTurns);
  }

  // Cap 2: total characters. Drop whole oldest turns until the remainder fits;
  // if a single most-recent turn still exceeds the budget on its own, truncate
  // its response text so at least the request survives.
  const turnLength = (t: ResumeContextTurn): number => t.request.length + t.response.length;
  let totalChars = turns.reduce((sum, t) => sum + turnLength(t), 0);
  while (turns.length > 1 && totalChars > maxChars) {
    const removed = turns[0];
    totalChars -= turnLength(removed);
    turns = turns.slice(1);
    droppedTurnCount += 1;
  }
  if (turns.length === 1 && totalChars > maxChars) {
    const only = turns[0];
    const room = Math.max(0, maxChars - only.request.length);
    const truncatedResponse = only.response.slice(0, room) + (room < only.response.length ? "…" : "");
    turns = [{ ...only, response: truncatedResponse }];
  }

  const truncated = droppedTurnCount > 0 || totalChars > maxChars;

  const partial: Omit<ResumeContext, "previewText"> = {
    sourceNodeId: selectedNodeId,
    sourceNodeTitle,
    pathNodeIds,
    turns,
    truncated,
    droppedTurnCount,
  };
  return { ...partial, previewText: formatPreview(partial) };
}

/**
 * Formats the final query string to seed a new `@roadmap` interaction with.
 * The `@roadmap` mention addresses the participant so the resumed turn is
 * captured exactly like any other (preserving the Phase 1 limitation that only
 * `@roadmap` messages are accessible). The user's optional follow-up question
 * is appended after the reconstructed context.
 */
export function formatResumeQuery(
  context: ResumeContext,
  question?: string,
  resumeNodeId?: string
): string {
  const parts: string[] = [`@roadmap Resuming from "${context.sourceNodeTitle}".`, ""];
  if (context.turns.length > 0) {
    parts.push("Prior context:");
    context.turns.forEach((turn, index) => {
      parts.push(`[${index + 1}] ${turn.nodeTitle}`);
      parts.push(`Q: ${turn.request}`);
      parts.push(`A: ${turn.response || "(no response)"}`);
      parts.push("");
    });
  }
  const trimmedQuestion = (question ?? "").trim();
  if (trimmedQuestion.length > 0) {
    parts.push(`Follow-up: ${trimmedQuestion}`);
  } else {
    parts.push("Continue from here.");
  }
  if (resumeNodeId) {
    parts.push("", `<!-- conversation-roadmap:resume=${resumeNodeId} -->`);
  }
  return parts.join("\n").trimEnd();
}

/** Extracts trusted resume metadata and removes every internal marker from the visible/model prompt. */
export function parseResumePrompt(prompt: string): {
  prompt: string;
  resumeNodeId?: string;
} {
  const match = RESUME_MARKER_PATTERN.exec(prompt);
  return {
    prompt: prompt.replace(ANY_RESUME_MARKER_PATTERN, "").trimEnd(),
    resumeNodeId: match?.[1],
  };
}
