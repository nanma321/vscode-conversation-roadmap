import { SummarizeOutcome } from "./summarizationService";

export interface SummarizationNotice {
  message: string;
  severity: "warning" | "error";
}

export function buildSummarizationNotice(
  outcome: SummarizeOutcome
): SummarizationNotice | undefined {
  if (
    outcome.errors.length === 0 &&
    outcome.failures.length === 0 &&
    outcome.fallbacks.length === 0
  ) {
    return undefined;
  }

  const retryTurnIds = new Set(
    outcome.failures
      .filter((failure) => failure.willRetry)
      .flatMap((failure) => failure.turnIds)
  );
  const fallbackTurnIds = new Set(
    outcome.fallbacks.map((fallback) => fallback.turnId)
  );
  const details = [...new Set(outcome.errors)].slice(0, 3);
  const parts: string[] = [];
  if (retryTurnIds.size > 0) {
    parts.push(
      `${retryTurnIds.size} turn(s) remain eligible for one bounded retry`
    );
  }
  if (fallbackTurnIds.size > 0) {
    parts.push(
      `${fallbackTurnIds.size} source-linked fallback node(s) were created`
    );
  }
  if (details.length > 0) {
    parts.push(details.join("; "));
  }

  const message = `Conversation Roadmap summarization: ${parts.join(". ")}.`;
  return {
    message:
      message.length <= 900
        ? message
        : `${message.slice(0, 870)} [... details truncated ...]`,
    severity:
      outcome.failures.some((failure) => failure.willRetry) ||
      outcome.fallbacks.length > 0
        ? "warning"
        : "error",
  };
}
