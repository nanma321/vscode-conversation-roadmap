/**
 * Registers the `@roadmap` chat participant.
 *
 * Per the Phase 1 exit criteria, this handler only ever sees requests that
 * were explicitly directed at `@roadmap` (VS Code only invokes a
 * participant's handler for messages addressed to it), and only uses the
 * public `vscode.chat` API surface. It logs each request and the resulting
 * response text to a {@link TurnStore} so the graph Webview can later
 * display each node's original source messages.
 */
import * as vscode from "vscode";
import { TurnStore } from "./turnStore";
import {
  buildTurnRecord,
  cancelledOutcome,
  extractSupportedReferences,
  failedOutcome,
  successOutcome,
  TurnOutcome,
} from "./turnCapture";
import { ROADMAP_MENTION } from "./chatPrefill";
import { tryPrefillRoadmapChat } from "./vscodeChatPrefill";

let turnCounter = 0;
let sessionCounter = 0;
// Tracks the session id for the conversation currently being handled. Reset to a
// new id whenever a chat has no prior `@roadmap` history (i.e. a new chat), so
// each conversation forms its own roadmap while remaining individually selectable.
let currentSessionId: string | undefined;

function nextTurnId(): string {
  turnCounter += 1;
  return `turn-${Date.now()}-${turnCounter}`;
}

/**
 * Resolves the session id for an incoming request. A new session starts when the
 * chat has no prior `@roadmap` turns in its history, or when we have no in-memory
 * session (e.g. the first turn after the extension activated mid-conversation).
 * Only history involving `@roadmap` is ever visible here, preserving the Phase 1
 * limitation that other participants' messages are inaccessible.
 */
function resolveSessionId(chatContext: vscode.ChatContext): string {
  const hasHistory = Array.isArray(chatContext.history) && chatContext.history.length > 0;
  if (!hasHistory || !currentSessionId) {
    sessionCounter += 1;
    currentSessionId = `session-${Date.now()}-${sessionCounter}`;
  }
  return currentSessionId;
}

export function registerRoadmapParticipant(
  context: vscode.ExtensionContext,
  store: TurnStore
): vscode.ChatParticipant {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> => {
    const turnId = nextTurnId();
    const sessionId = resolveSessionId(chatContext);
    const timestamp = new Date().toISOString();
    const references = extractSupportedReferences(request.references);
    let responseText = "";
    let outcome: TurnOutcome;

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (!model) {
        stream.markdown(
          "No language model is available to respond. This turn is still recorded for the roadmap graph."
        );
        // No model means the request could not actually be answered; this is
        // an explicit failure, not a silently "completed" empty response.
        outcome = failedOutcome(responseText, new Error("No language model is available"));
      } else {
        const messages = [vscode.LanguageModelChatMessage.User(request.prompt)];
        const chatResponse = await model.sendRequest(messages, {}, token);
        for await (const fragment of chatResponse.text) {
          if (token.isCancellationRequested) {
            break;
          }
          responseText += fragment;
          stream.markdown(fragment);
        }
        outcome = token.isCancellationRequested ? cancelledOutcome(responseText) : successOutcome(responseText);
      }
    } catch (err) {
      // Model failures and cancellations surfaced as errors are logged as
      // incomplete turns rather than dropped, so provenance of the failure
      // is preserved (see Key Engineering Principles). Cancellation always
      // takes precedence so a user-cancelled turn is never recorded as a
      // model failure.
      outcome = token.isCancellationRequested ? cancelledOutcome(responseText) : failedOutcome(responseText, err);
    } finally {
      await store.append(
        buildTurnRecord({
          id: turnId,
          sessionId,
          timestamp,
          request: request.prompt,
          outcome: outcome!,
          references,
        })
      );
      if (!token.isCancellationRequested) {
        const autoPrefill = vscode.workspace
          .getConfiguration("conversationRoadmap")
          .get<boolean>("autoPrefillMention", true);
        if (autoPrefill) {
          setTimeout(() => {
            void tryPrefillRoadmapChat(ROADMAP_MENTION).catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              void vscode.window.showWarningMessage(
                `Conversation Roadmap could not prepare the next chat input: ${message}`
              );
            });
          }, 200);
        }
      }
    }
  };

  const participant = vscode.chat.createChatParticipant("roadmap.participant", handler);
  context.subscriptions.push(participant);
  return participant;
}
