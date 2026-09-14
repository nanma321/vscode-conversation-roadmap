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
    let responseText = "";
    let completed = false;

    try {
      const [model] = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (!model) {
        stream.markdown(
          "No language model is available to respond. This turn is still recorded for the roadmap graph."
        );
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
      }
      completed = !token.isCancellationRequested;
    } catch (err) {
      // Model failures are logged as incomplete turns rather than dropped,
      // so provenance of the failure is preserved (see Key Engineering Principles).
      completed = false;
      responseText = responseText || `Error: ${(err as Error).message}`;
    } finally {
      await store.append({
        id: turnId,
        sessionId,
        timestamp: new Date().toISOString(),
        request: request.prompt,
        response: responseText,
        completed,
      });
    }
  };

  const participant = vscode.chat.createChatParticipant("roadmap.participant", handler);
  context.subscriptions.push(participant);
  return participant;
}
