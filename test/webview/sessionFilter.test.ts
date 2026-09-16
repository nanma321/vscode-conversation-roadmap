import * as assert from "assert";
import {
  deriveSessionLabel,
  deriveSessionOptions,
  filterRoadmapBySession,
  nodeSessionIds,
} from "../../src/webview/sessionFilter";
import { createDefaultSettings, Roadmap, RoadmapEdge, RoadmapNode } from "../../src/model/types";
import type { TurnRecord } from "../../src/turnStore";

const NOW = "2026-01-01T00:00:00.000Z";

function node(id: string, sessionIds: string[], overrides: Partial<RoadmapNode> = {}): RoadmapNode {
  return {
    id,
    title: id,
    summary: "",
    status: "open",
    tags: [],
    notes: "",
    sourceRefs: sessionIds.map((sessionId, i) => ({ turnId: `${id}-t${i}`, sessionId })),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function edge(id: string, source: string, target: string): RoadmapEdge {
  return { id, source, target, kind: "topic" };
}

function roadmapWith(nodes: RoadmapNode[], edges: RoadmapEdge[]): Roadmap {
  return {
    id: "roadmap-1",
    title: "Test",
    createdAt: NOW,
    updatedAt: NOW,
    nodes,
    edges,
    settings: createDefaultSettings(),
  };
}

function turn(id: string, sessionId: string): TurnRecord {
  return { id, sessionId, timestamp: NOW, request: "q", response: "a", completed: true, references: [] };
}

describe("deriveSessionLabel", () => {
  it("uses the first request and date instead of an opaque chat number", () => {
    const turns = [
      { ...turn("t1", "s1"), request: "What is a loop in AI?" },
      { ...turn("t2", "s1"), request: "A later follow-up" },
    ];
    assert.strictEqual(deriveSessionLabel("s1", turns), "What is a loop in AI? · 2026-01-01");
  });

  it("normalizes whitespace and truncates a very long first request", () => {
    const request = `A   long\nrequest ${"x".repeat(80)}`;
    const label = deriveSessionLabel("s1", [{ ...turn("t1", "s1"), request }]);
    assert.ok(label.endsWith("… · 2026-01-01"));
    assert.ok(!label.includes("\n"));
  });

  it("labels legacy and missing sessions explicitly", () => {
    assert.strictEqual(deriveSessionLabel("legacy", [turn("t1", "legacy")]), "Earlier turns (legacy)");
    assert.strictEqual(deriveSessionLabel("missing", []), "Unknown session");
  });
});

describe("nodeSessionIds", () => {
  it("collects the distinct sessions of a node's source turns", () => {
    const ids = nodeSessionIds([
      { sessionId: "s1" },
      { sessionId: "s1" },
      { sessionId: "s2" },
    ]);
    assert.deepStrictEqual([...ids].sort(), ["s1", "s2"]);
  });
});

describe("deriveSessionOptions", () => {
  it("lists sessions that have nodes, labeled by first-appearance order", () => {
    const roadmap = roadmapWith([node("a", ["s1"]), node("b", ["s2"]), node("c", ["s1"])], []);
    const turns = [
      { ...turn("t1", "s1"), request: "First topic" },
      { ...turn("t2", "s2"), request: "Second topic" },
    ];
    const options = deriveSessionOptions(roadmap, turns);

    assert.deepStrictEqual(
      options.map((o) => ({ id: o.id, label: o.label, nodeCount: o.nodeCount })),
      [
        { id: "s1", label: "First topic · 2026-01-01", nodeCount: 2 },
        { id: "s2", label: "Second topic · 2026-01-01", nodeCount: 1 },
      ]
    );
  });

  it("labels the legacy session explicitly", () => {
    const roadmap = roadmapWith([node("a", ["legacy"])], []);
    const options = deriveSessionOptions(roadmap, [turn("t1", "legacy")]);
    assert.strictEqual(options[0].label, "Earlier turns (legacy)");
  });

  it("omits sessions that have no nodes", () => {
    const roadmap = roadmapWith([node("a", ["s1"])], []);
    const turns = [turn("t1", "s1"), turn("t2", "s2")];
    const options = deriveSessionOptions(roadmap, turns);
    assert.deepStrictEqual(options.map((o) => o.id), ["s1"]);
  });
});

describe("filterRoadmapBySession", () => {
  it("returns the roadmap unchanged when the filter is null", () => {
    const roadmap = roadmapWith([node("a", ["s1"]), node("b", ["s2"])], [edge("e1", "a", "b")]);
    assert.strictEqual(filterRoadmapBySession(roadmap, null), roadmap);
  });

  it("keeps only nodes belonging to the selected session", () => {
    const roadmap = roadmapWith([node("a", ["s1"]), node("b", ["s2"]), node("c", ["s1"])], []);
    const filtered = filterRoadmapBySession(roadmap, "s1");
    assert.deepStrictEqual(filtered.nodes.map((n) => n.id).sort(), ["a", "c"]);
  });

  it("drops edges whose endpoints are filtered out", () => {
    const roadmap = roadmapWith(
      [node("a", ["s1"]), node("b", ["s2"])],
      [edge("e1", "a", "b"), edge("e2", "a", "a")]
    );
    const filtered = filterRoadmapBySession(roadmap, "s1");
    // e1 crosses into s2 (dropped); e2 stays within s1.
    assert.deepStrictEqual(filtered.edges.map((e) => e.id), ["e2"]);
  });

  it("always keeps provenance-less nodes (e.g. resume branches) under any filter", () => {
    const roadmap = roadmapWith([node("a", ["s1"]), node("branch", [])], []);
    const filtered = filterRoadmapBySession(roadmap, "s2");
    assert.deepStrictEqual(filtered.nodes.map((n) => n.id), ["branch"]);
  });

  it("keeps a node that spans multiple sessions when either session is selected", () => {
    const roadmap = roadmapWith([node("a", ["s1", "s2"])], []);
    assert.strictEqual(filterRoadmapBySession(roadmap, "s1").nodes.length, 1);
    assert.strictEqual(filterRoadmapBySession(roadmap, "s2").nodes.length, 1);
  });

  it("does not mutate the input roadmap", () => {
    const roadmap = roadmapWith([node("a", ["s1"]), node("b", ["s2"])], [edge("e1", "a", "b")]);
    filterRoadmapBySession(roadmap, "s1");
    assert.strictEqual(roadmap.nodes.length, 2);
    assert.strictEqual(roadmap.edges.length, 1);
  });
});
