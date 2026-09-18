import { Roadmap, Turn } from "../model/types";
import { ExtractedNode, ModelSummaryResponse } from "./summaryResponseSchema";

export function isQuestionRequest(request: string): boolean {
  return request.trim().length > 0;
}

function questionKey(request: string): string {
  return request
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function compact(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function uniqueLocalId(prefix: string, used: Set<string>): string {
  let candidate = prefix;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${prefix}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function responseParentForTurn(response: ModelSummaryResponse, turnId: string): string | undefined {
  const parent = response.nodes.find(
    (node) => node.sourceTurnIds.includes(turnId) && node.kind === "topic"
  );
  if (!parent) {
    return undefined;
  }
  return parent.relation === "continue" ? parent.targetNodeId : parent.localId;
}

function latestTopicId(roadmap: Roadmap): string | undefined {
  return [...roadmap.nodes]
    .filter((node) => (node.nodeType ?? "topic") === "topic")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id;
}

function existingQuestionKeys(roadmap: Roadmap, allTurns: readonly Turn[]): Set<string> {
  const turnsById = new Map(allTurns.map((turn) => [turn.id, turn]));
  const keys = new Set<string>();
  for (const node of roadmap.nodes) {
    if (node.nodeType !== "question") {
      continue;
    }
    for (const reference of node.sourceRefs) {
      const turn = turnsById.get(reference.turnId);
      if (turn) {
        keys.add(questionKey(turn.request));
      }
    }
  }
  return keys;
}

function createdNodeCoversTurn(response: ModelSummaryResponse, turnId: string): boolean {
  return response.nodes.some(
    (node) => node.relation !== "continue" && node.sourceTurnIds.includes(turnId)
  );
}

/**
 * Guarantees that each distinct question-shaped request receives a created
 * question node. The model still decides whether the parent topic continues or
 * changes; this function only prevents a question from disappearing into a
 * topic continuation.
 */
export function ensureQuestionNodes(
  response: ModelSummaryResponse,
  turns: readonly Turn[],
  sessionRoadmap: Roadmap,
  allTurns: readonly Turn[]
): ModelSummaryResponse {
  const nodes: ExtractedNode[] = response.nodes.map((node) => ({
    ...node,
    sourceTurnIds: [...node.sourceTurnIds],
    tags: node.tags ? [...node.tags] : undefined,
  }));
  const usedLocalIds = new Set(nodes.map((node) => node.localId));
  const knownQuestionKeys = existingQuestionKeys(sessionRoadmap, allTurns);

  for (const turn of turns) {
    if (!isQuestionRequest(turn.request)) {
      continue;
    }
    const key = questionKey(turn.request);
    if (!key || knownQuestionKeys.has(key)) {
      continue;
    }
    // The first resumed response is folded into its pre-created placeholder,
    // so that existing node already represents this request.
    if (turn.resumeNodeId) {
      knownQuestionKeys.add(key);
      continue;
    }
    if (createdNodeCoversTurn(response, turn.id)) {
      knownQuestionKeys.add(key);
      continue;
    }

    let parentId = responseParentForTurn(response, turn.id) ?? latestTopicId(sessionRoadmap);
    if (!parentId) {
      const topicLocalId = uniqueLocalId(`auto-topic-${turn.id}`, usedLocalIds);
      nodes.push({
        localId: topicLocalId,
        kind: "topic",
        title: compact(turn.request, 72),
        summary: compact(turn.response, 240) || "Conversation topic for this question.",
        sourceTurnIds: [turn.id],
        relation: "topic",
      });
      knownQuestionKeys.add(key);
      continue;
    }

    nodes.push({
      localId: uniqueLocalId(`auto-question-${turn.id}`, usedLocalIds),
      kind: "question",
      title: compact(turn.request, 96),
      summary: compact(turn.response, 320) || "Captured user question.",
      sourceTurnIds: [turn.id],
      relation: "topic",
      targetNodeId: parentId,
    });
    knownQuestionKeys.add(key);
  }

  return { schemaVersion: 1, nodes };
}

export interface QuestionBackfill {
  response: ModelSummaryResponse;
  turns: Turn[];
}

/**
 * Builds deterministic summary operations for question turns that are already
 * referenced by a topic but do not yet have their own question node.
 */
export function buildQuestionBackfill(
  sessionRoadmap: Roadmap,
  sessionTurns: readonly Turn[],
  allTurns: readonly Turn[]
): QuestionBackfill {
  const represented = existingQuestionKeys(sessionRoadmap, allTurns);
  const referencedTurnIds = new Set(
    sessionRoadmap.nodes.flatMap((node) => node.sourceRefs.map((reference) => reference.turnId))
  );
  const topicOriginTurnIds = new Set(
    sessionRoadmap.nodes
      .filter((node) => (node.nodeType ?? "topic") === "topic")
      .map((node) => node.sourceRefs[0]?.turnId)
      .filter((turnId): turnId is string => Boolean(turnId))
  );
  const turns = sessionTurns.filter((turn) => {
    const key = questionKey(turn.request);
    return (
      referencedTurnIds.has(turn.id) &&
      !topicOriginTurnIds.has(turn.id) &&
      isQuestionRequest(turn.request) &&
      key.length > 0 &&
      !represented.has(key)
    );
  });
  const seedNodes: ExtractedNode[] = [];

  for (const turn of turns) {
    const parent =
      sessionRoadmap.nodes.find(
        (node) =>
          (node.nodeType ?? "topic") === "topic" &&
          node.sourceRefs.some(
            (reference) =>
              reference.turnId === turn.id && reference.sessionId === turn.sessionId
          )
      ) ??
      [...sessionRoadmap.nodes]
        .filter((node) => (node.nodeType ?? "topic") === "topic")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!parent) {
      continue;
    }
    seedNodes.push({
      localId: `backfill-topic-${turn.id}`,
      kind: "topic",
      title: parent.title || "Conversation topic",
      summary: parent.summary.trim() || compact(turn.response, 240) || "Existing conversation topic.",
      sourceTurnIds: [turn.id],
      relation: "continue",
      targetNodeId: parent.id,
    });
  }

  const response = ensureQuestionNodes(
    { schemaVersion: 1, nodes: seedNodes },
    turns,
    sessionRoadmap,
    allTurns
  );
  return { response, turns: [...turns] };
}
