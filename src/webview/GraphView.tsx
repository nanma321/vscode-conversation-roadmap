/**
 * React Flow canvas: renders the roadmap graph with zoom, pan, minimap, and
 * fit-to-view, supports dragging nodes to reposition them (persisted via
 * `moveNode` messages), and reports selection changes. Manual positions
 * (`RoadmapNode.position`) are always honored; nodes without one yet fall
 * back to {@link resolveNodePositions}'s deterministic auto-layout so
 * dragging one node never causes the rest of the graph to jump.
 */
import * as React from "react";
import ReactFlow, {
  Background,
  Connection,
  Controls,
  Edge,
  MiniMap,
  Node,
  NodeChange,
  NodeTypes,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { Roadmap, RoadmapNode } from "../model/types";
import { resolveNodePositions } from "./layout";
import { RoadmapFlowNode, RoadmapFlowNodeData } from "./RoadmapFlowNode";

const NODE_TYPES: NodeTypes = { roadmapNode: RoadmapFlowNode };

function toFlowNodes(roadmap: Roadmap, selectedNodeId: string | null, matchedNodeIds: ReadonlySet<string>): Node<RoadmapFlowNodeData>[] {
  const positions = resolveNodePositions(roadmap.nodes, roadmap.edges);
  return roadmap.nodes.map((node) => ({
    id: node.id,
    type: "roadmapNode",
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { node, selected: node.id === selectedNodeId, dimmed: !matchedNodeIds.has(node.id) },
  }));
}

/**
 * Converts persisted edges into React Flow edges, styling them so semantic
 * structure is visually distinguishable from pure layout (Phase 6):
 * AI-generated "branch" edges are animated, user-defined "manual" edges are
 * dashed, and "topic" edges (the default AI-generated continuation) are
 * plain solid lines. None of this styling is persisted - it is derived
 * purely from each edge's `kind` every render.
 */
function toFlowEdges(roadmap: Roadmap): Edge[] {
  return roadmap.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: edge.kind === "branch",
    style: edge.kind === "manual" ? { strokeDasharray: "6 4" } : undefined,
    className: `roadmap-edge roadmap-edge-${edge.kind}`,
  }));
}

function FitOnLoad(): null {
  const { fitView } = useReactFlow();
  React.useEffect(() => {
    // Runs once per mount: fits the whole graph in view as soon as the
    // canvas has measured its nodes, satisfying the fit-to-view requirement
    // without fighting the user's own zoom/pan afterwards.
    const timer = setTimeout(() => fitView({ padding: 0.2 }), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function GraphView(props: {
  roadmap: Roadmap;
  selectedNodeId: string | null;
  /** Ids of nodes currently matching the search query/filters (Phase 8); unmatched nodes render dimmed rather than being hidden, so the graph's overall shape stays visible. */
  matchedNodeIds: ReadonlySet<string>;
  onSelectNode: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onAddEdge: (source: string, target: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}): React.JSX.Element {
  const { roadmap, selectedNodeId, matchedNodeIds, onSelectNode, onMoveNode, onAddEdge, onDeleteEdge } = props;
  const [nodes, setNodes] = React.useState<Node<RoadmapFlowNodeData>[]>(() =>
    toFlowNodes(roadmap, selectedNodeId, matchedNodeIds)
  );

  React.useEffect(() => {
    setNodes(toFlowNodes(roadmap, selectedNodeId, matchedNodeIds));
  }, [roadmap, selectedNodeId, matchedNodeIds]);

  const edges = React.useMemo(() => toFlowEdges(roadmap), [roadmap]);

  const handleNodesChange = React.useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const handleNodeDragStop = React.useCallback(
    (_event: React.MouseEvent, node: Node<RoadmapNode>) => {
      onMoveNode(node.id, { x: node.position.x, y: node.position.y });
    },
    [onMoveNode]
  );

  const handleNodeClick = React.useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onSelectNode(node.id);
    },
    [onSelectNode]
  );

  const handlePaneClick = React.useCallback(() => onSelectNode(null), [onSelectNode]);

  // Dragging a connection from one node's handle to another's is how a
  // user defines a new ("manual") edge directly on the canvas (Phase 6).
  // React Flow only calls this once both a source and target are resolved,
  // so there is nothing further to validate here - the host still
  // validates/rejects the resulting `addEdge` message before it can touch
  // persisted state.
  const handleConnect = React.useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        onAddEdge(connection.source, connection.target);
      }
    },
    [onAddEdge]
  );

  const handleEdgeClick = React.useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      onDeleteEdge(edge.id);
    },
    [onDeleteEdge]
  );

  return (
    <div className="graph-canvas" role="application" aria-label="Roadmap graph">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onConnect={handleConnect}
          onEdgeClick={handleEdgeClick}
          fitView
          minZoom={0.1}
          maxZoom={2}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
          <FitOnLoad />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
