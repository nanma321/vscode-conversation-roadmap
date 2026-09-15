/**
 * Accessible outline/tree alternative to the graph canvas (Phase 5). Every
 * operation the graph supports for node selection is available here as a
 * plain, fully keyboard-navigable list (arrow keys move focus, Enter/Space
 * selects), so a user who cannot or does not want to use pointer-driven
 * drag-and-drop can still inspect and select every node.
 */
import * as React from "react";
import { Roadmap, RoadmapNode } from "../model/types";

interface OutlineEntry {
  node: RoadmapNode;
  depth: number;
}

function buildOutline(roadmap: Roadmap): OutlineEntry[] {
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

export function OutlineView(props: {
  roadmap: Roadmap;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}): React.JSX.Element {
  const { roadmap, selectedNodeId, onSelectNode } = props;
  const entries = React.useMemo(() => buildOutline(roadmap), [roadmap]);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const focusItem = (index: number): void => {
    const clamped = Math.max(0, Math.min(entries.length - 1, index));
    itemRefs.current[clamped]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(entries.length - 1);
    }
  };

  if (entries.length === 0) {
    return <p className="empty">No roadmap nodes yet.</p>;
  }

  return (
    <ul className="outline-view" role="tree" aria-label="Roadmap outline">
      {entries.map((entry, index) => (
        <li key={entry.node.id} role="none">
          <button
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role="treeitem"
            aria-selected={entry.node.id === selectedNodeId}
            aria-level={entry.depth + 1}
            className={"outline-item" + (entry.node.id === selectedNodeId ? " selected" : "") + (entry.node.highlighted ? " highlighted" : "")}
            style={{ paddingLeft: `${entry.depth * 1.25 + 0.5}rem`, borderLeftColor: entry.node.color }}
            onClick={() => onSelectNode(entry.node.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            <span className={"badge status-" + entry.node.status}>{entry.node.status}</span>{" "}
            {entry.node.title || "(untitled)"}
          </button>
        </li>
      ))}
    </ul>
  );
}
