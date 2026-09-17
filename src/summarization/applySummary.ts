/**
 * Applies a validated model summary response to a {@link Roadmap} (Phase 4).
 *
 * `summarizeIncrementally` is the single entry point callers should use: it
 * validates the raw model output (see `summaryResponseSchema.ts`), resolves
 * every node's graph placement, and only ever returns an updated roadmap
 * when the whole response is well-formed and internally consistent. Per the
 * Key Engineering Principles - "never overwrite user-authored graph changes
 * automatically" and "invalid model output must leave the previous graph
 * unchanged" - any problem found at any stage causes the *original*
 * roadmap to be returned untouched, alongside the errors that explain why.
 */
import { CURRENT_SCHEMA_VERSION, Roadmap, RoadmapEdge, RoadmapNode, SourceReference, Turn } from "../model/types";
import { validateRoadmapDocument } from "../model/schema";
import { ExtractedNode, ModelSummaryResponse, validateModelSummaryResponse } from "./summaryResponseSchema";

/** The outcome of attempting to apply a raw model response to a roadmap. */
export interface SummarizationResult {
  /** The updated roadmap if the response was valid and applied cleanly, otherwise the original `roadmap` passed in, unchanged. */
  roadmap: Roadmap;
  /** Human-readable, path-prefixed error messages. Empty when `changed` is true. */
  errors: string[];
  /** True only when the response was valid and at least one node was created or updated. */
  changed: boolean;
}

function defaultStatus(extracted: ExtractedNode): RoadmapNode["status"] {
  return extracted.status ?? "open";
}

function mergeTags(existing: string[], incoming: string[] | undefined): string[] {
  if (!incoming || incoming.length === 0) {
    return existing;
  }
  const merged = [...existing];
  for (const tag of incoming) {
    if (!merged.includes(tag)) {
      merged.push(tag);
    }
  }
  return merged;
}

function mergeSourceRefs(existing: SourceReference[], additions: SourceReference[]): SourceReference[] {
  const merged = [...existing];
  for (const ref of additions) {
    if (!merged.some((r) => r.turnId === ref.turnId && r.sessionId === ref.sessionId)) {
      merged.push(ref);
    }
  }
  return merged;
}

/** Small, dependency-free string hash (FNV-1a) used only to derive stable, deterministic node/edge ids from their content. */
function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function newNodeId(roadmapId: string, extracted: ExtractedNode): string {
  return `node-${extracted.kind}-${stableHash(`${roadmapId}|${extracted.localId}|${extracted.sourceTurnIds.join(",")}`)}`;
}

function newEdgeId(roadmapId: string, source: string, target: string, kind: string): string {
  return `edge-${stableHash(`${roadmapId}|${source}|${target}|${kind}`)}`;
}

/**
 * Validates `rawResponse` (raw, untrusted model output) and, if valid,
 * applies it to `roadmap` given the batch of `turns` it was derived from.
 * `turns` must be exactly the turns the model was shown when producing
 * `rawResponse` (i.e. the same batch passed to `buildSummarizationPrompt`).
 *
 * Returns the original `roadmap` unchanged (with `changed: false` and a
 * non-empty `errors` list) whenever the response fails structural
 * validation, references a turn id outside `turns`, or references a
 * `targetNodeId` that cannot be resolved against the existing roadmap or
 * earlier nodes in the same response.
 */
