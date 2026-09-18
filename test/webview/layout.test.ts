import * as assert from "assert";
import { computeAutoLayout, resolveNodePositions } from "../../src/webview/layout";
import { createDefaultSettings, Roadmap, RoadmapEdge, RoadmapNode } from "../../src/model/types";

function makeNode(id: string, overrides: Partial<RoadmapNode> = {}): RoadmapNode {
  const now = new Date().toISOString();
  return {
    id,
    title: id,
    summary: "",
    status: "open",
    tags: [],
    notes: "",
    sourceRefs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEdge(id: string, source: string, target: string): RoadmapEdge {
  return { id, source, target, kind: "topic" };
}

describe("computeAutoLayout", () => {
  it("places every node even with no edges", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const positions = computeAutoLayout(nodes, []);
    assert.strictEqual(positions.size, 2);
    assert.ok(positions.has("a"));
    assert.ok(positions.has("b"));
  });

  it("places each child below its parent for a simple chain", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const positions = computeAutoLayout(nodes, edges);
    assert.strictEqual(positions.get("a")!.x, positions.get("b")!.x);
    assert.strictEqual(positions.get("b")!.x, positions.get("c")!.x);
    assert.ok(positions.get("a")!.y < positions.get("b")!.y);
    assert.ok(positions.get("b")!.y < positions.get("c")!.y);
  });

  it("places siblings left-to-right at the same depth", () => {
    const nodes = [makeNode("root"), makeNode("child1"), makeNode("child2")];
    const edges = [makeEdge("e1", "root", "child1"), makeEdge("e2", "root", "child2")];
    const positions = computeAutoLayout(nodes, edges);
    assert.notStrictEqual(positions.get("child1")!.x, positions.get("child2")!.x);
    assert.strictEqual(positions.get("child1")!.y, positions.get("child2")!.y);
    assert.ok(positions.get("root")!.y < positions.get("child1")!.y);
  });

  it("keeps the existing child stable and centers its parent when a sibling is appended", () => {
    const initialNodes = [makeNode("root"), makeNode("child1")];
    const initialEdges = [makeEdge("e1", "root", "child1")];
    const initial = computeAutoLayout(initialNodes, initialEdges);

    const expanded = computeAutoLayout(
      [...initialNodes, makeNode("child2")],
      [...initialEdges, makeEdge("e2", "root", "child2")]
    );
    assert.deepStrictEqual(expanded.get("child1"), initial.get("child1"));
    assert.strictEqual(expanded.get("root")!.x, 120);
    assert.strictEqual(expanded.get("child2")!.x, 240);
  });

  it("places a grandchild beneath its own new parent instead of another branch", () => {
    const nodes = [
      makeNode("root"),
      makeNode("old-child"),
      makeNode("new-parent"),
      makeNode("new-child"),
    ];
    const edges = [
      makeEdge("e1", "root", "old-child"),
      makeEdge("e2", "root", "new-parent"),
      makeEdge("e3", "new-parent", "new-child"),
    ];
    const positions = computeAutoLayout(nodes, edges);

    assert.strictEqual(positions.get("new-parent")!.x, positions.get("new-child")!.x);
    assert.ok(positions.get("new-parent")!.y < positions.get("new-child")!.y);
    assert.notStrictEqual(positions.get("old-child")!.x, positions.get("new-child")!.x);
  });

  it("centers a parent over a row of child subtrees", () => {
    const children = ["a", "b", "c", "d", "e"].map((id) => makeNode(id));
    const nodes = [makeNode("root"), ...children];
    const edges = children.map((child, index) => makeEdge(`e${index}`, "root", child.id));
    const positions = computeAutoLayout(nodes, edges);
    const childColumns = children.map((child) => positions.get(child.id)!.x);

    assert.deepStrictEqual(childColumns, [0, 240, 480, 720, 960]);
    assert.strictEqual(positions.get("root")!.x, 480);
  });

  it("still places nodes unreachable from any root (e.g. a cycle)", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "a")];
    const positions = computeAutoLayout(nodes, edges);
    assert.strictEqual(positions.size, 2);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "a", "c")];
    const first = computeAutoLayout(nodes, edges);
    const second = computeAutoLayout(nodes, edges);
    assert.deepStrictEqual(Array.from(first.entries()), Array.from(second.entries()));
  });
});

describe("resolveNodePositions", () => {
  it("prefers a node's manual position over the auto-layout position", () => {
    const nodes = [makeNode("a", { position: { x: 999, y: 888 } }), makeNode("b")];
    const positions = resolveNodePositions(nodes, []);
    assert.deepStrictEqual(positions.get("a"), { x: 999, y: 888 });
  });

  it("falls back to the auto-layout position when no manual position is set", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("e1", "a", "b")];
    const auto = computeAutoLayout(nodes, edges);
    const positions = resolveNodePositions(nodes, edges);
    assert.deepStrictEqual(positions.get("b"), auto.get("b"));
  });

  it("positions a new automatic child relative to its parent's latest manual position", () => {
    const nodes = [
      makeNode("parent", { position: { x: 900, y: 300 } }),
      makeNode("child"),
    ];
    const edges = [makeEdge("e1", "parent", "child")];
    const positions = resolveNodePositions(nodes, edges);

    assert.deepStrictEqual(positions.get("parent"), { x: 900, y: 300 });
    assert.deepStrictEqual(positions.get("child"), { x: 900, y: 450 });
  });

  it("preserves a child's own manual position instead of inheriting its parent's offset", () => {
    const nodes = [
      makeNode("parent", { position: { x: 900, y: 300 } }),
      makeNode("child", { position: { x: 120, y: 640 } }),
      makeNode("grandchild"),
    ];
    const edges = [
      makeEdge("e1", "parent", "child"),
      makeEdge("e2", "child", "grandchild"),
    ];
    const positions = resolveNodePositions(nodes, edges);

    assert.deepStrictEqual(positions.get("child"), { x: 120, y: 640 });
    assert.deepStrictEqual(positions.get("grandchild"), { x: 120, y: 790 });
  });

  it("resolves a position for every node in a roadmap", () => {
    const now = new Date().toISOString();
    const roadmap: Roadmap = {
      id: "r1",
      title: "r",
      createdAt: now,
      updatedAt: now,
      nodes: [makeNode("a"), makeNode("b", { position: { x: 5, y: 5 } })],
      edges: [makeEdge("e1", "a", "b")],
      settings: createDefaultSettings(),
    };
    const positions = resolveNodePositions(roadmap.nodes, roadmap.edges);
    assert.strictEqual(positions.size, 2);
  });
});
