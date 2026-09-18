/**
 * Modal shown when the user clicks "Resume from here" on a node (Phase 7).
 *
 * Per the product design, resuming must "explain what context will be sent
 * before a resume operation" and "clearly indicate that resuming creates a new
 * branch rather than modifying the original transcript." This component builds
 * the exact same context the extension host will send (via the shared,
 * vscode-free {@link buildResumeContext}) and shows it read-only as a preview,
 * alongside a size/truncation notice and an optional follow-up question, before
 * the user confirms. On confirm it hands the follow-up question back to
 * {@link App}, which posts the single validated `resumeFromNode` message.
 */
import * as React from "react";
import { Roadmap, RoadmapNode } from "../model/types";
import type { TurnRecord } from "../turnStore";
import { buildResumeContext, ResumeSourceTurn } from "../resume/resumeContext";
import { useModalFocus } from "./useModalFocus";

export function ResumePreview(props: {
  node: RoadmapNode;
  roadmap: Roadmap;
  turnsById: Map<string, TurnRecord>;
  onSend: (question: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { node, roadmap, turnsById, onSend, onCancel } = props;
  const [question, setQuestion] = React.useState("");
  const dialogRef = useModalFocus<HTMLDivElement>(onCancel);

  const context = React.useMemo(
    () => buildResumeContext(roadmap, node.id, turnsById as ReadonlyMap<string, ResumeSourceTurn>),
    [roadmap, node.id, turnsById]
  );

  return (
    <div className="resume-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="resume-modal"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="resume-dialog-title">Resume from &ldquo;{node.title}&rdquo;</h2>
        <p className="resume-explainer">
          This starts a <strong>new branch</strong> seeded with the context below. Your original conversation and
          roadmap path are <strong>not modified</strong>.
        </p>

        <label htmlFor="resume-context-preview">Context to be sent</label>
        <textarea
          id="resume-context-preview"
          className="resume-context-preview"
          readOnly
          value={context.previewText}
          rows={12}
        />
        {context.truncated ? (
          <p className="resume-truncation" role="note">
            Context was trimmed to stay within size limits ({context.droppedTurnCount} earlier turn(s) omitted).
          </p>
        ) : null}

        <label htmlFor="resume-question">Follow-up question (optional)</label>
        <textarea
          id="resume-question"
          className="resume-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What would you like to ask from this point?"
          rows={3}
        />

        <div className="resume-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onSend(question.trim())}>
            Create branch &amp; open chat
          </button>
        </div>
      </div>
    </div>
  );
}
