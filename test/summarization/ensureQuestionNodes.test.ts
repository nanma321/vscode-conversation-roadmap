import * as assert from "assert";
import { createDefaultSettings, Roadmap, Turn } from "../../src/model/types";
import {
  buildQuestionBackfill,
  ensureQuestionNodes,
  isQuestionRequest,
} from "../../src/summarization/ensureQuestionNodes";
import { ModelSummaryResponse } from "../../src/summarization/summaryResponseSchema";

const NOW = "2026-09-18T00:00:00.000Z";

function turn(id: string, request: string): Turn {
  return {
    id,
    sessionId: "session-1",
    timestamp: NOW,
    request,
    response: `Answer to ${request}`,
    completed: true,
    references: [],
  };
}

function roadmap(): Roadmap {
  return {
    id: "roadmap-1",
    title: "Roadmap",
    createdAt: NOW,
    updatedAt: NOW,
    nodes: [
      {
        id: "topic-1",
        title: "Loops",
        summary: "",
        status: "open",
        nodeType: "topic",
        tags: [],
        notes: "",
        sourceRefs: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    edges: [],
    settings: createDefaultSettings(),
  };
}

function continuingTopics(turns: Turn[]): ModelSummaryResponse {
  return {
    schemaVersion: 1,
    nodes: turns.map((item, index) => ({
      localId: `continued-${index}`,
      kind: "topic",
      title: "ignored",
      summary: item.response,
      sourceTurnIds: [item.id],
      relation: "continue",
      targetNodeId: "topic-1",
    })),
  };
}

describe("ensureQuestionNodes", () => {
  it("treats every non-empty participant request as a question-node candidate", () => {
    assert.strictEqual(isQuestionRequest("Tell me why this works?"), true);
    assert.strictEqual(isQuestionRequest("How does this work"), true);
    assert.strictEqual(isQuestionRequest("Explain how this works"), true);
    assert.strictEqual(isQuestionRequest("   "), false);
  });

  it("adds one child question for each distinct same-topic question", () => {
    const turns = [
      turn("turn-1", "What is a loop?"),
      turn("turn-2", "How does a loop stop?"),
      turn("turn-3", "Can a loop run forever?"),
    ];
    const result = ensureQuestionNodes(continuingTopics(turns), turns, roadmap(), turns);
    const questions = result.nodes.filter((node) => node.kind === "question");

    assert.strictEqual(questions.length, 3);
    assert.deepStrictEqual(
      questions.map((node) => node.targetNodeId),
      ["topic-1", "topic-1", "topic-1"]
    );
    assert.ok(questions.every((node) => node.relation === "topic"));
  });

  it("adds a new question when the model only continues an old question", () => {
    const item = turn("turn-1", "Why use a loop?");
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        ...continuingTopics([item]).nodes,
        {
          localId: "model-question",
          kind: "question",
          title: "Why loops",
          summary: item.response,
          sourceTurnIds: [item.id],
          relation: "continue",
          targetNodeId: "old-question",
        },
      ],
    };

    const result = ensureQuestionNodes(response, [item], roadmap(), [item]);
    const createdQuestion = result.nodes.find(
      (node) => node.kind === "question" && node.relation !== "continue"
    );
    assert.ok(createdQuestion);
    assert.strictEqual(createdQuestion?.targetNodeId, "topic-1");
  });

  it("does not add a redundant question when the model already creates a node for the request", () => {
    const item = turn("turn-1", "What is a loop?");
    const response: ModelSummaryResponse = {
      schemaVersion: 1,
      nodes: [
        {
          localId: "new-topic",
          kind: "topic",
          title: "Loops",
          summary: item.response,
          sourceTurnIds: [item.id],
          relation: "topic",
          targetNodeId: "topic-1",
        },
      ],
    };
    const result = ensureQuestionNodes(response, [item], roadmap(), [item]);
    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].localId, "new-topic");
  });

  it("does not duplicate a question already represented by an existing question node", () => {
    const item = turn("turn-old", "What is a loop?");
    const existing = roadmap();
    existing.nodes.push({
      id: "question-1",
      title: item.request,
      summary: item.response,
      status: "open",
      nodeType: "question",
      tags: [],
      notes: "",
      sourceRefs: [{ turnId: item.id, sessionId: item.sessionId }],
      createdAt: NOW,
      updatedAt: NOW,
    });
    const repeated = turn("turn-new", "  WHAT is a loop?! ");

    const result = ensureQuestionNodes(
      continuingTopics([repeated]),
      [repeated],
      existing,
      [item, repeated]
    );
    assert.strictEqual(result.nodes.filter((node) => node.kind === "question").length, 0);
  });

  it("uses one fallback topic node to represent a request when the graph and response are empty", () => {
    const item = turn("turn-1", "Where should we start?");
    const empty = roadmap();
    empty.nodes = [];
    const result = ensureQuestionNodes(
      { schemaVersion: 1, nodes: [] },
      [item],
      empty,
      [item]
    );

    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].kind, "topic");
  });

  it("builds a deterministic backfill for questions already referenced only by a topic", () => {
    const items = [
      turn("turn-1", "What is a loop?"),
      turn("turn-2", "How does a loop stop?"),
    ];
    const existing = roadmap();
    existing.nodes[0].sourceRefs = items.map((item) => ({
      turnId: item.id,
      sessionId: item.sessionId,
    }));

    const backfill = buildQuestionBackfill(existing, items, items);
    assert.deepStrictEqual(backfill.turns.map((item) => item.id), ["turn-2"]);
    assert.strictEqual(
      backfill.response.nodes.filter((node) => node.kind === "question").length,
      1
    );
    assert.ok(
      backfill.response.nodes
        .filter((node) => node.kind === "question")
        .every((node) => node.targetNodeId === "topic-1")
    );
  });
});
