import * as assert from "assert";
import { createDefaultSettings, Roadmap, Turn } from "../../src/model/types";
import { attachResumeTurns } from "../../src/summarization/resumeAttachment";
import { ModelSummaryResponse } from "../../src/summarization/summaryResponseSchema";

const NOW = "2026-09-18T00:00:00.000Z";

function roadmap(): Roadmap {
  return {
    id: "roadmap-1",
    title: "Roadmap",
    createdAt: NOW,
    updatedAt: NOW,
    nodes: [
      {
        id: "node-original",
        title: "Original",
        summary: "",
        status: "open",
        nodeType: "topic",
        tags: [],
        notes: "",
        sourceRefs: [{ turnId: "turn-old", sessionId: "session-old" }],
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "node-resume",
        title: "Resume: Original",
        summary: "",
        status: "open",
        nodeType: "topic",
        tags: [],
        notes: "Try another path",
        sourceRefs: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    edges: [
      {
        id: "edge-resume",
        source: "node-original",
        target: "node-resume",
        kind: "branch",
        label: "resume",
      },
    ],
    settings: createDefaultSettings(),
  };
}

function resumedTurn(resumeNodeId = "node-resume"): Turn {
  return {
    id: "turn-new",
    sessionId: "session-new",
    timestamp: NOW,
    request: "Continue this branch",
    response: "A new response",
    completed: true,
    resumeNodeId,
    references: [],
  };
}

function response(): ModelSummaryResponse {
  return {
    schemaVersion: 1,
    nodes: [
      {
        localId: "response-node",
        kind: "topic",
        title: "Resumed response",
        summary: "A new response",
        sourceTurnIds: ["turn-new"],
        relation: "branch",
        targetNodeId: "node-original",
      },
    ],
  };
}

describe("attachResumeTurns", () => {
  it("reparents the resumed response under the validated placeholder", () => {
    const result = attachResumeTurns(response(), [resumedTurn()], roadmap());
    assert.strictEqual(result.nodes[0].relation, "continue");
    assert.strictEqual(result.nodes[0].targetNodeId, "node-resume");
  });

  it("creates later branch-affinity responses as children of the same placeholder", () => {
    const turn = { ...resumedTurn(), resumeNodeId: undefined, branchRootNodeId: "node-resume" };
    const result = attachResumeTurns(response(), [turn], roadmap());
    assert.strictEqual(result.nodes[0].relation, "topic");
    assert.strictEqual(result.nodes[0].targetNodeId, "node-resume");
  });

  it("attaches a later response beneath the deepest existing branch response", () => {
    const existing = roadmap();
    existing.nodes.push({
      id: "node-response-1",
      title: "First resumed response",
      summary: "",
      status: "open",
      nodeType: "topic",
      tags: [],
      notes: "",
      sourceRefs: [{ turnId: "turn-prior", sessionId: "session-new" }],
      createdAt: NOW,
      updatedAt: "2026-09-18T00:01:00.000Z",
    });
    existing.edges.push({
      id: "edge-response-1",
      source: "node-resume",
      target: "node-response-1",
      kind: "topic",
    });
    const turn = { ...resumedTurn(), resumeNodeId: undefined, branchRootNodeId: "node-resume" };
    const result = attachResumeTurns(response(), [turn], existing);
    assert.strictEqual(result.nodes[0].targetNodeId, "node-response-1");
  });

  it("creates a placeholder continuation when the model returns no node", () => {
    const result = attachResumeTurns(
      { schemaVersion: 1, nodes: [] },
      [resumedTurn()],
      roadmap()
    );
    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].relation, "continue");
    assert.strictEqual(result.nodes[0].targetNodeId, "node-resume");
  });

  it("ignores a stale or forged marker that is not a resume placeholder", () => {
    const result = attachResumeTurns(response(), [resumedTurn("node-original")], roadmap());
    assert.strictEqual(result.nodes[0].relation, "branch");
    assert.strictEqual(result.nodes[0].targetNodeId, "node-original");
  });

  it("does not mutate the model response object", () => {
    const input = response();
    const before = JSON.parse(JSON.stringify(input));
    attachResumeTurns(input, [resumedTurn()], roadmap());
    assert.deepStrictEqual(input, before);
  });
});
