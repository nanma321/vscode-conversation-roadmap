import * as assert from "assert";
import { summarizeIncrementally } from "../../src/summarization/applySummary";
import { ModelSummaryResponse } from "../../src/summarization/summaryResponseSchema";
import { makeEmptyRoadmap, makeTurn } from "./fixtures";

describe("summarizeIncrementally", () => {
  it("creates a brand-new topic node in an empty roadmap, citing its source turn", () => {
    const roadmap = makeEmptyRoadmap();
    const turn = makeTurn({ id: "turn-1", request: "Let's plan the release.", response: "Sounds good." });
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "topic-1",
          kind: "topic",
          title: "Release planning",
          summary: "Planning the release.",
          sourceTurnIds: [turn.id],
          relation: "topic",
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.roadmap.nodes.length, 1);
    const node = result.roadmap.nodes[0];
    assert.strictEqual(node.title, "Release planning");
    assert.strictEqual(node.nodeType, "topic");
    assert.ok(node.sourceRefs.length >= 1, "every generated node must cite at least one source turn");
    assert.strictEqual(node.sourceRefs[0].turnId, turn.id);
    assert.strictEqual(result.roadmap.edges.length, 0);
  });

  it("conservatively continues an existing node instead of creating a duplicate", () => {
    const roadmap = makeEmptyRoadmap();
    const now = new Date().toISOString();
    roadmap.nodes.push({
      id: "node-existing",
      title: "Release planning",
      summary: "Initial summary.",
      status: "open",
      nodeType: "topic",
      tags: ["existing-tag"],
      notes: "",
      sourceRefs: [{ turnId: "turn-0", sessionId: "session-fixture" }],
      createdAt: now,
      updatedAt: now,
    });
    const turn = makeTurn({ id: "turn-2", request: "Let's add more detail.", response: "Adding detail." });

    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "continued",
          kind: "topic",
          title: "ignored on continue",
          summary: "Updated summary with more detail.",
          tags: ["new-tag"],
          sourceTurnIds: [turn.id],
          relation: "continue",
          targetNodeId: "node-existing",
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes.length, 1);
    const node = result.roadmap.nodes[0];
    assert.strictEqual(node.id, "node-existing");
    assert.strictEqual(node.summary, "Updated summary with more detail.");
    // Tags are merged (union), never removed.
    assert.deepStrictEqual(node.tags.sort(), ["existing-tag", "new-tag"].sort());
    // Source refs accumulate rather than replace.
    assert.strictEqual(node.sourceRefs.length, 2);
    assert.ok(node.sourceRefs.some((r) => r.turnId === "turn-0"));
    assert.ok(node.sourceRefs.some((r) => r.turnId === turn.id));
  });

  it("preserves the existing node's non-open status on continue when the response omits status", () => {
    const roadmap = makeEmptyRoadmap();
    const now = new Date().toISOString();
    roadmap.nodes.push({
      id: "node-existing",
      title: "Release planning",
      summary: "Initial summary.",
      status: "blocked",
      nodeType: "topic",
      tags: [],
      notes: "",
      sourceRefs: [{ turnId: "turn-0", sessionId: "session-fixture" }],
      createdAt: now,
      updatedAt: now,
    });
    const turn = makeTurn({ id: "turn-3", request: "Any update?", response: "Still waiting on input." });

    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "continued",
          kind: "topic",
          title: "ignored on continue",
          summary: "Still blocked.",
          sourceTurnIds: [turn.id],
          relation: "continue",
          targetNodeId: "node-existing",
          // status intentionally omitted
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.changed, true);
    const node = result.roadmap.nodes[0];
    // Status must be preserved, not reset to the "open" default.
    assert.strictEqual(node.status, "blocked");
  });

  it("never overwrites a status the user explicitly edited", () => {
    const roadmap = makeEmptyRoadmap();
    const now = new Date().toISOString();
    roadmap.nodes.push({
      id: "node-existing",
      title: "Release planning",
      summary: "Initial summary.",
      status: "done",
      statusEdited: true,
      nodeType: "task",
      tags: [],
      notes: "",
      sourceRefs: [{ turnId: "turn-0", sessionId: "session-fixture" }],
      createdAt: now,
      updatedAt: now,
    });
    const turn = makeTurn({ id: "turn-3", request: "Any update?", response: "More work was suggested." });
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "continued",
          kind: "task",
          title: "ignored on continue",
          summary: "The model considers this in progress.",
          status: "in-progress",
          sourceTurnIds: [turn.id],
          relation: "continue",
          targetNodeId: "node-existing",
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.roadmap.nodes[0].status, "done");
    assert.strictEqual(result.roadmap.nodes[0].statusEdited, true);
  });

  it("never overwrites user-authored title, notes, or position on continuation", () => {
    const roadmap = makeEmptyRoadmap();
    const now = new Date().toISOString();
    roadmap.nodes.push({
      id: "node-existing",
      title: "User's own title",
      summary: "Old summary.",
      status: "open",
      nodeType: "topic",
      tags: [],
      notes: "User's private notes - never touch these.",
      position: { x: 42, y: 7 },
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
    });
    const turn = makeTurn({ id: "turn-3" });
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "c",
          kind: "topic",
          title: "AI would rename it to this",
          summary: "New AI summary.",
          sourceTurnIds: [turn.id],
          relation: "continue",
          targetNodeId: "node-existing",
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    const node = result.roadmap.nodes[0];
    assert.strictEqual(node.title, "User's own title");
    assert.strictEqual(node.notes, "User's private notes - never touch these.");
    assert.deepStrictEqual(node.position, { x: 42, y: 7 });
  });

  it("creates a topic edge from the target node to a newly created topic node", () => {
    const roadmap = makeEmptyRoadmap();
    const now = new Date().toISOString();
    roadmap.nodes.push({
      id: "node-a",
      title: "Topic A",
      summary: "",
      status: "open",
      nodeType: "topic",
      tags: [],
      notes: "",
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
    });
    const turn = makeTurn({ id: "turn-4" });
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "topic-b",
          kind: "topic",
          title: "Topic B",
          summary: "A new subject.",
          sourceTurnIds: [turn.id],
          relation: "topic",
          targetNodeId: "node-a",
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.roadmap.nodes.length, 2);
    assert.strictEqual(result.roadmap.edges.length, 1);
    const edge = result.roadmap.edges[0];
    assert.strictEqual(edge.source, "node-a");
    assert.strictEqual(edge.kind, "topic");
    const newNode = result.roadmap.nodes.find((n) => n.id === edge.target);
    assert.ok(newNode);
    assert.strictEqual(newNode!.title, "Topic B");
  });

  it("creates a branch edge when relation is branch", () => {
    const roadmap = makeEmptyRoadmap();
    const now = new Date().toISOString();
    roadmap.nodes.push({
      id: "node-a",
      title: "Topic A",
      summary: "",
      status: "open",
      nodeType: "topic",
      tags: [],
      notes: "",
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
    });
    const turn = makeTurn({ id: "turn-5" });
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "branch-b",
          kind: "task",
          title: "Forked idea",
          summary: "An aside branching off topic A.",
          sourceTurnIds: [turn.id],
          relation: "branch",
          targetNodeId: "node-a",
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.roadmap.edges.length, 1);
    assert.strictEqual(result.roadmap.edges[0].kind, "branch");
    assert.strictEqual(result.roadmap.edges[0].source, "node-a");
  });

  it("extracts decision/question/task/outcome/blocker nodes distinctly from the topic node", () => {
    const roadmap = makeEmptyRoadmap();
    const turn = makeTurn({ id: "turn-6" });
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        { localId: "t", kind: "topic", title: "Topic", summary: "s", sourceTurnIds: [turn.id], relation: "topic" },
        { localId: "d", kind: "decision", title: "D", summary: "s", sourceTurnIds: [turn.id], relation: "topic", targetNodeId: "t" },
        { localId: "q", kind: "question", title: "Q", summary: "s", sourceTurnIds: [turn.id], relation: "topic", targetNodeId: "t" },
        { localId: "k", kind: "task", title: "K", summary: "s", sourceTurnIds: [turn.id], relation: "topic", targetNodeId: "t" },
        { localId: "o", kind: "outcome", title: "O", summary: "s", sourceTurnIds: [turn.id], relation: "topic", targetNodeId: "t", status: "done" },
        { localId: "b", kind: "blocker", title: "B", summary: "s", sourceTurnIds: [turn.id], relation: "topic", targetNodeId: "t", status: "blocked" },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.changed, true);
    const kinds = result.roadmap.nodes.map((n) => n.nodeType).sort();
    assert.deepStrictEqual(kinds, ["blocker", "decision", "outcome", "question", "task", "topic"]);
    const blocker = result.roadmap.nodes.find((n) => n.nodeType === "blocker");
    assert.strictEqual(blocker!.status, "blocked");
    const outcome = result.roadmap.nodes.find((n) => n.nodeType === "outcome");
    assert.strictEqual(outcome!.status, "done");
    // Every node must cite at least one source turn.
    for (const node of result.roadmap.nodes) {
      assert.ok(node.sourceRefs.length >= 1);
    }
  });

  it("leaves the roadmap unchanged when the model response fails structural validation", () => {
    const roadmap = makeEmptyRoadmap();
    roadmap.nodes.push({
      id: "node-existing",
      title: "Untouched",
      summary: "Untouched summary",
      status: "open",
      tags: [],
      notes: "",
      sourceRefs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const turn = makeTurn({ id: "turn-7" });

    const invalidResponse = { schemaVersion: 1, nodes: [{ kind: "topic" }] };
    const result = summarizeIncrementally(roadmap, invalidResponse, [turn]);

    assert.strictEqual(result.changed, false);
    assert.ok(result.errors.length > 0);
    assert.deepStrictEqual(result.roadmap, roadmap);
  });

  it("leaves the roadmap unchanged when a node cites a turn id outside the given batch", () => {
    const roadmap = makeEmptyRoadmap();
    const turn = makeTurn({ id: "turn-8" });
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "x",
          kind: "topic",
          title: "T",
          summary: "s",
          sourceTurnIds: ["turn-not-in-batch"],
          relation: "topic",
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap.nodes.length, 0);
  });

  it("leaves the roadmap unchanged when targetNodeId cannot be resolved", () => {
    const roadmap = makeEmptyRoadmap();
    const turn = makeTurn({ id: "turn-9" });
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "x",
          kind: "topic",
          title: "T",
          summary: "s",
          sourceTurnIds: [turn.id],
          relation: "continue",
          targetNodeId: "ghost-node",
        },
      ],
    };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.changed, false);
    assert.ok(result.errors.some((e) => e.includes("ghost-node")));
    assert.strictEqual(result.roadmap.nodes.length, 0);
  });

  it("makes no changes and reports no errors when the response has zero nodes", () => {
    const roadmap = makeEmptyRoadmap();
    const turn = makeTurn({ id: "turn-10" });
    const response: ModelSummaryResponse = { schemaVersion: 1, nodes: [] };

    const result = summarizeIncrementally(roadmap, response, [turn]);
    assert.strictEqual(result.changed, false);
    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.roadmap, roadmap);
  });
});
