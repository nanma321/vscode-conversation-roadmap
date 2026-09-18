import * as vscode from "vscode";
import {
  ChatPrefillAttemptOutcome,
  ChatPrefillOutcome,
  prefillChat,
  tryPrefillChat,
} from "./chatPrefill";

const host = {
  getCommands: () => vscode.commands.getCommands(true),
  executeCommand: (command: string, args: { query: string; isPartialQuery: true }) =>
    vscode.commands.executeCommand(command, args),
  writeClipboard: (text: string) => vscode.env.clipboard.writeText(text),
  showInformationMessage: (message: string) => {
    void vscode.window.showInformationMessage(message);
  },
};

/** VS Code adapter over the pure, unit-tested chat-prefill policy. */
export function prefillRoadmapChat(
  query: string,
  clipboardMessage: string
): Promise<ChatPrefillOutcome> {
  return prefillChat(host, query, clipboardMessage);
}

/** Non-intrusive automatic prefill: never replaces clipboard content on failure. */
export function tryPrefillRoadmapChat(query: string): Promise<ChatPrefillAttemptOutcome> {
  return tryPrefillChat(host, query);
}
