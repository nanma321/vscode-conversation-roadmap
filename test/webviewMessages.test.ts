import * as assert from "assert";
import { applyWebviewMessage, validateWebviewMessage } from "../src/webviewMessages";
import { RoadmapHistory } from "../src/model/roadmapHistory";
import { createDefaultSettings, Roadmap } from "../src/model/types";

function sampleRoadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  const now = new Date().toISOString();
  return {
    id: "roadmap-1",
    title: "Sample roadmap",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "node-1",
        title: "Kickoff",
        summary: "Initial discussion",
        status: "open",
        tags: ["planning"],
        notes: "",
        sourceRefs: [{ turnId: "turn-1", sessionId: "session-1" }],
        createdAt: now,
        updatedAt: now,
      },
    ],
    edges: [],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

/** Two-node roadmap, with a second node that has its own distinct source turns, for edge/merge/split tests. */
function sampleRoadmapWithTwoNodes(overrides: Partial<Roadmap> = {}): Roadmap {
  const base = sampleRoadmap();
  const now = new Date().toISOString();
  return sampleRoadmap({
    nodes: [
      base.nodes[0],
      {
        id: "node-2",
        title: "Follow-up",
        summary: "Second discussion",
        status: "open",
        tags: ["follow-up"],
        notes: "some notes",
        sourceRefs: [
          { turnId: "turn-2", sessionId: "session-1" },
          { turnId: "turn-3", sessionId: "session-1" },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  });
}

describe("validateWebviewMessage", () => {
  it("rejects non-object messages", () => {
    const result = validateWebviewMessage("not an object");
    assert.strictEqual(result.valid, false);
  });

  it("rejects messages without a string type", () => {
    const result = validateWebviewMessage({ nodeId: "node-1" });
    assert.strictEqual(result.valid, false);
  });

  it("rejects unrecognized message types", () => {
    const result = validateWebviewMessage({ type: "deleteEverything" });
    assert.strictEqual(result.valid, false);
    assert.match(result.errors[0], /unrecognized message type/);
  });

  it("accepts a well-formed moveNode message", () => {
    const result = validateWebviewMessage({ type: "moveNode", nodeId: "node-1", position: { x: 10, y: 20 } });
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.value, { type: "moveNode", nodeId: "node-1", position: { x: 10, y: 20 } });
  });

  it("rejects moveNode with a non-finite position", () => {
    const result = validateWebviewMessage({ type: "moveNode", nodeId: "node-1", position: { x: Infinity, y: 20 } });
    assert.strictEqual(result.valid, false);
  });

  it("rejects moveNode missing a position entirely", () => {
    const result = validateWebviewMessage({ type: "moveNode", nodeId: "node-1" });
    assert.strictEqual(result.valid, false);
  });

  it("trims renameNode titles and rejects blank ones", () => {
    const ok = validateWebviewMessage({ type: "renameNode", nodeId: "node-1", title: "  New title  " });
    assert.strictEqual(ok.valid, true);
    assert.strictEqual(ok.value && (ok.value as { title: string }).title, "New title");

    const blank = validateWebviewMessage({ type: "renameNode", nodeId: "node-1", title: "   " });
    assert.strictEqual(blank.valid, false);
  });

  it("accepts updateNotes with an empty string (clearing notes)", () => {
    const result = validateWebviewMessage({ type: "updateNotes", nodeId: "node-1", notes: "" });
    assert.strictEqual(result.valid, true);
  });

  it("rejects updateTags when tags is not an array of strings", () => {
    const result = validateWebviewMessage({ type: "updateTags", nodeId: "node-1", tags: ["ok", 5] });
    assert.strictEqual(result.valid, false);
  });

  it("accepts updateColor with a hex color or null", () => {
    const withColor = validateWebviewMessage({ type: "updateColor", nodeId: "node-1", color: "#ff00aa" });
    assert.strictEqual(withColor.valid, true);
    const cleared = validateWebviewMessage({ type: "updateColor", nodeId: "node-1", color: null });
    assert.strictEqual(cleared.valid, true);
  });

  it("rejects updateColor with a non-hex string", () => {
    const result = validateWebviewMessage({ type: "updateColor", nodeId: "node-1", color: "red" });
    assert.strictEqual(result.valid, false);
  });

  it("accepts toggleHighlight with a boolean", () => {
    const result = validateWebviewMessage({ type: "toggleHighlight", nodeId: "node-1", highlighted: true });
    assert.strictEqual(result.valid, true);
  });

  it("rejects toggleHighlight with a non-boolean", () => {
    const result = validateWebviewMessage({ type: "toggleHighlight", nodeId: "node-1", highlighted: "yes" });
    assert.strictEqual(result.valid, false);
  });

  it("accepts selectNode with a null nodeId (deselecting)", () => {
    const result = validateWebviewMessage({ type: "selectNode", nodeId: null });
    assert.strictEqual(result.valid, true);
  });

  it("accepts a bare requestState message", () => {
    const result = validateWebviewMessage({ type: "requestState" });
    assert.strictEqual(result.valid, true);
  });
});

describe("applyWebviewMessage", () => {
  it("returns the original roadmap unchanged for an invalid message", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "moveNode", nodeId: "node-1" });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap, roadmap);
    assert.ok(result.errors.length > 0);
  });

  it("returns the original roadmap unchanged for an unknown node id", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, {
      type: "moveNode",
      nodeId: "does-not-exist",
      position: { x: 1, y: 2 },
    });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap, roadmap);
    assert.match(result.errors[0], /no node with id/);
  });

  it("persists a moved node's position without touching other fields", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "moveNode", nodeId: "node-1", position: { x: 42, y: 84 } });
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.roadmap.nodes[0].position, { x: 42, y: 84 });
    assert.strictEqual(result.roadmap.nodes[0].title, "Kickoff");
    assert.strictEqual(result.roadmap.nodes[0].summary, "Initial discussion");
  });

  it("renames a node", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "renameNode", nodeId: "node-1", title: "Renamed" });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes[0].title, "Renamed");
  });

  it("updates notes without touching the AI-generated summary", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "updateNotes", nodeId: "node-1", notes: "My notes" });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes[0].notes, "My notes");
    assert.strictEqual(result.roadmap.nodes[0].summary, "Initial discussion");
  });

  it("replaces tags with the user-provided set", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "updateTags", nodeId: "node-1", tags: ["urgent", "phase5"] });
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.roadmap.nodes[0].tags, ["urgent", "phase5"]);
  });

  it("sets and clears a node's color", () => {
    const roadmap = sampleRoadmap();
    const colored = applyWebviewMessage(roadmap, { type: "updateColor", nodeId: "node-1", color: "#abc" });
    assert.strictEqual(colored.roadmap.nodes[0].color, "#abc");

    const cleared = applyWebviewMessage(colored.roadmap, { type: "updateColor", nodeId: "node-1", color: null });
    assert.strictEqual(cleared.roadmap.nodes[0].color, undefined);
  });

  it("toggles highlighting", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "toggleHighlight", nodeId: "node-1", highlighted: true });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes[0].highlighted, true);
  });

  it("does not persist anything for selectNode or requestState", () => {
    const roadmap = sampleRoadmap();
    const select = applyWebviewMessage(roadmap, { type: "selectNode", nodeId: "node-1" });
    assert.strictEqual(select.changed, false);
    assert.strictEqual(select.roadmap, roadmap);

    const request = applyWebviewMessage(roadmap, { type: "requestState" });
    assert.strictEqual(request.changed, false);
    assert.strictEqual(request.roadmap, roadmap);
  });

  it("leaves other nodes untouched when editing one node", () => {
    const roadmap = sampleRoadmap({
      nodes: [
        ...sampleRoadmap().nodes,
        {
          id: "node-2",
          title: "Second",
          summary: "Second summary",
          status: "open",
          tags: [],
          notes: "",
          sourceRefs: [{ turnId: "turn-2", sessionId: "session-1" }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const result = applyWebviewMessage(roadmap, { type: "renameNode", nodeId: "node-1", title: "Renamed" });
    assert.strictEqual(result.roadmap.nodes[1].title, "Second");
  });
});

describe("validateWebviewMessage: structural edits", () => {
  it("accepts a well-formed addEdge message", () => {
    const result = validateWebviewMessage({ type: "addEdge", source: "node-1", target: "node-2" });
    assert.strictEqual(result.valid, true);
  });

  it("rejects addEdge with a self-loop", () => {
    const result = validateWebviewMessage({ type: "addEdge", source: "node-1", target: "node-1" });
    assert.strictEqual(result.valid, false);
  });

  it("rejects addEdge missing source/target", () => {
    const result = validateWebviewMessage({ type: "addEdge", source: "node-1" });
    assert.strictEqual(result.valid, false);
  });

  it("accepts deleteEdge with an edge id", () => {
    const result = validateWebviewMessage({ type: "deleteEdge", edgeId: "edge-1" });
    assert.strictEqual(result.valid, true);
  });

  it("rejects mergeNodes with identical source and target ids", () => {
    const result = validateWebviewMessage({ type: "mergeNodes", sourceNodeId: "node-1", targetNodeId: "node-1" });
    assert.strictEqual(result.valid, false);
  });

  it("accepts a well-formed splitNode message", () => {
    const result = validateWebviewMessage({ type: "splitNode", nodeId: "node-1", title: "New topic", sourceRefTurnIds: ["turn-2"] });
    assert.strictEqual(result.valid, true);
  });

  it("rejects splitNode with an empty sourceRefTurnIds array", () => {
    const result = validateWebviewMessage({ type: "splitNode", nodeId: "node-1", title: "New topic", sourceRefTurnIds: [] });
    assert.strictEqual(result.valid, false);
  });

  it("accepts bare undo/redo messages", () => {
    assert.strictEqual(validateWebviewMessage({ type: "undo" }).valid, true);
    assert.strictEqual(validateWebviewMessage({ type: "redo" }).valid, true);
  });
});

describe("applyWebviewMessage: user-defined edges", () => {
  it("adds a manual edge between two existing nodes", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const result = applyWebviewMessage(roadmap, { type: "addEdge", source: "node-1", target: "node-2" });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.edges.length, 1);
    assert.strictEqual(result.roadmap.edges[0].kind, "manual");
    assert.strictEqual(result.roadmap.edges[0].source, "node-1");
    assert.strictEqual(result.roadmap.edges[0].target, "node-2");
  });

  it("rejects addEdge referencing an unknown node", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const result = applyWebviewMessage(roadmap, { type: "addEdge", source: "node-1", target: "does-not-exist" });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap.edges.length, 0);
  });

  it("rejects a duplicate edge between the same pair of nodes", () => {
    let roadmap = sampleRoadmapWithTwoNodes();
    roadmap = applyWebviewMessage(roadmap, { type: "addEdge", source: "node-1", target: "node-2" }).roadmap;
    const result = applyWebviewMessage(roadmap, { type: "addEdge", source: "node-1", target: "node-2" });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap.edges.length, 1);
  });

  it("deletes an existing edge", () => {
    let roadmap = sampleRoadmapWithTwoNodes();
    roadmap = applyWebviewMessage(roadmap, { type: "addEdge", source: "node-1", target: "node-2" }).roadmap;
    const edgeId = roadmap.edges[0].id;
    const result = applyWebviewMessage(roadmap, { type: "deleteEdge", edgeId });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.edges.length, 0);
  });

  it("rejects deleteEdge for an unknown edge id", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const result = applyWebviewMessage(roadmap, { type: "deleteEdge", edgeId: "does-not-exist" });
    assert.strictEqual(result.changed, false);
  });

  it("distinguishes manual (user-defined) edges from AI-generated topic/branch edges", () => {
    const roadmap = sampleRoadmapWithTwoNodes({
      edges: [{ id: "edge-ai", source: "node-1", target: "node-2", kind: "topic" }],
    });
    // Adding a reverse user-defined edge must not disturb the existing semantic edge's kind.
    const result = applyWebviewMessage(roadmap, { type: "addEdge", source: "node-2", target: "node-1" });
    assert.strictEqual(result.roadmap.edges.find((e) => e.id === "edge-ai")?.kind, "topic");
    assert.strictEqual(result.roadmap.edges.find((e) => e.source === "node-2")?.kind, "manual");
  });
});

