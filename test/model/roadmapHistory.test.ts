import * as assert from "assert";
import { RoadmapHistory } from "../../src/model/roadmapHistory";
import { createDefaultSettings, Roadmap } from "../../src/model/types";

function sampleRoadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  const now = new Date().toISOString();
  return {
    id: "roadmap-1",
    title: "Sample roadmap",
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

describe("RoadmapHistory", () => {
  it("reports canUndo/canRedo as false when empty", () => {
    const history = new RoadmapHistory();
    assert.strictEqual(history.canUndo(), false);
    assert.strictEqual(history.canRedo(), false);
  });

  it("undo restores the exact prior snapshot", () => {
    const history = new RoadmapHistory();
    const before = sampleRoadmap({ title: "Before" });
    const after = sampleRoadmap({ title: "After" });

    history.record(before);
    assert.strictEqual(history.canUndo(), true);

    const restored = history.undo(after);
    assert.strictEqual(restored, before);
    assert.strictEqual(restored?.title, "Before");
  });

  it("redo re-applies the state that was undone", () => {
    const history = new RoadmapHistory();
    const before = sampleRoadmap({ title: "Before" });
    const after = sampleRoadmap({ title: "After" });

    history.record(before);
    const restored = history.undo(after);
    assert.strictEqual(restored, before);
    assert.strictEqual(history.canRedo(), true);

    const redone = history.redo(before);
    assert.strictEqual(redone, after);
  });

  it("undo with an empty stack returns undefined and does not touch redo", () => {
    const history = new RoadmapHistory();
    const current = sampleRoadmap();
    const result = history.undo(current);
    assert.strictEqual(result, undefined);
    assert.strictEqual(history.canRedo(), false);
  });

  it("redo with an empty stack returns undefined", () => {
    const history = new RoadmapHistory();
    const current = sampleRoadmap();
    const result = history.redo(current);
    assert.strictEqual(result, undefined);
  });

  it("recording a new transaction clears the redo stack", () => {
    const history = new RoadmapHistory();
    const v1 = sampleRoadmap({ title: "v1" });
    const v2 = sampleRoadmap({ title: "v2" });
    const v3 = sampleRoadmap({ title: "v3" });

    history.record(v1);
    history.undo(v2); // now redo stack has v2
    assert.strictEqual(history.canRedo(), true);

    // A brand new transaction is recorded (as if the user made a fresh edit
    // instead of redoing) - the previously-undone future must be discarded.
    history.record(v2);
    assert.strictEqual(history.canRedo(), false);
    void v3;
  });

  it("supports multiple sequential undo/redo steps in order", () => {
    const history = new RoadmapHistory();
    const v1 = sampleRoadmap({ title: "v1" });
    const v2 = sampleRoadmap({ title: "v2" });
    const v3 = sampleRoadmap({ title: "v3" });

    history.record(v1);
    history.record(v2);

    let current = v3;
    current = history.undo(current)!;
    assert.strictEqual(current, v2);
    current = history.undo(current)!;
    assert.strictEqual(current, v1);
    assert.strictEqual(history.canUndo(), false);

    current = history.redo(current)!;
    assert.strictEqual(current, v2);
    current = history.redo(current)!;
    assert.strictEqual(current, v3);
    assert.strictEqual(history.canRedo(), false);
  });

  it("caps the undo stack at the configured limit", () => {
    const history = new RoadmapHistory(2);
    const v1 = sampleRoadmap({ title: "v1" });
    const v2 = sampleRoadmap({ title: "v2" });
    const v3 = sampleRoadmap({ title: "v3" });
    const v4 = sampleRoadmap({ title: "v4" });

    history.record(v1);
    history.record(v2);
    history.record(v3); // v1 should be dropped, keeping [v2, v3]

    let current = v4;
    current = history.undo(current)!;
    assert.strictEqual(current, v3);
    current = history.undo(current)!;
    assert.strictEqual(current, v2);
    assert.strictEqual(history.canUndo(), false);
  });
});
