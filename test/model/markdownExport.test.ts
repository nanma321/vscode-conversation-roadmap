import * as assert from "assert";
import { createDefaultSettings, Roadmap } from "../../src/model/types";
import { exportRoadmapToMarkdown } from "../../src/model/markdownExport";

function sampleRoadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  const now = new Date().toISOString();
  return {
    id: "roadmap-1",
    title: "Sample Roadmap",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "node-1",
        title: "Kickoff",
        summary: "Initial discussion",
        status: "open",
        nodeType: "topic",
        tags: ["planning"],
        notes: "some notes",
        sourceRefs: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-2",
        title: "Child topic",
        summary: "",
        status: "done",
        tags: [],
        notes: "",
        sourceRefs: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    edges: [{ id: "edge-1", source: "node-1", target: "node-2", kind: "topic" }],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

describe("markdownExport", () => {
  it("includes the roadmap title as a heading", () => {
    const md = exportRoadmapToMarkdown(sampleRoadmap());
    assert.ok(md.startsWith("# Sample Roadmap"));
  });

  it("renders one bullet per node, nesting children under their parent", () => {
    const md = exportRoadmapToMarkdown(sampleRoadmap());
    const lines = md.split("\n");
    const kickoffLine = lines.find((l) => l.includes("Kickoff"));
    const childLine = lines.find((l) => l.includes("Child topic"));
    assert.ok(kickoffLine);
    assert.ok(childLine);
    assert.ok(kickoffLine!.startsWith("- "));
    assert.ok(childLine!.startsWith("  - "), "child node should be indented one level under its parent");
  });

  it("includes node type, status, tags, summary, and notes", () => {
    const md = exportRoadmapToMarkdown(sampleRoadmap());
    assert.ok(md.includes("topic"));
    assert.ok(md.includes("open"));
    assert.ok(md.includes("planning"));
    assert.ok(md.includes("Initial discussion"));
    assert.ok(md.includes("some notes"));
  });

  it("handles a roadmap with no nodes", () => {
    const md = exportRoadmapToMarkdown(sampleRoadmap({ nodes: [], edges: [] }));
    assert.ok(md.includes("No nodes yet"));
  });

  it("escapes Markdown-significant characters in node titles", () => {
    const roadmap = sampleRoadmap();
    roadmap.nodes[0].title = "Use *bold* and _italic_ [links](url)";
    const md = exportRoadmapToMarkdown(roadmap);
    assert.ok(!md.includes("*bold*"));
    assert.ok(md.includes("\\*bold\\*"));
  });
});
