/**
 * Pure auto-layout heuristic for the graph Webview (Phase 5).
 *
 * Manual positions (`RoadmapNode.position`) always win - per the Key
 * Engineering Principle that user-authored graph changes are never
 * overwritten automatically, this module only ever computes a position for
 * a node that has none yet. Nodes are placed top-to-bottom by graph depth
 * from root nodes (nodes with no incoming edge), and left-to-right within a
 * depth level in the order they're first reached, giving a stable,
 * deterministic layout for a given node/edge set.
 *
 * Kept dependency-free (no `vscode`, no DOM) so it can run identically in
 * the bundled Webview and be unit-tested via the extension host's test
 * runner, matching the rest of the codebase's testing conventions.
 */
import { NodePosition, RoadmapEdge, RoadmapNode } from "../model/types";

const COLUMN_WIDTH = 240;
const LEVEL_HEIGHT = 150;

function buildPrimaryHierarchy(nodes: RoadmapNode[], edges: RoadmapEdge[]): {
  primaryParent: Map<string, string>;
  childrenOf: Map<string, string[]>;
} {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const primaryParent = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || primaryParent.has(edge.target)) {
      return;
    }
    primaryParent.set(edge.target, edge.source);
    const children = childrenOf.get(edge.source) ?? [];
    children.push(edge.target);
    childrenOf.set(edge.source, children);
  });
  return { primaryParent, childrenOf };
}

/** Computes a deterministic fallback position for every node, ignoring any manual `position` already set. */
export function computeAutoLayout(nodes: RoadmapNode[], edges: RoadmapEdge[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  const { primaryParent, childrenOf } = buildPrimaryHierarchy(nodes, edges);

  const roots = nodes.filter((node) => !primaryParent.has(node.id)).map((node) => node.id);
  const visited = new Set<string>();
  let nextLeafColumn = 0;

  function place(nodeId: string, level: number): void {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    const children = (childrenOf.get(nodeId) ?? []).filter((child) => !visited.has(child));
    for (const child of children) {
      place(child, level + 1);
    }
    const firstChild = children.length > 0 ? positions.get(children[0]) : undefined;
    const lastChild = children.length > 0 ? positions.get(children[children.length - 1]) : undefined;
    const x =
      firstChild && lastChild
        ? (firstChild.x + lastChild.x) / 2
        : nextLeafColumn++ * COLUMN_WIDTH;
    positions.set(nodeId, { x, y: level * LEVEL_HEIGHT });
  }

  roots.forEach((id) => place(id, 0));
  // A cycle has no root. Treat its first unvisited node as a root while the
  // visited guard keeps traversal finite.
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      place(node.id, 0);
    }
  });

  return positions;
}

/** Resolves the effective position for every node: its manual `position` if set, otherwise the auto-layout fallback. */
export function resolveNodePositions(nodes: RoadmapNode[], edges: RoadmapEdge[]): Map<string, NodePosition> {
  const auto = computeAutoLayout(nodes, edges);
  const { primaryParent, childrenOf } = buildPrimaryHierarchy(nodes, edges);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const resolved = new Map<string, NodePosition>();
  const visited = new Set<string>();

  function place(nodeId: string, inheritedOffset: NodePosition): void {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) {
      return;
    }
    const automatic = auto.get(nodeId) ?? { x: 0, y: 0 };
    const position = node.position ?? {
      x: automatic.x + inheritedOffset.x,
      y: automatic.y + inheritedOffset.y,
    };
    resolved.set(nodeId, position);
    const descendantOffset = {
      x: position.x - automatic.x,
      y: position.y - automatic.y,
    };
    for (const child of childrenOf.get(nodeId) ?? []) {
      place(child, descendantOffset);
    }
  }

  nodes
    .filter((node) => !primaryParent.has(node.id))
    .forEach((node) => place(node.id, { x: 0, y: 0 }));
  nodes.forEach((node) => place(node.id, { x: 0, y: 0 }));
  return resolved;
}
