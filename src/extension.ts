import * as vscode from "vscode";
import { TurnStore } from "./turnStore";
import { RoadmapStore } from "./model/roadmapStore";
import { registerRoadmapParticipant } from "./chatParticipant";
import {
  closeRestoredGraphTabs,
  disposeGraphWebview,
  registerGraphRestoreDisposal,
  showGraphWebview,
  updateGraph,
  resumeSelectedNode,
} from "./webviewPanel";
import { exportMarkdownOutlineCommand, exportRoadmapCommand, importRoadmapCommand } from "./importExportCommands";
import { deleteAllDataCommand } from "./dataDeletion";
import { RequestSummary, SummarizationService } from "./summarization/summarizationService";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Register synchronously before any startup work. The webview stores a small
  // marker through setState(), causing VS Code to route any attempted restore
  // through this serializer, which deliberately closes the stale panel.
  registerGraphRestoreDisposal(context);

  // VS Code saves its editor layout before extension deactivation, so a graph
  // tab can be restored even though deactivate() disposed its panel. Remove
  // only this extension's restored webview tabs at startup; persisted roadmap
  // data remains untouched and the graph can be reopened from its command.
  await closeRestoredGraphTabs();

  // Storage lives under globalStorageUri so captured turns persist across
  // window reloads and VS Code restarts (confirmed by the "Roadmap: Open
  // Graph" command re-reading this same directory after a restart).
  const store = new TurnStore(context.globalStorageUri.fsPath);
  await store.load();

  // The domain-model roadmap graph (Phase 2/5) is persisted separately from
  // raw captured turns, in its own file under the same storage directory.
  const roadmapStore = new RoadmapStore(context.globalStorageUri.fsPath);
  await roadmapStore.load();

  // Summarization wiring (Phase 4 logic, connected here): after a turn is
  // captured, the model is asked to fold it into the roadmap graph. The model
  // call is injected so the summarization logic itself stays free of `vscode`.
  // Only models the user is authorized to use are selected, and `sendRequest`
  // surfaces VS Code's own consent flow, honoring the privacy requirement to
  // use only user-authorized models.
  const requestSummary: RequestSummary = async (prompt: string): Promise<string> => {
    const [model] = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (!model) {
      throw new Error("No language model is available for summarization");
    }
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const source = new vscode.CancellationTokenSource();
    try {
      const response = await model.sendRequest(messages, {}, source.token);
      let text = "";
      for await (const fragment of response.text) {
        text += fragment;
      }
      return text;
    } finally {
      source.dispose();
    }
  };
  const summarizer = new SummarizationService(store, roadmapStore, requestSummary);

  // Live refresh: whenever a new turn is captured, immediately push it into the
  // open graph panel (so the transcript updates at once), then summarize the new
  // turn into graph nodes and refresh again if the graph changed.
  context.subscriptions.push({
    dispose: store.onDidChange((turns) => {
      void updateGraph(turns);
      void summarizer
        .summarizeNewTurns()
        .then((outcome) => {
          if (outcome.changed) {
            return updateGraph(store.getAll());
          }
          return undefined;
        })
        .catch(() => {
          // Summarization failures must never break capture; the turn is still
          // recorded and visible in the transcript view.
        });
    }),
  });

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

  // Phase 9: user-initiated, irreversible local data deletion (turns + roadmap graphs).
  const deleteAllDataCmd = vscode.commands.registerCommand(
    "conversationRoadmap.deleteAllData",
    async () => {
      await deleteAllDataCommand(store, roadmapStore);
    }
  );
  context.subscriptions.push(deleteAllDataCmd);
}

export function deactivate(): void {
  // Best-effort immediate cleanup; activate() also removes any tab that VS Code
  // already persisted and restored before this hook ran.
  disposeGraphWebview();
}
