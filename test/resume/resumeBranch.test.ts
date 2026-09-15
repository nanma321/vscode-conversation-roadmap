import * as assert from "assert";
import { applyWebviewMessage, validateWebviewMessage } from "../../src/webviewMessages";
import { RoadmapHistory } from "../../src/model/roadmapHistory";
import { createDefaultSettings, Roadmap, RoadmapNode } from "../../src/model/types";

const NOW = "2026-01-01T00:00:00.000Z";

function node(id: string, title: string, turnIds: string[]): RoadmapNode {
  return {
    id,
    title,
    summary: "",
    status: "open",
    tags: [],
    notes: "",
    sourceRefs: turnIds.map((turnId) => ({ turnId, sessionId: "session-1" })),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function sampleRoadmap(): Roadmap {
  return {
    id: "roadmap-1",
    title: "Sample",
    createdAt: NOW,
    updatedAt: NOW,
    nodes: [node("node-1", "Kickoff", ["turn-1"]), node("node-2", "Follow-up", ["turn-2"])],
    edges: [{ id: "edge-1", source: "node-1", target: "node-2", kind: "topic" }],
    settings: createDefaultSettings(),
  };
}

describe("validateWebviewMessage: resumeFromNode", () => {
  it("accepts a resumeFromNode with a question", () => {
    const result = validateWebviewMessage({ type: "resumeFromNode", nodeId: "node-1", question: "next?" });
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.value, { type: "resumeFromNode", nodeId: "node-1", question: "next?" });
  });

  it("accepts a resumeFromNode without a question", () => {
    const result = validateWebviewMessage({ type: "resumeFromNode", nodeId: "node-1" });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.value?.type, "resumeFromNode");
  });

  it("rejects a resumeFromNode with a missing nodeId", () => {
    const result = validateWebviewMessage({ type: "resumeFromNode" });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("nodeId")));
  });

  it("rejects a resumeFromNode with a non-string question", () => {
    const result = validateWebviewMessage({ type: "resumeFromNode", nodeId: "node-1", question: 42 });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("question")));
  });
});

describe("applyWebviewMessage: resumeFromNode (branch creation)", () => {
  it("creates a new branch node and a branch edge from the source node", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "resumeFromNode", nodeId: "node-2", question: "explore an alternative" });

    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.roadmap.nodes.length, 3, "a new branch node should be added");

    const newNode = result.roadmap.nodes.find((n) => !["node-1", "node-2"].includes(n.id));
    assert.ok(newNode, "expected a newly created branch node");
    assert.strictEqual(newNode?.title, "Resume: Follow-up");
    assert.strictEqual(newNode?.notes, "explore an alternative");
    assert.deepStrictEqual(newNode?.sourceRefs, [], "a fresh branch has no captured turns yet");

    const branchEdge = result.roadmap.edges.find((e) => e.kind === "branch");
    assert.ok(branchEdge, "expected a branch edge");
    assert.strictEqual(branchEdge?.source, "node-2");
    assert.strictEqual(branchEdge?.target, newNode?.id);
    assert.strictEqual(branchEdge?.label, "resume");
  });

  it("leaves the source node and existing path completely unchanged", () => {
    const roadmap = sampleRoadmap();
    const before = JSON.parse(JSON.stringify(roadmap));
    const result = applyWebviewMessage(roadmap, { type: "resumeFromNode", nodeId: "node-2" });

    // Original nodes/edges are still present and identical.
    const originalNode2Before = before.nodes.find((n: RoadmapNode) => n.id === "node-2");
    const originalNode2After = result.roadmap.nodes.find((n) => n.id === "node-2");
    assert.deepStrictEqual(originalNode2After, originalNode2Before, "source node must be untouched");

    const topicEdgeAfter = result.roadmap.edges.find((e) => e.id === "edge-1");
    assert.deepStrictEqual(topicEdgeAfter, before.edges[0], "existing path edge must be untouched");

    // The input roadmap object itself must not be mutated.
    assert.strictEqual(roadmap.nodes.length, 2, "input roadmap must not be mutated in place");
  });

  it("rejects resuming from an unknown node id without changing the roadmap", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "resumeFromNode", nodeId: "nope" });
    assert.strictEqual(result.changed, false);
    assert.ok(result.errors.some((e) => e.includes("nope")));
    assert.strictEqual(result.roadmap.nodes.length, 2);
  });

  it("prevents a duplicate empty resume branch from the same node", () => {
    const roadmap = sampleRoadmap();
    const first = applyWebviewMessage(roadmap, { type: "resumeFromNode", nodeId: "node-2" });
    assert.strictEqual(first.changed, true);

    // Second identical resume (same node, same empty question) is a no-op.
    const second = applyWebviewMessage(first.roadmap, { type: "resumeFromNode", nodeId: "node-2" });
    assert.strictEqual(second.changed, false);
    assert.ok(second.errors.some((e) => /already exists/i.test(e)));
    assert.strictEqual(second.roadmap.nodes.length, 3, "no additional node should be created");
  });

  it("allows a second branch from the same node with a distinct follow-up question", () => {
    const roadmap = sampleRoadmap();
    const first = applyWebviewMessage(roadmap, { type: "resumeFromNode", nodeId: "node-2", question: "path A" });
    const second = applyWebviewMessage(first.roadmap, { type: "resumeFromNode", nodeId: "node-2", question: "path B" });
    assert.strictEqual(second.changed, true);
    assert.strictEqual(second.roadmap.nodes.length, 4, "two distinct branches should exist");
  });

  it("records the branch as an undoable transaction that restores the exact prior state", () => {
    const roadmap = sampleRoadmap();
    const history = new RoadmapHistory();
    const branched = applyWebviewMessage(roadmap, { type: "resumeFromNode", nodeId: "node-2" }, history);
    assert.strictEqual(branched.changed, true);
    assert.strictEqual(history.canUndo(), true);

    const undone = applyWebviewMessage(branched.roadmap, { type: "undo" }, history);
    assert.strictEqual(undone.changed, true);
    assert.strictEqual(undone.roadmap.nodes.length, 2, "undo removes the branch node");
    assert.ok(!undone.roadmap.edges.some((e) => e.kind === "branch"), "undo removes the branch edge");
  });
});
