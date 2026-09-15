import * as assert from "assert";
import { createDefaultSettings, Roadmap } from "../../src/model/types";
import { SearchableTurn, filterNodes, matchesFilters, searchRoadmap } from "../../src/model/search";

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
        title: "Kickoff planning",
        summary: "Initial discussion about scope",
        status: "open",
        nodeType: "topic",
        tags: ["planning", "backend"],
        notes: "",
        sourceRefs: [{ turnId: "turn-1", sessionId: "session-1" }],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-2",
        title: "Auth decision",
        summary: "Use JWT for authentication",
        status: "done",
        nodeType: "decision",
        tags: ["backend"],
        notes: "See RFC 123",
        highlighted: true,
        sourceRefs: [{ turnId: "turn-2", sessionId: "session-1" }],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-3",
        title: "Resume branch",
        summary: "",
        status: "open",
        nodeType: "topic",
        tags: [],
        notes: "follow up question",
        sourceRefs: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    edges: [{ id: "edge-1", source: "node-1", target: "node-3", kind: "branch", label: "resume" }],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

const turns: SearchableTurn[] = [
  { id: "turn-1", request: "How should we scope the MVP?", response: "Let's start with auth and billing." },
  { id: "turn-2", request: "Which auth approach?", response: "We chose JWT tokens for statelessness." },
];

describe("search", () => {
  describe("matchesFilters / filterNodes", () => {
    it("returns all nodes when no filters are set", () => {
      const roadmap = sampleRoadmap();
      assert.strictEqual(filterNodes(roadmap, {}).length, 3);
    });

    it("filters by node type, treating an absent nodeType as topic", () => {
      const roadmap = sampleRoadmap();
      const results = filterNodes(roadmap, { types: ["decision"] });
      assert.deepStrictEqual(results.map((n) => n.id), ["node-2"]);
    });

    it("filters by status", () => {
      const roadmap = sampleRoadmap();
      const results = filterNodes(roadmap, { statuses: ["done"] });
      assert.deepStrictEqual(results.map((n) => n.id), ["node-2"]);
    });

    it("filters by tags using OR semantics across the given list", () => {
      const roadmap = sampleRoadmap();
      const results = filterNodes(roadmap, { tags: ["planning"] });
      assert.deepStrictEqual(results.map((n) => n.id), ["node-1"]);
    });

    it("filters to only highlighted nodes", () => {
      const roadmap = sampleRoadmap();
      const results = filterNodes(roadmap, { highlightedOnly: true });
      assert.deepStrictEqual(results.map((n) => n.id), ["node-2"]);
    });

    it("filters to only nodes created via a resume branch edge", () => {
      const roadmap = sampleRoadmap();
      const results = filterNodes(roadmap, { branchesOnly: true });
      assert.deepStrictEqual(results.map((n) => n.id), ["node-3"]);
    });

    it("combines multiple filters with AND", () => {
      const roadmap = sampleRoadmap();
      const results = filterNodes(roadmap, { statuses: ["open"], tags: ["planning"] });
      assert.deepStrictEqual(results.map((n) => n.id), ["node-1"]);
    });

    it("matchesFilters is consistent with filterNodes for a single node", () => {
      const roadmap = sampleRoadmap();
      const node = roadmap.nodes[1];
      assert.strictEqual(matchesFilters(node, { statuses: ["done"] }), true);
      assert.strictEqual(matchesFilters(node, { statuses: ["open"] }), false);
    });
  });

  describe("searchRoadmap", () => {
    it("matches on node title", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "kickoff");
      assert.deepStrictEqual(results.map((r) => r.nodeId), ["node-1"]);
      assert.ok(results[0].matchedFields.includes("title"));
    });

    it("matches on node summary", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "jwt for authentication");
      assert.deepStrictEqual(results.map((r) => r.nodeId), ["node-2"]);
      assert.ok(results[0].matchedFields.includes("summary"));
    });

    it("matches on node notes", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "RFC 123");
      assert.deepStrictEqual(results.map((r) => r.nodeId), ["node-2"]);
      assert.ok(results[0].matchedFields.includes("notes"));
    });

    it("matches on node tags", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "backend").map((r) => r.nodeId).sort();
      assert.deepStrictEqual(results, ["node-1", "node-2"]);
    });

    it("matches on the source transcript (request/response text) even when the node's own text doesn't mention it", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "billing");
      assert.deepStrictEqual(results.map((r) => r.nodeId), ["node-1"]);
      assert.deepStrictEqual(results[0].matchedFields, ["transcript"]);
      assert.deepStrictEqual(results[0].matchedTurnIds, ["turn-1"]);
    });

    it("is case-insensitive", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "KICKOFF");
      assert.deepStrictEqual(results.map((r) => r.nodeId), ["node-1"]);
    });

    it("an empty query matches every node passing the filters", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "   ", { statuses: ["open"] });
      assert.deepStrictEqual(results.map((r) => r.nodeId).sort(), ["node-1", "node-3"]);
    });

    it("combines a query with filters", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "backend", { statuses: ["done"] });
      assert.deepStrictEqual(results.map((r) => r.nodeId), ["node-2"]);
    });

    it("returns no results when the query matches nothing", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, turns, "nonexistent-term-xyz");
      assert.deepStrictEqual(results, []);
    });

    it("does not crash on a dangling source reference whose turn is absent from `turns`", () => {
      const roadmap = sampleRoadmap();
      const results = searchRoadmap(roadmap, [], "kickoff");
      assert.deepStrictEqual(results.map((r) => r.nodeId), ["node-1"]);
    });
  });
});
