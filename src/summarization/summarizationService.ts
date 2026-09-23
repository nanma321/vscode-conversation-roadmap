/**
 * Runtime orchestration that turns captured `@roadmap` turns into roadmap
 * graph nodes (wiring for Phase 4's summarization).
 *
 * Phases 4 and 5 built the summarizer (`applySummary.ts`, `prompt.ts`) and the
 * graph that renders {@link RoadmapStore} nodes, but nothing connected capture
 * to summarization, so newly captured turns never became graph nodes. This
 * service is that connection: given the batch of not-yet-summarized turns, it
 * builds the summarization prompt, asks a language model (injected as
 * `requestSummary` so this module stays free of any `vscode` dependency and is
 * unit-testable), and applies the validated response to the default roadmap via
 * {@link summarizeIncrementally}, persisting the result.
 *
 * Safety properties inherited from the modules it composes:
 *   - invalid or malformed model output leaves the roadmap unchanged, and
 *   - user-authored fields are never overwritten.
 * It additionally guarantees only one summarization runs at a time (concurrent
 * requests are chained), that failed turns receive at most a small bounded
 * number of model attempts before a deterministic fallback is persisted, and
 * that each chat session is summarized against only its own existing nodes so
 * a new chat starts its own sub-graph instead of being linked onto an earlier
 * session.
 */
import { RoadmapStore, RoadmapStoreAccess } from "../model/roadmapStore";
import { loadDefaultRoadmap, saveRoadmap } from "../model/defaultRoadmap";
import { Roadmap, RoadmapNode, Turn } from "../model/types";
import type { TurnStore, TurnRecord } from "../turnStore";
import { buildSummarizationPrompt } from "./prompt";
import { summarizeIncrementally, SummarizationResult } from "./applySummary";
import { buildQuestionBackfill, ensureQuestionNodes } from "./ensureQuestionNodes";
import {
  ModelSummaryResponse,
  validateModelSummaryResponse,
} from "./summaryResponseSchema";
import { attachResumeTurns } from "./resumeAttachment";

/** Signature of the injected model call: takes the prompt, returns the model's raw text response. */
export type RequestSummary = (prompt: string) => Promise<string>;

/** One initial model call plus one later retry before deterministic fallback. */
export const MAX_SUMMARIZATION_ATTEMPTS = 2;

export type SummarizationFailureStage =
  | "request"
  | "json"
  | "schema"
  | "apply";

export interface SummarizationFailureDetail {
  sessionId: string;
  turnIds: string[];
  attempt: number;
  maxAttempts: number;
  stage: SummarizationFailureStage;
  message: string;
  willRetry: boolean;
}

export interface SummarizationFallbackDetail {
  sessionId: string;
  turnId: string;
  nodeId: string;
  reason: string;
}

/** Outcome of a summarization attempt. */
export interface SummarizeOutcome {
  /** True if the roadmap was changed and persisted. */
  changed: boolean;
  /** The (possibly updated) default roadmap. */
  roadmap: Roadmap;
  /** Validation/parse errors, if any. */
  errors: string[];
  /** Structured model/validation failures from this run. */
  failures: SummarizationFailureDetail[];
  /** Source-linked fallback nodes created after retry exhaustion. */
  fallbacks: SummarizationFallbackDetail[];
}

