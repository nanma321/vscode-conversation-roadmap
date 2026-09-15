/**
 * Detail panel shown for the currently selected node: its source transcript
 * (the request/response turns it was derived from, resolved via
 * `sourceRefs`) plus an editing form for the user-owned fields (title,
 * notes, tags, color, highlight), and structural editing controls (Phase
 * 6) to merge this node into another or split selected source turns off
 * into a new node. Every edit is sent immediately as a validated Webview
 * message (see `webviewMessages.ts`) so it is persisted and cannot be lost
 * on reload; the merge action is confirmed by the caller ({@link App})
 * before the message is sent, since it removes this node entirely.
 */
import * as React from "react";
import { Roadmap, RoadmapNode } from "../model/types";
import type { TurnRecord } from "../turnStore";

const COLOR_SWATCHES = ["#f14c4c", "#e2a336", "#e5c116", "#4caf50", "#2472c8", "#a074c4", "#8b8b8b"];

export function NodeDetailsPanel(props: {
  node: RoadmapNode | null;
  roadmap: Roadmap;
  turnsById: Map<string, TurnRecord>;
  onRename: (title: string) => void;
  onUpdateNotes: (notes: string) => void;
  onUpdateTags: (tags: string[]) => void;
  onUpdateColor: (color: string | null) => void;
  onToggleHighlight: (highlighted: boolean) => void;
  onMergeInto: (targetNodeId: string) => void;
  onSplit: (title: string, sourceRefTurnIds: string[]) => void;
  onResume: () => void;
}): React.JSX.Element {
  const { node, roadmap, turnsById, onRename, onUpdateNotes, onUpdateTags, onUpdateColor, onToggleHighlight, onMergeInto, onSplit, onResume } =
    props;
  const [titleDraft, setTitleDraft] = React.useState(node?.title ?? "");
  const [notesDraft, setNotesDraft] = React.useState(node?.notes ?? "");
  const [tagsDraft, setTagsDraft] = React.useState((node?.tags ?? []).join(", "));
  const [mergeTargetId, setMergeTargetId] = React.useState("");
  const [splitTitle, setSplitTitle] = React.useState("");
  const [splitTurnIds, setSplitTurnIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    setTitleDraft(node?.title ?? "");
    setNotesDraft(node?.notes ?? "");
    setTagsDraft((node?.tags ?? []).join(", "));
    setMergeTargetId("");
    setSplitTitle("");
    setSplitTurnIds(new Set());
  }, [node?.id]);

  if (!node) {
    return (
      <aside className="details-panel" aria-label="Node details">
        <p className="empty">Select a node to view and edit its details.</p>
      </aside>
    );
  }

  const turns = node.sourceRefs.map((ref) => turnsById.get(ref.turnId)).filter((t): t is TurnRecord => Boolean(t));
  const otherNodes = roadmap.nodes.filter((n) => n.id !== node.id);

  function toggleSplitTurn(turnId: string): void {
    setSplitTurnIds((current) => {
      const next = new Set(current);
      if (next.has(turnId)) {
        next.delete(turnId);
      } else {
        next.add(turnId);
      }
      return next;
    });
  }

  return (
    <aside className="details-panel" aria-label="Node details">
      <div className="field">
        <label htmlFor="node-title">Title</label>
        <input
          id="node-title"
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (titleDraft.trim().length > 0) {
              onRename(titleDraft);
            } else {
              setTitleDraft(node.title);
            }
          }}
        />
      </div>

      <div className="field">
        <label htmlFor="node-notes">Notes</label>
        <textarea
          id="node-notes"
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => onUpdateNotes(notesDraft)}
          rows={4}
        />
      </div>

      <div className="field">
        <label htmlFor="node-tags">Tags (comma-separated)</label>
        <input
          id="node-tags"
          type="text"
          value={tagsDraft}
          onChange={(e) => setTagsDraft(e.target.value)}
          onBlur={() =>
            onUpdateTags(
              tagsDraft
                .split(",")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0)
            )
          }
        />
      </div>

      <div className="field">
        <span id="node-color-label">Color</span>
        <div role="group" aria-labelledby="node-color-label" className="color-swatches">
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={"swatch" + (node.color === color ? " selected" : "")}
              style={{ background: color }}
              aria-label={`Set color ${color}`}
              aria-pressed={node.color === color}
              onClick={() => onUpdateColor(color)}
            />
          ))}
          <button type="button" className="swatch clear" aria-label="Clear color" onClick={() => onUpdateColor(null)}>
            &times;
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="node-highlight">
          <input
            id="node-highlight"
            type="checkbox"
            checked={Boolean(node.highlighted)}
            onChange={(e) => onToggleHighlight(e.target.checked)}
          />{" "}
          Highlighted
        </label>
      </div>

      <div className="field resume-action">
        <button type="button" className="resume-button" onClick={onResume}>
          Resume from here&hellip;
        </button>
        <p className="resume-hint">Starts a new branch from this node without changing the original path.</p>
      </div>

      <div className="field structural-edit">
        <span id="node-merge-label">Merge into another node</span>
        <div role="group" aria-labelledby="node-merge-label" className="merge-controls">
          <select
            aria-label="Node to merge into"
            value={mergeTargetId}
            onChange={(e) => setMergeTargetId(e.target.value)}
          >
            <option value="">Select a node&hellip;</option>
            {otherNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title || "(untitled)"}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!mergeTargetId}
            onClick={() => {
              onMergeInto(mergeTargetId);
              setMergeTargetId("");
            }}
          >
            Merge
          </button>
        </div>
      </div>

      {node.sourceRefs.length > 1 ? (
        <div className="field structural-edit">
          <span id="node-split-label">Split off selected source turns into a new node</span>
          <div role="group" aria-labelledby="node-split-label" className="split-controls">
            <ul className="split-turn-list">
              {node.sourceRefs.map((ref) => (
                <li key={ref.turnId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={splitTurnIds.has(ref.turnId)}
                      onChange={() => toggleSplitTurn(ref.turnId)}
                    />{" "}
                    {turnsById.get(ref.turnId)?.request ?? ref.turnId}
                  </label>
                </li>
              ))}
            </ul>
            <input
              type="text"
              aria-label="New node title"
              placeholder="New node title"
              value={splitTitle}
              onChange={(e) => setSplitTitle(e.target.value)}
            />
            <button
              type="button"
              disabled={splitTurnIds.size === 0 || splitTitle.trim().length === 0}
              onClick={() => {
                onSplit(splitTitle.trim(), Array.from(splitTurnIds));
                setSplitTitle("");
                setSplitTurnIds(new Set());
              }}
            >
              Split
            </button>
          </div>
        </div>
      ) : null}

      <div className="transcript">
        <h3>Source messages</h3>
        {turns.length === 0 ? (
          <p className="empty">No source turns recorded for this node.</p>
        ) : (
          turns.map((turn) => (
            <div className="transcript-turn" key={turn.id}>
              <p>
                <strong>Request:</strong> {turn.request}
              </p>
              <p>
                <strong>Response:</strong> {turn.response || "(no response)"}
              </p>
              <p className="transcript-meta">
                {turn.completed ? "complete" : "incomplete"} &middot; {turn.timestamp}
              </p>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
