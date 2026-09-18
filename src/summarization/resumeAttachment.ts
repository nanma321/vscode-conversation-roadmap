import { Roadmap, Turn } from "../model/types";
import { ExtractedNode, ModelSummaryResponse } from "./summaryResponseSchema";

function isResumePlaceholder(roadmap: Roadmap, nodeId: string): boolean {
  return (
    roadmap.nodes.some((node) => node.id === nodeId) &&
    roadmap.edges.some(
      (edge) =>
        edge.target === nodeId &&
        edge.kind === "branch" &&
        edge.label === "resume"
    )
  );
}

function latestBranchTip(roadmap: Roadmap, rootNodeId: string): string {
  const distance = new Map<string, number>([[rootNodeId, 0]]);
  const queue = [rootNodeId];
  while (queue.length > 0) {
    const source = queue.shift()!;
    const nextDistance = (distance.get(source) ?? 0) + 1;
    for (const edge of roadmap.edges.filter((candidate) => candidate.source === source)) {
      if (!distance.has(edge.target)) {
        distance.set(edge.target, nextDistance);
        queue.push(edge.target);
      }
    }
  }
  return [...roadmap.nodes]
    .reverse()
    .filter((node) => distance.has(node.id))
    .sort((left, right) => {
      const depth = (distance.get(right.id) ?? 0) - (distance.get(left.id) ?? 0);
      return depth || right.updatedAt.localeCompare(left.updatedAt);
    })[0]?.id ?? rootNodeId;
}

/**
 * Reparents the primary model result for each resumed turn beneath its
 * pre-created resume placeholder. A forged or stale marker is ignored unless
 * it references a real target of a `branch`/`resume` edge.
 */
export function attachResumeTurns(
  response: ModelSummaryResponse,
  turns: readonly Turn[],
  roadmap: Roadmap
): ModelSummaryResponse {
  const nodes: ExtractedNode[] = response.nodes.map((node) => ({
    ...node,
    sourceTurnIds: [...node.sourceTurnIds],
    tags: node.tags ? [...node.tags] : undefined,
  }));
  const nextTargetByBranch = new Map<string, string>();

  for (const turn of turns) {
    const branchRootNodeId = turn.branchRootNodeId ?? turn.resumeNodeId;
    if (!branchRootNodeId || !isResumePlaceholder(roadmap, branchRootNodeId)) {
      continue;
    }
    const targetNodeId = turn.resumeNodeId
      ? branchRootNodeId
      : nextTargetByBranch.get(branchRootNodeId) ??
        latestBranchTip(roadmap, branchRootNodeId);
    const candidates = nodes.filter((node) => node.sourceTurnIds.includes(turn.id));
    let primary = candidates.find((node) => node.kind === "topic") ?? candidates[0];
    if (!primary && turn.resumeNodeId) {
      primary = {
        localId: `resume-response-${turn.id}`,
        kind: "topic",
        title: roadmap.nodes.find((node) => node.id === branchRootNodeId)?.title ?? "Resumed conversation",
        summary: turn.response.trim() || "Resumed conversation response.",
        sourceTurnIds: [turn.id],
        relation: "continue",
        targetNodeId,
      };
      nodes.push(primary);
      candidates.push(primary);
    }
    if (!primary) {
      continue;
    }
    primary.relation = turn.resumeNodeId ? "continue" : "topic";
    primary.targetNodeId = targetNodeId;
    const responseLocalIds = new Set(candidates.map((node) => node.localId));
    for (const candidate of candidates) {
      if (
        candidate === primary ||
        !candidate.targetNodeId ||
        responseLocalIds.has(candidate.targetNodeId)
      ) {
        continue;
      }
      candidate.relation = "topic";
      candidate.targetNodeId = turn.resumeNodeId ? branchRootNodeId : primary.localId;
    }
    if (!turn.resumeNodeId) {
      nextTargetByBranch.set(branchRootNodeId, primary.localId);
    }
  }

  return { schemaVersion: 1, nodes };
}
