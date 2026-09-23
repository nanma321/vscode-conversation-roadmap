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
import { parseResumePrompt } from "./resume/resumeContext";
import {
  ModelConversationMessage,
  ParticipantHistoryItem,
  prepareModelConversation,
} from "./chatHistory";
import {
  createChatSessionMetadata,
  ROADMAP_PARTICIPANT_ID,
  resolveChatSessionId,
} from "./chatSession";

let turnCounter = 0;
let sessionCounter = 0;

function nextTurnId(): string {
  turnCounter += 1;
  return `turn-${Date.now()}-${turnCounter}`;
}

function nextSessionId(): string {
  sessionCounter += 1;
  return `session-${Date.now()}-${sessionCounter}`;
}

function accessibleHistory(chatContext: vscode.ChatContext): ParticipantHistoryItem[] {
  const history: ParticipantHistoryItem[] = [];
  for (const turn of chatContext.history) {
    if (turn.participant !== ROADMAP_PARTICIPANT_ID) {
      continue;
    }
    if (turn instanceof vscode.ChatRequestTurn) {
      history.push({ kind: "request", prompt: turn.prompt });
      continue;
    }
    if (turn instanceof vscode.ChatResponseTurn) {
      history.push({
        kind: "response",
        parts: turn.response.map((part) =>
          part instanceof vscode.ChatResponseMarkdownPart
            ? { kind: "markdown", text: part.value.value }
            : { kind: "nonText" }
        ),
      });
    }
  }
  return history;
}

function resolveSessionId(chatContext: vscode.ChatContext): string {
  const responseMetadata = chatContext.history
    .filter(
      (turn): turn is vscode.ChatResponseTurn =>
        turn instanceof vscode.ChatResponseTurn &&
        turn.participant === ROADMAP_PARTICIPANT_ID
    )
    .map((turn) => turn.result.metadata);
  return resolveChatSessionId(responseMetadata, nextSessionId);
}

function toLanguageModelMessage(message: ModelConversationMessage): vscode.LanguageModelChatMessage {
  return message.role === "user"
    ? vscode.LanguageModelChatMessage.User(message.content)
    : vscode.LanguageModelChatMessage.Assistant(message.content);
}

function chatResult(sessionId: string, errorMessage?: string): vscode.ChatResult {
  return {
    metadata: createChatSessionMetadata(sessionId),
    ...(errorMessage ? { errorDetails: { message: errorMessage } } : {}),
  };
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
  ): Promise<vscode.ChatResult> => {
    const turnId = nextTurnId();
    const sessionId = resolveSessionId(chatContext);
    const timestamp = new Date().toISOString();
    const references = extractSupportedReferences(request.references);
    const resumePrompt = parseResumePrompt(request.prompt);
    let responseText = "";
    let outcome: TurnOutcome;
    let result = chatResult(sessionId);

    try {
      const conversation = prepareModelConversation(
        accessibleHistory(chatContext),
        request.prompt
      );
      const [model] = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (!model) {
        const error = new Error("No language model is available");
        outcome = failedOutcome(responseText, error);
        result = chatResult(
          sessionId,
          "Conversation Roadmap could not respond because no language model is available."
        );
      } else {
        const messages = conversation.messages.map(toLanguageModelMessage);
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
      if (!token.isCancellationRequested) {
        const message = err instanceof Error ? err.message : String(err);
        result = chatResult(
          sessionId,
          `Conversation Roadmap could not complete the response: ${message}`
        );
      }
    }

    try {
      await store.append(
        buildTurnRecord({
          id: turnId,
          sessionId,
          timestamp,
          request: resumePrompt.prompt,
          resumeNodeId: resumePrompt.resumeNodeId,
          outcome,
          references,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const priorError = result.errorDetails?.message;
      return chatResult(
        sessionId,
        priorError
          ? `${priorError} Conversation Roadmap also could not save this turn: ${message}`
          : `Conversation Roadmap could not save this turn: ${message}`
      );
    }
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
    return result;
  };

  const participant = vscode.chat.createChatParticipant(
    ROADMAP_PARTICIPANT_ID,
    handler
  );
  context.subscriptions.push(participant);
  return participant;
}
