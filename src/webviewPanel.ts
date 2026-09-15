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
import { createDefaultSettings, Roadmap, RoadmapDocument } from "./model/types";
import { RoadmapHistory } from "./model/roadmapHistory";
import { applyWebviewMessage, HostToWebviewMessage } from "./webviewMessages";

/** Single roadmap this graph Webview reads/writes for now; multi-roadmap selection is a later phase. */
const DEFAULT_ROADMAP_ID = "default";

let currentPanel: vscode.WebviewPanel | undefined;
let currentRoadmapStore: RoadmapStore | undefined;
let currentTurnStore: TurnStore | undefined;
/** Undo/redo transaction history (Phase 6) for the single open roadmap; recreated each time the panel is (re)opened. */
let currentHistory: RoadmapHistory = new RoadmapHistory();

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/**
 * Returns the single default roadmap from `document`, creating (but not yet
 * persisting) an empty one if it doesn't exist yet. Callers that create a
 * new roadmap this way are responsible for persisting the updated document.
 */
function getOrCreateDefaultRoadmap(document: RoadmapDocument): { roadmap: Roadmap; document: RoadmapDocument } {
  const existing = document.roadmaps.find((r) => r.id === DEFAULT_ROADMAP_ID);
  if (existing) {
    return { roadmap: existing, document };
  }
  const now = new Date().toISOString();
  const roadmap: Roadmap = {
    id: DEFAULT_ROADMAP_ID,
    title: "Roadmap",
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    settings: createDefaultSettings(),
  };
  return { roadmap, document: { ...document, roadmaps: [...document.roadmaps, roadmap] } };
}

/** Loads (creating if necessary) the default roadmap, persisting it if it had to be created. */
async function loadDefaultRoadmap(store: RoadmapStore): Promise<Roadmap> {
  const doc = await store.load();
  const { roadmap, document } = getOrCreateDefaultRoadmap(doc);
  if (document !== doc) {
    await store.save(document);
  }
  return roadmap;
}

/** Persists `roadmap` back into its document, replacing the prior copy of the same id. */
async function saveRoadmap(store: RoadmapStore, roadmap: Roadmap): Promise<void> {
  const doc = await store.load();
  const nextRoadmaps = doc.roadmaps.some((r) => r.id === roadmap.id)
    ? doc.roadmaps.map((r) => (r.id === roadmap.id ? roadmap : r))
    : [...doc.roadmaps, roadmap];
  await store.save({ ...doc, roadmaps: nextRoadmaps });
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};" />
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
  }, null, context.subscriptions);

  currentPanel = panel;
  return panel;
}
