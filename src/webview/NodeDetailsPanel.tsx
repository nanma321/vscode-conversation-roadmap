/**
 * Detail panel shown for the currently selected node: its source transcript
 * (the request/response turns it was derived from, resolved via
 * `sourceRefs`) plus an editing form for the user-owned fields (title,
 * notes, tags, color, highlight). Every edit is sent immediately as a
 * validated Webview message (see `webviewMessages.ts`) so it is persisted
 * and cannot be lost on reload.
 */
import * as React from "react";
import { RoadmapNode } from "../model/types";
import type { TurnRecord } from "../turnStore";

const COLOR_SWATCHES = ["#f14c4c", "#e2a336", "#e5c116", "#4caf50", "#2472c8", "#a074c4", "#8b8b8b"];

export function NodeDetailsPanel(props: {
  node: RoadmapNode | null;
  turnsById: Map<string, TurnRecord>;
  onRename: (title: string) => void;
  onUpdateNotes: (notes: string) => void;
  onUpdateTags: (tags: string[]) => void;
  onUpdateColor: (color: string | null) => void;
  onToggleHighlight: (highlighted: boolean) => void;
}): React.JSX.Element {
  const { node, turnsById, onRename, onUpdateNotes, onUpdateTags, onUpdateColor, onToggleHighlight } = props;
  const [titleDraft, setTitleDraft] = React.useState(node?.title ?? "");
  const [notesDraft, setNotesDraft] = React.useState(node?.notes ?? "");
  const [tagsDraft, setTagsDraft] = React.useState((node?.tags ?? []).join(", "));

  React.useEffect(() => {
    setTitleDraft(node?.title ?? "");
    setNotesDraft(node?.notes ?? "");
    setTagsDraft((node?.tags ?? []).join(", "));
  }, [node?.id]);

  if (!node) {
    return (
      <aside className="details-panel" aria-label="Node details">
        <p className="empty">Select a node to view and edit its details.</p>
      </aside>
    );
  }

  const turns = node.sourceRefs.map((ref) => turnsById.get(ref.turnId)).filter((t): t is TurnRecord => Boolean(t));

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
