/**
 * Basic Webview that renders a graph of captured `@roadmap` turns. Each turn
 * becomes one node; clicking a node reveals the locally stored source
 * request/response for that turn.
 *
 * The graph refreshes in real time: the client is data-driven and re-renders
 * its node list whenever the extension posts an `update` message (triggered by
 * {@link TurnStore.onDidChange} as new turns are captured). The currently
 * selected node is preserved across refreshes. Layout is still a fixed vertical
 * chain - there is no dragging, editing, or React Flow yet; that is Phase 5.
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

function renderHtml(turns: TurnRecord[]): string {
  const nonce = getNonce();
  const dataJson = JSON.stringify(turns).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>Roadmap Graph</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); padding: 1rem; }
    .sessions { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 1rem; }
    .session { padding: 0.25rem 0.6rem; border-radius: 12px; border: 1px solid var(--vscode-panel-border, #888); background: transparent; color: inherit; cursor: pointer; font-size: 0.85em; }
    .session.selected { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border-color: transparent; }
    .graph { display: flex; flex-direction: column; align-items: flex-start; }
    .node { display: block; margin: 0.25rem 0; padding: 0.5rem 0.75rem; border-radius: 4px; border: 1px solid var(--vscode-panel-border, #888); background: var(--vscode-button-secondaryBackground, #333); color: inherit; cursor: pointer; text-align: left; }
    .node.incomplete { border-style: dashed; opacity: 0.7; }
    .node.selected { outline: 2px solid var(--vscode-focusBorder, #007acc); }
    .edge { margin-left: 1rem; opacity: 0.6; }
    .empty { opacity: 0.7; font-style: italic; }
    #details { margin-top: 1.5rem; padding: 0.75rem; border-top: 1px solid var(--vscode-panel-border, #888); white-space: pre-wrap; }
    #details h3 { margin-top: 0; }
  </style>
</head>
<body>
  <h2>Roadmap (live graph &mdash; Phase 1 spike)</h2>
  <div id="sessions" class="sessions"></div>
  <div id="graph" class="graph"></div>
  <div id="details"></div>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    let turns = ${dataJson};
    let selectedId = null;
    let selectedSessionId = null;
    // Follow the newest chat's roadmap by default; stop following once the user
    // deliberately clicks into an older session.
    let followLatest = true;
    const sessionsEl = document.getElementById('sessions');
    const graphEl = document.getElementById('graph');
    const detailsEl = document.getElementById('details');

    function escapeHtmlClient(value) {
      const div = document.createElement('div');
      div.textContent = value == null ? '' : String(value);
      return div.innerHTML;
    }

    function groupSessions(list) {
      const map = new Map();
      const order = [];
      for (const t of list) {
        const sid = t.sessionId || 'legacy';
        if (!map.has(sid)) { map.set(sid, []); order.push(sid); }
        map.get(sid).push(t);
      }
      return order.map((sid) => ({ id: sid, turns: map.get(sid) }));
    }

    function showDetails(turn) {
      if (!turn) {
        detailsEl.innerHTML = '<p class="empty">Select a node to view its source messages.</p>';
        return;
      }
      detailsEl.innerHTML = '<h3>Source messages</h3>' +
        '<p><strong>Request:</strong> ' + escapeHtmlClient(turn.request) + '</p>' +
        '<p><strong>Response:</strong> ' + escapeHtmlClient(turn.response || '(no response)') + '</p>' +
        '<p><strong>Status:</strong> ' + (turn.completed ? 'complete' : 'incomplete') + '</p>' +
        '<p><strong>Timestamp:</strong> ' + escapeHtmlClient(turn.timestamp) + '</p>';
    }

    function render() {
      const sessions = groupSessions(turns);
      sessionsEl.innerHTML = '';
      graphEl.innerHTML = '';

      if (!sessions.length) {
        graphEl.innerHTML = '<p class="empty">No @roadmap turns captured yet. Ask @roadmap something in the chat panel; this graph updates automatically.</p>';
        showDetails(null);
        return;
      }

      const latestId = sessions[sessions.length - 1].id;
      if (followLatest || !sessions.some((s) => s.id === selectedSessionId)) {
        selectedSessionId = latestId;
      }

      // Session selector: lets older chats stay selectable while newer ones arrive.
      sessions.forEach((session, i) => {
        const first = session.turns[0];
        const label = session.id === 'legacy' ? 'Earlier turns' : 'Chat ' + (i + 1);
        const btn = document.createElement('button');
        btn.className = 'session' + (session.id === selectedSessionId ? ' selected' : '');
        btn.textContent = label + ' (' + session.turns.length + ')';
        btn.title = first ? first.request : '';
        btn.addEventListener('click', () => {
          selectedSessionId = session.id;
          followLatest = session.id === latestId;
          selectedId = null;
          render();
        });
        sessionsEl.appendChild(btn);
      });

      const active = sessions.find((s) => s.id === selectedSessionId) || sessions[sessions.length - 1];
      active.turns.forEach((turn, index) => {
        if (index > 0) {
          const edge = document.createElement('div');
          edge.className = 'edge';
          edge.innerHTML = '&#8595;';
          graphEl.appendChild(edge);
        }
        const label = turn.request && turn.request.length > 40
          ? turn.request.slice(0, 40) + '\u2026'
          : (turn.request || '(empty request)');
        const btn = document.createElement('button');
        btn.className = 'node ' + (turn.completed ? 'complete' : 'incomplete') + (turn.id === selectedId ? ' selected' : '');
        btn.title = turn.request || '';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          selectedId = turn.id;
          render();
          showDetails(turn);
        });
        graphEl.appendChild(btn);
      });

      const selected = active.turns.find((t) => t.id === selectedId);
      showDetails(selected || null);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'update' && Array.isArray(msg.turns)) {
        turns = msg.turns;
        render();
      }
    });

    render();
  </script>
</body>
</html>`;
}

/** Pushes the latest turns into an already-open graph panel, if any. */
export function updateGraph(turns: TurnRecord[]): void {
  if (currentPanel) {
    void currentPanel.webview.postMessage({ type: "update", turns });
  }
}

/** Opens (or reveals) the graph Webview panel, populated with the given turns. */
export function showGraphWebview(
  context: vscode.ExtensionContext,
  turns: TurnRecord[]
): vscode.WebviewPanel {
  if (currentPanel) {
    updateGraph(turns);
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return currentPanel;
  }

  const panel = vscode.window.createWebviewPanel(
    "conversationRoadmap.graph",
    "Roadmap Graph",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = renderHtml(turns);
  panel.onDidDispose(() => {
    currentPanel = undefined;
  }, null, context.subscriptions);

  currentPanel = panel;
  return panel;
}

