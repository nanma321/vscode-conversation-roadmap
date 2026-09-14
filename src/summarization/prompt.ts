/**
 * Builds the structured summarization prompt sent to the language model
 * (Phase 4). The prompt asks the model to reply with JSON matching
 * {@link ModelSummaryResponse} (see `summaryResponseSchema.ts`), describing
 * how a batch of newly captured `@roadmap` turns should update the roadmap
 * graph.
 *
 * Kept free of any `vscode` dependency, like `turnCapture.ts` and
 * `model/*.ts`, so it can be unit-tested without the extension host. The
 * caller (a future summarization service wired into `extension.ts`) is
 * responsible for actually sending this text to a language model and
 * feeding the response through `validateModelSummaryResponse` /
 * `summarizeIncrementally`.
 */
import { Roadmap, Turn } from "../model/types";

/** Caps how much of a single turn's request/response text is inlined into the prompt, to keep it a manageable size. */
const MAX_TURN_TEXT_LENGTH = 2000;

function truncate(text: string): string {
  return text.length > MAX_TURN_TEXT_LENGTH ? `${text.slice(0, MAX_TURN_TEXT_LENGTH)}\u2026` : text;
}

function renderExistingGraph(roadmap: Roadmap | undefined): string {
  if (!roadmap || roadmap.nodes.length === 0) {
    return "The roadmap graph is currently empty. Any node you create should use relation \"topic\" with no targetNodeId.";
  }
  const lines = roadmap.nodes.map((node) => {
    const kind = node.nodeType ?? "topic";
    return `- id: ${node.id} | kind: ${kind} | status: ${node.status} | title: ${JSON.stringify(node.title)}`;
  });
  return ["Existing roadmap nodes (use their ids as targetNodeId to continue or branch from them):", ...lines].join(
    "\n"
  );
}

function renderTurns(turns: Turn[]): string {
  return turns
    .map((turn) => {
      const status = turn.completed ? "completed" : "incomplete (cancelled or failed)";
      return [
        `Turn id: ${turn.id} (session ${turn.sessionId}, ${status})`,
        `  Request: ${JSON.stringify(truncate(turn.request))}`,
        `  Response: ${JSON.stringify(truncate(turn.response))}`,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * Builds the full prompt text for summarizing `turns` (a batch of newly
 * captured turns, oldest first) into updates for `roadmap` (the roadmap's
 * current state, or `undefined`/empty for a brand-new roadmap).
 */
export function buildSummarizationPrompt(turns: Turn[], roadmap: Roadmap | undefined): string {
  return `You are maintaining a roadmap graph that summarizes an ongoing conversation. \
Read the new conversation turns below and decide how they should update the graph.

${renderExistingGraph(roadmap)}

New conversation turns to summarize (oldest first):

${renderTurns(turns)}

Instructions:
- Be conservative: prefer relation "continue" on the most relevant existing node over creating a new node. Only create a new node ("topic" or "branch") when the turns introduce a genuinely new subject.
- Use relation "topic" for a new node that sequentially follows the current topic, and relation "branch" only when the turns clearly return to or fork off an earlier, different topic (targetNodeId must be that earlier node's id).
- In addition to topic nodes, extract distinct "decision", "question", "task", "outcome", and "blocker" items mentioned in the turns as their own nodes (kind set accordingly), each related via "topic" or "continue" to the relevant topic node.
- Every node you produce MUST include at least one id from "sourceTurnIds", chosen only from the turn ids listed above. Do not invent turn ids.
- Do not remove or alter information the user has authored themselves; only propose additions and updates derived from these turns.
- Respond with ONLY a single JSON object (no markdown code fences, no commentary) matching exactly this shape:

{
  "schemaVersion": 1,
  "nodes": [
    {
      "localId": "string, unique within this response",
      "kind": "topic" | "decision" | "question" | "task" | "outcome" | "blocker",
      "title": "short title",
      "summary": "summary text",
      "status": "open" | "in-progress" | "done" | "blocked" (optional),
      "tags": ["optional", "tags"],
      "sourceTurnIds": ["turn id", "..."],
      "relation": "continue" | "topic" | "branch",
      "targetNodeId": "existing node id, or an earlier localId in this response (required for continue/branch)"
    }
  ]
}`;
}
