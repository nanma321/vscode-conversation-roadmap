import * as vscode from "vscode";
import { TurnStore } from "./turnStore";
import { RoadmapStore } from "./model/roadmapStore";
import { registerRoadmapParticipant } from "./chatParticipant";
import { showGraphWebview, updateGraph } from "./webviewPanel";

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
}

export function deactivate(): void {
  // No explicit teardown needed: TurnStore writes are flushed synchronously
  // after each append, and the chat participant/webview are disposed via
  // context.subscriptions.
}
