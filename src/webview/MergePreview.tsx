import * as React from "react";
import { RoadmapNode } from "../model/types";

export function MergePreview(props: {
  source: RoadmapNode;
  target: RoadmapNode;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { source, target, onConfirm, onCancel } = props;
  const [titleSource, setTitleSource] = React.useState<"target" | "source">("target");
  const retainedTitle = titleSource === "target" ? target.title : source.title;
  const combinedTags = Array.from(new Set([...target.tags, ...source.tags]));
  const combinedTurnCount = new Set(
    [...target.sourceRefs, ...source.sourceRefs].map((ref) => `${ref.sessionId}:${ref.turnId}`)
  ).size;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="merge-modal" role="dialog" aria-modal="true" aria-labelledby="merge-preview-title">
        <h2 id="merge-preview-title">Review merge</h2>
        <p>
          <strong>{source.title}</strong> will be removed and folded into <strong>{target.title}</strong>.
        </p>

        <fieldset className="merge-title-choice">
          <legend>Title after merge</legend>
          <label>
            <input
              type="radio"
              name="merge-title"
              checked={titleSource === "target"}
              onChange={() => setTitleSource("target")}
            />{" "}
            {target.title} (target)
          </label>
          <label>
            <input
              type="radio"
              name="merge-title"
              checked={titleSource === "source"}
              onChange={() => setTitleSource("source")}
            />{" "}
            {source.title} (selected node)
          </label>
        </fieldset>

        <section className="merge-summary-preview" aria-labelledby="merge-summaries-title">
          <h3 id="merge-summaries-title">Both summaries will be kept</h3>
          <div>
            <strong>{target.title}</strong>
            <p>{target.summary || "(No summary)"}</p>
          </div>
          <div>
            <strong>{source.title}</strong>
            <p>{source.summary || "(No summary)"}</p>
          </div>
        </section>

        <ul className="merge-retention-list">
          <li>{combinedTurnCount} unique source turn(s) will remain linked.</li>
          <li>{combinedTags.length > 0 ? `Tags will be combined: ${combinedTags.join(", ")}.` : "No tags to combine."}</li>
          <li>My notes will be combined and connections will be redirected.</li>
          <li>The operation can be reversed with Undo.</li>
        </ul>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onConfirm(retainedTitle)}>
            Merge nodes
          </button>
        </div>
      </div>
    </div>
  );
}
