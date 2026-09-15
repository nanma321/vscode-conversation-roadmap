import * as vscode from "vscode";
import { TurnStore } from "./turnStore";
import { RoadmapStore } from "./model/roadmapStore";
import { registerRoadmapParticipant } from "./chatParticipant";
import { showGraphWebview, updateGraph, resumeSelectedNode } from "./webviewPanel";
import { exportMarkdownOutlineCommand, exportRoadmapCommand, importRoadmapCommand } from "./importExportCommands";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Storage lives under globalStorageUri so captured turns persist across
  // window reloads and VS Code restarts (confirmed by the "Roadmap: Open
  // Graph" command re-reading this same directory after a restart).
  const store = new TurnStore(context.globalStorageUri.fsPath);
  await store.load();

  // The domain-model roadmap graph (Phase 2/5) is persisted separately from
  // raw captured turns, in its own file under the same storage directory.
  const roadmapStore = new RoadmapStore(context.globalStorageUri.fsPath);
  await roadmapStore.load();

  // Live refresh: whenever a new turn is captured, push it into the open graph
  // panel (a no-op if the panel isn't open) so the graph updates in real time.
  context.subscriptions.push({ dispose: store.onDidChange((turns) => updateGraph(turns)) });

  registerRoadmapParticipant(context, store);

  const openGraphCommand = vscode.commands.registerCommand(
    "conversationRoadmap.openGraph",
    async () => {
      // Reload from disk each time the command runs so the graph reflects
      // turns captured in prior sessions, confirming reload behavior.
      await store.load();
      await showGraphWebview(context, store, roadmapStore);
    }
  );
  context.subscriptions.push(openGraphCommand);

  // Phase 7: "Resume from here" is also available from the command palette,
  // acting on the node currently selected in the open graph.
  const resumeCommand = vscode.commands.registerCommand(
    "conversationRoadmap.resumeFromNode",
    async () => {
      await resumeSelectedNode();
    }
  );
  context.subscriptions.push(resumeCommand);

  // Phase 8: versioned JSON export/import and Markdown outline export, each
  // a thin command wrapper over the pure logic in
  // `model/exportImport.ts`/`model/markdownExport.ts`.
  const exportRoadmapCmd = vscode.commands.registerCommand(
    "conversationRoadmap.exportRoadmap",
    async () => {
      await exportRoadmapCommand(roadmapStore);
    }
  );
  context.subscriptions.push(exportRoadmapCmd);

  const importRoadmapCmd = vscode.commands.registerCommand(
    "conversationRoadmap.importRoadmap",
    async () => {
      await importRoadmapCommand(roadmapStore);
      // Refresh any open graph panel so an import is immediately visible
      // without requiring the user to reopen it.
      await updateGraph(store.getAll());
    }
  );
  context.subscriptions.push(importRoadmapCmd);

  const exportMarkdownOutlineCmd = vscode.commands.registerCommand(
    "conversationRoadmap.exportMarkdownOutline",
    async () => {
      await exportMarkdownOutlineCommand(roadmapStore);
    }
  );
  context.subscriptions.push(exportMarkdownOutlineCmd);
}

export function deactivate(): void {
  // No explicit teardown needed: TurnStore writes are flushed synchronously
  // after each append, and the chat participant/webview are disposed via
  // context.subscriptions.
}
