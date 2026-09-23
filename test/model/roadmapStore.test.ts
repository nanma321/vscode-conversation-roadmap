import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RoadmapStore, RoadmapValidationError } from "../../src/model/roadmapStore";
import { createDefaultSettings, createEmptyDocument, Roadmap, RoadmapDocument } from "../../src/model/types";
import { StorageBlockedError } from "../../src/storageRecovery";

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

  it("blocks writes and preserves corrupt roadmap storage byte-for-byte", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "roadmaps.json");
    const corruptBytes = Buffer.from("{ not valid json", "utf8");
    fs.writeFileSync(filePath, corruptBytes);

    const store = new RoadmapStore(dir, {
      now: () => new Date("2026-09-23T12:34:56.789Z"),
    });
    await assert.rejects(() => store.load(), StorageBlockedError);
    await assert.rejects(
      () => store.save({ version: 1, roadmaps: [sampleRoadmap()] }),
      StorageBlockedError
    );

    assert.deepStrictEqual(fs.readFileSync(filePath), corruptBytes);
    const backupPath = `${filePath}.recovery-2026-09-23T12-34-56-789Z.bak`;
    assert.deepStrictEqual(fs.readFileSync(backupPath), corruptBytes);
  });

  it("blocks when the on-disk file fails schema validation", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "roadmaps.json");
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, roadmaps: [{ id: "incomplete" }] }), "utf8");

    const store = new RoadmapStore(dir);
    await assert.rejects(() => store.load(), StorageBlockedError);
    await assert.rejects(() => store.deleteAll(), StorageBlockedError);
    assert.ok(fs.existsSync(filePath));
    assert.ok(
      fs.readdirSync(dir).some((name) => name.startsWith("roadmaps.json.recovery-"))
    );
  });

  it("keeps a blocked instance closed while a fresh instance can load a repaired file", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "roadmaps.json");
    fs.writeFileSync(filePath, "{broken", "utf8");
    const blocked = new RoadmapStore(dir);
    await assert.rejects(() => blocked.load(), StorageBlockedError);

    const repaired: RoadmapDocument = { version: 1, roadmaps: [sampleRoadmap()] };
    fs.writeFileSync(filePath, JSON.stringify(repaired), "utf8");
    await assert.rejects(() => blocked.save(repaired), StorageBlockedError);

    const recovered = new RoadmapStore(dir);
    assert.deepStrictEqual(await recovered.load(), repaired);
  });

  it("blocks concurrent saves while the recovery backup is still pending", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "roadmaps.json");
    const original = Buffer.from("{broken-concurrent", "utf8");
    fs.writeFileSync(filePath, original);
    let releaseBackup: (() => void) | undefined;
    let backupStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      backupStarted = resolve;
    });
    const store = new RoadmapStore(dir, {
      copyFile: async (source, destination) => {
        backupStarted?.();
        await new Promise<void>((resolve) => {
          releaseBackup = resolve;
        });
        await fs.promises.copyFile(source, destination);
      },
    });

    const load = store.load();
    await started;
    const save = store.save({ version: 1, roadmaps: [sampleRoadmap()] });
    assert.deepStrictEqual(fs.readFileSync(filePath), original);
    releaseBackup?.();
    await assert.rejects(() => load, StorageBlockedError);
    await assert.rejects(() => save, StorageBlockedError);
  });

  it("uses a durable marker to block another loaded roadmap store instance", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "roadmaps.json");
    const firstWindow = new RoadmapStore(dir);
    await firstWindow.load();
    await firstWindow.save({ version: 1, roadmaps: [sampleRoadmap()] });

    const corruptBytes = Buffer.from("{cross-window-corruption", "utf8");
    fs.writeFileSync(filePath, corruptBytes);
    const detectingWindow = new RoadmapStore(dir);
    await assert.rejects(() => detectingWindow.load(), StorageBlockedError);
    assert.ok(fs.existsSync(`${filePath}.blocked`));

    await assert.rejects(
      () =>
        firstWindow.save({
          version: 1,
          roadmaps: [sampleRoadmap({ title: "must not overwrite" })],
        }),
      StorageBlockedError
    );
    assert.deepStrictEqual(fs.readFileSync(filePath), corruptBytes);
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

  it("serializes complete graph transactions so concurrent edits are not lost", async () => {
    const dir = makeTempDir();
    const store = new RoadmapStore(dir);
    await store.load();
    await store.save({ version: 1, roadmaps: [sampleRoadmap()] });
    let releaseFirst: (() => void) | undefined;
    let firstLoaded: (() => void) | undefined;
    const loaded = new Promise<void>((resolve) => {
      firstLoaded = resolve;
    });

    const first = store.transaction(async (access) => {
      const document = await access.load();
      firstLoaded?.();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      document.roadmaps[0].title = "First edit";
      await access.save(document);
    });
    await loaded;
    const second = store.transaction(async (access) => {
      const document = await access.load();
      document.roadmaps[0].nodes[0].notes = "Second edit";
      await access.save(document);
    });

    releaseFirst?.();
    await Promise.all([first, second]);
    const persisted = await new RoadmapStore(dir).load();
    assert.strictEqual(persisted.roadmaps[0].title, "First edit");
    assert.strictEqual(persisted.roadmaps[0].nodes[0].notes, "Second edit");
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

    const recoveryPath = path.join(dir, "roadmaps.json.recovery-old.bak");
    fs.writeFileSync(recoveryPath, "old diagnostic copy", "utf8");
    await store.deleteAll();

    assert.deepStrictEqual(store.getDocument().roadmaps, []);
    assert.ok(!fs.existsSync(path.join(dir, "roadmaps.json")), "roadmaps.json should be deleted");
    assert.ok(!fs.existsSync(recoveryPath), "recovery copies should be deleted");

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
