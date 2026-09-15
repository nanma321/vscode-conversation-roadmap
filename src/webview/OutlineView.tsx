/**
 * Accessible outline/tree alternative to the graph canvas (Phase 5). Every
 * operation the graph supports for node selection is available here as a
 * plain, fully keyboard-navigable list (arrow keys move focus, Enter/Space
 * selects), so a user who cannot or does not want to use pointer-driven
 * drag-and-drop can still inspect and select every node.
 */
import * as React from "react";
import { Roadmap } from "../model/types";
import { buildRoadmapOutline } from "../model/outline";

export function OutlineView(props: {
  roadmap: Roadmap;
  selectedNodeId: string | null;
  /** Ids of nodes currently matching the search query/filters (Phase 8); unmatched nodes render dimmed rather than being hidden, preserving the outline's tree structure. */
  matchedNodeIds: ReadonlySet<string>;
  onSelectNode: (nodeId: string | null) => void;
}): React.JSX.Element {
  const { roadmap, selectedNodeId, matchedNodeIds, onSelectNode } = props;
  const entries = React.useMemo(() => buildRoadmapOutline(roadmap), [roadmap]);
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
            className={
              "outline-item" +
              (entry.node.id === selectedNodeId ? " selected" : "") +
              (entry.node.highlighted ? " highlighted" : "") +
              (matchedNodeIds.has(entry.node.id) ? "" : " dimmed")
            }
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
