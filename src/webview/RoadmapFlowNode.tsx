/**
 * Custom React Flow node renderer for a {@link RoadmapNode}: shows the
 * title, node type/status badges, and reflects the user's chosen `color`
 * and `highlighted` state. Kept intentionally simple - editing happens in
 * {@link NodeDetailsPanel}, not inline on the canvas.
 */
import * as React from "react";
import { Handle, Position } from "reactflow";
import { RoadmapNode } from "../model/types";

export interface RoadmapFlowNodeData {
  node: RoadmapNode;
  selected: boolean;
}

export function RoadmapFlowNode(props: { data: RoadmapFlowNodeData }): React.JSX.Element {
  const { node, selected } = props.data;
  const background = node.color ?? "var(--vscode-button-secondaryBackground, #333)";
  return (
    <div
      className={"roadmap-flow-node" + (selected ? " selected" : "") + (node.highlighted ? " highlighted" : "")}
      style={{ background }}
      title={node.summary}
    >
      <Handle type="target" position={Position.Top} />
      <div className="roadmap-flow-node-title">{node.title || "(untitled)"}</div>
      <div className="roadmap-flow-node-meta">
        <span className={"badge status-" + node.status}>{node.status}</span>
        {node.nodeType ? <span className="badge type">{node.nodeType}</span> : null}
      </div>
      {node.tags.length > 0 ? (
        <div className="roadmap-flow-node-tags">
          {node.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
