import { Roadmap, RoadmapEdge, RoadmapNode } from "../model/types";
import { resolveNodePositions } from "../webview/layout";
import {
  DEFAULT_NODE_BACKGROUND_FALLBACK,
  DEFAULT_NODE_FOREGROUND_FALLBACK,
  NEW_NODE_STICKER_BACKGROUND,
  NEW_NODE_STICKER_FOREGROUND,
  contrastingTextColor,
} from "../webview/nodeColor";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 96;
const MARGIN = 48;

interface SvgNode {
  node: RoadmapNode;
  x: number;
  y: number;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function wrapTitle(title: string, maxCharacters = 28, maxLines = 2): string[] {
  const words = normalizeText(title || "(untitled)")
    .split(" ")
    .flatMap((word) => {
      if (word.length <= maxCharacters) {
        return [word];
      }
      const chunks: string[] = [];
      for (let index = 0; index < word.length; index += maxCharacters) {
        chunks.push(word.slice(index, index + maxCharacters));
      }
      return chunks;
    });
  const lines: string[] = [];
  for (const word of words) {
    const current = lines[lines.length - 1];
    if (!current || current.length + word.length + 1 > maxCharacters) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  if (lines.length <= maxLines) {
    return lines;
  }
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = `${visible[maxLines - 1].slice(0, maxCharacters - 1)}…`;
  return visible;
}

function edgeStyle(edge: RoadmapEdge): { stroke: string; dash?: string } {
  if (edge.kind === "branch") {
    return { stroke: "#8a4b08", dash: "7 5" };
  }
  if (edge.kind === "manual") {
    return { stroke: "#6f42a5", dash: "5 4" };
  }
  return { stroke: "#4d4d4d" };
}

function connectorPoints(source: SvgNode, target: SvgNode): {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
} {
  const sourceCenterX = source.x + NODE_WIDTH / 2;
  const sourceCenterY = source.y + NODE_HEIGHT / 2;
  const targetCenterX = target.x + NODE_WIDTH / 2;
  const targetCenterY = target.y + NODE_HEIGHT / 2;
  const dx = targetCenterX - sourceCenterX;
  const dy = targetCenterY - sourceCenterY;
  const scale = Math.max(Math.abs(dx) / (NODE_WIDTH / 2), Math.abs(dy) / (NODE_HEIGHT / 2), 1);
  return {
    sourceX: sourceCenterX + dx / scale,
    sourceY: sourceCenterY + dy / scale,
    targetX: targetCenterX - dx / scale,
    targetY: targetCenterY - dy / scale,
  };
}

function renderNode(positioned: SvgNode): string {
  const { node, x, y } = positioned;
  const background = node.color ?? DEFAULT_NODE_BACKGROUND_FALLBACK;
  const foreground = node.color ? contrastingTextColor(node.color) : DEFAULT_NODE_FOREGROUND_FALLBACK;
  const titleLines = wrapTitle(node.title);
  const title = titleLines
    .map(
      (line, index) =>
        `<tspan x="${x + 14}" y="${y + 25 + index * 17}">${escapeXml(line)}</tspan>`
    )
    .join("");
  const metadata = `${node.nodeType ?? "topic"} · ${node.status}`;
  const newBadge = node.isNew
    ? `<g><rect x="${x + NODE_WIDTH - 48}" y="${y - 9}" width="38" height="18" rx="9" fill="${NEW_NODE_STICKER_BACKGROUND}"/><text x="${x + NODE_WIDTH - 29}" y="${y + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${NEW_NODE_STICKER_FOREGROUND}">new</text></g>`
    : "";
  return [
    "<g>",
    `<title>${escapeXml(`${node.title}. Type ${node.nodeType ?? "topic"}. Status ${node.status}.`)}</title>`,
    `<rect x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="${background}" stroke="${foreground}" stroke-width="2"/>`,
    newBadge,
    `<text font-family="Segoe UI, sans-serif" font-size="14" font-weight="600" fill="${foreground}">${title}</text>`,
    `<text x="${x + 14}" y="${y + NODE_HEIGHT - 16}" font-family="Segoe UI, sans-serif" font-size="11" fill="${foreground}">${escapeXml(metadata)}</text>`,
    "</g>",
  ].join("");
}

/** Renders a standalone, accessible SVG using the roadmap's effective saved layout. */
export function exportRoadmapToSvg(roadmap: Roadmap): string {
  if (roadmap.nodes.length === 0) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240" role="img" aria-labelledby="roadmap-title roadmap-description">',
      `<title id="roadmap-title">${escapeXml(roadmap.title || "Roadmap")}</title>`,
      '<desc id="roadmap-description">Empty roadmap with no nodes or connections.</desc>',
      '<text x="320" y="120" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="18" fill="#1f1f1f">No roadmap nodes yet.</text>',
      "</svg>",
    ].join("\n");
  }

  const rawPositions = resolveNodePositions(roadmap.nodes, roadmap.edges);
  const raw = roadmap.nodes.map((node) => ({ node, ...(rawPositions.get(node.id) ?? { x: 0, y: 0 }) }));
  const minX = Math.min(...raw.map((entry) => entry.x));
  const minY = Math.min(...raw.map((entry) => entry.y));
  const nodes: SvgNode[] = raw.map((entry) => ({
    ...entry,
    x: entry.x - minX + MARGIN,
    y: entry.y - minY + MARGIN,
  }));
  const width = Math.ceil(Math.max(...nodes.map((entry) => entry.x)) + NODE_WIDTH + MARGIN);
  const height = Math.ceil(Math.max(...nodes.map((entry) => entry.y)) + NODE_HEIGHT + MARGIN);
  const byId = new Map(nodes.map((entry) => [entry.node.id, entry]));

  const edges = roadmap.edges
    .map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) {
        return "";
      }
      const points = connectorPoints(source, target);
      const style = edgeStyle(edge);
      const label = normalizeText(edge.label ? `${edge.kind}: ${edge.label}` : edge.kind);
      const midpointX = (points.sourceX + points.targetX) / 2;
      const midpointY = (points.sourceY + points.targetY) / 2;
      const labelWidth = Math.min(180, Math.max(44, label.length * 6.5 + 12));
      return [
        `<g><title>${escapeXml(`${source.node.title} to ${target.node.title}. ${label}.`)}</title>`,
        `<line x1="${points.sourceX}" y1="${points.sourceY}" x2="${points.targetX}" y2="${points.targetY}" stroke="${style.stroke}" stroke-width="2"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""} marker-end="url(#arrow-${edge.kind})"/>`,
        `<rect x="${midpointX - labelWidth / 2}" y="${midpointY - 10}" width="${labelWidth}" height="18" rx="3" fill="#ffffff"/>`,
        `<text x="${midpointX}" y="${midpointY + 3}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="10" fill="#1f1f1f">${escapeXml(label)}</text></g>`,
      ].join("");
    })
    .join("");
  const nodeDescriptions = nodes.map((entry) => entry.node.title || "Untitled node").join(", ");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="roadmap-title roadmap-description">`,
    `<title id="roadmap-title">${escapeXml(roadmap.title || "Roadmap")}</title>`,
    `<desc id="roadmap-description">Roadmap graph with ${roadmap.nodes.length} nodes and ${roadmap.edges.length} connections. Nodes: ${escapeXml(nodeDescriptions)}.</desc>`,
    '<defs><marker id="arrow-topic" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#4d4d4d"/></marker><marker id="arrow-branch" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#8a4b08"/></marker><marker id="arrow-manual" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#6f42a5"/></marker></defs>',
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    edges,
    nodes.map(renderNode).join(""),
    "</svg>",
  ].join("\n");
}
