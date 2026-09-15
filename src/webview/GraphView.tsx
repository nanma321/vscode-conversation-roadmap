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

function toFlowNodes(roadmap: Roadmap, selectedNodeId: string | null): Node<RoadmapFlowNodeData>[] {
  const positions = resolveNodePositions(roadmap.nodes, roadmap.edges);
  return roadmap.nodes.map((node) => ({
    id: node.id,
    type: "roadmapNode",
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { node, selected: node.id === selectedNodeId },
  }));
}

function toFlowEdges(roadmap: Roadmap): Edge[] {
  return roadmap.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: edge.kind === "branch",
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
  onSelectNode: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
}): React.JSX.Element {
  const { roadmap, selectedNodeId, onSelectNode, onMoveNode } = props;
  const [nodes, setNodes] = React.useState<Node<RoadmapFlowNodeData>[]>(() => toFlowNodes(roadmap, selectedNodeId));

  React.useEffect(() => {
    setNodes(toFlowNodes(roadmap, selectedNodeId));
  }, [roadmap, selectedNodeId]);

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