describe("applyWebviewMessage: merge operation", () => {
  it("merges the source node into the target node, preserving all source references", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const totalRefsBefore = roadmap.nodes.reduce((sum, n) => sum + n.sourceRefs.length, 0);

    const result = applyWebviewMessage(roadmap, { type: "mergeNodes", sourceNodeId: "node-2", targetNodeId: "node-1" });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes.length, 1);
    assert.strictEqual(result.roadmap.nodes[0].id, "node-1");

    const totalRefsAfter = result.roadmap.nodes.reduce((sum, n) => sum + n.sourceRefs.length, 0);
    assert.strictEqual(totalRefsAfter, totalRefsBefore);

    const turnIds = result.roadmap.nodes[0].sourceRefs.map((r) => r.turnId).sort();
    assert.deepStrictEqual(turnIds, ["turn-1", "turn-2", "turn-3"]);
  });

  it("merges tags (union) and concatenates notes from both nodes", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const result = applyWebviewMessage(roadmap, { type: "mergeNodes", sourceNodeId: "node-2", targetNodeId: "node-1" });
    assert.deepStrictEqual([...result.roadmap.nodes[0].tags].sort(), ["follow-up", "planning"]);
    assert.match(result.roadmap.nodes[0].notes, /some notes/);
  });

  it("redirects edges referencing the removed source node to the target node", () => {
    const roadmap = sampleRoadmapWithTwoNodes({
      nodes: [
        ...sampleRoadmapWithTwoNodes().nodes,
        {
          id: "node-3",
          title: "Third",
          summary: "",
          status: "open",
          tags: [],
          notes: "",
          sourceRefs: [{ turnId: "turn-4", sessionId: "session-1" }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      edges: [{ id: "edge-1", source: "node-2", target: "node-3", kind: "topic" }],
    });
    const result = applyWebviewMessage(roadmap, { type: "mergeNodes", sourceNodeId: "node-2", targetNodeId: "node-1" });
    assert.strictEqual(result.roadmap.edges.length, 1);
    assert.strictEqual(result.roadmap.edges[0].source, "node-1");
    assert.strictEqual(result.roadmap.edges[0].target, "node-3");
  });

  it("rejects merging a node that does not exist", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const result = applyWebviewMessage(roadmap, { type: "mergeNodes", sourceNodeId: "does-not-exist", targetNodeId: "node-1" });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap.nodes.length, 2);
  });
});

