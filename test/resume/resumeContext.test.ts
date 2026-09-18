import * as assert from "assert";
import {
  buildResumeContext,
  formatResumeQuery,
  parseResumePrompt,
  ResumeSourceTurn,
} from "../../src/resume/resumeContext";
import { createDefaultSettings, Roadmap, RoadmapEdge, RoadmapNode } from "../../src/model/types";

const NOW = "2026-01-01T00:00:00.000Z";

function node(id: string, title: string, turnIds: string[], overrides: Partial<RoadmapNode> = {}): RoadmapNode {
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
    ...overrides,
  };
}

function edge(id: string, source: string, target: string): RoadmapEdge {
  return { id, source, target, kind: "topic" };
}

function roadmapWith(nodes: RoadmapNode[], edges: RoadmapEdge[]): Roadmap {
  return {
    id: "roadmap-1",
    title: "Test roadmap",
    createdAt: NOW,
    updatedAt: NOW,
    nodes,
    edges,
    settings: createDefaultSettings(),
  };
}

function turn(id: string, request: string, response: string): ResumeSourceTurn {
  return { id, sessionId: "session-1", request, response };
}

function turnMap(turns: ResumeSourceTurn[]): Map<string, ResumeSourceTurn> {
  return new Map(turns.map((t) => [t.id, t]));
}

describe("buildResumeContext", () => {
  it("includes the selected node and its ancestor path in root-to-selected order", () => {
    const roadmap = roadmapWith(
      [node("a", "Root", ["turn-a"]), node("b", "Middle", ["turn-b"]), node("c", "Leaf", ["turn-c"])],
      [edge("e1", "a", "b"), edge("e2", "b", "c")]
    );
    const turns = turnMap([
      turn("turn-a", "root request", "root response"),
      turn("turn-b", "middle request", "middle response"),
      turn("turn-c", "leaf request", "leaf response"),
    ]);

    const ctx = buildResumeContext(roadmap, "c", turns);

    assert.deepStrictEqual(ctx.pathNodeIds, ["a", "b", "c"]);
    assert.deepStrictEqual(
      ctx.turns.map((t) => t.turnId),
      ["turn-a", "turn-b", "turn-c"]
    );
    assert.strictEqual(ctx.sourceNodeTitle, "Leaf");
    assert.strictEqual(ctx.truncated, false);
    assert.strictEqual(ctx.droppedTurnCount, 0);
  });

  it("excludes nodes that are not ancestors of the selected node", () => {
    // d is a sibling branch off a, not an ancestor of c.
    const roadmap = roadmapWith(
      [node("a", "Root", ["turn-a"]), node("b", "Middle", ["turn-b"]), node("c", "Leaf", ["turn-c"]), node("d", "Sibling", ["turn-d"])],
      [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "a", "d")]
    );
    const turns = turnMap([
      turn("turn-a", "a", "a"),
      turn("turn-b", "b", "b"),
      turn("turn-c", "c", "c"),
      turn("turn-d", "d", "d"),
    ]);

    const ctx = buildResumeContext(roadmap, "c", turns);
    assert.ok(!ctx.pathNodeIds.includes("d"), "sibling node d must not be on the path");
    assert.deepStrictEqual(ctx.pathNodeIds, ["a", "b", "c"]);
  });

  it("de-duplicates a turn referenced by more than one node on the path", () => {
    const roadmap = roadmapWith(
      [node("a", "Root", ["turn-shared"]), node("b", "Leaf", ["turn-shared", "turn-b"])],
      [edge("e1", "a", "b")]
    );
    const turns = turnMap([turn("turn-shared", "shared", "shared resp"), turn("turn-b", "b", "b resp")]);

    const ctx = buildResumeContext(roadmap, "b", turns);
    const ids = ctx.turns.map((t) => t.turnId);
    assert.deepStrictEqual(ids, ["turn-shared", "turn-b"], "shared turn must appear exactly once");
  });

  it("caps the number of turns, dropping the oldest and flagging truncation", () => {
    const roadmap = roadmapWith(
      [node("a", "Root", ["t1"]), node("b", "Mid", ["t2"]), node("c", "Leaf", ["t3"])],
      [edge("e1", "a", "b"), edge("e2", "b", "c")]
    );
    const turns = turnMap([turn("t1", "one", "r1"), turn("t2", "two", "r2"), turn("t3", "three", "r3")]);

    const ctx = buildResumeContext(roadmap, "c", turns, { maxTurns: 2 });
    assert.deepStrictEqual(
      ctx.turns.map((t) => t.turnId),
      ["t2", "t3"],
      "should keep the two most recent turns"
    );
    assert.strictEqual(ctx.truncated, true);
    assert.strictEqual(ctx.droppedTurnCount, 1);
  });

  it("caps total characters, dropping whole oldest turns to fit", () => {
    const big = "x".repeat(100);
    const roadmap = roadmapWith(
      [node("a", "Root", ["t1"]), node("b", "Leaf", ["t2"])],
      [edge("e1", "a", "b")]
    );
    const turns = turnMap([turn("t1", big, big), turn("t2", "small", "small")]);

    const ctx = buildResumeContext(roadmap, "b", turns, { maxChars: 50 });
    assert.deepStrictEqual(
      ctx.turns.map((t) => t.turnId),
      ["t2"],
      "oldest oversized turn should be dropped"
    );
    assert.strictEqual(ctx.truncated, true);
    assert.ok(ctx.droppedTurnCount >= 1);
  });

  it("truncates a single oversized turn's response rather than dropping it entirely", () => {
    const roadmap = roadmapWith([node("a", "Only", ["t1"])], []);
    const turns = turnMap([turn("t1", "req", "y".repeat(200))]);

    const ctx = buildResumeContext(roadmap, "a", turns, { maxChars: 20 });
    assert.strictEqual(ctx.turns.length, 1);
    assert.ok(ctx.turns[0].response.length < 200, "response should be truncated");
    assert.strictEqual(ctx.truncated, true);
  });

  it("returns a safe empty context for an unknown node id", () => {
    const roadmap = roadmapWith([node("a", "Only", ["t1"])], []);
    const ctx = buildResumeContext(roadmap, "does-not-exist", turnMap([turn("t1", "r", "r")]));
    assert.strictEqual(ctx.turns.length, 0);
    assert.strictEqual(ctx.pathNodeIds.length, 0);
    assert.strictEqual(ctx.truncated, false);
    assert.ok(typeof ctx.previewText === "string" && ctx.previewText.length > 0);
  });

  it("does not hang on a graph containing a cycle", () => {
    const roadmap = roadmapWith(
      [node("a", "A", ["ta"]), node("b", "B", ["tb"])],
      [edge("e1", "a", "b"), edge("e2", "b", "a")]
    );
    const ctx = buildResumeContext(roadmap, "b", turnMap([turn("ta", "a", "a"), turn("tb", "b", "b")]));
    // Both nodes are mutual ancestors; the traversal must terminate and include both.
    assert.strictEqual(ctx.pathNodeIds.length, 2);
  });

  it("previewText states it creates a new branch and leaves the original unchanged", () => {
    const roadmap = roadmapWith([node("a", "Topic", ["t1"])], []);
    const ctx = buildResumeContext(roadmap, "a", turnMap([turn("t1", "hello", "hi")]));
    assert.match(ctx.previewText, /new branch/i);
    assert.match(ctx.previewText, /unchanged/i);
    assert.ok(ctx.previewText.includes("Topic"));
  });
});

