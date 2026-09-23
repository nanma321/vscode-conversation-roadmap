export const CHAT_SESSION_METADATA_KEY = "conversationRoadmap";
export const ROADMAP_PARTICIPANT_ID = "roadmap.participant";

export interface ChatSessionMetadata {
  [CHAT_SESSION_METADATA_KEY]: {
    sessionId: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createChatSessionMetadata(sessionId: string): ChatSessionMetadata {
  return {
    [CHAT_SESSION_METADATA_KEY]: {
      sessionId,
    },
  };
}

export function readChatSessionId(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }
  const roadmapMetadata = metadata[CHAT_SESSION_METADATA_KEY];
  if (!isRecord(roadmapMetadata)) {
    return undefined;
  }
  const sessionId = roadmapMetadata.sessionId;
  return typeof sessionId === "string" && /^session-\d+-\d+$/.test(sessionId)
    ? sessionId
    : undefined;
}

/**
 * Recovers this chat's session id from the newest participant response.
 * Returning the id in ChatResult metadata lets interleaved chat tabs remain
 * independent without relying on a process-global "current chat" variable.
 */
export function resolveChatSessionId(
  responseMetadata: readonly unknown[],
  createSessionId: () => string
): string {
  for (let index = responseMetadata.length - 1; index >= 0; index -= 1) {
    const sessionId = readChatSessionId(responseMetadata[index]);
    if (sessionId) {
      return sessionId;
    }
  }
  return createSessionId();
}
