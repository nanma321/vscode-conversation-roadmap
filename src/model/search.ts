/**
 * Graph and transcript search + filtering (Phase 8).
 *
 * Search must locate both AI/user-authored node text (title, summary,
 * notes, tags) *and* the raw source transcript a node was derived from, so
 * a user can find a topic either by how it was summarized or by exactly
 * what was said. Filters (type, status, tags, highlighted, branches) are
 * independent of the free-text query and can be combined with it or used
 * on their own to narrow the visible graph.
 *
 * Like `resumeContext.ts` and `webviewMessages.ts`, this module has no
 * dependency on `vscode` or the DOM so the exact same matching logic runs
 * in the Webview (to drive the search box/filters live) and in unit tests.
 */
import { NodeStatus, NodeType, Roadmap, RoadmapNode } from "./types";

/** A minimal view of a captured turn needed for transcript search. Matches the relevant subset of `TurnRecord`/`Turn`. */
export interface SearchableTurn {
  id: string;
  request: string;
  response: string;
}

/** Which field(s) of a node (and/or its source transcript) matched a search query. */
export type SearchMatchField = "title" | "summary" | "notes" | "tags" | "transcript";

/** One node's search result: which fields matched and, for a transcript match, which turns matched. */
export interface SearchMatch {
  nodeId: string;
  matchedFields: SearchMatchField[];
  /** Ids of source turns whose request/response text matched the query. Empty unless `matchedFields` includes `"transcript"`. */
  matchedTurnIds: string[];
}

/** Independent, combinable filters over the roadmap's nodes. All are optional; an absent filter imposes no constraint. */
export interface SearchFilters {
  /** Node must have one of these `nodeType`s. A node with no `nodeType` is treated as `"topic"`. */
  types?: NodeType[];
  /** Node must have one of these statuses. */
  statuses?: NodeStatus[];
  /** Node must have at least one of these tags. */
  tags?: string[];
  /** When true, only nodes with `highlighted: true` pass. */
  highlightedOnly?: boolean;
  /** When true, only nodes reached via a "branch" edge (i.e. created by "Resume from here", Phase 7) pass. */
  branchesOnly?: boolean;
}

function matchesTypeFilter(node: RoadmapNode, types: readonly NodeType[] | undefined): boolean {
  if (!types || types.length === 0) {
    return true;
  }
  const effectiveType: NodeType = node.nodeType ?? "topic";
  return types.includes(effectiveType);
}

function matchesStatusFilter(node: RoadmapNode, statuses: readonly NodeStatus[] | undefined): boolean {
  if (!statuses || statuses.length === 0) {
    return true;
  }
  return statuses.includes(node.status);
}

function matchesTagsFilter(node: RoadmapNode, tags: readonly string[] | undefined): boolean {
  if (!tags || tags.length === 0) {
    return true;
  }
  return tags.some((tag) => node.tags.includes(tag));
}

/** Ids of nodes that are the *target* of at least one "branch" edge, i.e. resume branches (Phase 7). */
function collectBranchNodeIds(roadmap: Roadmap): Set<string> {
  const ids = new Set<string>();
  for (const edge of roadmap.edges) {
    if (edge.kind === "branch") {
      ids.add(edge.target);
    }
  }
  return ids;
}

/**
 * Returns true if `node` satisfies every constraint in `filters`. Filters
 * combine with AND (a node must satisfy all of them); the `tags` filter
 * itself combines with OR (any one listed tag is enough).
 */
export function matchesFilters(node: RoadmapNode, filters: SearchFilters, branchNodeIds?: ReadonlySet<string>): boolean {
  if (!matchesTypeFilter(node, filters.types)) {
    return false;
  }
  if (!matchesStatusFilter(node, filters.statuses)) {
    return false;
  }
  if (!matchesTagsFilter(node, filters.tags)) {
    return false;
  }
  if (filters.highlightedOnly && !node.highlighted) {
    return false;
  }
  if (filters.branchesOnly && !(branchNodeIds?.has(node.id) ?? false)) {
    return false;
  }
  return true;
}

/** Returns the roadmap's nodes that satisfy `filters`, with no free-text query applied. */
export function filterNodes(roadmap: Roadmap, filters: SearchFilters): RoadmapNode[] {
  const branchNodeIds = filters.branchesOnly ? collectBranchNodeIds(roadmap) : undefined;
  return roadmap.nodes.filter((node) => matchesFilters(node, filters, branchNodeIds));
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function includesQuery(haystack: string, query: string): boolean {
  return normalize(haystack).includes(query);
}

/**
 * Searches `roadmap` (and, for transcript matches, `turns`) for `query`,
 * restricted to nodes that also satisfy `filters`. An empty/whitespace-only
 * query matches every node that passes the filters (so filters alone can
 * narrow the view without any free text). The query is matched
 * case-insensitively as a substring against node title/summary/notes/tags
 * and, for transcript search, each source turn's request/response text.
 *
 * `turns` may be a subset or superset of the roadmap's turns (e.g. only one
 * session's worth); a source reference whose turn is not present in
 * `turns` simply cannot produce a transcript match, exactly like a dangling
 * reference produces no crash elsewhere in the extension.
 */
export function searchRoadmap(
  roadmap: Roadmap,
  turns: readonly SearchableTurn[],
  query: string,
  filters: SearchFilters = {}
): SearchMatch[] {
  const trimmedQuery = normalize(query.trim());
  const branchNodeIds = filters.branchesOnly ? collectBranchNodeIds(roadmap) : undefined;
  const turnsById = new Map(turns.map((t) => [t.id, t]));

  const results: SearchMatch[] = [];
  for (const node of roadmap.nodes) {
    if (!matchesFilters(node, filters, branchNodeIds)) {
      continue;
    }

    if (trimmedQuery.length === 0) {
      results.push({ nodeId: node.id, matchedFields: [], matchedTurnIds: [] });
      continue;
    }

    const matchedFields: SearchMatchField[] = [];
    if (includesQuery(node.title, trimmedQuery)) {
      matchedFields.push("title");
    }
    if (includesQuery(node.summary, trimmedQuery)) {
      matchedFields.push("summary");
    }
    if (includesQuery(node.notes, trimmedQuery)) {
      matchedFields.push("notes");
    }
    if (node.tags.some((tag) => includesQuery(tag, trimmedQuery))) {
      matchedFields.push("tags");
    }

    const matchedTurnIds: string[] = [];
    for (const ref of node.sourceRefs) {
      const turn = turnsById.get(ref.turnId);
      if (!turn) {
        continue;
      }
      if (includesQuery(turn.request, trimmedQuery) || includesQuery(turn.response, trimmedQuery)) {
        matchedTurnIds.push(turn.id);
      }
    }
    if (matchedTurnIds.length > 0) {
      matchedFields.push("transcript");
    }

    if (matchedFields.length > 0) {
      results.push({ nodeId: node.id, matchedFields, matchedTurnIds });
    }
  }
  return results;
}