describe("formatResumeQuery", () => {
  it("addresses @roadmap and includes the context and follow-up question", () => {
    const roadmap = roadmapWith([node("a", "Design", ["t1"])], []);
    const ctx = buildResumeContext(roadmap, "a", turnMap([turn("t1", "how to design", "use layers")]));
    const query = formatResumeQuery(ctx, "what about testing?");

    assert.ok(query.startsWith("@roadmap "), "must address the @roadmap participant");
    assert.ok(query.includes("how to design"));
    assert.ok(query.includes("use layers"));
    assert.ok(query.includes("Follow-up: what about testing?"));
  });

  it("falls back to a continue instruction when no question is given", () => {
    const roadmap = roadmapWith([node("a", "Design", ["t1"])], []);
    const ctx = buildResumeContext(roadmap, "a", turnMap([turn("t1", "q", "a")]));
    const query = formatResumeQuery(ctx);
    assert.ok(query.includes("Continue from here."));
  });

  it("carries and strips an internal resume placeholder marker", () => {
    const roadmap = roadmapWith([node("a", "Design", ["t1"])], []);
    const ctx = buildResumeContext(roadmap, "a", turnMap([turn("t1", "q", "a")]));
    const query = formatResumeQuery(ctx, "what next?", "node-resume-3");
    assert.ok(query.includes("<!-- conversation-roadmap:resume=node-resume-3 -->"));

    const parsed = parseResumePrompt(query.replace(/^@roadmap\s+/, ""));
    assert.strictEqual(parsed.resumeNodeId, "node-resume-3");
    assert.ok(!parsed.prompt.includes("conversation-roadmap:resume"));
    assert.ok(parsed.prompt.includes("what next?"));
  });

  it("strips a malformed resume marker without trusting its node id", () => {
    const parsed = parseResumePrompt(
      "Continue here.\n<!-- conversation-roadmap:resume=node id with spaces -->"
    );
    assert.strictEqual(parsed.resumeNodeId, undefined);
    assert.strictEqual(parsed.prompt, "Continue here.");
  });
});