describe("applyWebviewMessage: split operation", () => {
  it("splits selected source references into a new node, preserving all references", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const totalRefsBefore = roadmap.nodes.reduce((sum, n) => sum + n.sourceRefs.length, 0);

    const result = applyWebviewMessage(roadmap, {
      type: "splitNode",
      nodeId: "node-2",
      title: "Split off topic",
      sourceRefTurnIds: ["turn-3"],
    });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes.length, 3);

    const totalRefsAfter = result.roadmap.nodes.reduce((sum, n) => sum + n.sourceRefs.length, 0);
    assert.strictEqual(totalRefsAfter, totalRefsBefore);

    const originalNode = result.roadmap.nodes.find((n) => n.id === "node-2")!;
    assert.deepStrictEqual(originalNode.sourceRefs.map((r) => r.turnId), ["turn-2"]);

    const newNode = result.roadmap.nodes.find((n) => n.title === "Split off topic")!;
    assert.ok(newNode);
    assert.deepStrictEqual(newNode.sourceRefs.map((r) => r.turnId), ["turn-3"]);
  });

  it("creates a manual edge from the original node to the new split-off node", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const result = applyWebviewMessage(roadmap, {
      type: "splitNode",
      nodeId: "node-2",
      title: "Split off topic",
      sourceRefTurnIds: ["turn-3"],
    });
    const newNode = result.roadmap.nodes.find((n) => n.title === "Split off topic")!;
    const splitEdge = result.roadmap.edges.find((e) => e.source === "node-2" && e.target === newNode.id);
    assert.ok(splitEdge);
    assert.strictEqual(splitEdge?.kind, "manual");
  });

  it("rejects splitNode when none of the requested turn ids belong to the node", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const result = applyWebviewMessage(roadmap, {
      type: "splitNode",
      nodeId: "node-2",
      title: "Split off topic",
      sourceRefTurnIds: ["turn-does-not-exist"],
    });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap.nodes.length, 2);
  });

  it("rejects splitNode for an unknown node id", () => {
    const roadmap = sampleRoadmapWithTwoNodes();
    const result = applyWebviewMessage(roadmap, {
      type: "splitNode",
      nodeId: "does-not-exist",
      title: "Split off topic",
      sourceRefTurnIds: ["turn-2"],
    });
    assert.strictEqual(result.changed, false);
  });
});

