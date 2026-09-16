/**
 * React Flow-based Webview that renders the persisted roadmap graph (Phase
 * 5), backed by the domain-model {@link RoadmapStore}. Users can pan/zoom
 * the graph, select a node to see the source transcript it was derived
 * from, drag nodes to reposition them, and edit each node's title, notes,
 * tags, color, and highlight state - all of which round-trip through
 * {@link RoadmapStore} so nothing is lost on reload.
 *
 * The heavy client-side rendering lives in `src/webview/` (a separate React
 * + React Flow bundle built by `esbuild.js` into `media/graph.js`, loaded
 * here via `webview.asWebviewUri`); this module is only responsible for:
 *   - serving that bundle inside a CSP-locked-down HTML shell,
 *   - handing the Webview its initial `roadmap`/`turns` state,
 *   - validating every message the Webview sends back (see
 *     `webviewMessages.ts`) before it is ever allowed to touch persisted
 *     state, matching the Key Engineering Principle that a Webview - like
 *     AI output or an import - is untrusted input,
 *   - and persisting valid edits, then re-broadcasting the resulting state
 *     so every open view (and the next reload) stays in sync.
 */
import * as vscode from "vscode";
import { TurnRecord, TurnStore } from "./turnStore";
import { RoadmapStore } from "./model/roadmapStore";
import { Roadmap } from "./model/types";
import { RoadmapHistory } from "./model/roadmapHistory";
import { applyWebviewMessage, HostToWebviewMessage, validateWebviewMessage } from "./webviewMessages";
import { buildResumeContext, formatResumeQuery, ResumeSourceTurn } from "./resume/resumeContext";
import { buildContentSecurityPolicy } from "./webviewCsp";
import { loadDefaultRoadmap, saveRoadmap } from "./model/defaultRoadmap";

let currentPanel: vscode.WebviewPanel | undefined;
let currentRoadmapStore: RoadmapStore | undefined;
let currentTurnStore: TurnStore | undefined;
/** Last node the Webview reported as selected, so the palette "Resume from Selected Node" command knows its target. */
let currentSelectedNodeId: string | null = null;
/** Undo/redo transaction history (Phase 6) for the single open roadmap; recreated each time the panel is (re)opened. */
let currentHistory: RoadmapHistory = new RoadmapHistory();

/**
 * Closes the graph editor without changing any persisted turns or roadmap
 * data. Called during extension shutdown so VS Code does not restore a stale
 * Roadmap Graph tab the next time the window opens.
 */
export function disposeGraphWebview(): void {
  currentPanel?.dispose();
  currentPanel = undefined;
  currentRoadmapStore = undefined;
  currentTurnStore = undefined;
  currentSelectedNodeId = null;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri, roadmap: Roadmap, turns: TurnRecord[]): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "graph.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "graph.css"));
  const stateJson = JSON.stringify({
    roadmap,
    turns,
    canUndo: currentHistory.canUndo(),
    canRedo: currentHistory.canRedo(),
  }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy(webview.cspSource, nonce)}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Roadmap Graph</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__ROADMAP_INITIAL_STATE__ = ${stateJson};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** Pushes the latest roadmap/turns (and undo/redo availability) into an already-open graph panel, if any. */
function broadcastState(roadmap: Roadmap, turns: TurnRecord[]): void {
  if (currentPanel) {
    const message: HostToWebviewMessage = {
      type: "state",
      roadmap,
      turns,
      canUndo: currentHistory.canUndo(),
      canRedo: currentHistory.canRedo(),
    };
    void currentPanel.webview.postMessage(message);
  }
}

/**
 * Pushes the latest captured turns into the open graph panel by re-reading
 * the current default roadmap alongside them. No-op if the panel isn't
 * open. Kept as the same entry point `TurnStore.onDidChange` already wires
 * up in `extension.ts`, so newly captured turns immediately update any open
 * transcript panel even though the roadmap graph itself only changes once
 * summarization runs.
 */
export function updateGraph(turns: TurnRecord[]): void {
  if (!currentPanel || !currentRoadmapStore) {
    return;
  }
  void loadDefaultRoadmap(currentRoadmapStore).then((roadmap) => broadcastState(roadmap, turns));
}

/** Sends a validation/apply error back to the open Webview as a user-visible banner. */
function postError(errors: string[]): void {
  if (!currentPanel) {
    return;
  }
  const message: HostToWebviewMessage = {
    type: "error",
    message: `Roadmap graph could not apply your change: ${errors.join("; ")}`,
  };
  void currentPanel.webview.postMessage(message);
}

/**
 * Starts a new `@roadmap` interaction seeded with `query` (Phase 7).
 *
 * Public-API constraint: VS Code exposes no typed public API to programmatically
 * invoke a chat participant or inject a user turn, and the product design
 * forbids depending on private/internal commands. The one broadly available,
 * user-visible mechanism is the built-in `workbench.action.chat.open` command,
 * which merely *prefills* the chat input (the user still presses Enter, so
 * nothing is sent without explicit consent). We probe for it first and, if it
 * is unavailable, fall back to copying the context to the clipboard so the user
 * can paste it into `@roadmap` themselves. Either way the branch node/edge has
 * already been created, so the resume is traceable regardless of how the chat
 * is ultimately started.
 */
