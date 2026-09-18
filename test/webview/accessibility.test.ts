import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { createDefaultSettings, Roadmap, RoadmapNode } from "../../src/model/types";
import { describeRoadmapNode } from "../../src/webview/accessibility";

const NOW = "2026-09-18T00:00:00.000Z";

function node(id: string, title: string, overrides: Partial<RoadmapNode> = {}): RoadmapNode {
  return {
    id,
    title,
    summary: "",
    status: "open",
    nodeType: "topic",
    tags: [],
    notes: "",
    sourceRefs: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("Webview accessibility", () => {
  it("describes node name, type, status, state, and relationships", () => {
    const selected = node("node-2", "Implementation", {
      status: "in-progress",
      nodeType: "task",
      highlighted: true,
      isNew: true,
    });
    const roadmap: Roadmap = {
      id: "roadmap-1",
      title: "Accessibility",
      createdAt: NOW,
      updatedAt: NOW,
      nodes: [node("node-1", "Planning"), selected, node("node-3", "Validation")],
      edges: [
        { id: "edge-1", source: "node-1", target: "node-2", kind: "topic" },
        { id: "edge-2", source: "node-2", target: "node-3", kind: "topic" },
      ],
      settings: createDefaultSettings(),
    };

    const description = describeRoadmapNode(roadmap, selected);
    assert.match(description, /Implementation/);
    assert.match(description, /Type task/);
    assert.match(description, /Status in-progress/);
    assert.match(description, /New/);
    assert.match(description, /Important/);
    assert.match(description, /From Planning/);
    assert.match(description, /To Validation/);
  });

  it("defines visible focus and reduced-motion rules in the bundled Webview stylesheet source", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../src/webview/styles.css"),
      "utf8"
    );
    assert.match(css, /:focus-visible/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /\.react-flow__edge\.animated path/);
    assert.match(css, /\.roadmap-edge \.react-flow__edge-path\s*\{[^}]*stroke-width:\s*2\.5/s);
    assert.match(css, /\.roadmap-flow-node\s*\{[^}]*width:\s*220px/s);
    assert.match(css, /\.tag\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });
});
