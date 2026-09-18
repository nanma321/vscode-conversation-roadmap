import { Roadmap, RoadmapNode } from "../model/types";

/** Builds a concise accessible name including node metadata and relationships. */
export function describeRoadmapNode(roadmap: Roadmap, node: RoadmapNode): string {
  const incoming = roadmap.edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => roadmap.nodes.find((candidate) => candidate.id === edge.source)?.title)
    .filter((title): title is string => Boolean(title));
  const outgoing = roadmap.edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => roadmap.nodes.find((candidate) => candidate.id === edge.target)?.title)
    .filter((title): title is string => Boolean(title));
  const relationships = [
    incoming.length > 0 ? `From ${incoming.join(", ")}` : "",
    outgoing.length > 0 ? `To ${outgoing.join(", ")}` : "",
  ].filter((value) => value.length > 0);

  return [
    node.title || "Untitled node",
    `Type ${node.nodeType ?? "topic"}`,
    `Status ${node.status}`,
    node.isNew ? "New" : "",
    node.highlighted ? "Important" : "",
    ...relationships,
  ]
    .filter((value) => value.length > 0)
    .join(". ");
}
