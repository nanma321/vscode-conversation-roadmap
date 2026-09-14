import * as assert from "assert";
import { summarizeIncrementally } from "../../src/summarization/applySummary";
import { ModelSummaryResponse } from "../../src/summarization/summaryResponseSchema";
import {
  extractedItemsResponse,
  extractedItemsTurns,
  invalidResponseMissingSourceTurnIds,
  linearConversationResponse,
  linearConversationTurns,
  makeEmptyRoadmap,
  topicShiftTurns,
} from "./fixtures";

describe("common conversation pattern fixtures", () => {
  it("pattern: a linear conversation collapses into a single continued topic node", () => {
    const turns = linearConversationTurns();
    const response = linearConversationResponse(turns);
    const result = summarizeIncrementally(makeEmptyRoadmap(), response, turns);

    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes.length, 1);
    assert.strictEqual(result.roadmap.edges.length, 0);
    assert.strictEqual(result.roadmap.nodes[0].sourceRefs.length, turns.length);
  });

  it("pattern: a genuine topic shift produces two topic nodes joined by a topic edge, not one merged node", () => {
    const { topicATurns, topicBTurns } = topicShiftTurns();
    const allTurns = [...topicATurns, ...topicBTurns];

    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "topic-a",
          kind: "topic",
          title: "Login page",
          summary: "Email + password fields, forgot-password link.",
          sourceTurnIds: topicATurns.map((t) => t.id),
          relation: "topic",
        },
        {
          localId: "topic-b",
          kind: "topic",
          title: "Billing",
          summary: "Monthly/annual plans via Stripe.",
          sourceTurnIds: topicBTurns.map((t) => t.id),
          relation: "topic",
          targetNodeId: "topic-a",
        },
      ],
    };

    const result = summarizeIncrementally(makeEmptyRoadmap(), response, allTurns);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes.length, 2);
    assert.strictEqual(result.roadmap.edges.length, 1);
    assert.strictEqual(result.roadmap.edges[0].kind, "topic");
  });

  it("pattern: decisions, questions, tasks, outcomes, and blockers are all extracted alongside their topic", () => {
    const turns = extractedItemsTurns();
    const response = extractedItemsResponse(turns);
    const result = summarizeIncrementally(makeEmptyRoadmap(), response, turns);

    assert.strictEqual(result.changed, true);
    const kinds = new Set(result.roadmap.nodes.map((n) => n.nodeType));
    for (const expected of ["topic", "decision", "question", "task", "outcome", "blocker"]) {
      assert.ok(kinds.has(expected as any), `expected a "${expected}" node`);
    }
    for (const node of result.roadmap.nodes) {
      assert.ok(node.sourceRefs.length >= 1);
    }
  });

  it("pattern: an invalid response (no cited source turns) is rejected and the graph stays unchanged", () => {
    const turns = extractedItemsTurns();
    const roadmap = makeEmptyRoadmap();
    const response = invalidResponseMissingSourceTurnIds();

    const result = summarizeIncrementally(roadmap, response, turns);
    assert.strictEqual(result.changed, false);
    assert.ok(result.errors.length > 0);
    assert.deepStrictEqual(result.roadmap, roadmap);
  });
});
