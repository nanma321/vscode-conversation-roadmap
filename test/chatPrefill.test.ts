import * as assert from "assert";
import {
  CONTINUE_ROADMAP_COMMAND,
  ROADMAP_MENTION,
  ChatPrefillHost,
  prefillChat,
  tryPrefillChat,
} from "../src/chatPrefill";

function host(commands: string[], executeError?: Error): {
  value: ChatPrefillHost;
  executed: Array<{ command: string; query: string; isPartialQuery: true }>;
  clipboard: string[];
  messages: string[];
} {
  const executed: Array<{ command: string; query: string; isPartialQuery: true }> = [];
  const clipboard: string[] = [];
  const messages: string[] = [];
  return {
    executed,
    clipboard,
    messages,
    value: {
      getCommands: async () => commands,
      executeCommand: async (command, args) => {
        if (executeError) {
          throw executeError;
        }
        executed.push({
          command,
          query: args.query,
          isPartialQuery: args.isPartialQuery,
        });
      },
      writeClipboard: async (text) => {
        clipboard.push(text);
      },
      showInformationMessage: (message) => {
        messages.push(message);
      },
    },
  };
}

describe("chat continuation prefill", () => {
  it("defines the Command Palette fallback and participant mention", () => {
    assert.strictEqual(CONTINUE_ROADMAP_COMMAND, "conversationRoadmap.continueChat");
    assert.strictEqual(ROADMAP_MENTION, "@roadmap ");
  });

  it("prefills chat when the chat-open command is available", async () => {
    const testHost = host(["workbench.action.chat.open"]);
    const outcome = await prefillChat(testHost.value, ROADMAP_MENTION, "copied");

    assert.strictEqual(outcome, "prefilled");
    assert.deepStrictEqual(testHost.executed, [
      {
        command: "workbench.action.chat.open",
        query: "@roadmap ",
        isPartialQuery: true,
      },
    ]);
    assert.deepStrictEqual(testHost.clipboard, []);
    assert.deepStrictEqual(testHost.messages, []);
  });

  it("copies the query and explains the fallback when chat-open is unavailable", async () => {
    const testHost = host([]);
    const outcome = await prefillChat(testHost.value, ROADMAP_MENTION, "Mention copied");

    assert.strictEqual(outcome, "copied");
    assert.deepStrictEqual(testHost.clipboard, ["@roadmap "]);
    assert.deepStrictEqual(testHost.messages, ["Mention copied"]);
  });

  it("uses the same explicit fallback when chat-open fails", async () => {
    const testHost = host(["workbench.action.chat.open"], new Error("command failed"));
    const outcome = await prefillChat(testHost.value, ROADMAP_MENTION, "Mention copied");

    assert.strictEqual(outcome, "copied");
    assert.deepStrictEqual(testHost.clipboard, ["@roadmap "]);
    assert.deepStrictEqual(testHost.messages, ["Mention copied"]);
  });

  it("automatic prefill never changes the clipboard when the command is unavailable", async () => {
    const testHost = host([]);
    const outcome = await tryPrefillChat(testHost.value, ROADMAP_MENTION);

    assert.strictEqual(outcome, "unavailable");
    assert.deepStrictEqual(testHost.clipboard, []);
    assert.deepStrictEqual(testHost.messages, []);
  });

  it("automatic prefill uses partial-query mode without submitting", async () => {
    const testHost = host(["workbench.action.chat.open"]);
    const outcome = await tryPrefillChat(testHost.value, ROADMAP_MENTION);

    assert.strictEqual(outcome, "prefilled");
    assert.deepStrictEqual(testHost.executed, [
      {
        command: "workbench.action.chat.open",
        query: "@roadmap ",
        isPartialQuery: true,
      },
    ]);
  });
});