export function summarizeIncrementally(
  roadmap: Roadmap,
  rawResponse: unknown,
  turns: Turn[]
): SummarizationResult {
  const knownTurnIds = new Set(turns.map((t) => t.id));
  const validation = validateModelSummaryResponse(rawResponse, knownTurnIds);
  if (!validation.valid || !validation.value) {
    return { roadmap, errors: validation.errors, changed: false };
  }
  const response: ModelSummaryResponse = validation.value;
  if (response.nodes.length === 0) {
    return { roadmap, errors: [], changed: false };
  }

  const turnsById = new Map(turns.map((t) => [t.id, t]));
  const existingNodeIds = new Set(roadmap.nodes.map((n) => n.id));
  // Maps a response-local id to the actual roadmap node id it resolved to
  // (either newly minted, for topic/branch, or the existing id it continues).
  const localIdToNodeId = new Map<string, string>();
  const errors: string[] = [];

  function resolveTarget(targetNodeId: string | undefined, path: string): string | undefined {
    if (targetNodeId === undefined) {
      return undefined;
    }
    if (existingNodeIds.has(targetNodeId)) {
      return targetNodeId;
    }
    const resolved = localIdToNodeId.get(targetNodeId);
    if (resolved) {
      return resolved;
    }
    pushResolutionError(path, targetNodeId);
    return undefined;
  }

  function pushResolutionError(path: string, targetNodeId: string): void {
    errors.push(
      `${path}: targetNodeId "${targetNodeId}" does not match an existing roadmap node id or an earlier node in this response`
    );
  }

  // Work on a deep copy so a failure partway through never mutates the caller's roadmap.
  const nodesById = new Map<string, RoadmapNode>(roadmap.nodes.map((n) => [n.id, { ...n }]));
  const newEdges: RoadmapEdge[] = [];
  const now = new Date().toISOString();

  response.nodes.forEach((extracted, i) => {
    const path = `response.nodes[${i}]`;
    const sourceRefs: SourceReference[] = extracted.sourceTurnIds.map((turnId) => ({
      turnId,
      sessionId: turnsById.get(turnId)!.sessionId,
    }));

    if (extracted.relation === "continue") {
      const targetId = resolveTarget(extracted.targetNodeId, path);
      if (!targetId) {
        return;
      }
      const existing = nodesById.get(targetId);
      if (!existing) {
        pushResolutionError(path, extracted.targetNodeId!);
        return;
      }
      // Conservative continuation: never touch `title`, `notes`, or
      // `position` (user-authored/user-owned fields per the domain model),
      // and only ever add tags/source refs, never remove them.
      const updated: RoadmapNode = {
        ...existing,
        summary: extracted.summary,
        status: existing.statusEdited ? existing.status : extracted.status ?? existing.status,
        tags: mergeTags(existing.tags, extracted.tags),
        sourceRefs: mergeSourceRefs(existing.sourceRefs, sourceRefs),
        updatedAt: now,
      };
      nodesById.set(targetId, updated);
      localIdToNodeId.set(extracted.localId, targetId);
      return;
    }

    // relation is "topic" or "branch": create a brand-new node.
    const resolvedTarget = resolveTarget(extracted.targetNodeId, path);
    if (extracted.targetNodeId !== undefined && !resolvedTarget) {
      // resolveTarget already recorded the error.
      return;
    }

    const nodeId = newNodeId(roadmap.id, extracted);
    const newNode: RoadmapNode = {
      id: nodeId,
      title: extracted.title,
      summary: extracted.summary,
      status: defaultStatus(extracted),
      nodeType: extracted.kind,
      tags: extracted.tags ? [...extracted.tags] : [],
      notes: "",
      sourceRefs,
      createdAt: now,
      updatedAt: now,
    };
    nodesById.set(nodeId, newNode);
    localIdToNodeId.set(extracted.localId, nodeId);

    if (resolvedTarget) {
      const edgeKind = extracted.relation === "branch" ? "branch" : "topic";
      newEdges.push({
        id: newEdgeId(roadmap.id, resolvedTarget, nodeId, edgeKind),
        source: resolvedTarget,
        target: nodeId,
        kind: edgeKind,
      });
    }
  });

  if (errors.length > 0) {
    // Any unresolved reference invalidates the whole batch - applying only
    // part of a response could silently leave the graph inconsistent.
    return { roadmap, errors, changed: false };
  }

  const updatedRoadmap: Roadmap = {
    ...roadmap,
    nodes: Array.from(nodesById.values()),
    edges: [...roadmap.edges, ...newEdges],
    updatedAt: now,
  };

  // Defense in depth: re-validate the whole document shape before trusting
  // our own construction above, so a bug here can never corrupt the graph.
  const docValidation = validateRoadmapDocument({ version: CURRENT_SCHEMA_VERSION, roadmaps: [updatedRoadmap] });
  if (!docValidation.valid) {
    return { roadmap, errors: docValidation.errors, changed: false };
  }

  return { roadmap: updatedRoadmap, errors: [], changed: true };
}
