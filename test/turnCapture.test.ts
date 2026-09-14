import * as assert from "assert";
import {
  buildTurnRecord,
  cancelledOutcome,
  extractSupportedReferences,
  failedOutcome,
  successOutcome,
} from "../src/turnCapture";

describe("turnCapture", () => {
  describe("extractSupportedReferences", () => {
    it("returns an empty array when references is undefined", () => {
      assert.deepStrictEqual(extractSupportedReferences(undefined), []);
    });

    it("returns an empty array when references is empty", () => {
      assert.deepStrictEqual(extractSupportedReferences([]), []);
    });

    it("captures a plain-text reference value", () => {
      const result = extractSupportedReferences([
        { id: "ref-1", modelDescription: "a note", value: "some referenced text" },
      ]);
      assert.deepStrictEqual(result, [
        { id: "ref-1", description: "a note", kind: "text", value: "some referenced text" },
      ]);
    });

    it("truncates overly long text reference values", () => {
      const longText = "x".repeat(5000);
      const result = extractSupportedReferences([{ id: "ref-1", value: longText }]);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].value.length, 4000);
    });

    it("captures a URI-like reference value", () => {
      const fakeUri = { scheme: "file", fsPath: "/tmp/example.ts", toString: () => "file:///tmp/example.ts" };
      const result = extractSupportedReferences([{ id: "ref-uri", value: fakeUri }]);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].kind, "uri");
      assert.strictEqual(result[0].value, "file:///tmp/example.ts");
    });

    it("captures a Location-like reference value using its uri", () => {
      const fakeUri = { toString: () => "file:///tmp/example.ts" };
      const fakeLocation = { uri: fakeUri, range: [0, 10] };
      const result = extractSupportedReferences([{ id: "ref-loc", value: fakeLocation }]);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].kind, "location");
      assert.strictEqual(result[0].value, "file:///tmp/example.ts");
    });

    it("drops references with an unsupported/unknown value shape", () => {
      const result = extractSupportedReferences([
        { id: "ref-unknown", value: { someRandomField: 42 } },
        { id: "ref-number", value: 123 },
        { id: "ref-null", value: null },
      ]);
      assert.deepStrictEqual(result, []);
    });
  });

  describe("outcome classification", () => {
    it("marks a successful outcome as completed", () => {
      const outcome = successOutcome("the final answer");
      assert.strictEqual(outcome.completed, true);
      assert.strictEqual(outcome.responseText, "the final answer");
    });

    it("marks a cancelled outcome as not completed while preserving partial text", () => {
      const outcome = cancelledOutcome("partial respo");
      assert.strictEqual(outcome.completed, false);
      assert.strictEqual(outcome.responseText, "partial respo");
    });

    it("marks a failed outcome as not completed and records the error when no text was produced", () => {
      const outcome = failedOutcome("", new Error("model unavailable"));
      assert.strictEqual(outcome.completed, false);
      assert.strictEqual(outcome.responseText, "Error: model unavailable");
    });

    it("preserves any partial text already produced when a failure occurs mid-stream", () => {
      const outcome = failedOutcome("partial before failure", new Error("boom"));
      assert.strictEqual(outcome.completed, false);
      assert.strictEqual(outcome.responseText, "partial before failure");
    });

    it("stringifies non-Error failure values", () => {
      const outcome = failedOutcome("", "plain string failure");
      assert.strictEqual(outcome.responseText, "Error: plain string failure");
    });
  });

  describe("buildTurnRecord", () => {
    it("assembles a TurnRecord from a request and its outcome, preserving provenance fields", () => {
      const record = buildTurnRecord({
        id: "turn-1",
        sessionId: "session-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        request: "What should we build next?",
        outcome: successOutcome("Here's a plan."),
        references: [{ id: "ref-1", kind: "text", value: "context" }],
      });

      assert.deepStrictEqual(record, {
        id: "turn-1",
        sessionId: "session-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        request: "What should we build next?",
        response: "Here's a plan.",
        completed: true,
        references: [{ id: "ref-1", kind: "text", value: "context" }],
      });
    });

    it("assembles a not-completed TurnRecord for a cancelled/failed outcome", () => {
      const record = buildTurnRecord({
        id: "turn-2",
        sessionId: "session-1",
        timestamp: "2024-01-01T00:00:01.000Z",
        request: "Do something long-running",
        outcome: cancelledOutcome("partial"),
        references: [],
      });

      assert.strictEqual(record.completed, false);
      assert.strictEqual(record.response, "partial");
    });
  });
});
