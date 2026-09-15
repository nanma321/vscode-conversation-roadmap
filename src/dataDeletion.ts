/**
 * "Roadmap: Delete All Local Data" (Phase 9) - lets a user permanently
 * erase every conversation turn and roadmap graph the extension has
 * stored, in line with the Key Engineering Principle that conversation
 * content is stored locally by default and must stay under the user's
 * control. This is the only place either store's `deleteAll()` is called:
 * both are irreversible, so this command always confirms with the user via
 * a modal warning (matching the confirmation-before-destructive-action
 * pattern already used for merge/delete-edge in the graph Webview) before
 * doing anything.
 */
import * as vscode from "vscode";
import { TurnStore } from "./turnStore";
import { RoadmapStore } from "./model/roadmapStore";
import { updateGraph } from "./webviewPanel";

const CONFIRM_LABEL = "Delete All Local Data";

/**
 * Deletes all locally persisted turns and roadmap graphs after the user
 * confirms, then refreshes any open graph panel so it immediately reflects
 * the now-empty state instead of showing stale, already-deleted data.
 */
export async function deleteAllDataCommand(turnStore: TurnStore, roadmapStore: RoadmapStore): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "This permanently deletes all captured conversation turns and roadmap graphs stored locally by this extension. This cannot be undone. Continue?",
    { modal: true },
    CONFIRM_LABEL
  );
  if (choice !== CONFIRM_LABEL) {
    return;
  }

  await turnStore.deleteAll();
  await roadmapStore.deleteAll();

  // Refresh any open graph panel to the now-empty state rather than leaving
  // it showing data that no longer exists on disk.
  updateGraph(turnStore.getAll());

  void vscode.window.showInformationMessage("All locally stored roadmap data has been deleted.");
}