async function startResumeInteraction(query: string): Promise<void> {
  const available = await vscode.commands.getCommands(true);
  if (available.includes("workbench.action.chat.open")) {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", { query });
      return;
    } catch {
      // Fall through to the clipboard path below.
    }
  }
  await vscode.env.clipboard.writeText(query);
  void vscode.window.showInformationMessage(
    "Resume context copied to the clipboard. Paste it into the @roadmap chat to continue from this branch."
  );
}

/**
 * Creates a resume branch from `nodeId` and opens a new `@roadmap` interaction
 * seeded with the reconstructed context. Persists and broadcasts the new
 * branch first (so it is durable and visible even if the chat never opens),
 * then hands the query to {@link startResumeInteraction}.
 */
async function performResume(nodeId: string, question: string | undefined): Promise<void> {
  if (!currentRoadmapStore) {
    return;
  }
  const roadmap = await loadDefaultRoadmap(currentRoadmapStore);
  const turns = currentTurnStore?.getAll() ?? [];
  const turnsById = new Map<string, ResumeSourceTurn>(turns.map((t) => [t.id, t]));

  const result = applyWebviewMessage(roadmap, { type: "resumeFromNode", nodeId, question }, currentHistory);
  if (!result.changed) {
    if (result.errors.length > 0) {
      postError(result.errors);
    }
    return;
  }
  await saveRoadmap(currentRoadmapStore, result.roadmap);
  broadcastState(result.roadmap, turns);

  // Build the context/query from the *pre-branch* roadmap (the ancestor path of
  // the source node), which is exactly the context the preview showed.
  const context = buildResumeContext(roadmap, nodeId, turnsById);
  await startResumeInteraction(formatResumeQuery(context, question));
}

/**
 * Command entry point for "Conversation Roadmap: Resume from Selected Node".
 * Resumes from whichever node the open graph currently has selected.
 */
export async function resumeSelectedNode(): Promise<void> {
  if (!currentPanel || !currentRoadmapStore) {
    void vscode.window.showInformationMessage("Open the Roadmap graph and select a node first.");
    return;
  }
  if (!currentSelectedNodeId) {
    void vscode.window.showInformationMessage("Select a roadmap node to resume from first.");
    return;
  }
  await performResume(currentSelectedNodeId, undefined);
}

/** Opens (or reveals) the graph Webview panel, populated with the current roadmap and turns. */
export async function showGraphWebview(
  context: vscode.ExtensionContext,
  turnStore: TurnStore,
  roadmapStore: RoadmapStore
): Promise<vscode.WebviewPanel> {
  currentRoadmapStore = roadmapStore;
  currentTurnStore = turnStore;

  const roadmap = await loadDefaultRoadmap(roadmapStore);
  const turns = turnStore.getAll();

  if (currentPanel) {
    broadcastState(roadmap, turns);
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return currentPanel;
  }

  const panel = vscode.window.createWebviewPanel(
    "conversationRoadmap.graph",
    "Roadmap Graph",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    }
  );
  // A fresh panel starts with a fresh transaction history: there is nothing
  // yet to undo, and any history from a previously disposed panel no longer
  // corresponds to anything the user can see.
  currentHistory = new RoadmapHistory();
  currentSelectedNodeId = null;
  panel.webview.html = renderHtml(panel.webview, context.extensionUri, roadmap, turns);

  panel.webview.onDidReceiveMessage(
    async (rawMessage: unknown) => {
      // Every message from the Webview is untrusted input (the Webview runs
      // arbitrary script) and must be validated before it can touch
      // persisted state; `applyWebviewMessage` never throws and never
      // mutates `roadmap` in place, so a malformed message can only ever
      // fail to change anything.
      if (!currentRoadmapStore) {
        return;
      }

      // Resume (Phase 7) has a side effect beyond a graph edit - it also opens
      // a new chat interaction - so it is handled by its own path rather than
      // the generic apply/persist flow below. Selection is tracked here so the
      // palette "Resume from Selected Node" command knows its target.
      const peek = validateWebviewMessage(rawMessage);
      if (peek.valid && peek.value) {
        if (peek.value.type === "selectNode") {
          currentSelectedNodeId = peek.value.nodeId;
        } else if (peek.value.type === "resumeFromNode") {
          await performResume(peek.value.nodeId, peek.value.question);
          return;
        }
      }

      const latestRoadmap = await loadDefaultRoadmap(currentRoadmapStore);
      const result = applyWebviewMessage(latestRoadmap, rawMessage, currentHistory);
      if (result.changed) {
        await saveRoadmap(currentRoadmapStore, result.roadmap);
        broadcastState(result.roadmap, currentTurnStore?.getAll() ?? []);
      } else if (result.errors.length > 0) {
        const message: HostToWebviewMessage = {
          type: "error",
          message: `Roadmap graph could not apply your change: ${result.errors.join("; ")}`,
        };
        void panel.webview.postMessage(message);
      }
    },
    null,
    context.subscriptions
  );

  panel.onDidDispose(() => {
    currentPanel = undefined;
    currentRoadmapStore = undefined;
    currentTurnStore = undefined;
    currentSelectedNodeId = null;
  }, null, context.subscriptions);

  currentPanel = panel;
  return panel;
}
