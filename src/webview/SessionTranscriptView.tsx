/**
 * Raw conversation transcript view, grouped by chat session (Phase 5).
 *
 * The graph/outline views show *derived* roadmap nodes, which may summarize
 * or merge several turns together; this view instead lets a user browse the
 * original `@roadmap` request/response turns exactly as captured, grouped
 * by the chat session they came from (a new chat starts a new session -
 * see `chatParticipant.ts`/`turnStore.ts`). It follows the newest session by
 * default and lets the user click into any older one; turns persisted
 * before sessions existed are grouped under "Earlier turns".
 *
 * This is a read-only complement to the per-node transcript shown in
 * `NodeDetailsPanel` - it never posts messages to the extension host.
 */
import * as React from "react";
import type { TurnRecord } from "../turnStore";
import { LEGACY_SESSION_ID } from "../legacySessionId";
import { Markdown } from "./Markdown";
import { deriveSessionLabel } from "./sessionFilter";

interface SessionGroup {
  sessionId: string;
  turns: TurnRecord[];
}

function groupBySession(turns: TurnRecord[]): SessionGroup[] {
  const order: string[] = [];
  const map = new Map<string, TurnRecord[]>();
  for (const turn of turns) {
    const sessionId = turn.sessionId || LEGACY_SESSION_ID;
    if (!map.has(sessionId)) {
      order.push(sessionId);
      map.set(sessionId, []);
    }
    map.get(sessionId)!.push(turn);
  }
  return order.map((sessionId) => ({ sessionId, turns: map.get(sessionId)! }));
}

export function SessionTranscriptView(props: { turns: TurnRecord[] }): React.JSX.Element {
  const { turns } = props;
  const groups = React.useMemo(() => groupBySession(turns), [turns]);
  const latestSessionId = groups.length > 0 ? groups[groups.length - 1].sessionId : null;
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(latestSessionId);
  // Follow the newest session by default until the user deliberately clicks an older one.
  const [followLatest, setFollowLatest] = React.useState(true);

  React.useEffect(() => {
    if (followLatest || !groups.some((g) => g.sessionId === selectedSessionId)) {
      setSelectedSessionId(latestSessionId);
    }
  }, [latestSessionId, followLatest, groups, selectedSessionId]);

  if (groups.length === 0) {
    return (
      <p className="empty">
        No <code>@roadmap</code> turns captured yet.
      </p>
    );
  }

  const active = groups.find((g) => g.sessionId === selectedSessionId) ?? groups[groups.length - 1];

  return (
    <div className="session-transcript-view">
      <div className="session-chips" role="tablist" aria-label="Chat sessions">
        {groups.map((group) => {
          const label = deriveSessionLabel(group.sessionId, turns);
          const selected = group.sessionId === active.sessionId;
          return (
            <button
              key={group.sessionId}
              type="button"
              role="tab"
              aria-selected={selected}
              className={"session-chip" + (selected ? " selected" : "")}
              onClick={() => {
                setSelectedSessionId(group.sessionId);
                setFollowLatest(group.sessionId === latestSessionId);
              }}
            >
              {label} ({group.turns.length})
            </button>
          );
        })}
      </div>
      <ul className="session-turn-list" aria-label={`Turns in ${active.sessionId === LEGACY_SESSION_ID ? "Earlier turns" : "selected chat"}`}>
        {active.turns.map((turn) => (
          <li key={turn.id} className={"session-turn" + (turn.completed ? "" : " incomplete")}>
            <p className="transcript-meta">
              {turn.completed ? "complete" : "incomplete"} &middot; {turn.timestamp}
            </p>
            <p>
              <strong>Request:</strong> {turn.request}
            </p>
            <div className="transcript-response">
              <strong>Response:</strong>
              {turn.response ? <Markdown text={turn.response} /> : <span> (no response)</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
