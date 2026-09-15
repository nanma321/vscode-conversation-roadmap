/**
 * Phase 9 reliability test: a large conversation (many turns, applied
 * incrementally in small batches, the same way `chatParticipant.ts` drives
 * summarization turn-by-turn in practice) must still produce a valid,
 * bounded roadmap - no dropped provenance, no duplicate nodes for a topic
 * that keeps being continued, and no unbounded growth in node count as the
 * conversation grows. This exercises `summarizeIncrementally`
 * (`src/summarization/applySummary.ts`) at a scale well beyond the
 * ten-turn fixture in `test/summarization/tenTurnConversation.test.ts`.
 */
import * as assert from "assert";
import { summarizeIncrementally } from "../../src/summarization/applySummary";
import { validateRoadmapDocument } from "../../src/model/schema";
import { CURRENT_SCHEMA_VERSION, Roadmap, Turn } from "../../src/model/types";
import { ModelSummaryResponse } from "../../src/summarization/summaryResponseSchema";
import { makeEmptyRoadmap, makeTurn } from "../summarization/fixtures";

const TOTAL_TURNS = 500;
const BATCH_SIZE = 5;
const TOPIC_COUNT = 10;

/** Builds `TOTAL_TURNS` turns cycling through `TOPIC_COUNT` recurring subjects, so most batches continue an existing topic rather than starting a new one - representative of a long-running, multi-subject conversation. */
function buildLargeConversation(): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < TOTAL_TURNS; i++) {
    const topic = i % TOPIC_COUNT;
    turns.push(
      makeTurn({
        request: `Turn ${i} about topic ${topic}`,
        response: `Response ${i} about topic ${topic}`,
      })
    );
  }
  return turns;
}

/** A well-behaved incremental summarizer response for one batch: continues each topic's node if it already exists, otherwise creates it. */
function buildBatchResponse(batch: Turn[], knownTopicLocalIds: Set<number>): ModelSummaryResponse {
  const byTopic = new Map<number, Turn[]>();
  for (const turn of batch) {
    const globalIndex = Number(turn.request.match(/^Turn (\d+)/)![1]);
    const topic = globalIndex % TOPIC_COUNT;
    const list = byTopic.get(topic) ?? [];
    list.push(turn);
    byTopic.set(topic, list);
  }

  const nodes: ModelSummaryResponse["nodes"] = [];
  for (const [topic, turnsForTopic] of byTopic) {
    const alreadyExists = knownTopicLocalIds.has(topic);
    nodes.push({
      localId: `topic-${topic}`,
      kind: "topic",
      title: `Topic ${topic}`,
      summary: `Rolling summary of topic ${topic} (up to turn ${turnsForTopic[turnsForTopic.length - 1].request}).`,
      sourceTurnIds: turnsForTopic.map((t) => t.id),
      relation: alreadyExists ? "continue" : "topic",
      targetNodeId: alreadyExists ? `node-topic-${topic}-placeholder` : undefined,
    });
    knownTopicLocalIds.add(topic);
  }
  return { schemaVersion: 1, nodes };
}

describe("Phase 9 reliability: large conversations and incremental compaction", () => {
  it("compacts hundreds of turns, applied in small incremental batches, into a small, bounded set of nodes without losing provenance", () => {
    const allTurns = buildLargeConversation();
    let roadmap: Roadmap = makeEmptyRoadmap();
    const knownTopicLocalIds = new Set<number>();
    // Maps a topic's local id to the actual node id the roadmap assigned it,
    // once created, so later batches can `continue` it by real node id
    // (mirroring how `chatParticipant.ts` would track this across calls).
    const nodeIdByTopic = new Map<number, string>();

    const start = Date.now();
    for (let offset = 0; offset < allTurns.length; offset += BATCH_SIZE) {
      const batch = allTurns.slice(offset, offset + BATCH_SIZE);
      const rawResponse = buildBatchResponse(batch, knownTopicLocalIds);
      // Rewrite each node's targetNodeId to the real, previously-resolved node id.
      const response: ModelSummaryResponse = {
        ...rawResponse,
        nodes: rawResponse.nodes.map((n) => {
          const topic = Number(n.localId.replace("topic-", ""));
          const resolvedTarget = nodeIdByTopic.get(topic);
          return resolvedTarget ? { ...n, relation: "continue" as const, targetNodeId: resolvedTarget } : n;
        }),
      };

      const result = summarizeIncrementally(roadmap, response, batch);
      assert.strictEqual(result.changed, true, `batch at offset ${offset} failed to apply: ${result.errors.join("; ")}`);
      roadmap = result.roadmap;

      // Record the real node id assigned to each newly created topic.
      for (const node of roadmap.nodes) {
        const match = /^Topic (\d+)$/.exec(node.title);
        if (match) {
          nodeIdByTopic.set(Number(match[1]), node.id);
        }
      }
    }
    const elapsedMs = Date.now() - start;

    // Compaction: 500 turns across 10 recurring topics collapse into exactly
    // 10 nodes (continuations update, never duplicate, a topic's node).
    assert.strictEqual(roadmap.nodes.length, TOPIC_COUNT);

    // No data loss: every one of the 500 source turns is still traceable
    // from exactly one node's sourceRefs.
    const citedTurnIds = new Set<string>();
    for (const node of roadmap.nodes) {
      for (const ref of node.sourceRefs) {
        citedTurnIds.add(ref.turnId);
      }
    }
    assert.strictEqual(citedTurnIds.size, allTurns.length, "every source turn must remain traceable after compaction");
    for (const turn of allTurns) {
      assert.ok(citedTurnIds.has(turn.id), `turn ${turn.id} lost its provenance`);
    }

    // The resulting document is still schema-valid after hundreds of incremental applications.
    const validation = validateRoadmapDocument({ version: CURRENT_SCHEMA_VERSION, roadmaps: [roadmap] });
    assert.strictEqual(validation.valid, true, `final roadmap failed schema validation: ${validation.errors.join("; ")}`);

    // Sanity performance bound: applying 100 incremental batches over 500
    // turns should complete quickly (well under a second) with no
    // superlinear blowup; a generous ceiling avoids flakiness on slow CI
    // machines while still catching a real performance regression.
    assert.ok(elapsedMs < 5000, `incremental compaction took too long: ${elapsedMs}ms`);
  });
});
