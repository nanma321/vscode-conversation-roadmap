import * as assert from "assert";
import { validateModelSummaryResponse } from "../../src/summarization/summaryResponseSchema";

const KNOWN_TURN_IDS = new Set(["turn-1", "turn-2"]);

function validNode(overrides: Record<string, unknown> = {}) {
  return {
    localId: "n1",
    kind: "topic",
    title: "A topic",
    summary: "Some summary text",
    sourceTurnIds: ["turn-1"],
    relation: "topic",
    ...overrides,
  };
}

describe("validateModelSummaryResponse", () => {
  it("accepts a minimal well-formed response", () => {
    const result = validateModelSummaryResponse({ schemaVersion: 1, nodes: [validNode()] }, KNOWN_TURN_IDS);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.value);
  });

  it("accepts an empty nodes array (no new information this batch)", () => {
    const result = validateModelSummaryResponse({ schemaVersion: 1, nodes: [] }, KNOWN_TURN_IDS);
    assert.strictEqual(result.valid, true);
  });

  it("rejects a non-object value", () => {
    const result = validateModelSummaryResponse("not an object", KNOWN_TURN_IDS);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects a response with the wrong schemaVersion", () => {
    const result = validateModelSummaryResponse({ schemaVersion: 2, nodes: [] }, KNOWN_TURN_IDS);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("schemaVersion")));
  });

  it("rejects a response whose nodes field is not an array", () => {
    const result = validateModelSummaryResponse({ schemaVersion: 1, nodes: "oops" }, KNOWN_TURN_IDS);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("nodes")));
  });

  it("rejects a node with an invalid kind", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ kind: "not-a-kind" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".kind")));
  });

  it("rejects a node missing a title", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ title: "" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".title")));
  });

  it("rejects a node missing a summary", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ summary: "" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".summary")));
  });

  it("rejects a node with an empty sourceTurnIds array", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ sourceTurnIds: [] })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("sourceTurnIds") && e.includes("cite")));
  });

  it("rejects a node citing a turn id outside the given batch", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ sourceTurnIds: ["turn-unknown"] })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("turn-unknown")));
  });

  it("rejects duplicate localIds within the same response", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ localId: "dup" }), validNode({ localId: "dup" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("duplicate localId")));
  });

  it("rejects an invalid relation value", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ relation: "teleport" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".relation")));
  });

  it("requires targetNodeId when relation is continue", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ relation: "continue" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("targetNodeId")));
  });

  it("requires targetNodeId when relation is branch", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ relation: "branch" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("targetNodeId")));
  });

  it("allows relation topic without a targetNodeId", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ relation: "topic" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, true);
  });

  it("rejects an invalid status when present", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ status: "sideways" })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".status")));
  });

  it("rejects tags that are not an array of strings", () => {
    const result = validateModelSummaryResponse(
      { schemaVersion: 1, nodes: [validNode({ tags: [1, 2] })] },
      KNOWN_TURN_IDS
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".tags")));
  });

  it("accepts decision/question/task/outcome/blocker kinds", () => {
    for (const kind of ["decision", "question", "task", "outcome", "blocker"]) {
      const result = validateModelSummaryResponse(
        { schemaVersion: 1, nodes: [validNode({ kind, localId: kind })] },
        KNOWN_TURN_IDS
      );
      assert.strictEqual(result.valid, true, `expected kind "${kind}" to be valid`);
    }
  });
});
