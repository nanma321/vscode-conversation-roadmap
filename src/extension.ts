import * as vscode from "vscode";
import { TurnStore } from "./turnStore";
import { registerRoadmapParticipant } from "./chatParticipant";
import { showGraphWebview, updateGraph } from "./webviewPanel";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Storage lives under globalStorageUri so captured turns persist across
  // window reloads and VS Code restarts (confirmed by the "Roadmap: Open
  // Graph" command re-reading this same directory after a restart).
  const store = new TurnStore(context.globalStorageUri.fsPath);
  await store.load();

  // Live refresh: whenever a new turn is captured, push it into the open graph
  // panel (a no-op if the panel isn't open) so the graph updates in real time.
  context.subscriptions.push({ dispose: store.onDidChange((turns) => updateGraph(turns)) });

  registerRoadmapParticipant(context, store);

  const openGraphCommand = vscode.commands.registerCommand(
    "conversationRoadmap.openGraph",
    async () => {
      // Reload from disk each time the command runs so the graph reflects
      // turns captured in prior sessions, confirming reload behavior.
      const turns = await store.load();
      showGraphWebview(context, turns);
    }
  );
  context.subscriptions.push(openGraphCommand);
}

export function deactivate(): void {
  // No explicit teardown needed: TurnStore writes are flushed synchronously
  // after each append, and the chat participant/webview are disposed via
  // context.subscriptions.
}
