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
 * requests are chained), that a turn is attempted at most once (so a turn the
 * model chooses not to reference does not trigger repeated work), and that each
 * chat session is summarized against only its own existing nodes so a new chat
 * starts its own sub-graph instead of being linked onto an earlier session.
 */
import { RoadmapStore } from "../model/roadmapStore";
import { loadDefaultRoadmap, saveRoadmap } from "../model/defaultRoadmap";
import { Roadmap, Turn } from "../model/types";
import type { TurnStore, TurnRecord } from "../turnStore";
import { buildSummarizationPrompt } from "./prompt";
import { summarizeIncrementally, SummarizationResult } from "./applySummary";
import { buildQuestionBackfill, ensureQuestionNodes } from "./ensureQuestionNodes";
import { validateModelSummaryResponse } from "./summaryResponseSchema";

/** Signature of the injected model call: takes the prompt, returns the model's raw text response. */
export type RequestSummary = (prompt: string) => Promise<string>;

/** Outcome of a summarization attempt. */
export interface SummarizeOutcome {
  /** True if the roadmap was changed and persisted. */
  changed: boolean;
  /** The (possibly updated) default roadmap. */
  roadmap: Roadmap;
  /** Validation/parse errors, if any. */
  errors: string[];
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
    references: record.references ?? [],
  };
}

/**
 * A view of `roadmap` containing only the nodes derived from `sessionId` (and
 * the edges among them). Used as the *existing graph* shown to the model when
 * summarizing that session, so the model can only continue/branch within the
 * same chat and a new chat therefore starts its own sub-graph. Nodes without
 * any source turns (e.g. resume branches) carry no session and are excluded
 * from this context.
 */
function sessionScopedRoadmap(roadmap: Roadmap, sessionId: string): Roadmap {
  const nodes = roadmap.nodes.filter((n) => n.sourceRefs.some((r) => r.sessionId === sessionId));
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges = roadmap.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
  return { ...roadmap, nodes, edges };
}

export class SummarizationService {
  /** Ids of turns already sent to the summarizer, so each turn is attempted at most once. */
  private readonly attemptedTurnIds = new Set<string>();
  /** Serializes summarization runs so overlapping captures cannot race on the roadmap document. */
  private queue: Promise<SummarizeOutcome> = Promise.resolve({ changed: false, roadmap: undefined as unknown as Roadmap, errors: [] });

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
    const backfill = async (): Promise<SummarizeOutcome> => {
      const roadmap = await loadDefaultRoadmap(this.roadmapStore);
      if (!roadmap.settings.autoSummarize) {
        return { changed: false, roadmap, errors: [] };
      }
      const outcome = this.applyQuestionBackfill(roadmap, this.turnStore.getAll());
      if (outcome.changed) {
        await saveRoadmap(this.roadmapStore, outcome.roadmap);
      }
      return outcome;
    };
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
      await this.roadmapStore.deleteAll();
      this.attemptedTurnIds.clear();
      const roadmap = await loadDefaultRoadmap(this.roadmapStore);
      return { changed: true, roadmap, errors: [] };
    };
    this.queue = this.queue.then(clear, clear);
    return this.queue.then((outcome) => outcome.roadmap);
  }

  private async runOnce(): Promise<SummarizeOutcome> {
    const roadmap = await loadDefaultRoadmap(this.roadmapStore);

    // Respect the user's per-roadmap preference; if auto-summarize is off, do
    // nothing (the user can still build the graph via manual edits/import).
    if (!roadmap.settings.autoSummarize) {
      return { changed: false, roadmap, errors: [] };
    }

    const allTurns = this.turnStore.getAll();
    const backfill = this.applyQuestionBackfill(roadmap, allTurns);
    let currentRoadmap = backfill.roadmap;
    let changedAny = backfill.changed;
    const errors: string[] = [...backfill.errors];

    // A turn is "already summarized" if any node already references it; combine
    // that with the in-memory attempted set so we neither re-summarize nor
    // repeatedly retry a turn the model chose not to use.
    const referenced = new Set<string>();
    for (const node of currentRoadmap.nodes) {
      for (const ref of node.sourceRefs) {
        referenced.add(ref.turnId);
      }
    }

    const pending = allTurns.filter(
      (t) =>
        t.completed &&
        !t.roadmapExcluded &&
        !referenced.has(t.id) &&
        !this.attemptedTurnIds.has(t.id)
    );
    if (pending.length === 0) {
      if (changedAny) {
        await saveRoadmap(this.roadmapStore, currentRoadmap);
      }
      return { changed: changedAny, roadmap: currentRoadmap, errors };
    }

    // Mark attempted up front so a failure or a model no-op doesn't cause this
    // same batch to be retried on every subsequent capture.
    for (const t of pending) {
      this.attemptedTurnIds.add(t.id);
    }

    // Summarize one session at a time. Each session's prompt is given only the
    // nodes from that *same* session as existing context, so a new chat starts
    // its own sub-graph instead of the model linking (continuing/branching) the
    // new turns onto an unrelated earlier session's nodes. Changes still apply
    // to the full roadmap, so other sessions' nodes are preserved.
    for (const sessionId of this.orderedSessionIds(pending)) {
      const sessionTurns = pending.filter((t) => t.sessionId === sessionId).map(toTurn);
      const scopedRoadmap = sessionScopedRoadmap(currentRoadmap, sessionId);
      const prompt = buildSummarizationPrompt(sessionTurns, scopedRoadmap);

      let rawResponse: string;
      try {
        rawResponse = await this.requestSummary(prompt);
      } catch (err) {
        errors.push(`summarization request failed for ${sessionId}: ${(err as Error).message}`);
        continue;
      }

      const parsed = parseModelJson(rawResponse);
      if (parsed === undefined) {
        errors.push(`summarization response for ${sessionId} was not valid JSON`);
        continue;
      }

      const validation = validateModelSummaryResponse(
        parsed,
        new Set(sessionTurns.map((turn) => turn.id))
      );
      if (!validation.valid || !validation.value) {
        errors.push(...validation.errors);
        continue;
      }
      const response = ensureQuestionNodes(
        validation.value,
        sessionTurns,
        scopedRoadmap,
        allTurns.map(toTurn)
      );
      const result: SummarizationResult = summarizeIncrementally(currentRoadmap, response, sessionTurns);
      if (result.changed) {
        currentRoadmap = result.roadmap;
        changedAny = true;
      } else {
        errors.push(...result.errors);
      }
    }

    if (!changedAny) {
      return { changed: false, roadmap: currentRoadmap, errors };
    }

    await saveRoadmap(this.roadmapStore, currentRoadmap);
    return { changed: true, roadmap: currentRoadmap, errors };
  }

  private applyQuestionBackfill(
    roadmap: Roadmap,
    allTurns: TurnRecord[]
  ): SummarizeOutcome {
    const allDomainTurns = allTurns
      .filter((turn) => turn.completed && !turn.roadmapExcluded)
      .map(toTurn);
    let currentRoadmap = roadmap;
    let changed = false;
    const errors: string[] = [];

    for (const sessionId of this.orderedSessionIds(
      allTurns.filter((turn) => turn.completed && !turn.roadmapExcluded)
    )) {
      const sessionTurns = allDomainTurns.filter((turn) => turn.sessionId === sessionId);
      const scopedRoadmap = sessionScopedRoadmap(currentRoadmap, sessionId);
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

    return { changed, roadmap: currentRoadmap, errors };
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