/** Strips a leading/trailing Markdown code fence the model may wrap its JSON in, then parses. Returns undefined on failure. */
function parseModelJson(raw: string): unknown {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) {
    text = fence[1].trim();
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Converts a persisted {@link TurnRecord} to the domain-model {@link Turn} shape the summarizer expects. */
function toTurn(record: TurnRecord): Turn {
  return {
    id: record.id,
    sessionId: record.sessionId,
    timestamp: record.timestamp,
    request: record.request,
    response: record.response,
    completed: record.completed,
    resumeNodeId: record.resumeNodeId,
    references: record.references ?? [],
  };
}

function toTurnsWithResumeAffinity(records: readonly TurnRecord[]): Turn[] {
  const activeResumeBySession = new Map<string, string>();
  return records.map((record) => {
    if (record.resumeNodeId) {
      activeResumeBySession.set(record.sessionId, record.resumeNodeId);
    }
    return {
      ...toTurn(record),
      branchRootNodeId: activeResumeBySession.get(record.sessionId),
    };
  });
}

/**
 * A view of `roadmap` containing only the nodes derived from `sessionId` (and
 * the edges among them). Used as the *existing graph* shown to the model when
 * summarizing that session, so the model can only continue/branch within the
 * same chat and a new chat therefore starts its own sub-graph. Nodes without
 * any source turns (e.g. resume branches) carry no session and are excluded
 * from this context.
 */
function sessionScopedRoadmap(
  roadmap: Roadmap,
  sessionId: string,
  resumeNodeIds: readonly string[] = []
): Roadmap {
  const resumedFrom = new Set(resumeNodeIds);
  const nodes = roadmap.nodes.filter(
    (node) =>
      resumedFrom.has(node.id) ||
      node.sourceRefs.some((reference) => reference.sessionId === sessionId)
  );
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges = roadmap.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
  return { ...roadmap, nodes, edges };
}

function referencedTurnIds(roadmap: Roadmap): Set<string> {
  return new Set(
    roadmap.nodes.flatMap((node) => node.sourceRefs.map((reference) => reference.turnId))
  );
}

function validateSessionTargets(
  response: ModelSummaryResponse,
  scopedRoadmap: Roadmap,
  fullRoadmap: Roadmap
): string[] {
  const allowedTargets = new Set(scopedRoadmap.nodes.map((node) => node.id));
  const allExistingNodeIds = new Set(fullRoadmap.nodes.map((node) => node.id));
  const earlierLocalIds = new Set<string>();
  const errors: string[] = [];
  response.nodes.forEach((node, index) => {
    if (allExistingNodeIds.has(node.localId)) {
      errors.push(
        `response.nodes[${index}].localId: "${node.localId}" collides with an existing roadmap node id`
      );
    }
    if (
      node.targetNodeId &&
      !allowedTargets.has(node.targetNodeId) &&
      !earlierLocalIds.has(node.targetNodeId)
    ) {
      errors.push(
        `response.nodes[${index}].targetNodeId: "${node.targetNodeId}" is outside the current chat session`
      );
    }
    earlierLocalIds.add(node.localId);
  });
  return errors;
}

function fallbackNodeId(roadmap: Roadmap, turnId: string): string {
  const safeTurnId = turnId.replace(/[^A-Za-z0-9._:-]/g, "-");
  const base = `fallback-${safeTurnId}`;
  const used = new Set(roadmap.nodes.map((node) => node.id));
  if (!used.has(base)) {
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function addFallbackNode(
  roadmap: Roadmap,
  turn: TurnRecord,
  reason: string
): { roadmap: Roadmap; detail: SummarizationFallbackDetail } {
  const nodeId = fallbackNodeId(roadmap, turn.id);
  const timestamp = turn.timestamp || new Date().toISOString();
  const node: RoadmapNode = {
    id: nodeId,
    title: "Automatic summary unavailable",
    summary:
      `Automatic summarization failed after ${MAX_SUMMARIZATION_ATTEMPTS} attempts. ` +
      "Review the linked source turn for the original request and response.",
    status: "open",
    tags: [],
    notes: "",
    sourceRefs: [{ turnId: turn.id, sessionId: turn.sessionId }],
    createdAt: timestamp,
    updatedAt: timestamp,
    isNew: true,
  };
  return {
    roadmap: {
      ...roadmap,
      nodes: [
        ...roadmap.nodes.map((existing) =>
          existing.isNew ? { ...existing, isNew: false } : existing
        ),
        node,
      ],
      updatedAt: timestamp,
    },
    detail: {
      sessionId: turn.sessionId,
      turnId: turn.id,
      nodeId,
      reason,
    },
  };
}

function emptyOutcome(roadmap: Roadmap): SummarizeOutcome {
  return {
    changed: false,
    roadmap,
    errors: [],
    failures: [],
    fallbacks: [],
  };
}

export class SummarizationService {
  /** Serializes summarization runs so overlapping captures cannot race on the roadmap document. */
  private queue: Promise<SummarizeOutcome> = Promise.resolve({
    changed: false,
    roadmap: undefined as unknown as Roadmap,
    errors: [],
    failures: [],
    fallbacks: [],
  });

  constructor(
    private readonly turnStore: TurnStore,
    private readonly roadmapStore: RoadmapStore,
    private readonly requestSummary: RequestSummary
  ) {}

  /**
   * Summarizes any captured turns not yet reflected in the roadmap, appending
   * new nodes/edges to the default roadmap and persisting them. Runs are
   * serialized: calling this while a previous run is in flight queues behind it.
   */
  summarizeNewTurns(): Promise<SummarizeOutcome> {
    this.queue = this.queue.then(
      () => this.runOnce(),
      () => this.runOnce()
    );
    return this.queue;
  }

  /** Repairs existing collapsed questions without invoking the language model. */
  backfillExistingQuestions(): Promise<SummarizeOutcome> {
    const backfill = (): Promise<SummarizeOutcome> =>
      this.roadmapStore.transaction(async (store) => {
        const roadmap = await loadDefaultRoadmap(store);
        if (!roadmap.settings.autoSummarize) {
          return emptyOutcome(roadmap);
        }
        const outcome = this.applyQuestionBackfill(
          roadmap,
          this.turnStore.getAll()
        );
        if (outcome.changed) {
          await saveRoadmap(store, outcome.roadmap);
        }
        return outcome;
      });
    this.queue = this.queue.then(backfill, backfill);
    return this.queue;
  }

  /**
   * Serializes graph clearing behind any active summarization, preserving raw
   * transcripts while ensuring all turns present at clear time stay excluded
   * after reload and cannot repopulate the graph.
   */
  clearAllRoadmaps(): Promise<Roadmap> {
    const clear = async (): Promise<SummarizeOutcome> => {
      await this.turnStore.excludeAllFromRoadmap();
      return this.roadmapStore.transaction(async (store) => {
        await store.deleteAll();
        const roadmap = await loadDefaultRoadmap(store);
        return { ...emptyOutcome(roadmap), changed: true };
      });
    };
    this.queue = this.queue.then(clear, clear);
    return this.queue.then((outcome) => outcome.roadmap);
  }

  private runOnce(): Promise<SummarizeOutcome> {
    return this.roadmapStore.transaction((store) =>
      this.runOnceInTransaction(store)
    );
  }

  private async runOnceInTransaction(
    roadmapStore: RoadmapStoreAccess
  ): Promise<SummarizeOutcome> {
    const roadmap = await loadDefaultRoadmap(roadmapStore);

    // Respect the user's per-roadmap preference; if auto-summarize is off, do
    // nothing (the user can still build the graph via manual edits/import).
    if (!roadmap.settings.autoSummarize) {
      return emptyOutcome(roadmap);
    }

    // Refresh under the roadmap transaction so another VS Code window's
    // appended turns and persisted retry reservations are observed before a
    // new model call is considered.
    await this.turnStore.load();
    const allTurns = this.turnStore.getAll();
    const backfill = this.applyQuestionBackfill(roadmap, allTurns);
    let currentRoadmap = backfill.roadmap;
    let changedAny = backfill.changed;
    const errors: string[] = [...backfill.errors];
    const failures: SummarizationFailureDetail[] = [];
    const fallbacks: SummarizationFallbackDetail[] = [];
    const domainTurns = toTurnsWithResumeAffinity(allTurns);
    const domainTurnsById = new Map(domainTurns.map((turn) => [turn.id, turn]));

    const referenced = referencedTurnIds(currentRoadmap);
    const unrepresented = allTurns.filter(
      (t) =>
        t.completed &&
        !t.roadmapExcluded &&
        !referenced.has(t.id)
    );
    if (unrepresented.length === 0) {
      if (changedAny) {
        await saveRoadmap(roadmapStore, currentRoadmap);
      }
      return {
        changed: changedAny,
        roadmap: currentRoadmap,
        errors,
        failures,
        fallbacks,
      };
    }

    // A prior run may have spent the final attempt but failed before the graph
    // could be saved. Repair those turns without another model call.
    for (const turn of unrepresented.filter(
      (candidate) =>
        (candidate.summarizationAttempts ?? 0) >= MAX_SUMMARIZATION_ATTEMPTS
    )) {
      const fallback = addFallbackNode(
        currentRoadmap,
        turn,
        "The persisted summarization retry limit had already been reached."
      );
      currentRoadmap = fallback.roadmap;
      fallbacks.push(fallback.detail);
      changedAny = true;
    }

    const pending = unrepresented.filter(
      (turn) => (turn.summarizationAttempts ?? 0) < MAX_SUMMARIZATION_ATTEMPTS
    );

    // Summarize one session at a time. Each session's prompt is given only the
    // nodes from that *same* session as existing context, so a new chat starts
    // its own sub-graph instead of the model linking (continuing/branching) the
    // new turns onto an unrelated earlier session's nodes. Changes still apply
    // to the full roadmap, so other sessions' nodes are preserved.
    for (const sessionId of this.orderedSessionIds(pending)) {
      const sessionTurns = pending
        .filter((turn) => turn.sessionId === sessionId)
        .map((turn) => domainTurnsById.get(turn.id))
        .filter((turn): turn is Turn => Boolean(turn));
      const scopedRoadmap = sessionScopedRoadmap(
        currentRoadmap,
        sessionId,
        sessionTurns
          .map((turn) => turn.branchRootNodeId)
          .filter((nodeId): nodeId is string => Boolean(nodeId))
      );
      const prompt = buildSummarizationPrompt(sessionTurns, scopedRoadmap);

      const nextAttempts = new Map(
        sessionTurns.map((turn) => [
          turn.id,
          (allTurns.find((candidate) => candidate.id === turn.id)
            ?.summarizationAttempts ?? 0) + 1,
        ])
      );
      // Reserve every attempt durably before the model call. The reservation
      // is not a completion marker: the turn remains pending until a graph
      // node or fallback is persisted.
      await this.turnStore.setSummarizationAttempts(nextAttempts);

      let rawResponse: string | undefined;
      let failureStage: SummarizationFailureStage | undefined;
      let failureMessage: string | undefined;
      try {
        rawResponse = await this.requestSummary(prompt);
      } catch (err) {
        failureStage = "request";
        failureMessage = `summarization request failed for ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      if (!failureStage) {
        const parsed = parseModelJson(rawResponse as string);
        if (parsed === undefined) {
          failureStage = "json";
          failureMessage = `summarization response for ${sessionId} was not valid JSON`;
        } else {
          const validation = validateModelSummaryResponse(
            parsed,
            new Set(sessionTurns.map((turn) => turn.id))
          );
          if (!validation.valid || !validation.value) {
            failureStage = "schema";
            failureMessage = validation.errors.join("; ");
          } else {
            const response = ensureQuestionNodes(
              attachResumeTurns(validation.value, sessionTurns, currentRoadmap),
              sessionTurns,
              scopedRoadmap,
              domainTurns
            );
            const targetErrors = validateSessionTargets(
              response,
              scopedRoadmap,
              currentRoadmap
            );
            if (targetErrors.length > 0) {
              failureStage = "schema";
              failureMessage = targetErrors.join("; ");
            } else {
              const result: SummarizationResult = summarizeIncrementally(
                currentRoadmap,
                response,
                sessionTurns
              );
              if (result.changed) {
                currentRoadmap = result.roadmap;
                changedAny = true;
              } else {
                failureStage = "apply";
                failureMessage =
                  result.errors.join("; ") ||
                  `summarization response for ${sessionId} did not update the roadmap`;
              }
            }
          }
        }
      }

      const representedAfterAttempt = referencedTurnIds(currentRoadmap);
      const missingTurns = sessionTurns.filter(
        (turn) => !representedAfterAttempt.has(turn.id)
      );
      if (missingTurns.length > 0 && !failureStage) {
        failureStage = "apply";
        failureMessage =
          `summarization response for ${sessionId} omitted ` +
          `${missingTurns.length} completed turn(s)`;
      }
      if (missingTurns.length === 0) {
        continue;
      }

      const detailMessage =
        failureMessage ?? `summarization failed for ${sessionId}`;
      errors.push(detailMessage);
      const turnsByAttempt = new Map<number, Turn[]>();
      for (const turn of missingTurns) {
        const attempt = nextAttempts.get(turn.id) ?? 1;
        const sameAttempt = turnsByAttempt.get(attempt) ?? [];
        sameAttempt.push(turn);
        turnsByAttempt.set(attempt, sameAttempt);
      }

      for (const [attempt, failedTurns] of turnsByAttempt) {
        const willRetry = attempt < MAX_SUMMARIZATION_ATTEMPTS;
        failures.push({
          sessionId,
          turnIds: failedTurns.map((turn) => turn.id),
          attempt,
          maxAttempts: MAX_SUMMARIZATION_ATTEMPTS,
          stage: failureStage ?? "apply",
          message: detailMessage,
          willRetry,
        });
        if (!willRetry) {
          for (const failedTurn of failedTurns) {
            const sourceTurn = allTurns.find((turn) => turn.id === failedTurn.id);
            if (!sourceTurn) {
              continue;
            }
            const fallback = addFallbackNode(
              currentRoadmap,
              sourceTurn,
              detailMessage
            );
            currentRoadmap = fallback.roadmap;
            fallbacks.push(fallback.detail);
            changedAny = true;
          }
        }
      }
    }

    if (!changedAny) {
      return {
        changed: false,
        roadmap: currentRoadmap,
        errors,
        failures,
        fallbacks,
      };
    }

    await saveRoadmap(roadmapStore, currentRoadmap);
    return {
      changed: true,
      roadmap: currentRoadmap,
      errors,
      failures,
      fallbacks,
    };
  }

  private applyQuestionBackfill(
    roadmap: Roadmap,
    allTurns: TurnRecord[]
  ): SummarizeOutcome {
    const eligibleTurnIds = new Set(
      allTurns
        .filter((turn) => turn.completed && !turn.roadmapExcluded)
        .map((turn) => turn.id)
    );
    const allDomainTurns = toTurnsWithResumeAffinity(allTurns).filter((turn) =>
      eligibleTurnIds.has(turn.id)
    );
    let currentRoadmap = roadmap;
    let changed = false;
    const errors: string[] = [];

    for (const sessionId of this.orderedSessionIds(
      allTurns.filter((turn) => turn.completed && !turn.roadmapExcluded)
    )) {
      const sessionTurns = allDomainTurns.filter((turn) => turn.sessionId === sessionId);
      const scopedRoadmap = sessionScopedRoadmap(
        currentRoadmap,
        sessionId,
        sessionTurns
          .map((turn) => turn.branchRootNodeId)
          .filter((nodeId): nodeId is string => Boolean(nodeId))
      );
      const backfill = buildQuestionBackfill(scopedRoadmap, sessionTurns, allDomainTurns);
      if (backfill.turns.length === 0) {
        continue;
      }
      const result = summarizeIncrementally(
        currentRoadmap,
        backfill.response,
        backfill.turns
      );
      if (result.changed) {
        currentRoadmap = result.roadmap;
        changed = true;
      } else {
        errors.push(...result.errors);
      }
    }

    return {
      changed,
      roadmap: currentRoadmap,
      errors,
      failures: [],
      fallbacks: [],
    };
  }

  /** The distinct session ids present in `turns`, in first-appearance order. */
  private orderedSessionIds(turns: TurnRecord[]): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const t of turns) {
      if (!seen.has(t.sessionId)) {
        seen.add(t.sessionId);
        order.push(t.sessionId);
      }
    }
    return order;
  }
}
