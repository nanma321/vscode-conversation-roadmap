import * as assert from "assert";
import { createDefaultSettings, createEmptyDocument, Roadmap, RoadmapDocument } from "../../src/model/types";
import { exportRoadmapDocument, parseImportPayload, planImport } from "../../src/model/exportImport";

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
        title: "Kickoff",
        summary: "Initial discussion",
        status: "open",
        tags: [],
        notes: "",
        sourceRefs: [{ turnId: "turn-1", sessionId: "session-1" }],
        createdAt: now,
        updatedAt: now,
      },
    ],
    edges: [],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

describe("exportImport", () => {
  describe("exportRoadmapDocument / parseImportPayload round-trip", () => {
    it("round-trips a document through export and import without information loss", () => {
      const document: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
      const exported = exportRoadmapDocument(document);
      const parsed = parseImportPayload(exported);
      assert.strictEqual(parsed.valid, true);
      assert.deepStrictEqual(parsed.document, document);
    });

    it("exports valid JSON text", () => {
      const document: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
      const exported = exportRoadmapDocument(document);
      assert.doesNotThrow(() => JSON.parse(exported));
    });
  });

  describe("parseImportPayload", () => {
    it("rejects malformed JSON", () => {
      const result = parseImportPayload("{ not valid json");
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.document, undefined);
    });

    it("rejects a document that fails schema validation", () => {
      const result = parseImportPayload(JSON.stringify({ version: 1, roadmaps: [{ id: "incomplete" }] }));
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    it("rejects a document with a version newer than this build supports", () => {
      const result = parseImportPayload(JSON.stringify({ version: 999, roadmaps: [] }));
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes("999"));
    });

    it("rejects a document with no version field", () => {
      const result = parseImportPayload(JSON.stringify({ roadmaps: [] }));
      assert.strictEqual(result.valid, false);
    });

    it("accepts a valid, current-version document", () => {
      const document: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
      const result = parseImportPayload(JSON.stringify(document));
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.document, document);
    });
  });

  describe("planImport", () => {
    it("imports every roadmap unchanged into a clean (empty) installation with no conflicts", () => {
      const existing = createEmptyDocument();
      const incoming: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
      const plan = planImport(existing, incoming);
      assert.strictEqual(plan.conflicts.length, 0);
      assert.deepStrictEqual(plan.importedRoadmapIds, ["roadmap-1"]);
      assert.strictEqual(plan.document.roadmaps.length, 1);
      assert.deepStrictEqual(plan.document.roadmaps[0], incoming.roadmaps[0]);
    });

    it("adds a non-colliding incoming roadmap alongside existing roadmaps", () => {
      const existing: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap({ id: "existing-1" })] };
      const incoming: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap({ id: "incoming-1" })] };
      const plan = planImport(existing, incoming);
      assert.strictEqual(plan.conflicts.length, 0);
      assert.strictEqual(plan.document.roadmaps.length, 2);
      assert.deepStrictEqual(
        plan.document.roadmaps.map((r) => r.id).sort(),
        ["existing-1", "incoming-1"]
      );
    });

    it("renames a colliding roadmap id instead of overwriting the existing roadmap, and reports the conflict", () => {
      const existing: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap({ id: "roadmap-1", title: "Existing" })] };
      const incoming: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap({ id: "roadmap-1", title: "Incoming" })] };
      const plan = planImport(existing, incoming);

      assert.strictEqual(plan.conflicts.length, 1);
      assert.strictEqual(plan.conflicts[0].originalId, "roadmap-1");
      assert.strictEqual(plan.conflicts[0].importedAsId, "roadmap-1-imported");

      assert.strictEqual(plan.document.roadmaps.length, 2);
      const original = plan.document.roadmaps.find((r) => r.id === "roadmap-1");
      const imported = plan.document.roadmaps.find((r) => r.id === "roadmap-1-imported");
      assert.strictEqual(original?.title, "Existing");
      assert.strictEqual(imported?.title, "Incoming");
    });

    it("does not mutate the existing or incoming documents passed in", () => {
      const existing: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap({ id: "roadmap-1" })] };
      const incoming: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap({ id: "roadmap-1" })] };
      const existingCopy = JSON.parse(JSON.stringify(existing));
      const incomingCopy = JSON.parse(JSON.stringify(incoming));

      planImport(existing, incoming);

      assert.deepStrictEqual(existing, existingCopy);
      assert.deepStrictEqual(incoming, incomingCopy);
    });

    it("assigns distinct renamed ids when multiple imports collide with the same existing id", () => {
      const existing: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap({ id: "roadmap-1" })] };
      const incoming: RoadmapDocument = {
        version: 1,
        roadmaps: [sampleRoadmap({ id: "roadmap-1", title: "First" }), sampleRoadmap({ id: "roadmap-1", title: "Second" })],
      };
      const plan = planImport(existing, incoming);
      assert.strictEqual(plan.conflicts.length, 2);
      const ids = plan.document.roadmaps.map((r) => r.id);
      assert.strictEqual(new Set(ids).size, ids.length, "all roadmap ids in the merged document must be unique");
    });
  });
});
