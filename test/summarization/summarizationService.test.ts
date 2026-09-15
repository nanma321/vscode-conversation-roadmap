import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RoadmapStore } from "../../src/model/roadmapStore";
import { loadDefaultRoadmap } from "../../src/model/defaultRoadmap";
import { TurnStore } from "../../src/turnStore";
import { SummarizationService } from "../../src/summarization/summarizationService";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-summarize-"));
}

async function seedTurn(store: TurnStore, id: string, request: string, completed = true): Promise<void> {
  await store.append({
    id,
    sessionId: "session-1",
    timestamp: new Date().toISOString(),
    request,
    response: `answer to ${request}`,
    completed,
    references: [],
  });
}

/** A model response that creates one topic node from the given turn id. */
function topicResponse(turnId: string, title = "A topic"): string {
  return JSON.stringify({
    schemaVersion: 1,
    nodes: [{ localId: "n1", kind: "topic", title, summary: "summary", sourceTurnIds: [turnId], relation: "topic" }],
  });
}

describe("SummarizationService", () => {
  it("summarizes a newly captured turn into a roadmap node and persists it", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "what is a loop");

    const service = new SummarizationService(turnStore, roadmapStore, async () => topicResponse("turn-1", "Loops"));
    const outcome = await service.summarizeNewTurns();

    assert.strictEqual(outcome.changed, true);
    assert.strictEqual(outcome.roadmap.nodes.length, 1);
    assert.strictEqual(outcome.roadmap.nodes[0].title, "Loops");
    assert.ok(outcome.roadmap.nodes[0].sourceRefs.some((r) => r.turnId === "turn-1"));

    // Persisted to disk: a fresh store instance sees the node.
    const reloaded = await loadDefaultRoadmap(new RoadmapStore(dir));
    assert.strictEqual(reloaded.nodes.length, 1);
    assert.strictEqual(reloaded.nodes[0].title, "Loops");
  });

  it("does not re-summarize a turn already reflected in the roadmap", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "first");

    let calls = 0;
    const service = new SummarizationService(turnStore, roadmapStore, async () => {
      calls += 1;
      return topicResponse("turn-1");
    });

    await service.summarizeNewTurns();
    const second = await service.summarizeNewTurns();

    assert.strictEqual(calls, 1, "the model should only be asked about the turn once");
    assert.strictEqual(second.changed, false);
  });

  it("skips incomplete (cancelled/failed) turns", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-bad", "cancelled question", false);

    let called = false;
    const service = new SummarizationService(turnStore, roadmapStore, async () => {
      called = true;
      return topicResponse("turn-bad");
    });
    const outcome = await service.summarizeNewTurns();

    assert.strictEqual(called, false, "incomplete turns should not be sent to the model");
    assert.strictEqual(outcome.changed, false);
    assert.strictEqual(outcome.roadmap.nodes.length, 0);
  });

  it("leaves the roadmap unchanged when the model returns invalid JSON", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "q");

    const service = new SummarizationService(turnStore, roadmapStore, async () => "not json at all");
    const outcome = await service.summarizeNewTurns();

    assert.strictEqual(outcome.changed, false);
    assert.ok(outcome.errors.some((e) => /json/i.test(e)));
    assert.strictEqual(outcome.roadmap.nodes.length, 0);
  });

  it("tolerates a model response wrapped in a Markdown code fence", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "q");

    const fenced = "```json\n" + topicResponse("turn-1", "Fenced") + "\n```";
    const service = new SummarizationService(turnStore, roadmapStore, async () => fenced);
    const outcome = await service.summarizeNewTurns();

    assert.strictEqual(outcome.changed, true);
    assert.strictEqual(outcome.roadmap.nodes[0].title, "Fenced");
  });

  it("does not retry a turn the model declined to use on the next capture", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "ignored");

    let calls = 0;
    // Model returns an empty node set (no-op) the first time.
    const service = new SummarizationService(turnStore, roadmapStore, async () => {
      calls += 1;
      return JSON.stringify({ schemaVersion: 1, nodes: [] });
    });

    await service.summarizeNewTurns();
    await service.summarizeNewTurns();
    assert.strictEqual(calls, 1, "a turn attempted once should not be retried on a later run");
  });

  it("respects autoSummarize=false by doing nothing", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    // Create the default roadmap with autoSummarize disabled.
    const roadmap = await loadDefaultRoadmap(roadmapStore);
    roadmap.settings.autoSummarize = false;
    const doc = await roadmapStore.load();
    await roadmapStore.save({ ...doc, roadmaps: [roadmap] });
    await seedTurn(turnStore, "turn-1", "q");

    let called = false;
    const service = new SummarizationService(turnStore, roadmapStore, async () => {
      called = true;
      return topicResponse("turn-1");
    });
    const outcome = await service.summarizeNewTurns();

    assert.strictEqual(called, false);
    assert.strictEqual(outcome.changed, false);
  });
});
