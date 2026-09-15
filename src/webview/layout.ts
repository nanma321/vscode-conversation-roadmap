/**
 * Pure auto-layout heuristic for the graph Webview (Phase 5).
 *
 * Manual positions (`RoadmapNode.position`) always win - per the Key
 * Engineering Principle that user-authored graph changes are never
 * overwritten automatically, this module only ever computes a position for
 * a node that has none yet. Nodes are placed left-to-right by BFS depth
 * from root nodes (nodes with no incoming edge), and top-to-bottom within a
 * depth level in the order they're first reached, giving a stable,
 * deterministic layout for a given node/edge set.
 *
 * Kept dependency-free (no `vscode`, no DOM) so it can run identically in
 * the bundled Webview and be unit-tested via the extension host's test
 * runner, matching the rest of the codebase's testing conventions.
 */
import { NodePosition, RoadmapEdge, RoadmapNode } from "../model/types";

const LEVEL_WIDTH = 260;
const ROW_HEIGHT = 120;

/** Computes a deterministic fallback position for every node, ignoring any manual `position` already set. */
export function computeAutoLayout(nodes: RoadmapNode[], edges: RoadmapEdge[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  const incomingCount = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();

  nodes.forEach((n) => incomingCount.set(n.id, 0));
  edges.forEach((e) => {
    if (incomingCount.has(e.target)) {
      incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1);
    }
    if (!childrenOf.has(e.source)) {
      childrenOf.set(e.source, []);
    }
    childrenOf.get(e.source)!.push(e.target);
  });

  const roots = nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0).map((n) => n.id);
  const visited = new Set<string>();
  const rowCountByLevel = new Map<number, number>();

  function place(nodeId: string, level: number): void {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    const row = rowCountByLevel.get(level) ?? 0;
    positions.set(nodeId, { x: level * LEVEL_WIDTH, y: row * ROW_HEIGHT });
    rowCountByLevel.set(level, row + 1);
    for (const child of childrenOf.get(nodeId) ?? []) {
      place(child, level + 1);
    }
  }

  // Fall back to treating every node as a root (e.g. an edge-free graph)
  // rather than producing no layout at all.
  (roots.length > 0 ? roots : nodes.map((n) => n.id)).forEach((id) => place(id, 0));
  // Any node unreachable from a root (isolated cycles, disconnected islands)
  // still needs a deterministic position.
  nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      place(n.id, 0);
    }
  });

  return positions;
}

/** Resolves the effective position for every node: its manual `position` if set, otherwise the auto-layout fallback. */
export function resolveNodePositions(nodes: RoadmapNode[], edges: RoadmapEdge[]): Map<string, NodePosition> {
  const auto = computeAutoLayout(nodes, edges);
  const resolved = new Map<string, NodePosition>();
  for (const node of nodes) {
    resolved.set(node.id, node.position ?? auto.get(node.id) ?? { x: 0, y: 0 });
  }
  return resolved;
}
