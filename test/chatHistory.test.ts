import * as assert from "assert";
import {
  appendToCurrentPrompt,
  buildCompactionDisclosure,
  ParticipantHistoryItem,
  prepareModelConversation,
} from "../src/chatHistory";

function request(prompt: unknown, referenceKey?: string): ParticipantHistoryItem {
  return {
    kind: "request",
    prompt,
    ...(referenceKey ? { referenceKey } : {}),
  };
}

function response(...parts: unknown[]): ParticipantHistoryItem {
  return { kind: "response", parts };
}

function markdown(text: string): unknown {
  return { kind: "markdown", text };
}

describe("participant chat history", () => {
  it("reproduces the log-analyzer design, short approval, and implementation follow-up", () => {
    const designHistory = [
      request("Design a log analyzer with streaming input."),
      response(markdown("Use a parser pipeline and bounded event queue.")),
    ];
    const approval = prepareModelConversation(designHistory, "yes and go try it");
    assert.deepStrictEqual(
      approval.messages.map((message) => [message.role, message.content]),
      [
        ["user", "Design a log analyzer with streaming input."],
        ["assistant", "Use a parser pipeline and bounded event queue."],
        ["user", "yes and go try it"],
      ]
    );

    const implementationFollowUp = prepareModelConversation(
      [
        ...designHistory,
        request("yes and go try it"),
        response(markdown("Implemented the parser, queue, and command wiring.")),
      ],
      "what tests should we add next?"
    );
    assert.deepStrictEqual(
      implementationFollowUp.messages.map((message) => message.content),
      [
        "Design a log analyzer with streaming input.",
        "Use a parser pipeline and bounded event queue.",
        "yes and go try it",
        "Implemented the parser, queue, and command wiring.",
        "what tests should we add next?",
      ]
    );
  });

  it("preserves ordered user and assistant messages for ordinary follow-ups", () => {
    const result = prepareModelConversation(
      [
        request("Compare SQLite and JSON storage."),
        response(markdown("SQLite supports richer queries.")),
        request("What about portability?"),
        response(markdown("JSON is easier to inspect and move.")),
      ],
      "Which should this extension use?"
    );

    assert.deepStrictEqual(result.messages, [
      { role: "user", content: "Compare SQLite and JSON storage." },
      { role: "assistant", content: "SQLite supports richer queries." },
      { role: "user", content: "What about portability?" },
      { role: "assistant", content: "JSON is easier to inspect and move." },
      { role: "user", content: "Which should this extension use?" },
    ]);
  });

  it("retains the resume seed and newest exchange for later short branch prompts", () => {
    const resumeSeed = [
      'Resuming from "Parser design".',
      "Prior context:",
      "Q: How should parsing work?",
      "A: Use a streaming parser.",
      "Follow-up: implement that branch",
      "<!-- conversation-roadmap:resume=node-resume-1 -->",
    ].join("\n");
    const result = prepareModelConversation(
      [
        request("Unrelated conversation before the resumed branch."),
        response(markdown("Old response.")),
        request(resumeSeed),
        response(markdown("I can implement the streaming parser next.")),
        request("yes and go try it"),
        response(markdown("The streaming parser is now implemented.")),
      ],
      "and add the edge-case tests",
      { maxHistoryMessages: 4, maxHistoryCharacters: 1000 }
    );

    assert.deepStrictEqual(
      result.messages.map((message) => message.content),
      [
        resumeSeed.replace(
          "\n<!-- conversation-roadmap:resume=node-resume-1 -->",
          ""
        ),
        "I can implement the streaming parser next.",
        "yes and go try it",
        "The streaming parser is now implemented.",
        "and add the edge-case tests",
      ]
    );
    assert.ok(
      result.messages.every(
        (message) => !message.content.includes("conversation-roadmap:resume")
      )
    );
  });

  it("prioritizes the newest resumed exchange under a very small message budget", () => {
    const resumeSeed =
      'Resuming from "Parser design".\nPrior context here.\n' +
      "<!-- conversation-roadmap:resume=node-resume-2 -->";
    const result = prepareModelConversation(
      [
        request(resumeSeed),
        response(markdown("Seed answer.")),
        request("yes and go try it"),
        response(markdown("Implementation completed.")),
      ],
      "and tests?",
      { maxHistoryMessages: 3, maxHistoryCharacters: 1000 }
    );

    assert.deepStrictEqual(
      result.messages.map((message) => [message.role, message.content]),
      [
        ["user", 'Resuming from "Parser design".\nPrior context here.'],
        ["user", "yes and go try it"],
        ["assistant", "Implementation completed."],
        ["user", "and tests?"],
      ]
    );
  });

  it("bounds oversized history while retaining newest coherent context", () => {
    const history: ParticipantHistoryItem[] = [];
    for (let index = 0; index < 8; index += 1) {
      history.push(
        request(`question-${index}-${"q".repeat(80)}`),
        response(markdown(`answer-${index}-${"a".repeat(80)}`))
      );
    }

    const result = prepareModelConversation(history, "current prompt", {
      maxHistoryMessages: 4,
      maxHistoryCharacters: 300,
    });
    const historyMessages = result.messages.slice(0, -1);

    assert.ok(historyMessages.length <= 4);
    assert.ok(
      historyMessages.reduce((total, message) => total + message.content.length, 0) <=
        300
    );
    assert.ok(historyMessages.some((message) => message.content.startsWith("question-7-")));
    assert.ok(historyMessages.some((message) => message.content.startsWith("answer-7-")));
    assert.strictEqual(
      result.messages[result.messages.length - 1]?.content,
      "current prompt"
    );
    assert.ok(result.omittedHistoryMessages > 0);
    assert.ok(result.omittedHistoryCharacters > 0);
  });

  it("reports retained historical reference keys in newest-context order", () => {
    const result = prepareModelConversation(
      [
        request("old question", "old-reference"),
        response(markdown("old answer")),
        request("new question", "new-reference"),
        response(markdown("new answer")),
      ],
      "continue",
      { maxHistoryMessages: 2, maxHistoryCharacters: 1000 }
    );

    assert.deepStrictEqual(result.retainedHistoryReferenceKeys, ["new-reference"]);
  });

  it("discloses compaction to the user and model without adding a prompt slot", () => {
    const result = prepareModelConversation(
      [
        request("old question"),
        response(markdown("old answer")),
        request("new question"),
        response(markdown("new answer")),
      ],
      "current request",
      { maxHistoryMessages: 2, maxHistoryCharacters: 1000 }
    );
    const disclosure = buildCompactionDisclosure(result);
    assert.ok(disclosure);
    assert.ok(disclosure!.userMessage.includes("2 earlier message(s)"));
    assert.ok(disclosure!.modelInstruction.includes("Do not infer"));

    const withInstruction = appendToCurrentPrompt(result.messages, [
      disclosure!.modelInstruction,
    ]);
    assert.strictEqual(withInstruction.length, result.messages.length);
    assert.strictEqual(
      withInstruction.filter((message) => message.content.includes("current request"))
        .length,
      1
    );
    assert.ok(withInstruction[withInstruction.length - 1].content.includes("Context compaction notice"));
  });

  it("does not emit a compaction disclosure when nothing was omitted", () => {
    const result = prepareModelConversation(
      [request("question"), response(markdown("answer"))],
      "continue"
    );
    assert.strictEqual(buildCompactionDisclosure(result), undefined);
  });

  it("reports the current Resume seed as retained when older history is omitted", () => {
    const result = prepareModelConversation(
      [request("old question"), response(markdown("old answer"))],
      "Resuming from here.\n<!-- conversation-roadmap:resume=resume-node -->"
    );
    const disclosure = buildCompactionDisclosure(result);

    assert.ok(disclosure);
    assert.ok(disclosure!.userMessage.includes("active Resume seed"));
    assert.strictEqual(result.messages.length, 1);
    assert.ok(result.messages[0].content.includes("Resuming from here."));
  });

  it("uses only textual Markdown response parts and ignores malformed content", () => {
    const result = prepareModelConversation(
      [
        response(markdown("orphan response")),
        request({ malformed: true }),
        response(markdown("response to malformed request")),
        request("Show the result."),
        response(
          { kind: "metadata", text: "hidden metadata" },
          { kind: "markdown", text: 42 },
          null,
          markdown("First paragraph."),
          { kind: "fileTree", value: ["secret.ts"] },
          markdown("\n\nSecond paragraph."),
          { kind: "button", value: { title: "Run" } }
        ),
      ],
      "continue"
    );

    assert.deepStrictEqual(result.messages, [
      { role: "user", content: "Show the result." },
      {
        role: "assistant",
        content: "First paragraph.\n\nSecond paragraph.",
      },
      { role: "user", content: "continue" },
    ]);
  });

  it("does not duplicate a current request that appears at the end of history", () => {
    const result = prepareModelConversation(
      [
        request("repeat this exact prompt"),
        response(markdown("Prior completed answer.")),
        request("repeat this exact prompt"),
      ],
      "repeat this exact prompt"
    );

    assert.deepStrictEqual(result.messages, [
      { role: "user", content: "repeat this exact prompt" },
      { role: "assistant", content: "Prior completed answer." },
      { role: "user", content: "repeat this exact prompt" },
    ]);
  });
});
