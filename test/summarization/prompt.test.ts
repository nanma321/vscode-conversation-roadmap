import * as assert from "assert";
import { buildSummarizationPrompt } from "../../src/summarization/prompt";
import { makeEmptyRoadmap, makeTurn } from "./fixtures";

describe("buildSummarizationPrompt", () => {
  it("describes an empty roadmap graph when none is given", () => {
    const turns = [makeTurn({ id: "turn-a", request: "Hi", response: "Hello" })];
    const prompt = buildSummarizationPrompt(turns, undefined);
    assert.ok(prompt.includes("roadmap graph is currently empty"));
  });

  it("lists existing roadmap node ids and titles so the model can target them", () => {
    const roadmap = makeEmptyRoadmap();
    roadmap.nodes.push({
      id: "node-existing",
      title: "Existing topic",
      summary: "summary",
      status: "open",
      tags: [],
      notes: "",
      sourceRefs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const turns = [makeTurn({ id: "turn-b" })];
    const prompt = buildSummarizationPrompt(turns, roadmap);
    assert.ok(prompt.includes("node-existing"));
    assert.ok(prompt.includes("Existing topic"));
  });

  it("includes every given turn's id, request, and response", () => {
    const turns = [
      makeTurn({ id: "turn-c1", request: "First request", response: "First response" }),
      makeTurn({ id: "turn-c2", request: "Second request", response: "Second response" }),
    ];
    const prompt = buildSummarizationPrompt(turns, undefined);
    assert.ok(prompt.includes("turn-c1"));
    assert.ok(prompt.includes("First request"));
    assert.ok(prompt.includes("First response"));
    assert.ok(prompt.includes("turn-c2"));
    assert.ok(prompt.includes("Second request"));
    assert.ok(prompt.includes("Second response"));
  });

  it("truncates overly long turn text", () => {
    const longText = "x".repeat(5000);
    const turns = [makeTurn({ id: "turn-d", request: longText, response: "short" })];
    const prompt = buildSummarizationPrompt(turns, undefined);
    assert.ok(!prompt.includes(longText));
    assert.ok(prompt.includes("\u2026"));
  });

  it("instructs conservative continuation and extraction of decisions/questions/tasks/outcomes/blockers", () => {
    const prompt = buildSummarizationPrompt([makeTurn({ id: "turn-e" })], undefined);
    assert.ok(prompt.includes("conservative"));
    assert.ok(prompt.includes("decision"));
    assert.ok(prompt.includes("question"));
    assert.ok(prompt.includes("task"));
    assert.ok(prompt.includes("outcome"));
    assert.ok(prompt.includes("blocker"));
    assert.ok(prompt.toLowerCase().includes("sourceturnids"));
  });

  it("requires a distinct question node even when its topic continues", () => {
    const prompt = buildSummarizationPrompt([makeTurn()], makeEmptyRoadmap());
    assert.match(prompt, /Every distinct non-empty user request MUST be represented by at least one newly created node/);
    assert.match(prompt, /do not add a redundant question node/);
  });

  it("describes the exact JSON response shape expected, including schemaVersion 1", () => {
    const prompt = buildSummarizationPrompt([makeTurn({ id: "turn-f" })], undefined);
    assert.ok(prompt.includes('"schemaVersion": 1'));
    assert.ok(prompt.includes('"relation"'));
    assert.ok(prompt.includes('"targetNodeId"'));
  });
});
