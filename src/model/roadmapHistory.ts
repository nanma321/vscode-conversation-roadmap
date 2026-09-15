/**
 * In-memory undo/redo history of {@link Roadmap} snapshots (Phase 6).
 *
 * Structural edits (adding/removing edges, merging or splitting nodes) and
 * ordinary field edits are all "graph transactions": each one is recorded
 * here as the *prior* roadmap snapshot before the edit is applied, so
 * `undo()` can restore the graph to the exact state it was in immediately
 * before that transaction, satisfying the Phase 6 exit criterion that
 * "undo restores the exact prior graph state." A new transaction always
 * clears the redo stack, matching standard undo/redo semantics (you cannot
 * redo a change that has been superseded by a new one).
 *
 * This is intentionally a plain, dependency-free class (no `vscode`, no
 * persistence) so it is trivially unit-testable and can be reused by both
 * the extension host (which owns one instance per open roadmap) and, if
 * ever needed, the Webview itself.
 */
import { Roadmap } from "./types";

/** Maximum number of prior snapshots retained; oldest entries are dropped once exceeded to bound memory use. */
const DEFAULT_HISTORY_LIMIT = 100;

export class RoadmapHistory {
  private readonly undoStack: Roadmap[] = [];
  private readonly redoStack: Roadmap[] = [];

  constructor(private readonly limit: number = DEFAULT_HISTORY_LIMIT) {}

  /** Whether {@link undo} would currently restore a prior state. */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether {@link redo} would currently restore an undone state. */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Records `previous` (the roadmap as it was *before* an about-to-be-applied
   * edit) onto the undo stack, and clears the redo stack, since applying a
   * new transaction invalidates any previously undone future. Must be called
   * once per transaction, before the edit is applied.
   */
  record(previous: Roadmap): void {
    this.undoStack.push(previous);
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  /**
   * Restores the most recently recorded prior snapshot, pushing `current`
   * (the roadmap as it is now, before undoing) onto the redo stack so
   * {@link redo} can restore it again. Returns `undefined`, leaving both
   * stacks untouched, if there is nothing to undo.
   */
  undo(current: Roadmap): Roadmap | undefined {
    const previous = this.undoStack.pop();
    if (!previous) {
      return undefined;
    }
    this.redoStack.push(current);
    return previous;
  }

  /**
   * Re-applies the most recently undone snapshot, pushing `current` back
   * onto the undo stack so it can be undone again. Returns `undefined`,
   * leaving both stacks untouched, if there is nothing to redo.
   */
  redo(current: Roadmap): Roadmap | undefined {
    const next = this.redoStack.pop();
    if (!next) {
      return undefined;
    }
    this.undoStack.push(current);
    return next;
  }
}
