/**
 * Pure storage logic for captured `@roadmap` conversation turns.
 *
 * Deliberately has no dependency on the `vscode` module so it can be
 * unit-tested in isolation and so the persistence format can be validated
 * without spinning up the extension host. `extension.ts` wires this module
 * to a concrete directory derived from `vscode.ExtensionContext.globalStorageUri`.
 */
import * as fs from "fs";
import * as path from "path";
import { LEGACY_SESSION_ID } from "./legacySessionId";

/** Re-exported for backward compatibility; import directly from `legacySessionId.ts` in browser-bundled (Webview) code to avoid pulling in this module's `fs`/`path` dependency. */
export { LEGACY_SESSION_ID };

/**
 * A reference (e.g. a file, selection, or other attached context) that was
 * part of a captured request. Only reference value kinds the extension
 * knows how to serialize safely are ever stored here; see
 * `turnCapture.ts#extractSupportedReferences` for the filtering logic.
 */
export interface TurnReference {
  /** Identifier for this kind of reference, as assigned by VS Code. */
  id: string;
  /** Optional human-readable description of the reference, if supplied. */
  description?: string;
  /** Which supported shape the original reference value had. */
  kind: "text" | "uri" | "location";
  /** Serialized textual representation of the reference's value. */
  value: string;
}

/** A single captured request/response exchange with the `@roadmap` participant. */
export interface TurnRecord {
  /** Stable identifier for this turn, assigned once when the turn is captured (Phase 3). */
  id: string;
  /**
   * Identifier grouping turns that belong to the same chat conversation. A new
   * chat starts a new session (see `chatParticipant.ts`), so the graph can show
   * a fresh roadmap per chat while keeping older sessions selectable. Turns
   * persisted before sessions existed are normalized to `"legacy"` on load.
   */
  sessionId: string;
  /** ISO-8601 timestamp of when the turn was recorded. */
  timestamp: string;
  /** The user's request text, exactly as received by the participant handler. */
  request: string;
  /** The concatenated response text produced by the participant, if any. */
  response: string;
  /** Whether the response completed successfully (false for cancelled/errored turns). */
  completed: boolean;
  /**
   * True when the user cleared all roadmap graphs while retaining transcripts.
   * Excluded turns stay readable but are never automatically summarized again.
   */
  roadmapExcluded?: boolean;
  /** Existing resume placeholder node this turn was submitted from, when applicable. */
  resumeNodeId?: string;
  /**
   * Supported references attached to the request (e.g. files or selections).
   * Turns persisted before references were captured are normalized to `[]` on load.
   */
  references: TurnReference[];
}

const STORE_FILE_NAME = "turns.json";

interface StoreFileShape {
  version: 1;
  turns: TurnRecord[];
}

/**
 * Loads and persists {@link TurnRecord} entries to a single JSON file on disk.
 * All reads/writes are synchronous-in-effect (awaited) and the whole file is
 * rewritten atomically (write to temp file + rename) so a crash mid-write
 * cannot corrupt previously stored turns.
 */
export class TurnStore {
  private readonly filePath: string;
  private turns: TurnRecord[] = [];
  private loaded = false;
  private readonly changeListeners: Array<(turns: TurnRecord[]) => void> = [];

  constructor(private readonly storageDir: string) {
    this.filePath = path.join(storageDir, STORE_FILE_NAME);
  }

  /**
   * Registers a listener invoked whenever the set of turns changes (e.g. a new
   * turn is appended). Returns an unsubscribe function. Used by the graph
   * Webview to refresh in real time as `@roadmap` turns are captured.
   */
  onDidChange(listener: (turns: TurnRecord[]) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      const index = this.changeListeners.indexOf(listener);
      if (index !== -1) {
        this.changeListeners.splice(index, 1);
      }
    };
  }

  private emitChange(): void {
    const snapshot = this.getAll();
    for (const listener of this.changeListeners) {
      listener(snapshot);
    }
  }

  /** Loads persisted turns from disk into memory. Safe to call multiple times. */
  async load(): Promise<TurnRecord[]> {
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    await this.cleanupOrphanedTempFiles();
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreFileShape;
      const loaded = Array.isArray(parsed.turns) ? parsed.turns : [];
      // Normalize turns persisted before sessions/references existed so they
      // group under a single "legacy" session and have a well-formed
      // (empty) references array rather than appearing session-less or
      // throwing when consumers iterate over `references`.
      this.turns = loaded.map((turn) => ({
        ...turn,
        sessionId: turn.sessionId || LEGACY_SESSION_ID,
        references: Array.isArray(turn.references) ? turn.references : [],
      }));
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        this.turns = [];
      } else {
        // Corrupt or unreadable file: do not throw and do not silently delete data.
        // Start from an empty in-memory list but leave the file on disk for inspection.
        this.turns = [];
      }
    }
    this.loaded = true;
    return this.getAll();
  }

  /** Returns a defensive copy of all currently loaded turns, oldest first. */
  getAll(): TurnRecord[] {
    return this.turns.map((turn) => ({ ...turn }));
  }

  /** Appends a new turn and persists the full set atomically. */
  async append(turn: TurnRecord): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    this.turns.push({ ...turn });
    await this.persist();
    this.emitChange();
  }

  /**
   * Keeps every captured transcript but marks all current turns as ineligible
   * for future automatic graph generation. This metadata-only update does not
   * emit a transcript change because visible turn content is unchanged.
   */
  async excludeAllFromRoadmap(): Promise<number> {
    if (!this.loaded) {
      await this.load();
    }
    let changed = 0;
    this.turns = this.turns.map((turn) => {
      if (turn.roadmapExcluded) {
        return turn;
      }
      changed += 1;
      return { ...turn, roadmapExcluded: true };
    });
    if (changed > 0) {
      await this.persist();
    }
    return changed;
  }

  private async persist(): Promise<void> {
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    const payload: StoreFileShape = { version: 1, turns: this.turns };
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.promises.rename(tempPath, this.filePath);
  }

  /**
   * Removes any leftover `turns.json.tmp-*` file from `storageDir`. Such a
   * file can only exist if a previous write was interrupted (e.g. the
   * process crashed or the window was force-closed) between the temp-file
   * write and the atomic rename that replaces `turns.json` - the rename
   * itself is a single filesystem operation, so `turns.json` can never be
   * left partially written. Run at the start of every `load()` so recovery
   * happens automatically the next time the extension starts, without ever
   * touching the real `turns.json`.
   */
  private async cleanupOrphanedTempFiles(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(this.storageDir);
    } catch {
      return;
    }
    const prefix = `${STORE_FILE_NAME}.tmp-`;
    await Promise.all(
      entries
        .filter((name) => name.startsWith(prefix))
        .map((name) => fs.promises.unlink(path.join(this.storageDir, name)).catch(() => undefined))
    );
  }

  /**
   * Permanently deletes all locally stored turns: clears in-memory state,
   * removes `turns.json` (and any leftover temp file) from disk, and
   * notifies listeners with the now-empty set. Used by the "delete all
   * local data" command (Phase 9); irreversible, so callers must confirm
   * with the user before calling this.
   */
  async deleteAll(): Promise<void> {
    this.turns = [];
    this.loaded = true;
    await this.cleanupOrphanedTempFiles();
    try {
      await fs.promises.unlink(this.filePath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        throw err;
      }
    }
    this.emitChange();
  }
}
