/**
 * Shared outline-tree construction for {@link Roadmap} (Phase 8, extracted
 * from the outline/tree view added in Phase 5).
 *
 * Both the Webview's accessible outline (`webview/OutlineView.tsx`) and the
 * Markdown outline export (`markdownExport.ts`) need the exact same
 * roots-first, depth-first traversal of the graph so the two views never
 * disagree about node order/nesting; this module is the single place that
 * logic lives. It has no dependency on `vscode`, React, or the DOM.
 */
import { Roadmap, RoadmapNode } from "./types";

/** One node's position in the outline: the node itself and how deeply nested it is under its ancestors. */
export interface OutlineEntry {
  node: RoadmapNode;
  depth: number;
}

/**
 * Builds a depth-first outline of `roadmap`: nodes with no incoming edge are
 * treated as roots (visited in their original array order), each followed
 * immediately by its descendants (also in edge order); a node reachable
 * from more than one parent appears only once, at the first place it is
 * reached. Any node unreachable from a root (e.g. part of a cycle with no
 * root of its own) is still included, appended at depth 0, so a node can
 * never silently disappear from the outline.
 */
export function buildRoadmapOutline(roadmap: Roadmap): OutlineEntry[] {
  const childrenOf = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const edge of roadmap.edges) {
    if (!childrenOf.has(edge.source)) {
      childrenOf.set(edge.source, []);
    }
    childrenOf.get(edge.source)!.push(edge.target);
    hasIncoming.add(edge.target);
  }
  const nodesById = new Map(roadmap.nodes.map((n) => [n.id, n]));
  const roots = roadmap.nodes.filter((n) => !hasIncoming.has(n.id));

  const entries: OutlineEntry[] = [];
  const visited = new Set<string>();
  function visit(nodeId: string, depth: number): void {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) {
      return;
    }
    entries.push({ node, depth });
    for (const childId of childrenOf.get(nodeId) ?? []) {
      visit(childId, depth + 1);
    }
  }
  (roots.length > 0 ? roots.map((n) => n.id) : roadmap.nodes.map((n) => n.id)).forEach((id) => visit(id, 0));
  // Include any node unreachable from a root so nothing silently disappears from the outline.
  roadmap.nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      visit(n.id, 0);
    }
  });
  return entries;
}
