export const CONTINUE_ROADMAP_COMMAND = "conversationRoadmap.continueChat";
export const ROADMAP_MENTION = "@roadmap ";

export interface ChatPrefillHost {
  getCommands(): PromiseLike<string[]>;
  executeCommand(
    command: string,
    args: { query: string; isPartialQuery: true }
  ): PromiseLike<unknown>;
  writeClipboard(text: string): PromiseLike<void>;
  showInformationMessage(message: string): void;
}

export type ChatPrefillAttemptOutcome = "prefilled" | "unavailable";
export type ChatPrefillOutcome = "prefilled" | "copied";

/** Attempts a non-submitting partial-query prefill without modifying the clipboard. */
export async function tryPrefillChat(
  host: ChatPrefillHost,
  query: string
): Promise<ChatPrefillAttemptOutcome> {
  const commands = await host.getCommands();
  if (!commands.includes("workbench.action.chat.open")) {
    return "unavailable";
  }
  try {
    await host.executeCommand("workbench.action.chat.open", {
      query,
      isPartialQuery: true,
    });
    return "prefilled";
  } catch {
    return "unavailable";
  }
}

/**
 * Uses VS Code's chat-open command when available and falls back explicitly to
 * the clipboard if that command is absent or fails.
 */
export async function prefillChat(
  host: ChatPrefillHost,
  query: string,
  clipboardMessage: string
): Promise<ChatPrefillOutcome> {
  const outcome = await tryPrefillChat(host, query);
  if (outcome === "prefilled") {
    return outcome;
  }

  await host.writeClipboard(query);
  host.showInformationMessage(clipboardMessage);
  return "copied";
}
