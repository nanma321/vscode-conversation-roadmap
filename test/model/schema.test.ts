import * as assert from "assert";
import { validateRoadmapDocument, SCHEMA_DESCRIPTION } from "../../src/model/schema";
import { createEmptyDocument, createDefaultSettings, RoadmapDocument, Roadmap } from "../../src/model/types";

function sampleRoadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  return {
    id: "roadmap-1",
    title: "Sample roadmap",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: "node-1",
        title: "Kickoff",
        summary: "Initial discussion",
        status: "open",
        tags: ["planning"],
        notes: "",
        sourceRefs: [{ turnId: "turn-1", sessionId: "session-1" }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    edges: [],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

describe("validateRoadmapDocument", () => {
  it("accepts a freshly created empty document", () => {
    const result = validateRoadmapDocument(createEmptyDocument());
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  it("accepts a well-formed document with nodes and edges", () => {
    const doc: RoadmapDocument = {
      version: SCHEMA_DESCRIPTION.version,
      roadmaps: [
        sampleRoadmap({
          nodes: [
            {
              id: "node-1",
              title: "A",
              summary: "",
              status: "open",
              tags: [],
              notes: "",
              sourceRefs: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: "node-2",
              title: "B",
              summary: "",
              status: "done",
              tags: [],
              notes: "",
              position: { x: 10, y: 20 },
              sourceRefs: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          edges: [{ id: "edge-1", source: "node-1", target: "node-2", kind: "topic" }],
        }),
      ],
    };
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, true);
    assert.ok(result.value);
  });

  it("rejects a non-object value", () => {
    const result = validateRoadmapDocument("not-a-document");
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects a document at the wrong schema version", () => {
    const result = validateRoadmapDocument({ version: 999, roadmaps: [] });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("version")));
  });

  it("rejects a roadmap missing required fields", () => {
    const doc = { version: 1, roadmaps: [{ id: "r1" }] };
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("title")));
    assert.ok(result.errors.some((e) => e.includes("nodes")));
  });

  it("rejects a node with an invalid status", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    (doc.roadmaps[0].nodes[0] as any).status = "not-a-real-status";
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });

  it("rejects an edge that references a non-existent node id", () => {
    const doc: RoadmapDocument = {
      version: 1,
      roadmaps: [sampleRoadmap({ edges: [{ id: "edge-1", source: "node-1", target: "ghost-node", kind: "manual" }] })],
    };
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("ghost-node")));
  });

  it("rejects duplicate roadmap ids", () => {
    const doc: RoadmapDocument = {
      version: 1,
      roadmaps: [sampleRoadmap({ id: "dup" }), sampleRoadmap({ id: "dup" })],
    };
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("duplicate roadmap id")));
  });

  it("rejects invalid settings", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    (doc.roadmaps[0].settings as any).layout = "sideways";
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("settings.layout")));
  });

  it("rejects a source reference missing turnId/sessionId", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    (doc.roadmaps[0].nodes[0].sourceRefs as any) = [{ turnId: "" }];
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("sourceRefs")));
  });

  it("accepts a node with a valid 3-digit hex color", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    (doc.roadmaps[0].nodes[0] as any).color = "#abc";
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, true);
  });

  it("accepts a node with a valid 6-digit hex color", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    (doc.roadmaps[0].nodes[0] as any).color = "#a1b2c3";
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, true);
  });

  it("accepts a node without a color (optional field)", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, true);
  });

  it("rejects a node with a malformed hex color string", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    (doc.roadmaps[0].nodes[0] as any).color = "not-a-color";
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".color")));
  });

  it("rejects a node with a non-string color", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    (doc.roadmaps[0].nodes[0] as any).color = 12345;
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".color")));
  });

  it("accepts a node with highlighted set to true or false", () => {
    for (const highlighted of [true, false]) {
      const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
      (doc.roadmaps[0].nodes[0] as any).highlighted = highlighted;
      const result = validateRoadmapDocument(doc);
      assert.strictEqual(result.valid, true, `expected highlighted=${highlighted} to be valid`);
    }
  });

  it("accepts a node without a highlighted field (optional)", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, true);
  });

  it("rejects a node with a non-boolean highlighted field", () => {
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    (doc.roadmaps[0].nodes[0] as any).highlighted = "yes";
    const result = validateRoadmapDocument(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(".highlighted")));
  });
});
