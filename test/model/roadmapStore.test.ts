import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RoadmapStore, RoadmapValidationError } from "../../src/model/roadmapStore";
import { createDefaultSettings, createEmptyDocument, Roadmap, RoadmapDocument } from "../../src/model/types";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-store-"));
}

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

describe("RoadmapStore", () => {
  it("starts with an empty document when no file exists on disk", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    const doc = await store.load();
    assert.strictEqual(doc.roadmaps.length, 0);
    assert.strictEqual(doc.version, 1);
  });

  it("survives an extension restart: a new store instance reloads the persisted document", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();
    const doc: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    await store.save(doc);

    const reloadedStore = new RoadmapStore(dir);
    const reloaded = await reloadedStore.load();
    assert.strictEqual(reloaded.roadmaps.length, 1);
    assert.strictEqual(reloaded.roadmaps[0].id, "roadmap-1");
    assert.strictEqual(reloaded.roadmaps[0].nodes[0].title, "Kickoff");
  });

  it("writes the file atomically as valid JSON at the current schema version", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();
    await store.save({ version: 1, roadmaps: [sampleRoadmap()] });

    const filePath = path.join(dir, "roadmaps.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.roadmaps.length, 1);

    // No leftover temp files after a successful save.
    const entries = fs.readdirSync(dir);
    assert.ok(!entries.some((e) => e.includes(".tmp-")), "no temp files should remain after save");
  });

  it("rejects an invalid document without writing it to disk", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();
    await store.save({ version: 1, roadmaps: [sampleRoadmap()] });

    const invalidDoc = { version: 1, roadmaps: [{ id: "bad" }] } as unknown as RoadmapDocument;
    await assert.rejects(() => store.save(invalidDoc), RoadmapValidationError);

    // The previously saved valid document must remain untouched on disk.
    const filePath = path.join(dir, "roadmaps.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.roadmaps.length, 1);
    assert.strictEqual(parsed.roadmaps[0].id, "roadmap-1");
  });

  it("falls back to an empty document (without deleting the file) when the on-disk file is corrupt JSON", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "roadmaps.json");
    fs.writeFileSync(filePath, "{ not valid json", "utf8");

    const store = new RoadmapStore(dir);
    const doc = await store.load();
    assert.strictEqual(doc.roadmaps.length, 0);

    // The corrupt file is left in place for inspection rather than deleted or overwritten.
    assert.ok(fs.existsSync(filePath));
    const raw = fs.readFileSync(filePath, "utf8");
    assert.strictEqual(raw, "{ not valid json");
  });

  it("falls back to an empty document when the on-disk file fails schema validation", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "roadmaps.json");
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, roadmaps: [{ id: "incomplete" }] }), "utf8");

    const store = new RoadmapStore(dir);
    const doc = await store.load();
    assert.strictEqual(doc.roadmaps.length, 0);
  });

  it("round-trips a version-1 document through save and load without information loss", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();

    const original: RoadmapDocument = {
      version: 1,
      roadmaps: [
        sampleRoadmap({
          id: "roadmap-full",
          nodes: [
            {
              id: "node-1",
              title: "Topic A",
              summary: "Summary of topic A",
              status: "in-progress",
              tags: ["important", "backend"],
              notes: "user notes here",
              position: { x: 12.5, y: -4 },
              sourceRefs: [{ turnId: "turn-1", sessionId: "session-1" }],
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-02T00:00:00.000Z",
            },
            {
              id: "node-2",
              title: "Topic B",
              summary: "Summary of topic B",
              status: "blocked",
              tags: [],
              notes: "",
              sourceRefs: [],
              createdAt: "2024-01-03T00:00:00.000Z",
              updatedAt: "2024-01-03T00:00:00.000Z",
            },
          ],
          edges: [{ id: "edge-1", source: "node-1", target: "node-2", kind: "branch", label: "resumed here" }],
        }),
      ],
    };

    await store.save(original);

    const reloadedStore = new RoadmapStore(dir);
    const reloaded = await reloadedStore.load();

    assert.deepStrictEqual(reloaded, original);
  });

  it("getDocument returns a defensive copy that does not mutate internal state", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();
    await store.save({ version: 1, roadmaps: [sampleRoadmap()] });

    const doc = store.getDocument();
    doc.roadmaps[0].title = "Mutated title";

    const fresh = store.getDocument();
    assert.strictEqual(fresh.roadmaps[0].title, "Sample roadmap");
  });

  it("recovers from an orphaned temp file left by an interrupted write, without touching the real file", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();
    await store.save({ version: 1, roadmaps: [sampleRoadmap()] });

    // Simulate a crash between the temp-file write and the rename in persist().
    const orphanTempPath = path.join(dir, "roadmaps.json.tmp-99999-123");
    fs.writeFileSync(orphanTempPath, JSON.stringify({ version: 1, roadmaps: [] }), "utf8");
    assert.ok(fs.existsSync(orphanTempPath));

    const reloadedStore = new RoadmapStore(dir);
    const reloaded = await reloadedStore.load();

    // The real file (with its previously saved roadmap) is unaffected...
    assert.strictEqual(reloaded.roadmaps.length, 1);
    assert.strictEqual(reloaded.roadmaps[0].id, "roadmap-1");
    // ...and the orphaned temp file has been cleaned up.
    assert.ok(!fs.existsSync(orphanTempPath), "orphaned temp file should be removed on load");
  });

  it("deleteAll removes roadmaps.json from disk and resets in-memory state to empty", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();
    await store.save({ version: 1, roadmaps: [sampleRoadmap()] });

    await store.deleteAll();

    assert.deepStrictEqual(store.getDocument().roadmaps, []);
    assert.ok(!fs.existsSync(path.join(dir, "roadmaps.json")), "roadmaps.json should be deleted");

    // A subsequent load from a fresh instance confirms nothing survives on disk.
    const reloadedStore = new RoadmapStore(dir);
    const reloaded = await reloadedStore.load();
    assert.strictEqual(reloaded.roadmaps.length, 0);
  });

  it("deleteAll is safe to call when no file has ever been written", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();
    await assert.doesNotReject(() => store.deleteAll());
    assert.deepStrictEqual(store.getDocument().roadmaps, []);
  });
});
