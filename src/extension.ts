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
  showGraphError,
} from "./webviewPanel";
import {
  exportMarkdownOutlineCommand,
  exportRoadmapCommand,
  exportSvgCommand,
  importRoadmapCommand,
} from "./importExportCommands";
import { deleteAllDataCommand } from "./dataDeletion";
import { RequestSummary, SummarizationService } from "./summarization/summarizationService";
import { maybeShowOnboarding } from "./onboarding";
import { CONTINUE_ROADMAP_COMMAND, ROADMAP_MENTION } from "./chatPrefill";
import { prefillRoadmapChat } from "./vscodeChatPrefill";
import { buildSummarizationNotice } from "./summarization/summarizationNotice";
import { StorageBlockedError } from "./storageRecovery";

async function reportOperationalError(error: unknown): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : `Conversation Roadmap encountered an unexpected error: ${String(error)}`;
  showGraphError(message);
  const action =
    error instanceof StorageBlockedError ? "Open Storage Folder" : undefined;
  const choice = action
    ? await vscode.window.showErrorMessage(message, action)
    : await vscode.window.showErrorMessage(message);
  if (choice === action && error instanceof StorageBlockedError) {
    await vscode.env.openExternal(vscode.Uri.file(contextDirectory(error.filePath)));
  }
}

function contextDirectory(filePath: string): string {
  const separator = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return separator >= 0 ? filePath.slice(0, separator) : filePath;
}

function reportSummarizationOutcome(outcome: Awaited<ReturnType<SummarizationService["summarizeNewTurns"]>>): void {
  const notice = buildSummarizationNotice(outcome);
  if (!notice) {
    return;
  }
  showGraphError(notice.message);
  if (notice.severity === "error") {
    void vscode.window.showErrorMessage(notice.message);
  } else {
    void vscode.window.showWarningMessage(notice.message);
  }
}

async function runWithOperationalReporting(
  operation: () => Promise<void>
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    await reportOperationalError(error);
  }
}

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
  // window reloads and VS Code restarts (confirmed by "Conversation Roadmap: Open
  // Graph" command re-reading this same directory after a restart).
  const store = new TurnStore(context.globalStorageUri.fsPath);
  const roadmapStore = new RoadmapStore(context.globalStorageUri.fsPath);
  try {
    await store.load();
    // The domain-model roadmap graph (Phase 2/5) is persisted separately from
    // raw captured turns, in its own file under the same storage directory.
    await roadmapStore.load();
  } catch (error) {
    await reportOperationalError(error);
    throw error;
  }

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
      void updateGraph(turns).catch((error) => reportOperationalError(error));
      void summarizer
        .summarizeNewTurns()
        .then(async (outcome) => {
          reportSummarizationOutcome(outcome);
          if (outcome.changed) {
            await updateGraph(store.getAll());
          }
        })
        .catch((error) => reportOperationalError(error));
    }),
  });

  registerRoadmapParticipant(context, store);

  const continueChatCommand = vscode.commands.registerCommand(
    CONTINUE_ROADMAP_COMMAND,
    async () => {
      await prefillRoadmapChat(
        ROADMAP_MENTION,
        "The @roadmap mention was copied to the clipboard. Paste it into chat to continue."
      );
    }
  );
  context.subscriptions.push(continueChatCommand);

  const openGraphCommand = vscode.commands.registerCommand(
    "conversationRoadmap.openGraph",
    async () => {
      await runWithOperationalReporting(async () => {
        // Reload from disk each time the command runs so the graph reflects
        // turns captured in prior sessions, confirming reload behavior.
        await store.load();
        const summary = await summarizer.summarizeNewTurns();
        reportSummarizationOutcome(summary);
        const backfill = await summarizer.backfillExistingQuestions();
        reportSummarizationOutcome(backfill);
        await showGraphWebview(
          context,
          store,
          roadmapStore,
          () => summarizer.clearAllRoadmaps()
        );
      });
    }
  );
  context.subscriptions.push(openGraphCommand);

  // Phase 7: "Resume from here" is also available from the command palette,
  // acting on the node currently selected in the open graph.
  const resumeCommand = vscode.commands.registerCommand(
    "conversationRoadmap.resumeFromNode",
    async () => {
      await runWithOperationalReporting(() => resumeSelectedNode());
    }
  );
  context.subscriptions.push(resumeCommand);

  // Phase 8: versioned JSON export/import and Markdown outline export, each
  // a thin command wrapper over the pure logic in
  // `model/exportImport.ts`/`model/markdownExport.ts`.
  const exportRoadmapCmd = vscode.commands.registerCommand(
    "conversationRoadmap.exportRoadmap",
    async () => {
      await runWithOperationalReporting(() => exportRoadmapCommand(roadmapStore));
    }
  );
  context.subscriptions.push(exportRoadmapCmd);

  const importRoadmapCmd = vscode.commands.registerCommand(
    "conversationRoadmap.importRoadmap",
    async () => {
      await runWithOperationalReporting(async () => {
        await importRoadmapCommand(roadmapStore);
        // Refresh any open graph panel so an import is immediately visible
        // without requiring the user to reopen it.
        await updateGraph(store.getAll());
      });
    }
  );
  context.subscriptions.push(importRoadmapCmd);

  const exportMarkdownOutlineCmd = vscode.commands.registerCommand(
    "conversationRoadmap.exportMarkdownOutline",
    async () => {
      await runWithOperationalReporting(() =>
        exportMarkdownOutlineCommand(roadmapStore)
      );
    }
  );
  context.subscriptions.push(exportMarkdownOutlineCmd);

  const exportSvgCmd = vscode.commands.registerCommand(
    "conversationRoadmap.exportSvg",
    async () => {
      await runWithOperationalReporting(() => exportSvgCommand(roadmapStore));
    }
  );
  context.subscriptions.push(exportSvgCmd);

  // Phase 9: user-initiated, irreversible local data deletion (turns + roadmap graphs).
  const deleteAllDataCmd = vscode.commands.registerCommand(
    "conversationRoadmap.deleteAllData",
    async () => {
      await runWithOperationalReporting(() =>
        deleteAllDataCommand(store, roadmapStore)
      );
    }
  );
  context.subscriptions.push(deleteAllDataCmd);

  // Phase 10: lets a user reopen the onboarding notice on demand, e.g. after
  // dismissing the first-run notice or to re-check the participant-only
  // history limitation before inviting a beta tester.
  const showOnboardingCmd = vscode.commands.registerCommand(
    "conversationRoadmap.showOnboarding",
    async () => {
      await maybeShowOnboarding(context, /* force */ true);
    }
  );
  context.subscriptions.push(showOnboardingCmd);

  // Phase 10 exit criterion: known limitations (participant-only history)
  // are visible before first use. Shown at most once per install unless the
  // user explicitly reopens it via the command above, and can be disabled
  // entirely via the `conversationRoadmap.showOnboarding` setting.
  void maybeShowOnboarding(context);
}

export function deactivate(): void {
  // Best-effort immediate cleanup; activate() also removes any tab that VS Code
  // already persisted and restored before this hook ran.
  disposeGraphWebview();
}
