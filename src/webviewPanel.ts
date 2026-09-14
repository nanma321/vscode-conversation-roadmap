/**
 * Basic Webview that renders a static, non-interactive graph of captured
 * `@roadmap` turns. Each turn becomes one node; clicking a node reveals the
 * locally stored source request/response for that turn (this is the only
 * interaction required by the Phase 1 exit criteria: "a node can display its
 * locally stored source messages"). Layout is fixed (a simple vertical
 * chain) - there is no dragging, editing, or React Flow yet; that is
 * Phase 5.
 */
import * as vscode from "vscode";
import { TurnRecord } from "./turnStore";

let currentPanel: vscode.WebviewPanel | undefined;

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(webview: vscode.Webview, turns: TurnRecord[]): string {
  const nonce = getNonce();
  const nodesHtml = turns
    .map((turn, index) => {
      const label = turn.request.length > 40 ? `${turn.request.slice(0, 40)}…` : turn.request;
      const status = turn.completed ? "complete" : "incomplete";
      return `<button class="node ${status}" data-index="${index}" title="${escapeHtml(
        turn.request
      )}">${escapeHtml(label || "(empty request)")}</button>`;
    })
    .join("<div class=\"edge\">&#8595;</div>");

  const dataJson = JSON.stringify(turns).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>Roadmap Graph</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); padding: 1rem; }
    .graph { display: flex; flex-direction: column; align-items: flex-start; }
    .node { display: block; margin: 0.25rem 0; padding: 0.5rem 0.75rem; border-radius: 4px; border: 1px solid var(--vscode-panel-border, #888); background: var(--vscode-button-secondaryBackground, #333); color: inherit; cursor: pointer; text-align: left; }
    .node.incomplete { border-style: dashed; opacity: 0.7; }
    .edge { margin-left: 1rem; opacity: 0.6; }
    .empty { opacity: 0.7; font-style: italic; }
    #details { margin-top: 1.5rem; padding: 0.75rem; border-top: 1px solid var(--vscode-panel-border, #888); white-space: pre-wrap; }
    #details h3 { margin-top: 0; }
  </style>
</head>
<body>
  <h2>Roadmap (static graph &mdash; Phase 1 spike)</h2>
  ${
    turns.length === 0
      ? '<p class="empty">No @roadmap turns captured yet. Ask @roadmap something in the chat panel, then reopen this graph.</p>'
      : `<div class="graph">${nodesHtml}</div><div id="details"><p class="empty">Select a node to view its source messages.</p></div>`
  }
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const turns = ${dataJson};
    const details = document.getElementById('details');
    document.querySelectorAll('.node').forEach((el) => {
      el.addEventListener('click', () => {
        const turn = turns[Number(el.getAttribute('data-index'))];
        if (!turn || !details) { return; }
        details.innerHTML = '<h3>Source messages</h3>' +
          '<p><strong>Request:</strong> ' + escapeHtmlClient(turn.request) + '</p>' +
          '<p><strong>Response:</strong> ' + escapeHtmlClient(turn.response || '(no response)') + '</p>' +
          '<p><strong>Status:</strong> ' + (turn.completed ? 'complete' : 'incomplete') + '</p>' +
          '<p><strong>Timestamp:</strong> ' + escapeHtmlClient(turn.timestamp) + '</p>';
      });
    });
    function escapeHtmlClient(value) {
      const div = document.createElement('div');
      div.textContent = value;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
}

/** Opens (or reveals) the graph Webview panel, populated with the given turns. */
export function showGraphWebview(
  context: vscode.ExtensionContext,
  turns: TurnRecord[]
): vscode.WebviewPanel {
  if (currentPanel) {
    currentPanel.webview.html = renderHtml(currentPanel.webview, turns);
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return currentPanel;
  }

  const panel = vscode.window.createWebviewPanel(
    "conversationRoadmap.graph",
    "Roadmap Graph",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = renderHtml(panel.webview, turns);
  panel.onDidDispose(() => {
    currentPanel = undefined;
  }, null, context.subscriptions);

  currentPanel = panel;
  return panel;
}
