import * as assert from "assert";
import { exportRoadmapToSvg } from "../../src/export/svgExport";
import { createDefaultSettings, Roadmap } from "../../src/model/types";

const NOW = "2026-09-18T00:00:00.000Z";

function sampleRoadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  return {
    id: "roadmap-1",
    title: "Release roadmap",
    createdAt: NOW,
    updatedAt: NOW,
    nodes: [
      {
        id: "node-1",
        title: "Plan <release>",
        summary: "",
        status: "in-progress",
        nodeType: "task",
        tags: [],
        notes: "",
        position: { x: -100, y: 40 },
        color: "#e5c116",
        isNew: true,
        sourceRefs: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "node-2",
        title: "Ship & verify",
        summary: "",
        status: "done",
        nodeType: "outcome",
        tags: [],
        notes: "",
        position: { x: 240, y: 40 },
        sourceRefs: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        kind: "branch",
        label: 'review "path"',
      },
    ],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

describe("svgExport", () => {
  it("renders a standalone accessible SVG with nodes and connections", () => {
    const svg = exportRoadmapToSvg(sampleRoadmap());
    assert.match(svg, /^<\?xml version="1\.0"/);
    assert.match(svg, /<svg[^>]+role="img"[^>]+aria-labelledby=/);
    assert.match(svg, /<title id="roadmap-title">Release roadmap<\/title>/);
    assert.match(svg, /Roadmap graph with 2 nodes and 1 connections/);
    assert.match(svg, /<line /);
    assert.match(svg, /branch: review &quot;path&quot;/);
  });

  it("escapes XML-sensitive text and uses the saved custom color with readable text", () => {
    const svg = exportRoadmapToSvg(sampleRoadmap());
    assert.ok(!svg.includes("<release>"));
    assert.ok(svg.includes("Plan &lt;release&gt;"));
    assert.ok(svg.includes("Ship &amp; verify"));
    assert.match(svg, /fill="#e5c116" stroke="#000000"/);
    assert.match(svg, />new<\/text>/);
  });

  it("normalizes negative manual positions into a positive viewBox and is deterministic", () => {
    const roadmap = sampleRoadmap();
    const first = exportRoadmapToSvg(roadmap);
    const second = exportRoadmapToSvg(roadmap);
    assert.strictEqual(first, second);
    assert.match(first, /viewBox="0 0 \d+ \d+"/);
    assert.ok(!first.includes(' x="-'));
    assert.ok(!first.includes(' y="-'));
  });

  it("renders a valid informative empty-state SVG", () => {
    const svg = exportRoadmapToSvg(sampleRoadmap({ nodes: [], edges: [] }));
    assert.match(svg, /Empty roadmap with no nodes or connections/);
    assert.match(svg, /No roadmap nodes yet/);
  });
});
