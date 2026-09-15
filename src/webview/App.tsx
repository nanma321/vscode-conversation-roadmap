/**
 * Root component of the graph Webview (Phase 5). Owns the current roadmap
 * + transcript state (kept in sync with the extension host via `state`
 * messages), the selected node, and which alternative view (graph canvas or
 * accessible outline) is currently shown. Every mutating user action is
 * translated into one validated {@link WebviewToHostMessage} and posted to
 * the host - this component never persists anything itself.
 */
import * as React from "react";
import { Roadmap } from "../model/types";
import type { TurnRecord } from "../turnStore";
import type { HostToWebviewMessage, WebviewToHostMessage } from "../webviewMessages";
import { GraphView } from "./GraphView";
import { OutlineView } from "./OutlineView";
import { SessionTranscriptView } from "./SessionTranscriptView";
import { NodeDetailsPanel } from "./NodeDetailsPanel";
import { VsCodeApi } from "./vscodeApi";

export interface InitialState {
  roadmap: Roadmap;
  turns: TurnRecord[];
}

type ViewMode = "graph" | "outline" | "transcript";

export function App(props: { vscode: VsCodeApi; initialState: InitialState }): React.JSX.Element {
  const { vscode, initialState } = props;
  const [roadmap, setRoadmap] = React.useState<Roadmap>(initialState.roadmap);
  const [turns, setTurns] = React.useState<TurnRecord[]>(initialState.turns);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<ViewMode>("graph");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    function onMessage(event: MessageEvent<HostToWebviewMessage>): void {
      const message = event.data;
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "state") {
        setRoadmap(message.roadmap);
        setTurns(message.turns);
        // Deselect if the previously selected node no longer exists (e.g. it
        // was removed by a structural edit elsewhere), rather than pointing
        // the details panel at stale data.
        setSelectedNodeId((current) => (current && message.roadmap.nodes.some((n) => n.id === current) ? current : null));
      } else if (message.type === "error") {
        setErrorMessage(message.message);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const post = React.useCallback((message: WebviewToHostMessage) => vscode.postMessage(message), [vscode]);

  const handleSelectNode = React.useCallback(
    (nodeId: string | null) => {
      setSelectedNodeId(nodeId);
      post({ type: "selectNode", nodeId });
    },
    [post]
  );

  const handleMoveNode = React.useCallback(
    (nodeId: string, position: { x: number; y: number }) => post({ type: "moveNode", nodeId, position }),
    [post]
  );

  const selectedNode = roadmap.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const turnsById = React.useMemo(() => new Map(turns.map((t) => [t.id, t])), [turns]);

  return (
    <div className="app">
      <div className="toolbar" role="toolbar" aria-label="Graph view controls">
        <button
          type="button"
          aria-pressed={viewMode === "graph"}
          className={viewMode === "graph" ? "active" : ""}
          onClick={() => setViewMode("graph")}
        >
          Graph view
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "outline"}
          className={viewMode === "outline" ? "active" : ""}
          onClick={() => setViewMode("outline")}
        >
          Outline view
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "transcript"}
          className={viewMode === "transcript" ? "active" : ""}
          onClick={() => setViewMode("transcript")}
        >
          Session transcript
        </button>
      </div>

      {errorMessage ? (
        <div role="alert" className="error-banner">
          {errorMessage}
          <button type="button" onClick={() => setErrorMessage(null)} aria-label="Dismiss error">
            &times;
          </button>
        </div>
      ) : null}

      <div className="main">
        {viewMode === "transcript" ? (
          <SessionTranscriptView turns={turns} />
        ) : roadmap.nodes.length === 0 ? (
          <p className="empty">
            No roadmap nodes yet. Ask <code>@roadmap</code> something in the chat panel; this graph updates
            automatically as topics are captured.
          </p>
        ) : viewMode === "graph" ? (
          <GraphView roadmap={roadmap} selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} onMoveNode={handleMoveNode} />
        ) : (
          <OutlineView roadmap={roadmap} selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} />
        )}

        {viewMode === "transcript" ? null : (
          <NodeDetailsPanel
            node={selectedNode}
            turnsById={turnsById}
            onRename={(title) => selectedNodeId && post({ type: "renameNode", nodeId: selectedNodeId, title })}
            onUpdateNotes={(notes) => selectedNodeId && post({ type: "updateNotes", nodeId: selectedNodeId, notes })}
            onUpdateTags={(tags) => selectedNodeId && post({ type: "updateTags", nodeId: selectedNodeId, tags })}
            onUpdateColor={(color) => selectedNodeId && post({ type: "updateColor", nodeId: selectedNodeId, color })}
            onToggleHighlight={(highlighted) =>
              selectedNodeId && post({ type: "toggleHighlight", nodeId: selectedNodeId, highlighted })
            }
          />
        )}
      </div>
    </div>
  );
}
