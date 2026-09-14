import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TurnStore, TurnRecord } from "../src/turnStore";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-turnstore-"));
}

function sampleTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "turn-1",
    sessionId: "session-1",
    timestamp: new Date().toISOString(),
    request: "What should our roadmap look like?",
    response: "Here is a proposed roadmap.",
    completed: true,
    ...overrides,
  };
}

describe("TurnStore", () => {
  it("starts empty when no file exists on disk", async () => {
    const dir = makeTempDir();
    const store = new TurnStore(dir);
    const turns = await store.load();
    assert.strictEqual(turns.length, 0);
  });

  it("stores an appended turn and returns it via getAll", async () => {
    const dir = makeTempDir();
    const store = new TurnStore(dir);
    await store.load();
    await store.append(sampleTurn());

    const turns = store.getAll();
    assert.strictEqual(turns.length, 1);
    assert.strictEqual(turns[0].request, "What should our roadmap look like?");
    assert.strictEqual(turns[0].response, "Here is a proposed roadmap.");
    assert.strictEqual(turns[0].completed, true);
  });

  it("persists turns to disk so a new store instance can reload them", async () => {
    const dir = makeTempDir();
    const firstStore = new TurnStore(dir);
    await firstStore.load();
    await firstStore.append(sampleTurn({ id: "turn-1" }));
    await firstStore.append(sampleTurn({ id: "turn-2", request: "Follow-up question" }));

    // Simulate an extension restart: a brand new TurnStore instance pointed at
    // the same storage directory must be able to reload previously saved turns.
    const reloadedStore = new TurnStore(dir);
    const reloaded = await reloadedStore.load();

    assert.strictEqual(reloaded.length, 2);
    assert.strictEqual(reloaded[0].id, "turn-1");
    assert.strictEqual(reloaded[1].id, "turn-2");
    assert.strictEqual(reloaded[1].request, "Follow-up question");
  });

  it("marks cancelled/failed turns as not completed instead of dropping them", async () => {
    const dir = makeTempDir();
    const store = new TurnStore(dir);
    await store.load();
    await store.append(sampleTurn({ id: "turn-failed", completed: false, response: "" }));

    const turns = store.getAll();
    assert.strictEqual(turns.length, 1);
    assert.strictEqual(turns[0].completed, false);
  });

  it("allows a specific node's source messages to be looked up by id", async () => {
    const dir = makeTempDir();
    const store = new TurnStore(dir);
    await store.load();
    await store.append(sampleTurn({ id: "node-a", request: "req-a", response: "resp-a" }));
    await store.append(sampleTurn({ id: "node-b", request: "req-b", response: "resp-b" }));

    const turns = store.getAll();
    const nodeA = turns.find((t) => t.id === "node-a");
    assert.ok(nodeA, "expected to find the source turn for node-a");
    assert.strictEqual(nodeA?.request, "req-a");
    assert.strictEqual(nodeA?.response, "resp-a");
  });

  it("writes the persisted file atomically as valid JSON with a version field", async () => {
    const dir = makeTempDir();
    const store = new TurnStore(dir);
    await store.load();
    await store.append(sampleTurn());

    const filePath = path.join(dir, "turns.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.turns.length, 1);
  });

  it("notifies onDidChange listeners with the latest turns when a turn is appended", async () => {
    const dir = makeTempDir();
    const store = new TurnStore(dir);
    await store.load();

    const received: TurnRecord[][] = [];
    const unsubscribe = store.onDidChange((turns) => received.push(turns));

    await store.append(sampleTurn({ id: "turn-1" }));
    await store.append(sampleTurn({ id: "turn-2" }));

    assert.strictEqual(received.length, 2, "listener should fire once per append");
    assert.strictEqual(received[0].length, 1);
    assert.strictEqual(received[1].length, 2);
    assert.strictEqual(received[1][1].id, "turn-2");

    // After unsubscribing, further appends must not notify the listener.
    unsubscribe();
    await store.append(sampleTurn({ id: "turn-3" }));
    assert.strictEqual(received.length, 2, "listener should not fire after unsubscribe");
  });

  it("normalizes turns persisted without a sessionId to the legacy session on load", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "turns.json");
    // Simulate a file written before sessions existed (no sessionId field).
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        turns: [
          {
            id: "old-1",
            timestamp: new Date().toISOString(),
            request: "legacy request",
            response: "legacy response",
            completed: true,
          },
        ],
      }),
      "utf8"
    );

    const store = new TurnStore(dir);
    const turns = await store.load();
    assert.strictEqual(turns.length, 1);
    assert.strictEqual(turns[0].sessionId, "legacy");
  });
});
