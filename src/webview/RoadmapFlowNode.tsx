/**
 * Custom React Flow node renderer for a {@link RoadmapNode}: shows the
 * title, node type/status badges, and reflects the user's chosen `color`
 * and `highlighted` state. Kept intentionally simple - editing happens in
 * {@link NodeDetailsPanel}, not inline on the canvas.
 */
import * as React from "react";
import { Handle, Position } from "reactflow";
import { RoadmapNode } from "../model/types";
import {
  DEFAULT_NODE_BACKGROUND_FALLBACK,
  DEFAULT_NODE_FOREGROUND_FALLBACK,
  NEW_NODE_STICKER_BACKGROUND,
  NEW_NODE_STICKER_FOREGROUND,
  contrastingTextColor,
} from "./nodeColor";
import { previewTags } from "./tagDisplay";

export interface RoadmapFlowNodeData {
  node: RoadmapNode;
  selected: boolean;
  /** True when this node does not match the current search query/filters (Phase 8); rendered at reduced opacity rather than hidden. */
  dimmed?: boolean;
}

export function RoadmapFlowNode(props: { data: RoadmapFlowNodeData }): React.JSX.Element {
  const { node, selected, dimmed } = props.data;
  const style: React.CSSProperties = node.color
    ? {
        background: node.color,
        color: contrastingTextColor(node.color),
        borderColor: contrastingTextColor(node.color),
      }
    : {
        background: `var(--vscode-editorWidget-background, ${DEFAULT_NODE_BACKGROUND_FALLBACK})`,
        color: `var(--vscode-editorWidget-foreground, var(--vscode-foreground, ${DEFAULT_NODE_FOREGROUND_FALLBACK}))`,
      };
  const tagPreview = previewTags(node.tags);
  return (
    <div
      className={
        "roadmap-flow-node" +
        (selected ? " selected" : "") +
        (node.highlighted ? " highlighted" : "") +
        (node.isNew ? " new" : "") +
        (dimmed ? " dimmed" : "")
      }
      style={style}
      title={node.summary}
    >
      {node.isNew ? (
        <span
          className="new-node-sticker"
          style={{ background: NEW_NODE_STICKER_BACKGROUND, color: NEW_NODE_STICKER_FOREGROUND }}
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12">
            <path d="M6 1.25 7 4l2.75 1L7 6l-1 2.75L5 6 2.25 5 5 4l1-2.75Z" />
          </svg>
          <span>new</span>
        </span>
      ) : null}
      <Handle type="target" position={Position.Top} />
      <div className="roadmap-flow-node-title">{node.title || "(untitled)"}</div>
      <div className="roadmap-flow-node-meta">
        <span className={"badge status-" + node.status}>Status: {node.status}</span>
        <span className="badge type">Type: {node.nodeType ?? "topic"}</span>
        {node.highlighted ? <span className="badge highlight-badge">Important</span> : null}
      </div>
      {node.tags.length > 0 ? (
        <div className="roadmap-flow-node-tags">
          {tagPreview.visible.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
          {tagPreview.hidden.length > 0 ? (
            <span
              className="tag tag-overflow"
              aria-label={`${tagPreview.hidden.length} more tags`}
              title={tagPreview.hidden.join(", ")}
            >
              +{tagPreview.hidden.length}
            </span>
          ) : null}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
