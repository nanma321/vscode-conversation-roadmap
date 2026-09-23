/**
 * Pure, `vscode`-independent logic for turning a single `@roadmap`
 * participant invocation into a {@link TurnRecord} (Phase 3).
 *
 * Kept free of any runtime dependency on the `vscode` module - mirroring
 * the approach already used by `turnStore.ts` - so reference extraction and
 * success/cancelled/failed outcome classification can be unit-tested
 * without the extension host.
 */
import { TurnRecord, TurnReference } from "./turnStore";

/**
 * Structural (duck-typed) subset of `vscode.ChatPromptReference` that this
 * module depends on. Using a local interface instead of importing `vscode`
 * keeps this module host-independent while still type-checking correctly
 * against the real type at the `chatParticipant.ts` call site.
 */
export interface PromptReferenceLike {
  readonly id: string;
  readonly modelDescription?: string;
  readonly value: unknown;
}

/** Caps how much text from a single reference value is retained. */
const MAX_REFERENCE_TEXT_LENGTH = 4000;

function isPositionLike(
  value: unknown
): value is { line: number; character: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const position = value as { line?: unknown; character?: unknown };
  return (
    Number.isSafeInteger(position.line) &&
    Number.isSafeInteger(position.character)
  );
}

function isLocationLike(
  value: unknown
): value is {
  uri: unknown;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("uri" in value) ||
    !("range" in value)
  ) {
    return false;
  }
  const range = (value as { range?: unknown }).range;
  if (typeof range !== "object" || range === null) {
    return false;
  }
  const candidate = range as { start?: unknown; end?: unknown };
  return isPositionLike(candidate.start) && isPositionLike(candidate.end);
}

function isUriLike(value: unknown): value is { scheme: unknown } {
  return typeof value === "object" && value !== null && "scheme" in value && "fsPath" in value;
}

/**
 * Filters and serializes a request's `references` down to the subset this
 * extension knows how to store safely: plain text, file URIs, and
 * file+range locations. Any other/unknown reference value shape is
 * intentionally dropped rather than persisted as an opaque or
 * unserializable blob, per the "validate all... data" engineering
 * principle - these are the "supported references" the Phase 3 exit
 * criteria refer to.
 */
export function extractSupportedReferences(
  references: readonly PromptReferenceLike[] | undefined
): TurnReference[] {
  if (!references) {
    return [];
  }
  const result: TurnReference[] = [];
  for (const ref of references) {
    const { id, modelDescription, value } = ref;
    if (typeof value === "string") {
      result.push({
        id,
        description: modelDescription,
        kind: "text",
        value: value.slice(0, MAX_REFERENCE_TEXT_LENGTH),
      });
    } else if (isLocationLike(value)) {
      result.push({
        id,
        description: modelDescription,
        kind: "location",
        value: String(value.uri),
        range: {
          start: { ...value.range.start },
          end: { ...value.range.end },
        },
      });
    } else if (isUriLike(value)) {
      result.push({ id, description: modelDescription, kind: "uri", value: String(value) });
    }
    // Anything else (unknown/future reference value shapes) is skipped.
  }
  return result;
}

/** The classified result of one `@roadmap` invocation attempt. */
export interface TurnOutcome {
  /** True only when the model produced a response without being cancelled or erroring. */
  completed: boolean;
  /** Whatever response text had been produced/streamed before the outcome was determined. */
  responseText: string;
}

/** Classifies a successfully completed invocation. */
export function successOutcome(responseText: string): TurnOutcome {
  return { completed: true, responseText };
}

/**
 * Classifies a cancelled invocation. Any partial response text produced
 * before cancellation is preserved but the turn is explicitly marked
 * incomplete so it is never presented as a finished answer.
 */
export function cancelledOutcome(responseText: string): TurnOutcome {
  return { completed: false, responseText };
}

/**
 * Classifies a failed invocation (e.g. no model available, or the model
 * request threw). The failure is recorded rather than dropped so the turn's
 * provenance - including that it failed - is preserved.
 */
export function failedOutcome(responseText: string, error: unknown): TurnOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return { completed: false, responseText: responseText || `Error: ${message}` };
}

/** Input needed to assemble a {@link TurnRecord} from a request and its classified outcome. */
export interface BuildTurnRecordInput {
  id: string;
  sessionId: string;
  timestamp: string;
  request: string;
  resumeNodeId?: string;
  outcome: TurnOutcome;
  references: TurnReference[];
}

/** Assembles the {@link TurnRecord} that gets persisted via `TurnStore.append`. */
export function buildTurnRecord(input: BuildTurnRecordInput): TurnRecord {
  return {
    id: input.id,
    sessionId: input.sessionId,
    timestamp: input.timestamp,
    request: input.request,
    ...(input.resumeNodeId ? { resumeNodeId: input.resumeNodeId } : {}),
    response: input.outcome.responseText,
    completed: input.outcome.completed,
    references: input.references,
  };
}