describe("applyWebviewMessage: undo/redo transactions", () => {
  it("undo restores the exact prior roadmap state after a structural edit", () => {
    const history = new RoadmapHistory();
    const original = sampleRoadmapWithTwoNodes();

    const afterMerge = applyWebviewMessage(original, { type: "mergeNodes", sourceNodeId: "node-2", targetNodeId: "node-1" }, history);
    assert.strictEqual(afterMerge.changed, true);
    assert.strictEqual(afterMerge.roadmap.nodes.length, 1);

    const undone = applyWebviewMessage(afterMerge.roadmap, { type: "undo" }, history);
    assert.strictEqual(undone.changed, true);
    assert.deepStrictEqual(undone.roadmap, original);
  });

  it("redo re-applies a change that was undone", () => {
    const history = new RoadmapHistory();
    const original = sampleRoadmapWithTwoNodes();

    const afterAdd = applyWebviewMessage(original, { type: "addEdge", source: "node-1", target: "node-2" }, history);
    const undone = applyWebviewMessage(afterAdd.roadmap, { type: "undo" }, history);
    assert.deepStrictEqual(undone.roadmap, original);

    const redone = applyWebviewMessage(undone.roadmap, { type: "redo" }, history);
    assert.strictEqual(redone.changed, true);
    assert.deepStrictEqual(redone.roadmap, afterAdd.roadmap);
  });

  it("reports no-op (changed: false) when there is nothing to undo or redo", () => {
    const history = new RoadmapHistory();
    const roadmap = sampleRoadmapWithTwoNodes();
    const undoResult = applyWebviewMessage(roadmap, { type: "undo" }, history);
    assert.strictEqual(undoResult.changed, false);
    assert.strictEqual(undoResult.roadmap, roadmap);

    const redoResult = applyWebviewMessage(roadmap, { type: "redo" }, history);
    assert.strictEqual(redoResult.changed, false);
    assert.strictEqual(redoResult.roadmap, roadmap);
  });

  it("a new edit after undo clears the redo stack", () => {
    const history = new RoadmapHistory();
    const original = sampleRoadmapWithTwoNodes();

    const afterAdd = applyWebviewMessage(original, { type: "addEdge", source: "node-1", target: "node-2" }, history);
    const undone = applyWebviewMessage(afterAdd.roadmap, { type: "undo" }, history);
    // Make a fresh edit instead of redoing.
    const afterRename = applyWebviewMessage(undone.roadmap, { type: "renameNode", nodeId: "node-1", title: "Renamed" }, history);
    assert.strictEqual(afterRename.changed, true);

    const redoResult = applyWebviewMessage(afterRename.roadmap, { type: "redo" }, history);
    assert.strictEqual(redoResult.changed, false);
  });
});
