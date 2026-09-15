/**
 * Session filtering for the cumulative roadmap graph.
 *
 * The roadmap graph is deliberately cumulative: every chat's summarized turns
 * accumulate into one persistent graph. That can make the graph busy once
 * several chats have been captured, so this module lets the Webview optionally
 * narrow the graph to a single chat session while leaving the underlying,
 * persisted roadmap untouched (filtering is a pure, view-only transform).
 *
 * A node's session membership is derived from the sessions of the turns it was
 * summarized from (`sourceRefs[].sessionId`). Nodes that have no source turns
 * yet - e.g. a freshly created "resume" branch - carry no session, so they are
 * kept under every filter rather than vanishing.
 *
 * Kept free of `vscode`/DOM so it is unit-testable and cannot diverge from what
 * the graph renders.
 */
import { Roadmap } from "../model/types";
import type { TurnRecord } from "../turnStore";
import { LEGACY_SESSION_ID } from "../legacySessionId";

export interface SessionOption {
  id: string;
  label: string;
  /** How many roadmap nodes belong to this session. */
  nodeCount: number;
}

/** Session ids a node belongs to, derived from the turns it was summarized from. */
export function nodeSessionIds(sourceRefs: { sessionId: string }[]): Set<string> {
  return new Set(sourceRefs.map((r) => r.sessionId));
}

/**
 * The order sessions first appear across `turns` (oldest first), used to label
 * them consistently with the transcript view's "Chat N" chips.
 */
function sessionOrder(turns: TurnRecord[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    const sid = turn.sessionId || LEGACY_SESSION_ID;
    if (!seen.has(sid)) {
      seen.add(sid);
      order.push(sid);
    }
  }
  return order;
}

/**
 * Builds the list of sessions that actually have nodes in `roadmap`, labeled
 * ("Chat N", or "Earlier turns" for the legacy session) using the same
 * first-appearance ordering as the transcript view.
 */
export function deriveSessionOptions(roadmap: Roadmap, turns: TurnRecord[]): SessionOption[] {
  const counts = new Map<string, number>();
  for (const node of roadmap.nodes) {
    for (const sid of nodeSessionIds(node.sourceRefs)) {
      counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
  }

  const order = sessionOrder(turns);
  const labelFor = (sid: string): string => {
    if (sid === LEGACY_SESSION_ID) {
      return "Earlier turns";
    }
    const index = order.indexOf(sid);
    return index >= 0 ? `Chat ${index + 1}` : "Other";
  };

  // Sessions that have nodes, ordered by first appearance; any node session not
  // present in the turn ordering (unexpected) is appended at the end.
  const orderedIds = [
    ...order.filter((sid) => counts.has(sid)),
    ...[...counts.keys()].filter((sid) => !order.includes(sid)),
  ];

  return orderedIds.map((id) => ({ id, label: labelFor(id), nodeCount: counts.get(id) ?? 0 }));
}

/**
 * Returns a view of `roadmap` narrowed to `sessionId`. Passing `null` returns
 * the roadmap unchanged. A node is kept if it has no source turns (so
 * provenance-less user nodes never disappear) or if any of its source turns
 * belong to `sessionId`; edges are kept only when both endpoints remain.
 */
export function filterRoadmapBySession(roadmap: Roadmap, sessionId: string | null): Roadmap {
  if (!sessionId) {
    return roadmap;
  }
  const nodes = roadmap.nodes.filter(
    (n) => n.sourceRefs.length === 0 || n.sourceRefs.some((r) => r.sessionId === sessionId)
  );
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges = roadmap.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
  return { ...roadmap, nodes, edges };
}
