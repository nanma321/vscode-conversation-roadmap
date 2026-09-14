import * as assert from "assert";
import { summarizeIncrementally } from "../../src/summarization/applySummary";
import { ModelSummaryResponse } from "../../src/summarization/summaryResponseSchema";
import { makeEmptyRoadmap, tenTurnConversation } from "./fixtures";

describe("Phase 4 exit criteria: a representative ten-turn conversation", () => {
  it("produces a useful graph where every generated node cites at least one source turn", () => {
    const turns = tenTurnConversation();
    const [t0, t1, t2, t3, t4, t5, t6, t7, t8, t9] = turns;
    const knownTurnIds = new Set(turns.map((t) => t.id));

    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "topic-checkout",
          kind: "topic",
          title: "Checkout flow",
          summary: "Cart summary, credit card + PayPal, cart summary UI needed.",
          sourceTurnIds: [t0.id, t1.id],
          relation: "topic",
        },
        {
          localId: "decision-applepay",
          kind: "decision",
          title: "Add Apple Pay",
          summary: "Decided to add Apple Pay as a payment method.",
          sourceTurnIds: [t2.id],
          relation: "topic",
          targetNodeId: "topic-checkout",
        },
        {
          localId: "task-cart-ui",
          kind: "task",
          title: "Implement cart summary UI",
          summary: "Someone needs to implement the cart summary UI.",
          sourceTurnIds: [t3.id],
          relation: "topic",
          targetNodeId: "topic-checkout",
        },
        {
          localId: "topic-admin",
          kind: "topic",
          title: "Admin dashboard",
          summary: "Dashboard needs sales and inventory widgets.",
          sourceTurnIds: [t4.id, t5.id],
          relation: "topic",
          targetNodeId: "topic-checkout",
        },
        {
          localId: "blocker-analytics",
          kind: "blocker",
          title: "Analytics API not ready",
          summary: "The analytics API isn't ready, blocking the sales widget.",
          status: "blocked",
          sourceTurnIds: [t6.id],
          relation: "topic",
          targetNodeId: "topic-admin",
        },
        {
          localId: "giftcards",
          kind: "task",
          title: "Add gift card support",
          summary: "Support gift cards during checkout.",
          sourceTurnIds: [t7.id],
          relation: "branch",
          targetNodeId: "topic-checkout",
        },
        {
          localId: "outcome-payment-ui",
          kind: "outcome",
          title: "Payment method UI complete",
          summary: "Finished the payment method selection UI.",
          status: "done",
          sourceTurnIds: [t8.id],
          relation: "topic",
          targetNodeId: "topic-checkout",
        },
        {
          localId: "topic-admin-recap",
          kind: "topic",
          title: "Admin dashboard (recap)",
          summary: "Sales and inventory widgets, both pending the analytics API.",
          sourceTurnIds: [t9.id],
          relation: "continue",
          targetNodeId: "topic-admin",
        },
      ],
    };

    const result = summarizeIncrementally(makeEmptyRoadmap(), response, turns);

    assert.strictEqual(result.changed, true, `expected the batch to apply cleanly; errors: ${result.errors.join("; ")}`);
    assert.deepStrictEqual(result.errors, []);

    const { roadmap } = result;

    // A useful graph: more than one topic plus extracted item nodes.
    const topicNodes = roadmap.nodes.filter((n) => n.nodeType === "topic");
    assert.ok(topicNodes.length >= 2, "expected at least two topic nodes");
    const itemKinds = new Set(roadmap.nodes.map((n) => n.nodeType));
    for (const kind of ["decision", "task", "blocker", "outcome"]) {
      assert.ok(itemKinds.has(kind as any), `expected an extracted "${kind}" node`);
    }

    // Every generated node cites at least one source turn from the original ten.
    for (const node of roadmap.nodes) {
      assert.ok(node.sourceRefs.length >= 1, `node "${node.title}" must cite at least one source turn`);
      for (const ref of node.sourceRefs) {
        assert.ok(knownTurnIds.has(ref.turnId), `node "${node.title}" cites an unknown turn id "${ref.turnId}"`);
      }
    }

    // The topic-admin node was continued (not duplicated) by the final recap turn.
    assert.strictEqual(topicNodes.length, roadmap.nodes.filter((n) => n.nodeType === "topic").length);
    const adminNode = roadmap.nodes.find((n) => n.title === "Admin dashboard");
    assert.ok(adminNode);
    assert.ok(adminNode!.sourceRefs.some((r) => r.turnId === t9.id), "the recap turn should have been merged into the existing admin topic node");

    // A branch edge exists for the gift-card aside.
    assert.ok(roadmap.edges.some((e) => e.kind === "branch"), "expected at least one branch edge");
    // At least one sequential topic edge exists (checkout -> admin dashboard).
    assert.ok(roadmap.edges.some((e) => e.kind === "topic"), "expected at least one topic edge");
  });

  it("leaves the previous graph completely unchanged when the model output is invalid", () => {
    const turns = tenTurnConversation();
    const seedRoadmap = makeEmptyRoadmap();
    // Seed with a prior, valid graph state that must survive an invalid follow-up response untouched.
    const seeded = summarizeIncrementally(
      seedRoadmap,
      {
        schemaVersion: 1,
        nodes: [
          {
            localId: "topic-1",
            kind: "topic",
            title: "Prior topic",
            summary: "Prior summary.",
            sourceTurnIds: [turns[0].id],
            relation: "topic",
          },
        ],
      },
      [turns[0]]
    );
    assert.strictEqual(seeded.changed, true);
    const priorGraph = seeded.roadmap;

    // A malformed follow-up response: relation "continue" without a targetNodeId.
    const invalidResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "bad",
          kind: "topic",
          title: "Should not apply",
          summary: "Should not apply.",
          sourceTurnIds: [turns[1].id],
          relation: "continue",
        },
      ],
    };

    const result = summarizeIncrementally(priorGraph, invalidResponse, turns.slice(1));
    assert.strictEqual(result.changed, false);
    assert.ok(result.errors.length > 0);
    assert.deepStrictEqual(result.roadmap, priorGraph);
  });
});
