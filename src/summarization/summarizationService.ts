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
 * requests are chained) and that a turn is attempted at most once, so a turn the
 * model chooses not to reference does not trigger repeated work.
 */
import { RoadmapStore } from "../model/roadmapStore";
import { loadDefaultRoadmap, saveRoadmap } from "../model/defaultRoadmap";
import { Roadmap, Turn } from "../model/types";
import type { TurnStore, TurnRecord } from "../turnStore";
import { buildSummarizationPrompt } from "./prompt";
import { summarizeIncrementally, SummarizationResult } from "./applySummary";

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

  private async runOnce(): Promise<SummarizeOutcome> {
    const roadmap = await loadDefaultRoadmap(this.roadmapStore);

    // Respect the user's per-roadmap preference; if auto-summarize is off, do
    // nothing (the user can still build the graph via manual edits/import).
    if (!roadmap.settings.autoSummarize) {
      return { changed: false, roadmap, errors: [] };
    }

    // A turn is "already summarized" if any node already references it; combine
    // that with the in-memory attempted set so we neither re-summarize nor
    // repeatedly retry a turn the model chose not to use.
    const referenced = new Set<string>();
    for (const node of roadmap.nodes) {
      for (const ref of node.sourceRefs) {
        referenced.add(ref.turnId);
      }
    }

    const allTurns = this.turnStore.getAll();
    const pending = allTurns.filter(
      (t) => t.completed && !referenced.has(t.id) && !this.attemptedTurnIds.has(t.id)
    );
    if (pending.length === 0) {
      return { changed: false, roadmap, errors: [] };
    }

    // Mark attempted up front so a failure or a model no-op doesn't cause this
    // same batch to be retried on every subsequent capture.
    for (const t of pending) {
      this.attemptedTurnIds.add(t.id);
    }

    const turns = pending.map(toTurn);
    const prompt = buildSummarizationPrompt(turns, roadmap);

    let rawResponse: string;
    try {
      rawResponse = await this.requestSummary(prompt);
    } catch (err) {
      return { changed: false, roadmap, errors: [`summarization request failed: ${(err as Error).message}`] };
    }

    const parsed = parseModelJson(rawResponse);
    if (parsed === undefined) {
      return { changed: false, roadmap, errors: ["summarization response was not valid JSON"] };
    }

    const result: SummarizationResult = summarizeIncrementally(roadmap, parsed, turns);
    if (!result.changed) {
      return { changed: false, roadmap: result.roadmap, errors: result.errors };
    }

    await saveRoadmap(this.roadmapStore, result.roadmap);
    return { changed: true, roadmap: result.roadmap, errors: [] };
  }
}
