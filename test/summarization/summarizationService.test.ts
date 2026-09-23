import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RoadmapStore } from "../../src/model/roadmapStore";
import { loadDefaultRoadmap } from "../../src/model/defaultRoadmap";
import { TurnStore } from "../../src/turnStore";
import {
  MAX_SUMMARIZATION_ATTEMPTS,
  SummarizationService,
} from "../../src/summarization/summarizationService";

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

async function seedTurnInSession(store: TurnStore, id: string, sessionId: string, request: string): Promise<void> {
  await store.append({
    id,
    sessionId,
    timestamp: new Date().toISOString(),
    request,
    response: `answer to ${request}`,
    completed: true,
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
    const topic = outcome.roadmap.nodes.find((node) => node.title === "Loops");
    assert.ok(topic);
    assert.ok(topic!.sourceRefs.some((r) => r.turnId === "turn-1"));

    // Persisted to disk: a fresh store instance sees the node.
    const reloaded = await loadDefaultRoadmap(new RoadmapStore(dir));
    assert.strictEqual(reloaded.nodes.length, 1);
    assert.ok(reloaded.nodes.some((node) => node.title === "Loops"));
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

  it("creates exactly one new node for each distinct same-topic turn", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();

    let call = 0;
    const service = new SummarizationService(turnStore, roadmapStore, async (prompt) => {
      call += 1;
      const turnId = /Turn id: (\S+)/.exec(prompt)?.[1] ?? "unknown";
      if (call === 1) {
        return topicResponse(turnId, "Loops");
      }
      const topicId = /- id: (\S+) \| kind: topic/.exec(prompt)?.[1];
      assert.ok(topicId, "same-session follow-up prompt should include the existing topic");
      return JSON.stringify({
        schemaVersion: 1,
        nodes: [
          {
            localId: `continued-${call}`,
            kind: "topic",
            title: "ignored continuation title",
            summary: `updated from ${turnId}`,
            sourceTurnIds: [turnId],
            relation: "continue",
            targetNodeId: topicId,
          },
        ],
      });
    });

    await seedTurn(turnStore, "turn-1", "What is a loop?");
    await service.summarizeNewTurns();
    await seedTurn(turnStore, "turn-2", "How does a loop stop?");
    await service.summarizeNewTurns();
    await seedTurn(turnStore, "turn-3", "Can a loop run forever?");
    const outcome = await service.summarizeNewTurns();

    assert.strictEqual(outcome.roadmap.nodes.filter((node) => node.nodeType === "topic").length, 1);
    assert.strictEqual(outcome.roadmap.nodes.filter((node) => node.nodeType === "question").length, 2);
    assert.strictEqual(outcome.roadmap.nodes.length, 3);
    const topic = outcome.roadmap.nodes.find((node) => node.nodeType === "topic")!;
    const childQuestionIds = new Set(
      outcome.roadmap.edges
        .filter((edge) => edge.source === topic.id)
        .map((edge) => edge.target)
    );
    assert.ok(
      outcome.roadmap.nodes
        .filter((node) => node.nodeType === "question")
        .every((node) => childQuestionIds.has(node.id))
    );
  });

  it("backfills distinct questions collapsed into an existing topic without another model call", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "What is a loop?");
    await seedTurn(turnStore, "turn-2", "How does a loop stop?");
    await seedTurn(turnStore, "turn-3", "Can a loop run forever?");

    const existing = await loadDefaultRoadmap(roadmapStore);
    existing.nodes.push({
      id: "topic-1",
      title: "Loops",
      summary: "Three questions about loops.",
      status: "open",
      nodeType: "topic",
      tags: ["loops", "iteration"],
      notes: "",
      sourceRefs: turnStore.getAll().map((item) => ({
        turnId: item.id,
        sessionId: item.sessionId,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const document = await roadmapStore.load();
    await roadmapStore.save({ ...document, roadmaps: [existing] });

    let modelCalled = false;
    const service = new SummarizationService(turnStore, roadmapStore, async () => {
      modelCalled = true;
      throw new Error("model should not be called for backfill");
    });
    const outcome = await service.backfillExistingQuestions();

    assert.strictEqual(modelCalled, false);
    assert.strictEqual(outcome.changed, true);
    assert.strictEqual(outcome.roadmap.nodes.filter((node) => node.nodeType === "topic").length, 1);
    assert.strictEqual(outcome.roadmap.nodes.filter((node) => node.nodeType === "question").length, 2);
  });

  it("connects a resumed response beneath its pre-created resume placeholder", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();

    const existing = await loadDefaultRoadmap(roadmapStore);
    const now = new Date().toISOString();
    existing.nodes.push(
      {
        id: "node-original",
        title: "Original topic",
        summary: "Original",
        status: "open",
        nodeType: "topic",
        tags: [],
        notes: "",
        sourceRefs: [{ turnId: "turn-old", sessionId: "session-old" }],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-resume",
        title: "Resume: Original topic",
        summary: "",
        status: "open",
        nodeType: "topic",
        tags: [],
        notes: "Explore another path",
        sourceRefs: [],
        createdAt: now,
        updatedAt: now,
      }
    );
    existing.edges.push({
      id: "edge-resume",
      source: "node-original",
      target: "node-resume",
      kind: "branch",
      label: "resume",
    });
    const document = await roadmapStore.load();
    await roadmapStore.save({ ...document, roadmaps: [existing] });
    await turnStore.append({
      id: "turn-resumed",
      sessionId: "session-new",
      timestamp: now,
      request: "Continue the alternative",
      response: "Resumed answer",
      completed: true,
      resumeNodeId: "node-resume",
      references: [],
    });

    let capturedPrompt = "";
    const service = new SummarizationService(turnStore, roadmapStore, async (prompt) => {
      capturedPrompt = prompt;
      const turnId = /Turn id: (\S+)/.exec(prompt)?.[1] ?? "turn-resumed";
      return JSON.stringify({
        schemaVersion: 1,
        nodes: [
          {
            localId: `response-${turnId}`,
            kind: "topic",
            title: "Alternative response",
            summary: "Resumed answer",
            sourceTurnIds: [turnId],
            relation: "branch",
            targetNodeId: "node-original",
          },
        ],
      });
    });
    const outcome = await service.summarizeNewTurns();

    const responseNode = outcome.roadmap.nodes.find((node) =>
      node.sourceRefs.some((reference) => reference.turnId === "turn-resumed")
    );
    assert.ok(responseNode);
    assert.strictEqual(responseNode!.id, "node-resume");
    assert.strictEqual(outcome.roadmap.nodes.length, 2);
    assert.ok(
      outcome.roadmap.edges.some(
        (edge) => edge.source === "node-original" && edge.target === "node-resume"
      )
    );
    assert.ok(capturedPrompt.includes("node-resume"));

    await turnStore.append({
      id: "turn-follow-up",
      sessionId: "session-new",
      timestamp: now,
      request: "One more question in this resumed path",
      response: "Another resumed answer",
      completed: true,
      references: [],
    });
    const followUp = await service.summarizeNewTurns();
    const followUpNode = followUp.roadmap.nodes.find((node) =>
      node.sourceRefs.some((reference) => reference.turnId === "turn-follow-up")
    );
    assert.ok(followUpNode);
    assert.ok(
      followUp.roadmap.edges.some(
        (edge) => edge.source === "node-resume" && edge.target === followUpNode!.id
      )
    );
    assert.ok(
      !followUp.roadmap.edges.some(
        (edge) => edge.source === "node-original" && edge.target === followUpNode!.id
      )
    );

    await turnStore.append({
      id: "turn-third",
      sessionId: "session-new",
      timestamp: now,
      request: "Continue once more in this resumed path",
      response: "Third resumed answer",
      completed: true,
      references: [],
    });
    const third = await service.summarizeNewTurns();
    const thirdNode = third.roadmap.nodes.find((node) =>
      node.sourceRefs.some((reference) => reference.turnId === "turn-third")
    );
    assert.ok(thirdNode);
    assert.ok(
      third.roadmap.edges.some(
        (edge) => edge.source === followUpNode!.id && edge.target === thirdNode!.id
      )
    );
    assert.ok(
      !third.roadmap.edges.some(
        (edge) => edge.source === "node-resume" && edge.target === thirdNode!.id
      )
    );
  });

  it("clears all graphs permanently while preserving transcripts and allowing future turns", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "old question");

    const initialService = new SummarizationService(
      turnStore,
      roadmapStore,
      async () => topicResponse("turn-1", "Old node")
    );
    await initialService.summarizeNewTurns();
    const cleared = await initialService.clearAllRoadmaps();

    assert.strictEqual(cleared.nodes.length, 0);
    assert.strictEqual(turnStore.getAll().length, 1);
    assert.strictEqual(turnStore.getAll()[0].request, "old question");
    assert.strictEqual(turnStore.getAll()[0].roadmapExcluded, true);

    const reloadedTurns = new TurnStore(dir);
    const reloadedRoadmaps = new RoadmapStore(dir);
    await reloadedTurns.load();
    await reloadedRoadmaps.load();
    let calls = 0;
    const reloadedService = new SummarizationService(reloadedTurns, reloadedRoadmaps, async (prompt) => {
      calls += 1;
      const turnId = /Turn id: (\S+)/.exec(prompt)?.[1] ?? "unknown";
      return topicResponse(turnId, "New node");
    });

    await reloadedService.summarizeNewTurns();
    assert.strictEqual(calls, 0, "cleared transcripts must not recreate graph nodes after reload");

    await seedTurn(reloadedTurns, "turn-2", "new question");
    const outcome = await reloadedService.summarizeNewTurns();
    assert.strictEqual(calls, 1);
    assert.strictEqual(outcome.roadmap.nodes.length, 1);
    assert.ok(
      outcome.roadmap.nodes.some(
        (node) =>
          node.sourceRefs.some((ref) => ref.turnId === "turn-2")
      )
    );
  });

  it("serializes clearing after an in-flight summary so late model output cannot restore nodes", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "question being summarized");

    let releaseModel: ((response: string) => void) | undefined;
    const modelResponse = new Promise<string>((resolve) => {
      releaseModel = resolve;
    });
    const service = new SummarizationService(turnStore, roadmapStore, async () => modelResponse);

    const summaryPromise = service.summarizeNewTurns();
    const clearPromise = service.clearAllRoadmaps();
    releaseModel?.(topicResponse("turn-1", "Late node"));

    await summaryPromise;
    const cleared = await clearPromise;
    assert.strictEqual(cleared.nodes.length, 0);
    assert.strictEqual((await loadDefaultRoadmap(new RoadmapStore(dir))).nodes.length, 0);
    assert.strictEqual(turnStore.getAll()[0].roadmapExcluded, true);
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
    assert.strictEqual(outcome.failures.length, 1);
    assert.strictEqual(outcome.failures[0].attempt, 1);
    assert.strictEqual(outcome.failures[0].willRetry, true);
    assert.strictEqual(turnStore.getAll()[0].summarizationAttempts, 1);
  });

  it("keeps a transient failure eligible for one bounded later retry", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-retry", "design the log analyzer");

    let calls = 0;
    const service = new SummarizationService(turnStore, roadmapStore, async () => {
      calls += 1;
      return calls === 1 ? "temporarily malformed" : topicResponse("turn-retry", "Log analyzer");
    });

    const first = await service.summarizeNewTurns();
    assert.strictEqual(first.changed, false);
    assert.strictEqual(first.failures[0].willRetry, true);
    assert.strictEqual(first.fallbacks.length, 0);

    const second = await service.summarizeNewTurns();
    assert.strictEqual(second.changed, true);
    assert.strictEqual(second.failures.length, 0);
    assert.strictEqual(second.fallbacks.length, 0);
    assert.ok(
      second.roadmap.nodes.some((node) =>
        node.sourceRefs.some((reference) => reference.turnId === "turn-retry")
      )
    );

    await service.summarizeNewTurns();
    assert.strictEqual(calls, MAX_SUMMARIZATION_ATTEMPTS);
  });

  it("reserves the bounded attempt before invoking the model", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-reserved", "reserve before request");

    const service = new SummarizationService(turnStore, roadmapStore, async () => {
      assert.strictEqual(
        turnStore.getAll().find((turn) => turn.id === "turn-reserved")
          ?.summarizationAttempts,
        1
      );
      return topicResponse("turn-reserved");
    });
    await service.summarizeNewTurns();
  });

  it("persists a deterministic source-linked fallback after retries are exhausted", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-fallback", "analyze this log");

    let calls = 0;
    const firstService = new SummarizationService(turnStore, roadmapStore, async () => {
      calls += 1;
      return "{ invalid";
    });
    const first = await firstService.summarizeNewTurns();
    assert.strictEqual(first.changed, false);
    assert.strictEqual(first.fallbacks.length, 0);

    // Recreate the service to prove the retry count survives extension reload.
    const reloadedTurns = new TurnStore(dir);
    const reloadedRoadmaps = new RoadmapStore(dir);
    await reloadedTurns.load();
    await reloadedRoadmaps.load();
    const secondService = new SummarizationService(
      reloadedTurns,
      reloadedRoadmaps,
      async () => {
        calls += 1;
        return "{ still invalid";
      }
    );
    const second = await secondService.summarizeNewTurns();

    assert.strictEqual(calls, MAX_SUMMARIZATION_ATTEMPTS);
    assert.strictEqual(second.changed, true);
    assert.strictEqual(second.failures[0].willRetry, false);
    assert.strictEqual(second.fallbacks.length, 1);
    assert.strictEqual(second.fallbacks[0].turnId, "turn-fallback");
    const fallback = second.roadmap.nodes.find(
      (node) => node.id === second.fallbacks[0].nodeId
    );
    assert.ok(fallback);
    assert.strictEqual(fallback!.title, "Automatic summary unavailable");
    assert.ok(/failed after 2 attempts/i.test(fallback!.summary));
    assert.deepStrictEqual(fallback!.sourceRefs, [
      { turnId: "turn-fallback", sessionId: "session-1" },
    ]);
    assert.ok(!fallback!.summary.includes("analyze this log"));

    const persisted = await loadDefaultRoadmap(new RoadmapStore(dir));
    assert.ok(persisted.nodes.some((node) => node.id === fallback!.id));
    await secondService.summarizeNewTurns();
    assert.strictEqual(calls, MAX_SUMMARIZATION_ATTEMPTS);
  });

  it("honors retry reservations written by another VS Code window", async () => {
    const dir = makeTempDir();
    const firstTurns = new TurnStore(dir);
    const firstRoadmaps = new RoadmapStore(dir);
    await firstTurns.load();
    await firstRoadmaps.load();
    await seedTurn(firstTurns, "turn-shared", "shared failed summary");

    const secondTurns = new TurnStore(dir);
    const secondRoadmaps = new RoadmapStore(dir);
    await secondTurns.load();
    await secondRoadmaps.load();
    let calls = 0;
    const firstService = new SummarizationService(
      firstTurns,
      firstRoadmaps,
      async () => {
        calls += 1;
        return "invalid first response";
      }
    );
    const secondService = new SummarizationService(
      secondTurns,
      secondRoadmaps,
      async () => {
        calls += 1;
        return "invalid second response";
      }
    );

    await firstService.summarizeNewTurns();
    const second = await secondService.summarizeNewTurns();

    assert.strictEqual(calls, MAX_SUMMARIZATION_ATTEMPTS);
    assert.strictEqual(second.fallbacks.length, 1);
    assert.strictEqual(second.fallbacks[0].turnId, "turn-shared");
  });

  it("isolates success and retry state across multiple sessions", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurnInSession(turnStore, "turn-a", "session-a", "successful turn");
    await seedTurnInSession(turnStore, "turn-b", "session-b", "transient failure");

    const callsBySession = new Map<string, number>();
    const service = new SummarizationService(turnStore, roadmapStore, async (prompt) => {
      const turnId = prompt.includes("turn-a") ? "turn-a" : "turn-b";
      const sessionId = turnId === "turn-a" ? "session-a" : "session-b";
      callsBySession.set(sessionId, (callsBySession.get(sessionId) ?? 0) + 1);
      if (sessionId === "session-b" && callsBySession.get(sessionId) === 1) {
        throw new Error("temporary model outage");
      }
      return topicResponse(turnId, sessionId);
    });

    const first = await service.summarizeNewTurns();
    assert.strictEqual(first.changed, true);
    assert.deepStrictEqual(first.failures.map((failure) => failure.sessionId), [
      "session-b",
    ]);
    assert.ok(
      first.roadmap.nodes.some((node) =>
        node.sourceRefs.some((reference) => reference.turnId === "turn-a")
      )
    );
    assert.ok(
      !first.roadmap.nodes.some((node) =>
        node.sourceRefs.some((reference) => reference.turnId === "turn-b")
      )
    );

    const second = await service.summarizeNewTurns();
    assert.strictEqual(second.failures.length, 0);
    assert.ok(
      second.roadmap.nodes.some((node) =>
        node.sourceRefs.some((reference) => reference.turnId === "turn-b")
      )
    );
    assert.strictEqual(callsBySession.get("session-a"), 1);
    assert.strictEqual(callsBySession.get("session-b"), 2);
  });

  it("rejects a model target from another chat session", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurnInSession(turnStore, "turn-a", "session-a", "first chat");

    const serviceA = new SummarizationService(
      turnStore,
      roadmapStore,
      async () => topicResponse("turn-a", "Session A")
    );
    const first = await serviceA.summarizeNewTurns();
    const sessionANode = first.roadmap.nodes.find((node) =>
      node.sourceRefs.some((reference) => reference.turnId === "turn-a")
    );
    assert.ok(sessionANode);

    await seedTurnInSession(turnStore, "turn-b", "session-b", "second chat");
    const serviceB = new SummarizationService(turnStore, roadmapStore, async () =>
      JSON.stringify({
        schemaVersion: 1,
        nodes: [
          {
            localId: "malicious-cross-session",
            kind: "topic",
            title: "Wrong continuation",
            summary: "Must not cross sessions",
            sourceTurnIds: ["turn-b"],
            relation: "continue",
            targetNodeId: sessionANode!.id,
          },
        ],
      })
    );
    const outcome = await serviceB.summarizeNewTurns();

    assert.strictEqual(outcome.changed, false);
    assert.strictEqual(outcome.failures[0].stage, "schema");
    assert.ok(outcome.errors.some((error) => /outside the current chat session/.test(error)));
    const unchanged = outcome.roadmap.nodes.find((node) => node.id === sessionANode!.id);
    assert.deepStrictEqual(unchanged!.sourceRefs, [
      { turnId: "turn-a", sessionId: "session-a" },
    ]);
    assert.ok(
      !outcome.roadmap.edges.some(
        (edge) => edge.source === sessionANode!.id && edge.target !== sessionANode!.id
      )
    );
  });

  it("rejects a response-local id that collides with another session node", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurnInSession(turnStore, "turn-a", "session-a", "first chat");
    const first = await new SummarizationService(
      turnStore,
      roadmapStore,
      async () => topicResponse("turn-a", "Session A")
    ).summarizeNewTurns();
    const sessionANode = first.roadmap.nodes.find((node) =>
      node.sourceRefs.some((reference) => reference.turnId === "turn-a")
    );
    assert.ok(sessionANode);

    await seedTurnInSession(turnStore, "turn-b", "session-b", "second chat");
    const outcome = await new SummarizationService(
      turnStore,
      roadmapStore,
      async () =>
        JSON.stringify({
          schemaVersion: 1,
          nodes: [
            {
              localId: sessionANode!.id,
              kind: "topic",
              title: "Colliding local node",
              summary: "Must be rejected",
              sourceTurnIds: ["turn-b"],
              relation: "topic",
            },
            {
              localId: "child",
              kind: "topic",
              title: "Colliding child",
              summary: "Must not target another session",
              sourceTurnIds: ["turn-b"],
              relation: "branch",
              targetNodeId: sessionANode!.id,
            },
          ],
        })
    ).summarizeNewTurns();

    assert.strictEqual(outcome.changed, false);
    assert.ok(outcome.errors.some((error) => /collides with an existing/.test(error)));
    assert.deepStrictEqual(
      outcome.roadmap.nodes.find((node) => node.id === sessionANode!.id)!.sourceRefs,
      [{ turnId: "turn-a", sessionId: "session-a" }]
    );
  });

  it("serializes Webview-style graph edits behind an in-flight summary", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();
    await seedTurn(turnStore, "turn-1", "long model request");

    let releaseModel: (() => void) | undefined;
    let modelStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      modelStarted = resolve;
    });
    const service = new SummarizationService(turnStore, roadmapStore, async () => {
      modelStarted?.();
      await new Promise<void>((resolve) => {
        releaseModel = resolve;
      });
      return topicResponse("turn-1", "Summarized");
    });

    const summary = service.summarizeNewTurns();
    await started;
    let editFinished = false;
    const edit = (async () => {
      const roadmap = await loadDefaultRoadmap(roadmapStore);
      roadmap.title = "User title changed during summary";
      await roadmapStore.save({
        version: 1,
        roadmaps: [roadmap],
      });
      editFinished = true;
    })();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(editFinished, false);

    releaseModel?.();
    await summary;
    await edit;
    const persisted = await loadDefaultRoadmap(new RoadmapStore(dir));
    assert.strictEqual(persisted.title, "User title changed during summary");
    assert.ok(
      persisted.nodes.some((node) =>
        node.sourceRefs.some((reference) => reference.turnId === "turn-1")
      )
    );
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

  it("starts a new sub-graph for a new session instead of linking onto an earlier one", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();

    const prompts: string[] = [];
    const service = new SummarizationService(turnStore, roadmapStore, async (prompt) => {
      prompts.push(prompt);
      const m = /Turn id: (\S+)/.exec(prompt);
      const turnId = m ? m[1] : "unknown";
      return topicResponse(turnId, `Topic ${turnId}`);
    });

    // Session 1: one turn -> one topic node.
    await seedTurnInSession(turnStore, "t1", "session-1", "first topic");
    await service.summarizeNewTurns();

    // Session 2 (a new chat): another turn.
    await seedTurnInSession(turnStore, "t2", "session-2", "unrelated topic");
    await service.summarizeNewTurns();

    const roadmap = await loadDefaultRoadmap(roadmapStore);
    assert.strictEqual(roadmap.nodes.length, 2, "each session should contribute its own node");
    assert.strictEqual(roadmap.edges.length, 0, "there must be no edge linking the two sessions' nodes");
    const nodesById = new Map(roadmap.nodes.map((node) => [node.id, node]));
    for (const edge of roadmap.edges) {
      const sourceSession = nodesById.get(edge.source)?.sourceRefs[0]?.sessionId;
      const targetSession = nodesById.get(edge.target)?.sourceRefs[0]?.sessionId;
      assert.strictEqual(sourceSession, targetSession, "an edge must never connect different chat sessions");
    }

    // The prompt used for session 2 must not have shown session 1's node as
    // existing context (otherwise the model could continue/branch onto it).
    const session2Prompt = prompts.find((p) => p.includes("Turn id: t2"));
    assert.ok(session2Prompt, "expected a prompt for the session-2 turn");
    assert.ok(session2Prompt!.includes("currently empty"), "session-2 prompt should present an empty graph");
    assert.ok(!session2Prompt!.includes("Topic t1"), "session-2 prompt must not include session-1's node");
  });

  it("still shows a session its own earlier nodes as context for continuation", async () => {
    const dir = makeTempDir();
    const turnStore = new TurnStore(dir);
    const roadmapStore = new RoadmapStore(dir);
    await turnStore.load();
    await roadmapStore.load();

    const prompts: string[] = [];
    const service = new SummarizationService(turnStore, roadmapStore, async (prompt) => {
      prompts.push(prompt);
      const m = /Turn id: (\S+)/.exec(prompt);
      const turnId = m ? m[1] : "unknown";
      return topicResponse(turnId, `Topic ${turnId}`);
    });

    await seedTurnInSession(turnStore, "t1", "session-1", "first");
    await service.summarizeNewTurns();
    await seedTurnInSession(turnStore, "t3", "session-1", "follow-up");
    await service.summarizeNewTurns();

    const followUpPrompt = prompts.find((p) => p.includes("Turn id: t3"));
    assert.ok(followUpPrompt, "expected a prompt for the follow-up turn");
    assert.ok(
      followUpPrompt!.includes("Topic t1"),
      "a follow-up in the same session should see that session's existing node as context"
    );
  });
});
