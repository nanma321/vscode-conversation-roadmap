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
import { SearchFilters, searchRoadmap } from "../model/search";
import { deriveSessionOptions, filterRoadmapBySession } from "./sessionFilter";
import { GraphView } from "./GraphView";
import { OutlineView } from "./OutlineView";
import { SessionTranscriptView } from "./SessionTranscriptView";
import { NodeDetailsPanel } from "./NodeDetailsPanel";
import { ResumePreview } from "./ResumePreview";
import { SearchBar } from "./SearchBar";
import { VsCodeApi } from "./vscodeApi";

export interface InitialState {
  roadmap: Roadmap;
  turns: TurnRecord[];
  canUndo: boolean;
  canRedo: boolean;
}

type ViewMode = "graph" | "outline" | "transcript";

export function App(props: { vscode: VsCodeApi; initialState: InitialState }): React.JSX.Element {
  const { vscode, initialState } = props;
  const [roadmap, setRoadmap] = React.useState<Roadmap>(initialState.roadmap);
  const [turns, setTurns] = React.useState<TurnRecord[]>(initialState.turns);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<ViewMode>("graph");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [canUndo, setCanUndo] = React.useState<boolean>(Boolean(initialState.canUndo));
  const [canRedo, setCanRedo] = React.useState<boolean>(Boolean(initialState.canRedo));
  // Node id currently being resumed from (Phase 7); non-null while the resume
  // preview modal is open.
  const [resumeNodeId, setResumeNodeId] = React.useState<string | null>(null);
  // Search/filter state (Phase 8). Both are applied together via `search.ts`
  // so the Webview's matching logic never diverges from what is unit-tested
  // on the host side.
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [searchFilters, setSearchFilters] = React.useState<SearchFilters>({});
  // Optional session filter (view-only): null shows the full cumulative graph;
  // a session id narrows the graph/outline to that chat while leaving the
  // persisted roadmap untouched.
  const [sessionFilter, setSessionFilter] = React.useState<string | null>(null);

  React.useEffect(() => {
    function onMessage(event: MessageEvent<HostToWebviewMessage>): void {
      const message = event.data;
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "state") {
        setRoadmap(message.roadmap);
        setTurns(message.turns);
        setCanUndo(message.canUndo);
        setCanRedo(message.canRedo);
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

  const handleAddEdge = React.useCallback(
    (source: string, target: string) => post({ type: "addEdge", source, target }),
    [post]
  );

  const handleDeleteEdge = React.useCallback(
    (edgeId: string) => {
      // Removing an edge discards structure the user (or the summarizer)
      // created and cannot be undone from the canvas itself, so confirm
      // before sending the destructive message to the host.
      if (window.confirm("Delete this connection between nodes?")) {
        post({ type: "deleteEdge", edgeId });
      }
    },
    [post]
  );

  const handleMergeNodes = React.useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const sourceTitle = roadmap.nodes.find((n) => n.id === sourceNodeId)?.title || "(untitled)";
      const targetTitle = roadmap.nodes.find((n) => n.id === targetNodeId)?.title || "(untitled)";
      // Merging removes the source node entirely (its content is folded
      // into the target); confirm since this cannot be undone from the
      // canvas, only via the Undo command.
      if (window.confirm(`Merge "${sourceTitle}" into "${targetTitle}"? "${sourceTitle}" will be removed.`)) {
        post({ type: "mergeNodes", sourceNodeId, targetNodeId });
      }
    },
    [post, roadmap]
  );

  const handleSplitNode = React.useCallback(
    (nodeId: string, title: string, sourceRefTurnIds: string[]) => post({ type: "splitNode", nodeId, title, sourceRefTurnIds }),
    [post]
  );

  const handleUndo = React.useCallback(() => post({ type: "undo" }), [post]);
  const handleRedo = React.useCallback(() => post({ type: "redo" }), [post]);

  const handleResumeSend = React.useCallback(
    (nodeId: string, question: string) => {
      post({ type: "resumeFromNode", nodeId, question: question.length > 0 ? question : undefined });
      setResumeNodeId(null);
    },
    [post]
  );

  const selectedNode = roadmap.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const resumeNode = roadmap.nodes.find((n) => n.id === resumeNodeId) ?? null;
  const turnsById = React.useMemo(() => new Map(turns.map((t) => [t.id, t])), [turns]);

  // Sessions available to filter by, and the session-narrowed view of the
  // roadmap (view-only; the persisted roadmap is never changed).
  const sessionOptions = React.useMemo(() => deriveSessionOptions(roadmap, turns), [roadmap, turns]);
  React.useEffect(() => {
    if (sessionFilter && !sessionOptions.some((o) => o.id === sessionFilter)) {
      setSessionFilter(null);
    }
  }, [sessionFilter, sessionOptions]);
  const visibleRoadmap = React.useMemo(
    () => filterRoadmapBySession(roadmap, sessionFilter),
    [roadmap, sessionFilter]
  );

  // Recomputed on every roadmap/turns/query/filter change; `search.ts` is a
  // pure, cheap linear scan so there is no need to memoize beyond React's
  // normal render cycle. Search runs over the session-filtered view so match
  // counts reflect what the user is actually looking at.
  const searchMatches = searchRoadmap(visibleRoadmap, turns, searchQuery, searchFilters);
  const matchedNodeIds = new Set(searchMatches.map((m) => m.nodeId));

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
        {viewMode !== "transcript" && sessionOptions.length > 1 ? (
          <label className="session-filter">
            <span className="session-filter-label">Session:</span>
            <select
              aria-label="Filter graph by chat session"
              value={sessionFilter ?? ""}
              onChange={(e) => setSessionFilter(e.target.value === "" ? null : e.target.value)}
            >
              <option value="">All sessions ({roadmap.nodes.length})</option>
              {sessionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} ({option.nodeCount})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="toolbar-spacer" />
        <button type="button" onClick={handleUndo} disabled={!canUndo} aria-label="Undo last change">
          Undo
        </button>
        <button type="button" onClick={handleRedo} disabled={!canRedo} aria-label="Redo last undone change">
          Redo
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

      {viewMode === "transcript" ? null : (
        <SearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          filters={searchFilters}
          onFiltersChange={setSearchFilters}
          matchCount={matchedNodeIds.size}
          totalCount={roadmap.nodes.length}
        />
      )}

      <div className="main">
        {viewMode === "transcript" ? (
          <SessionTranscriptView turns={turns} />
        ) : visibleRoadmap.nodes.length === 0 ? (
          <p className="empty">
            {roadmap.nodes.length === 0 ? (
              <>
                No roadmap nodes yet. Ask <code>@roadmap</code> something in the chat panel; this graph updates
                automatically as topics are captured.
              </>
            ) : (
              <>No nodes in the selected session. Choose “All sessions” to see the full roadmap.</>
            )}
          </p>
        ) : viewMode === "graph" ? (
          <GraphView
            roadmap={visibleRoadmap}
            selectedNodeId={selectedNodeId}
            matchedNodeIds={matchedNodeIds}
            onSelectNode={handleSelectNode}
            onMoveNode={handleMoveNode}
            onAddEdge={handleAddEdge}
            onDeleteEdge={handleDeleteEdge}
          />
        ) : (
          <OutlineView roadmap={visibleRoadmap} selectedNodeId={selectedNodeId} matchedNodeIds={matchedNodeIds} onSelectNode={handleSelectNode} />
        )}

        {viewMode === "transcript" ? null : (
          <NodeDetailsPanel
            node={selectedNode}
            roadmap={roadmap}
            turnsById={turnsById}
            onRename={(title) => selectedNodeId && post({ type: "renameNode", nodeId: selectedNodeId, title })}
            onUpdateNotes={(notes) => selectedNodeId && post({ type: "updateNotes", nodeId: selectedNodeId, notes })}
            onUpdateTags={(tags) => selectedNodeId && post({ type: "updateTags", nodeId: selectedNodeId, tags })}
            onUpdateColor={(color) => selectedNodeId && post({ type: "updateColor", nodeId: selectedNodeId, color })}
            onToggleHighlight={(highlighted) =>
              selectedNodeId && post({ type: "toggleHighlight", nodeId: selectedNodeId, highlighted })
            }
            onMergeInto={(targetNodeId) => selectedNodeId && handleMergeNodes(selectedNodeId, targetNodeId)}
            onSplit={(title, sourceRefTurnIds) => selectedNodeId && handleSplitNode(selectedNodeId, title, sourceRefTurnIds)}
            onResume={() => selectedNodeId && setResumeNodeId(selectedNodeId)}
          />
        )}
      </div>

      {resumeNode ? (
        <ResumePreview
          node={resumeNode}
          roadmap={roadmap}
          turnsById={turnsById}
          onSend={(question) => handleResumeSend(resumeNode.id, question)}
          onCancel={() => setResumeNodeId(null)}
        />
      ) : null}
    </div>
  );
}
