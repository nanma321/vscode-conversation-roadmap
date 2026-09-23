import { parseResumePrompt } from "./resume/resumeContext";

export type ModelConversationRole = "user" | "assistant";

export interface ModelConversationMessage {
  role: ModelConversationRole;
  content: string;
}

export interface ParticipantHistoryRequest {
  kind: "request";
  prompt: unknown;
}

export interface ParticipantHistoryResponse {
  kind: "response";
  parts: unknown;
}

export type ParticipantHistoryItem = ParticipantHistoryRequest | ParticipantHistoryResponse;

export interface ChatHistoryBudget {
  maxHistoryMessages?: number;
  maxHistoryCharacters?: number;
}

export interface PreparedModelConversation {
  messages: ModelConversationMessage[];
  currentPrompt: string;
  currentResumeNodeId?: string;
  omittedHistoryMessages: number;
  omittedHistoryCharacters: number;
}

export const DEFAULT_MAX_HISTORY_MESSAGES = 20;
export const DEFAULT_MAX_HISTORY_CHARACTERS = 24000;

interface HistoryExchange {
  messages: ModelConversationMessage[];
  isResumeSeed: boolean;
}

interface MarkdownHistoryPart {
  kind: "markdown";
  text: string;
}

function isMarkdownHistoryPart(value: unknown): value is MarkdownHistoryPart {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { kind?: unknown; text?: unknown };
  return candidate.kind === "markdown" && typeof candidate.text === "string";
}

function responseText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .filter(isMarkdownHistoryPart)
    .map((part) => part.text)
    .join("");
}

function normalizeHistory(history: readonly ParticipantHistoryItem[]): HistoryExchange[] {
  const exchanges: HistoryExchange[] = [];
  let currentExchange: HistoryExchange | undefined;

  for (const item of history) {
    if (item.kind === "request") {
      if (typeof item.prompt !== "string") {
        currentExchange = undefined;
        continue;
      }
      const parsed = parseResumePrompt(item.prompt);
      if (parsed.prompt.trim().length === 0) {
        currentExchange = undefined;
        continue;
      }
      currentExchange = {
        messages: [{ role: "user", content: parsed.prompt }],
        isResumeSeed: parsed.resumeNodeId !== undefined,
      };
      exchanges.push(currentExchange);
      continue;
    }

    const text = responseText(item.parts);
    if (!currentExchange || text.trim().length === 0) {
      continue;
    }
    const existingResponse = currentExchange.messages.find((message) => message.role === "assistant");
    if (existingResponse) {
      existingResponse.content += text;
    } else {
      currentExchange.messages.push({ role: "assistant", content: text });
    }
  }

  return exchanges;
}

