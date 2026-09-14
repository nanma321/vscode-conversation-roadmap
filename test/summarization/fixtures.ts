/**
 * Fixtures for common conversation patterns, used across the Phase 4
 * summarization tests. Kept separate from the tests themselves so multiple
 * test files (prompt, validation, application, and the end-to-end
 * ten-turn scenario) can share the same representative inputs.
 */
import { createDefaultSettings, Roadmap, Turn } from "../../src/model/types";
import { ModelSummaryResponse } from "../../src/summarization/summaryResponseSchema";

let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `turn-fixture-${turnCounter}`;
}

/** Builds a single {@link Turn}, filling in reasonable defaults for fields the pattern under test doesn't care about. */
export function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: nextTurnId(),
    sessionId: "session-fixture",
    timestamp: new Date().toISOString(),
    request: "What should we do next?",
    response: "Here's a suggestion.",
    completed: true,
    references: [],
    ...overrides,
  };
}

/** Builds an empty roadmap, matching `createEmptyDocument()`'s per-roadmap shape. */
export function makeEmptyRoadmap(id = "roadmap-fixture"): Roadmap {
  const now = new Date().toISOString();
  return {
    id,
    title: "Fixture roadmap",
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    settings: createDefaultSettings(),
  };
}

/**
 * Pattern 1: a simple linear conversation about one subject. Five turns,
 * all continuing the same "topic" node the first turn creates.
 */
export function linearConversationTurns(): Turn[] {
  return [
    makeTurn({ request: "Let's plan the onboarding flow.", response: "Sure, let's start with sign-up." }),
    makeTurn({ request: "What about email verification?", response: "We should require it before first login." }),
    makeTurn({ request: "And password requirements?", response: "At least 12 characters, no other rules." }),
    makeTurn({ request: "Should we support SSO?", response: "Not for the MVP." }),
    makeTurn({ request: "Great, let's write this up.", response: "Onboarding flow: sign-up, verify email, password rules, no SSO for MVP." }),
  ];
}

/** The model response a well-behaved summarizer would produce for {@link linearConversationTurns}: one topic node continued/created, no branches. */
export function linearConversationResponse(turns: Turn[]): ModelSummaryResponse {
  return {
    schemaVersion: 1,
    nodes: [
      {
        localId: "topic-onboarding",
        kind: "topic",
        title: "Onboarding flow",
        summary: "Sign-up, email verification required before login, password rules, no SSO for MVP.",
        sourceTurnIds: turns.map((t) => t.id),
        relation: "topic",
      },
    ],
  };
}

/**
 * Pattern 2: a conversation that shifts to a genuinely new subject partway
 * through. The first two turns are about topic A; the last two are about
 * an unrelated topic B, which should become its own node rather than being
 * folded into topic A.
 */
export function topicShiftTurns(): { topicATurns: Turn[]; topicBTurns: Turn[] } {
  return {
    topicATurns: [
      makeTurn({ request: "Design the login page.", response: "Use email + password fields." }),
      makeTurn({ request: "Add a 'forgot password' link.", response: "Added below the submit button." }),
    ],
    topicBTurns: [
      makeTurn({ request: "Now let's talk about billing.", response: "We'll support monthly and annual plans." }),
      makeTurn({ request: "What payment processor?", response: "Stripe." }),
    ],
  };
}

/**
 * Pattern 3: a conversation that yields distinct decision/question/task/
 * outcome/blocker items alongside its topic node.
 */
export function extractedItemsTurns(): Turn[] {
  return [
    makeTurn({
      request: "We decided to use PostgreSQL for the database.",
      response: "Noted - PostgreSQL it is.",
    }),
    makeTurn({
      request: "Should we shard the database from day one?",
      response: "Open question, let's revisit after the first release.",
    }),
    makeTurn({
      request: "Someone needs to write the migration scripts.",
      response: "I'll add that as a task.",
    }),
    makeTurn({
      request: "The staging environment is down, blocking testing.",
      response: "That's a blocker until infra fixes it.",
    }),
    makeTurn({
      request: "We finished the schema design.",
      response: "Great, that's a solid outcome for this sprint.",
    }),
  ];
}

