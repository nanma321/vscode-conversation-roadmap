import * as assert from "assert";
import {
  createChatSessionMetadata,
  readChatSessionId,
  resolveChatSessionId,
} from "../src/chatSession";

describe("chat session identity", () => {
  it("keeps a session stable from response metadata", () => {
    let created = 0;
    const sessionId = resolveChatSessionId(
      [createChatSessionMetadata("session-1790097908881-1")],
      () => {
        created += 1;
        return "session-2-1";
      }
    );

    assert.strictEqual(sessionId, "session-1790097908881-1");
    assert.strictEqual(created, 0);
  });

  it("keeps interleaved chats associated with their own metadata", () => {
    const chatA = createChatSessionMetadata("session-100-1");
    const chatB = createChatSessionMetadata("session-200-2");

    assert.strictEqual(resolveChatSessionId([chatA], () => "new-a"), "session-100-1");
    assert.strictEqual(resolveChatSessionId([chatB], () => "new-b"), "session-200-2");
    assert.strictEqual(
      resolveChatSessionId([chatA, { unrelated: true }, chatA], () => "new-a"),
      "session-100-1"
    );
  });

  it("creates separate sessions for new chats without participant history", () => {
    let counter = 0;
    const create = (): string => `session-300-${++counter}`;

    assert.strictEqual(resolveChatSessionId([], create), "session-300-1");
    assert.strictEqual(resolveChatSessionId([], create), "session-300-2");
  });

  it("ignores malformed or untrusted session metadata", () => {
    assert.strictEqual(readChatSessionId(undefined), undefined);
    assert.strictEqual(readChatSessionId({ conversationRoadmap: "wrong" }), undefined);
    assert.strictEqual(
      readChatSessionId({ conversationRoadmap: { sessionId: "another-chat" } }),
      undefined
    );
    assert.strictEqual(
      resolveChatSessionId(
        [{ conversationRoadmap: { sessionId: "another-chat" } }],
        () => "session-400-1"
      ),
      "session-400-1"
    );
  });
});
