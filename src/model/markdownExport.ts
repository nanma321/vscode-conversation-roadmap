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

/**
 * Renders `roadmap` as a Markdown document: a top-level heading with the
 * roadmap's title, followed by one nested bullet per node (indented two
 * spaces per depth level, matching the outline view's nesting), each
 * showing the node's type, status, tags, summary, and notes when present.
 */
export function exportRoadmapToMarkdown(roadmap: Roadmap): string {
  const entries = buildRoadmapOutline(roadmap);
  const lines: string[] = [`# ${escapeMarkdown(roadmap.title || "Roadmap")}`, ""];

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
