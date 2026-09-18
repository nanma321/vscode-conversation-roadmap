/**
 * Markdown outline export (Phase 8).
 *
 * Renders a {@link Roadmap} as a nested Markdown bullet list using the same
 * roots-first, depth-first traversal as the Webview's accessible outline
 * view (`buildRoadmapOutline`, shared via `outline.ts`), so the exported
 * document's structure always matches what a user sees in the outline
 * view. Unlike the JSON export/import path, this is a one-way, read-only
 * rendering meant for sharing/archiving outside the extension - there is no
 * corresponding Markdown import.
 */
import { buildRoadmapOutline } from "./outline";
import { Roadmap, RoadmapNode } from "./types";

function escapeMarkdown(text: string): string {
  // Escape characters that would otherwise be interpreted as Markdown
  // formatting (emphasis, headings, etc.) so node text round-trips as
  // plain text when rendered.
  return text.replace(/([\\`*_{}[\]()#+\-.!>|])/g, "\\$1");
}

function formatNodeLine(node: RoadmapNode): string {
  const type = node.nodeType ?? "topic";
  const parts = [`**${escapeMarkdown(node.title || "(untitled)")}**`, `_(${type} · ${node.status})_`];
  if (node.highlighted) {
    parts.push("⭐");
  }
  return parts.join(" ");
}

function escapeMermaidText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;")
    .replace(/`/g, "&#96;")
    .replace(/\r?\n/g, " ");
}

/** Produces a Mermaid flowchart using generated aliases so persisted ids/text cannot alter Mermaid syntax. */
export function exportRoadmapToMermaid(roadmap: Roadmap): string {
  if (roadmap.nodes.length === 0) {
    return "_No graph nodes yet._";
  }

  const aliases = new Map(roadmap.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = ["```mermaid", "flowchart LR"];
  for (const node of roadmap.nodes) {
    const alias = aliases.get(node.id)!;
    const title = escapeMermaidText(node.title || "(untitled)");
    const metadata = escapeMermaidText(`${node.nodeType ?? "topic"} · ${node.status}`);
    lines.push(`  ${alias}["${title}<br/>${metadata}"]`);
  }
  for (const edge of roadmap.edges) {
    const source = aliases.get(edge.source);
    const target = aliases.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const label = escapeMermaidText(edge.label ? `${edge.kind}: ${edge.label}` : edge.kind);
    const connector = edge.kind === "branch" ? "-.->" : "-->";
    lines.push(`  ${source} ${connector}|${label}| ${target}`);
  }
  lines.push("```");
  return lines.join("\n");
}

/**
 * Renders `roadmap` as a Markdown document containing a Mermaid graph and a
 * readable nested outline. The outline uses one bullet per node (indented
 * two spaces per depth level) and includes type, status, tags, summary, and
 * notes when present.
 */
export function exportRoadmapToMarkdown(roadmap: Roadmap): string {
  const entries = buildRoadmapOutline(roadmap);
  const lines: string[] = [
    `# ${escapeMarkdown(roadmap.title || "Roadmap")}`,
    "",
    "## Graph",
    "",
    exportRoadmapToMermaid(roadmap),
    "",
    "## Outline",
    "",
  ];

  if (entries.length === 0) {
    lines.push("_No nodes yet._");
    return lines.join("\n").trimEnd() + "\n";
  }

  for (const { node, depth } of entries) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- ${formatNodeLine(node)}`);
    const detailIndent = `${indent}  `;
    if (node.tags.length > 0) {
      lines.push(`${detailIndent}Tags: ${node.tags.map(escapeMarkdown).join(", ")}`);
    }
    if (node.summary.trim().length > 0) {
      lines.push(`${detailIndent}Summary: ${escapeMarkdown(node.summary.trim())}`);
    }
    if (node.notes.trim().length > 0) {
      lines.push(`${detailIndent}Notes: ${escapeMarkdown(node.notes.trim())}`);
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
