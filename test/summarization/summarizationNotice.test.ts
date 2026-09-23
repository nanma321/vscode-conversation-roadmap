import * as assert from "assert";
import { buildSummarizationNotice } from "../../src/summarization/summarizationNotice";
import { SummarizeOutcome } from "../../src/summarization/summarizationService";
import { createDefaultSettings, Roadmap } from "../../src/model/types";

function roadmap(): Roadmap {
  const now = "2026-09-23T00:00:00.000Z";
  return {
    id: "default",
    title: "Roadmap",
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    settings: createDefaultSettings(),
  };
}

function outcome(overrides: Partial<SummarizeOutcome> = {}): SummarizeOutcome {
  return {
    changed: false,
    roadmap: roadmap(),
    errors: [],
    failures: [],
    fallbacks: [],
    ...overrides,
  };
}

describe("summarization notices", () => {
  it("does not notify after a clean run", () => {
    assert.strictEqual(buildSummarizationNotice(outcome()), undefined);
  });

  it("aggregates and deduplicates retry failures in one warning", () => {
    const notice = buildSummarizationNotice(
      outcome({
        errors: ["invalid JSON", "invalid JSON"],
        failures: [
          {
            sessionId: "session-a",
            turnIds: ["turn-1", "turn-2"],
            attempt: 1,
            maxAttempts: 2,
            stage: "json",
            message: "invalid JSON",
            willRetry: true,
          },
        ],
      })
    );

    assert.ok(notice);
    assert.strictEqual(notice!.severity, "warning");
    assert.ok(notice!.message.includes("2 turn(s)"));
    assert.strictEqual(
      notice!.message.match(/invalid JSON/g)?.length,
      1
    );
  });

  it("reports persisted fallbacks without repeating each raw failure", () => {
    const notice = buildSummarizationNotice(
      outcome({
        errors: ["schema failed"],
        fallbacks: [
          {
            sessionId: "session-a",
            turnId: "turn-1",
            nodeId: "fallback-turn-1",
            reason: "schema failed",
          },
          {
            sessionId: "session-a",
            turnId: "turn-2",
            nodeId: "fallback-turn-2",
            reason: "schema failed",
          },
        ],
      })
    );

    assert.ok(notice);
    assert.strictEqual(notice!.severity, "warning");
    assert.ok(notice!.message.includes("2 source-linked fallback node(s)"));
  });
});
