import * as React from "react";
import { EdgeKind, Roadmap, RoadmapEdge } from "../model/types";

export function EdgeDetailsPanel(props: {
  edge: RoadmapEdge;
  roadmap: Roadmap;
  onSave: (source: string, target: string, kind: EdgeKind, label: string | undefined) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { edge, roadmap, onSave, onDelete } = props;
  const [source, setSource] = React.useState(edge.source);
  const [target, setTarget] = React.useState(edge.target);
  const [kind, setKind] = React.useState<EdgeKind>(edge.kind);
  const [label, setLabel] = React.useState(edge.label ?? "");

  React.useEffect(() => {
    setSource(edge.source);
    setTarget(edge.target);
    setKind(edge.kind);
    setLabel(edge.label ?? "");
  }, [edge.id, edge.source, edge.target, edge.kind, edge.label]);

  const normalizedLabel = label.trim();
  const unchanged =
    source === edge.source &&
    target === edge.target &&
    kind === edge.kind &&
    normalizedLabel === (edge.label ?? "");
  const invalid = source === target;

  return (
    <aside className="details-panel" aria-label="Connection details">
      <h2>Connection</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) {
            onSave(source, target, kind, normalizedLabel || undefined);
          }
        }}
      >
        <div className="field">
          <label htmlFor="edge-source">From</label>
          <select id="edge-source" value={source} onChange={(event) => setSource(event.target.value)}>
            {roadmap.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title || "(untitled)"}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="edge-target">To</label>
          <select id="edge-target" value={target} onChange={(event) => setTarget(event.target.value)}>
            {roadmap.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title || "(untitled)"}
              </option>
            ))}
          </select>
          {invalid ? <span className="validation-message">A connection cannot point to the same node.</span> : null}
        </div>

        <div className="field">
          <label htmlFor="edge-label">Label</label>
          <input
            id="edge-label"
            type="text"
            value={label}
            placeholder="Optional"
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="edge-kind">Line type</label>
          <select id="edge-kind" value={kind} onChange={(event) => setKind(event.target.value as EdgeKind)}>
            <option value="topic">Topic (solid)</option>
            <option value="branch">Branch (animated)</option>
            <option value="manual">Manual (dashed)</option>
          </select>
        </div>

        <div className="edge-actions">
          <button type="submit" disabled={invalid || unchanged}>
            Save connection
          </button>
          <button type="button" className="danger-button" onClick={onDelete}>
            Delete connection
          </button>
        </div>
      </form>
    </aside>
  );
}
