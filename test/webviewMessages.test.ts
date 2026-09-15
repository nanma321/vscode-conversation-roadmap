import * as assert from "assert";
import { applyWebviewMessage, validateWebviewMessage } from "../src/webviewMessages";
import { createDefaultSettings, Roadmap } from "../src/model/types";

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
        tags: ["planning"],
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

describe("validateWebviewMessage", () => {
  it("rejects non-object messages", () => {
    const result = validateWebviewMessage("not an object");
    assert.strictEqual(result.valid, false);
  });

  it("rejects messages without a string type", () => {
    const result = validateWebviewMessage({ nodeId: "node-1" });
    assert.strictEqual(result.valid, false);
  });

  it("rejects unrecognized message types", () => {
    const result = validateWebviewMessage({ type: "deleteEverything" });
    assert.strictEqual(result.valid, false);
    assert.match(result.errors[0], /unrecognized message type/);
  });

  it("accepts a well-formed moveNode message", () => {
    const result = validateWebviewMessage({ type: "moveNode", nodeId: "node-1", position: { x: 10, y: 20 } });
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.value, { type: "moveNode", nodeId: "node-1", position: { x: 10, y: 20 } });
  });

  it("rejects moveNode with a non-finite position", () => {
    const result = validateWebviewMessage({ type: "moveNode", nodeId: "node-1", position: { x: Infinity, y: 20 } });
    assert.strictEqual(result.valid, false);
  });

  it("rejects moveNode missing a position entirely", () => {
    const result = validateWebviewMessage({ type: "moveNode", nodeId: "node-1" });
    assert.strictEqual(result.valid, false);
  });

  it("trims renameNode titles and rejects blank ones", () => {
    const ok = validateWebviewMessage({ type: "renameNode", nodeId: "node-1", title: "  New title  " });
    assert.strictEqual(ok.valid, true);
    assert.strictEqual(ok.value && (ok.value as { title: string }).title, "New title");

    const blank = validateWebviewMessage({ type: "renameNode", nodeId: "node-1", title: "   " });
    assert.strictEqual(blank.valid, false);
  });

  it("accepts updateNotes with an empty string (clearing notes)", () => {
    const result = validateWebviewMessage({ type: "updateNotes", nodeId: "node-1", notes: "" });
    assert.strictEqual(result.valid, true);
  });

  it("rejects updateTags when tags is not an array of strings", () => {
    const result = validateWebviewMessage({ type: "updateTags", nodeId: "node-1", tags: ["ok", 5] });
    assert.strictEqual(result.valid, false);
  });

  it("accepts updateColor with a hex color or null", () => {
    const withColor = validateWebviewMessage({ type: "updateColor", nodeId: "node-1", color: "#ff00aa" });
    assert.strictEqual(withColor.valid, true);
    const cleared = validateWebviewMessage({ type: "updateColor", nodeId: "node-1", color: null });
    assert.strictEqual(cleared.valid, true);
  });

  it("rejects updateColor with a non-hex string", () => {
    const result = validateWebviewMessage({ type: "updateColor", nodeId: "node-1", color: "red" });
    assert.strictEqual(result.valid, false);
  });

  it("accepts toggleHighlight with a boolean", () => {
    const result = validateWebviewMessage({ type: "toggleHighlight", nodeId: "node-1", highlighted: true });
    assert.strictEqual(result.valid, true);
  });

  it("rejects toggleHighlight with a non-boolean", () => {
    const result = validateWebviewMessage({ type: "toggleHighlight", nodeId: "node-1", highlighted: "yes" });
    assert.strictEqual(result.valid, false);
  });

  it("accepts selectNode with a null nodeId (deselecting)", () => {
    const result = validateWebviewMessage({ type: "selectNode", nodeId: null });
    assert.strictEqual(result.valid, true);
  });

  it("accepts a bare requestState message", () => {
    const result = validateWebviewMessage({ type: "requestState" });
    assert.strictEqual(result.valid, true);
  });
});

describe("applyWebviewMessage", () => {
  it("returns the original roadmap unchanged for an invalid message", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "moveNode", nodeId: "node-1" });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap, roadmap);
    assert.ok(result.errors.length > 0);
  });

  it("returns the original roadmap unchanged for an unknown node id", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, {
      type: "moveNode",
      nodeId: "does-not-exist",
      position: { x: 1, y: 2 },
    });
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.roadmap, roadmap);
    assert.match(result.errors[0], /no node with id/);
  });

  it("persists a moved node's position without touching other fields", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "moveNode", nodeId: "node-1", position: { x: 42, y: 84 } });
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.roadmap.nodes[0].position, { x: 42, y: 84 });
    assert.strictEqual(result.roadmap.nodes[0].title, "Kickoff");
    assert.strictEqual(result.roadmap.nodes[0].summary, "Initial discussion");
  });

  it("renames a node", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "renameNode", nodeId: "node-1", title: "Renamed" });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes[0].title, "Renamed");
  });

  it("updates notes without touching the AI-generated summary", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "updateNotes", nodeId: "node-1", notes: "My notes" });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes[0].notes, "My notes");
    assert.strictEqual(result.roadmap.nodes[0].summary, "Initial discussion");
  });

  it("replaces tags with the user-provided set", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "updateTags", nodeId: "node-1", tags: ["urgent", "phase5"] });
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.roadmap.nodes[0].tags, ["urgent", "phase5"]);
  });

  it("sets and clears a node's color", () => {
    const roadmap = sampleRoadmap();
    const colored = applyWebviewMessage(roadmap, { type: "updateColor", nodeId: "node-1", color: "#abc" });
    assert.strictEqual(colored.roadmap.nodes[0].color, "#abc");

    const cleared = applyWebviewMessage(colored.roadmap, { type: "updateColor", nodeId: "node-1", color: null });
    assert.strictEqual(cleared.roadmap.nodes[0].color, undefined);
  });

  it("toggles highlighting", () => {
    const roadmap = sampleRoadmap();
    const result = applyWebviewMessage(roadmap, { type: "toggleHighlight", nodeId: "node-1", highlighted: true });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.roadmap.nodes[0].highlighted, true);
  });

  it("does not persist anything for selectNode or requestState", () => {
    const roadmap = sampleRoadmap();
    const select = applyWebviewMessage(roadmap, { type: "selectNode", nodeId: "node-1" });
    assert.strictEqual(select.changed, false);
    assert.strictEqual(select.roadmap, roadmap);

    const request = applyWebviewMessage(roadmap, { type: "requestState" });
    assert.strictEqual(request.changed, false);
    assert.strictEqual(request.roadmap, roadmap);
  });

  it("leaves other nodes untouched when editing one node", () => {
    const roadmap = sampleRoadmap({
      nodes: [
        ...sampleRoadmap().nodes,
        {
          id: "node-2",
          title: "Second",
          summary: "Second summary",
          status: "open",
          tags: [],
          notes: "",
          sourceRefs: [{ turnId: "turn-2", sessionId: "session-1" }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const result = applyWebviewMessage(roadmap, { type: "renameNode", nodeId: "node-1", title: "Renamed" });
    assert.strictEqual(result.roadmap.nodes[1].title, "Second");
  });
});
