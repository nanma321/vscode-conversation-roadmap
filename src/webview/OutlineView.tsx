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
import { describeRoadmapNode } from "./accessibility";

export function OutlineView(props: {
  roadmap: Roadmap;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  /** Ids of nodes currently matching the search query/filters (Phase 8); unmatched nodes render dimmed rather than being hidden, preserving the outline's tree structure. */
  matchedNodeIds: ReadonlySet<string>;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string) => void;
}): React.JSX.Element {
  const { roadmap, selectedNodeId, selectedEdgeId, matchedNodeIds, onSelectNode, onSelectEdge } = props;
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
    <div className="outline-container">
      <ul className="outline-view" role="tree" aria-label="Roadmap nodes">
        {entries.map((entry, index) => (
          <li key={entry.node.id} role="none">
            <button
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="treeitem"
              aria-selected={entry.node.id === selectedNodeId}
              aria-level={entry.depth + 1}
              aria-label={describeRoadmapNode(roadmap, entry.node)}
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
              {entry.node.isNew ? <span className="badge new-outline-badge">New</span> : null}{" "}
              {entry.node.title || "(untitled)"}
            </button>
          </li>
        ))}
      </ul>
      {roadmap.edges.length > 0 ? (
        <section className="outline-connections" aria-labelledby="outline-connections-title">
          <h2 id="outline-connections-title">Connections</h2>
          <ul>
            {roadmap.edges.map((edge) => {
              const source = roadmap.nodes.find((node) => node.id === edge.source)?.title ?? edge.source;
              const target = roadmap.nodes.find((node) => node.id === edge.target)?.title ?? edge.target;
              return (
                <li key={edge.id}>
                  <button
                    type="button"
                    aria-pressed={edge.id === selectedEdgeId}
                    className={"outline-edge-item" + (edge.id === selectedEdgeId ? " selected" : "")}
                    onClick={() => onSelectEdge(edge.id)}
                  >
                    {source} to {target} ({edge.kind})
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