export function extractedItemsResponse(turns: Turn[]): ModelSummaryResponse {
  const [decisionTurn, questionTurn, taskTurn, blockerTurn, outcomeTurn] = turns;
  return {
    schemaVersion: 1,
    nodes: [
      {
        localId: "topic-db",
        kind: "topic",
        title: "Database design",
        summary: "Discussion of database technology and schema.",
        sourceTurnIds: turns.map((t) => t.id),
        relation: "topic",
      },
      {
        localId: "decision-postgres",
        kind: "decision",
        title: "Use PostgreSQL",
        summary: "Decided to use PostgreSQL for the database.",
        sourceTurnIds: [decisionTurn.id],
        relation: "topic",
        targetNodeId: "topic-db",
      },
      {
        localId: "question-sharding",
        kind: "question",
        title: "Shard from day one?",
        summary: "Open question about whether to shard the database immediately.",
        sourceTurnIds: [questionTurn.id],
        relation: "topic",
        targetNodeId: "topic-db",
      },
      {
        localId: "task-migrations",
        kind: "task",
        title: "Write migration scripts",
        summary: "Someone needs to write the database migration scripts.",
        sourceTurnIds: [taskTurn.id],
        relation: "topic",
        targetNodeId: "topic-db",
      },
      {
        localId: "blocker-staging",
        kind: "blocker",
        title: "Staging environment down",
        summary: "Staging environment outage is blocking testing.",
        status: "blocked",
        sourceTurnIds: [blockerTurn.id],
        relation: "topic",
        targetNodeId: "topic-db",
      },
      {
        localId: "outcome-schema",
        kind: "outcome",
        title: "Schema design complete",
        summary: "Finished the database schema design this sprint.",
        status: "done",
        sourceTurnIds: [outcomeTurn.id],
        relation: "topic",
        targetNodeId: "topic-db",
      },
    ],
  };
}

/**
 * Pattern 4: an invalid model response (missing a required `sourceTurnIds`
 * entry) that must be rejected without changing the graph.
 */
export function invalidResponseMissingSourceTurnIds(): ModelSummaryResponse {
  return {
    schemaVersion: 1,
    nodes: [
      {
        localId: "topic-bad",
        kind: "topic",
        title: "Should be rejected",
        summary: "This node has no source turns.",
        sourceTurnIds: [],
        relation: "topic",
      } as unknown as ModelSummaryResponse["nodes"][number],
    ],
  };
}

/**
 * Pattern 5: a representative ten-turn conversation spanning an initial
 * topic, an extracted decision/task, and a topic shift with a later branch
 * back to the original topic - used to validate the Phase 4 exit criterion
 * that a ten-turn conversation produces a useful graph.
 */
export function tenTurnConversation(): Turn[] {
  return [
    makeTurn({ request: "Let's design the checkout flow.", response: "Start with a cart summary screen." }),
    makeTurn({ request: "What payment methods?", response: "Credit card and PayPal." }),
    makeTurn({ request: "We decided to add Apple Pay too.", response: "Good call, adding it to the list." }),
    makeTurn({ request: "Someone should implement the cart summary UI.", response: "I'll log that as a task." }),
    makeTurn({ request: "Now, switching topics - what about the admin dashboard?", response: "Let's list required widgets." }),
    makeTurn({ request: "We need sales and inventory widgets.", response: "Noted both." }),
    makeTurn({ request: "Any blockers there?", response: "The analytics API isn't ready yet, that blocks the sales widget." }),
    makeTurn({ request: "Back to checkout - should we support gift cards?", response: "Yes, let's add gift card support." }),
    makeTurn({ request: "We finished the payment method selection UI.", response: "Nice, that's done." }),
    makeTurn({ request: "Let's recap the admin dashboard widgets.", response: "Sales, inventory, both pending the analytics API." }),
  ];
}