function messageCharacters(messages: readonly ModelConversationMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function truncateWithMarker(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  const marker = "\n[... history compacted ...]\n";
  if (maxLength <= marker.length) {
    return content.slice(0, maxLength);
  }
  const remaining = maxLength - marker.length;
  const headLength = Math.ceil(remaining / 2);
  const tailLength = Math.floor(remaining / 2);
  return `${content.slice(0, headLength)}${marker}${content.slice(content.length - tailLength)}`;
}

function compactMessages(
  messages: readonly ModelConversationMessage[],
  maxCharacters: number
): ModelConversationMessage[] {
  const totalCharacters = messageCharacters(messages);
  if (totalCharacters <= maxCharacters) {
    return messages.map((message) => ({ ...message }));
  }

  const allocations = new Array<number>(messages.length).fill(0);
  const pending = new Set(messages.map((_, index) => index));
  let remaining = maxCharacters;

  while (pending.size > 0) {
    const share = Math.floor(remaining / pending.size);
    const fitting = [...pending].filter((index) => messages[index].content.length <= share);
    if (fitting.length === 0) {
      const pendingIndexes = [...pending];
      pendingIndexes.forEach((index, position) => {
        allocations[index] = share + (position < remaining % pending.size ? 1 : 0);
      });
      break;
    }
    for (const index of fitting) {
      allocations[index] = messages[index].content.length;
      remaining -= allocations[index];
      pending.delete(index);
    }
  }

  return messages.map((message, index) => ({
    role: message.role,
    content: truncateWithMarker(message.content, allocations[index]),
  }));
}

function validateBudget(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

/**
 * Converts participant-only chat history into a bounded model conversation.
 *
 * History is grouped into request/response exchanges. The newest exchange is
 * always retained, as is the latest resume seed plus its response, so short
 * branch follow-ups keep both their immediate and reconstructed context.
 */
export function prepareModelConversation(
  history: readonly ParticipantHistoryItem[],
  currentPrompt: string,
  budget: ChatHistoryBudget = {}
): PreparedModelConversation {
  const maxHistoryMessages = budget.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
  const maxHistoryCharacters =
    budget.maxHistoryCharacters ?? DEFAULT_MAX_HISTORY_CHARACTERS;
  validateBudget(maxHistoryMessages, "maxHistoryMessages");
  validateBudget(maxHistoryCharacters, "maxHistoryCharacters");

  const current = parseResumePrompt(currentPrompt);
  const exchanges = normalizeHistory(history);
  const lastExchange = exchanges[exchanges.length - 1];
  if (
    lastExchange?.messages.length === 1 &&
    lastExchange.messages[0].role === "user" &&
    lastExchange.messages[0].content === current.prompt
  ) {
    exchanges.pop();
  }

  const originalMessages = exchanges.flatMap((exchange) => exchange.messages);
  const originalCharacters = messageCharacters(originalMessages);

  let relevantExchanges = exchanges;
  let resumeSeedIndex = -1;
  if (current.resumeNodeId) {
    relevantExchanges = [];
  } else {
    for (let index = exchanges.length - 1; index >= 0; index -= 1) {
      if (exchanges[index].isResumeSeed) {
        resumeSeedIndex = index;
        break;
      }
    }
    if (resumeSeedIndex >= 0) {
      relevantExchanges = exchanges.slice(resumeSeedIndex);
      resumeSeedIndex = 0;
    }
  }

  const selected = new Map<number, ModelConversationMessage[]>();
  if (relevantExchanges.length > 0) {
    const newestIndex = relevantExchanges.length - 1;
    const newestMessages = relevantExchanges[newestIndex].messages;
    selected.set(
      newestIndex,
      newestMessages.length <= maxHistoryMessages
        ? newestMessages.map((message) => ({ ...message }))
        : newestMessages
            .slice(newestMessages.length - maxHistoryMessages)
            .map((message) => ({ ...message }))
    );

    let remainingMandatorySlots =
      maxHistoryMessages - (selected.get(newestIndex)?.length ?? 0);
    if (
      resumeSeedIndex >= 0 &&
      resumeSeedIndex !== newestIndex &&
      remainingMandatorySlots > 0
    ) {
      selected.set(
        resumeSeedIndex,
        relevantExchanges[resumeSeedIndex].messages
          .slice(0, remainingMandatorySlots)
          .map((message) => ({ ...message }))
      );
    }

    const orderedMandatoryIndexes = [...selected.keys()].sort((a, b) => a - b);
    const mandatoryMessages = orderedMandatoryIndexes.flatMap((index) =>
      selected.get(index) ?? []
    );
    const boundedMandatoryMessages = compactMessages(
      mandatoryMessages,
      maxHistoryCharacters
    );

    let mandatoryOffset = 0;
    for (const index of orderedMandatoryIndexes) {
      const exchangeLength = Math.min(
        selected.get(index)?.length ?? 0,
        boundedMandatoryMessages.length - mandatoryOffset
      );
      if (exchangeLength > 0) {
        selected.set(
          index,
          boundedMandatoryMessages.slice(mandatoryOffset, mandatoryOffset + exchangeLength)
        );
        mandatoryOffset += exchangeLength;
      }
    }

    let remainingMessages =
      maxHistoryMessages -
      [...selected.values()].reduce((total, messages) => total + messages.length, 0);
    let remainingCharacters =
      maxHistoryCharacters -
      [...selected.values()].reduce(
        (total, messages) => total + messageCharacters(messages),
        0
      );

    for (let index = relevantExchanges.length - 1; index >= 0; index -= 1) {
      if (selected.has(index)) {
        continue;
      }
      const exchange = relevantExchanges[index];
      const exchangeCharacters = messageCharacters(exchange.messages);
      if (
        exchange.messages.length > remainingMessages ||
        exchangeCharacters > remainingCharacters
      ) {
        break;
      }
      selected.set(
        index,
        exchange.messages.map((message) => ({ ...message }))
      );
      remainingMessages -= exchange.messages.length;
      remainingCharacters -= exchangeCharacters;
    }
  }

  const selectedHistory = [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, messages]) => messages);
  const selectedCharacters = messageCharacters(selectedHistory);

  return {
    messages: [
      ...selectedHistory,
      {
        role: "user",
        content: current.prompt,
      },
    ],
    currentPrompt: current.prompt,
    ...(current.resumeNodeId ? { currentResumeNodeId: current.resumeNodeId } : {}),
    omittedHistoryMessages: originalMessages.length - selectedHistory.length,
    omittedHistoryCharacters: originalCharacters - selectedCharacters,
  };
}
