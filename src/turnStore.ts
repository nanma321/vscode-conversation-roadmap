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
import {
  blockStorageAfterLoadFailure,
  StorageBlockedError,
  StorageRecoveryDependencies,
} from "./storageRecovery";
import type { ReferenceRange } from "./referenceContext";
import {
  assertNoStorageBlockedMarker,
  clearStorageBlockedMarker,
  StorageFileLock,
  withStorageFileLock,
  writeStorageBlockedMarker,
} from "./storageFileGuard";

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
  /** Original attached selection, for location references. */
  range?: ReferenceRange;
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
  /** Number of model summarization calls already spent on this turn. */
  summarizationAttempts?: number;
}

const STORE_FILE_NAME = "turns.json";

interface StoreFileShape {
  version: 1;
  turns: TurnRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredReference(value: unknown): value is TurnReference {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.kind === "text" || value.kind === "uri" || value.kind === "location") &&
    typeof value.value === "string" &&
    (value.range === undefined ||
      (isRecord(value.range) &&
        isRecord(value.range.start) &&
        isRecord(value.range.end) &&
        Number.isSafeInteger(value.range.start.line) &&
        Number.isSafeInteger(value.range.start.character) &&
        Number.isSafeInteger(value.range.end.line) &&
        Number.isSafeInteger(value.range.end.character)))
  );
}

function isStoredTurn(value: unknown): value is TurnRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.sessionId === undefined || typeof value.sessionId === "string") &&
    typeof value.timestamp === "string" &&
    typeof value.request === "string" &&
    typeof value.response === "string" &&
    typeof value.completed === "boolean" &&
    (value.roadmapExcluded === undefined || typeof value.roadmapExcluded === "boolean") &&
    (value.resumeNodeId === undefined || typeof value.resumeNodeId === "string") &&
    (value.summarizationAttempts === undefined ||
      (Number.isSafeInteger(value.summarizationAttempts) &&
        (value.summarizationAttempts as number) >= 0)) &&
    (value.references === undefined ||
      (Array.isArray(value.references) && value.references.every(isStoredReference)))
  );
}

function parseStoreFile(value: unknown): StoreFileShape {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.turns) ||
    !value.turns.every(isStoredTurn)
  ) {
    throw new Error("turns.json does not match the supported version 1 storage shape");
  }
  return value as unknown as StoreFileShape;
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
  private blockedError: StorageBlockedError | undefined;
  private readonly changeListeners: Array<(turns: TurnRecord[]) => void> = [];
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageDir: string,
    private readonly recoveryDependencies: StorageRecoveryDependencies = {}
  ) {
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

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Loads persisted turns from disk into memory. Safe to call multiple times. */
  load(): Promise<TurnRecord[]> {
    return this.enqueueMutation(() => this.loadFromDisk());
  }

  private async loadFromDisk(
    heldLock?: StorageFileLock
  ): Promise<TurnRecord[]> {
    if (this.blockedError) {
      throw this.blockedError;
    }
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    const load = async (lock: StorageFileLock): Promise<TurnRecord[]> => {
      try {
        await this.cleanupOrphanedTempFiles();
        const raw = await fs.promises.readFile(this.filePath, "utf8");
        const parsed = parseStoreFile(JSON.parse(raw));
        // Normalize turns persisted before sessions/references existed so they
        // group under a single "legacy" session and have a well-formed
        // (empty) references array rather than appearing session-less or
        // throwing when consumers iterate over `references`.
        this.turns = parsed.turns.map((turn) => ({
          ...turn,
          sessionId: turn.sessionId || LEGACY_SESSION_ID,
          references: Array.isArray(turn.references) ? turn.references : [],
        }));
        await clearStorageBlockedMarker(this.filePath);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          this.turns = [];
          await clearStorageBlockedMarker(this.filePath);
        } else {
          this.turns = [];
          this.loaded = true;
          this.blockedError = new StorageBlockedError(
            "conversation transcript",
            this.filePath,
            err,
            undefined,
            new Error("diagnostic backup creation is still in progress")
          );
          this.blockedError = await blockStorageAfterLoadFailure(
            "conversation transcript",
            this.filePath,
            err,
            this.recoveryDependencies
          );
          try {
            await writeStorageBlockedMarker(this.filePath, this.blockedError);
          } catch (markerError) {
            lock.retain();
            this.blockedError = new StorageBlockedError(
              "conversation transcript",
              this.filePath,
              err,
              this.blockedError.backupPath,
              markerError
            );
          }
          throw this.blockedError;
        }
      }
      this.loaded = true;
      return this.getAll();
    };
    return heldLock
      ? load(heldLock)
      : withStorageFileLock(this.filePath, load);
  }

  /** Returns a defensive copy of all currently loaded turns, oldest first. */
  getAll(): TurnRecord[] {
    return this.turns.map((turn) => ({ ...turn }));
  }

  /** Appends a new turn and persists the full set atomically. */
  append(turn: TurnRecord): Promise<void> {
    return this.enqueueMutation(async () => {
      await fs.promises.mkdir(this.storageDir, { recursive: true });
      await withStorageFileLock(this.filePath, async (lock) => {
        await this.loadFromDisk(lock);
        this.assertWritable();
        const nextTurns = [...this.turns, { ...turn }];
        await this.persist(nextTurns, lock);
        this.turns = nextTurns;
      });
      this.emitChange();
    });
  }

  /**
   * Persists model-attempt counts without emitting a transcript change event,
   * preventing the summarizer from recursively scheduling itself.
   */
  setSummarizationAttempts(
    attemptsByTurnId: ReadonlyMap<string, number>
  ): Promise<void> {
    return this.enqueueMutation(async () => {
      await fs.promises.mkdir(this.storageDir, { recursive: true });
      await withStorageFileLock(this.filePath, async (lock) => {
        await this.loadFromDisk(lock);
        this.assertWritable();
        let changed = false;
        const nextTurns = this.turns.map((turn) => {
          const requestedAttempts = attemptsByTurnId.get(turn.id);
          if (requestedAttempts === undefined) {
            return turn;
          }
          const attempts = Math.max(
            turn.summarizationAttempts ?? 0,
            requestedAttempts
          );
          if (attempts === turn.summarizationAttempts) {
            return turn;
          }
          changed = true;
          return { ...turn, summarizationAttempts: attempts };
        });
        if (changed) {
          await this.persist(nextTurns, lock);
          this.turns = nextTurns;
        }
      });
    });
  }

  /**
   * Keeps every captured transcript but marks all current turns as ineligible
   * for future automatic graph generation. This metadata-only update does not
   * emit a transcript change because visible turn content is unchanged.
   */
  excludeAllFromRoadmap(): Promise<number> {
    return this.enqueueMutation(async () => {
      let changed = 0;
      await fs.promises.mkdir(this.storageDir, { recursive: true });
      await withStorageFileLock(this.filePath, async (lock) => {
        await this.loadFromDisk(lock);
        this.assertWritable();
        const nextTurns = this.turns.map((turn) => {
          if (turn.roadmapExcluded) {
            return turn;
          }
          changed += 1;
          return { ...turn, roadmapExcluded: true };
        });
        if (changed > 0) {
          await this.persist(nextTurns, lock);
          this.turns = nextTurns;
        }
      });
      return changed;
    });
  }

  private assertWritable(): void {
    if (this.blockedError) {
      throw this.blockedError;
    }
  }

  private async persist(
    turns: TurnRecord[],
    heldLock?: StorageFileLock
  ): Promise<void> {
    this.assertWritable();
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    const persist = async (): Promise<void> => {
      await assertNoStorageBlockedMarker("conversation transcript", this.filePath);
      const payload: StoreFileShape = { version: 1, turns };
      const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
      await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
      this.assertWritable();
      await fs.promises.rename(tempPath, this.filePath);
    };
    if (heldLock) {
      await persist();
    } else {
      await withStorageFileLock(this.filePath, persist);
    }
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
    const entries = await fs.promises.readdir(this.storageDir);
    const prefix = `${STORE_FILE_NAME}.tmp-`;
    for (const name of entries.filter((entry) => entry.startsWith(prefix))) {
      try {
        await fs.promises.unlink(path.join(this.storageDir, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          throw new Error(`Could not remove interrupted transcript write "${name}": ${String(error)}`);
        }
      }
    }
  }

  private async cleanupRecoveryArtifacts(): Promise<void> {
    const entries = await fs.promises.readdir(this.storageDir);
    const prefix = `${STORE_FILE_NAME}.recovery-`;
    for (const name of entries.filter((entry) => entry.startsWith(prefix))) {
      await fs.promises.unlink(path.join(this.storageDir, name));
    }
    await clearStorageBlockedMarker(this.filePath);
  }

  /**
   * Permanently deletes all locally stored turns: clears in-memory state,
   * removes `turns.json` (and any leftover temp file) from disk, and
   * notifies listeners with the now-empty set. Used by the "delete all
   * local data" command (Phase 9); irreversible, so callers must confirm
   * with the user before calling this.
   */
  deleteAll(): Promise<void> {
    return this.enqueueMutation(async () => {
      await fs.promises.mkdir(this.storageDir, { recursive: true });
      await withStorageFileLock(this.filePath, async (lock) => {
        await this.loadFromDisk(lock);
        this.assertWritable();
        await assertNoStorageBlockedMarker("conversation transcript", this.filePath);
        await this.cleanupOrphanedTempFiles();
        this.assertWritable();
        try {
          await fs.promises.unlink(this.filePath);
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code !== "ENOENT") {
            throw err;
          }
        }
        await this.cleanupRecoveryArtifacts();
      });
      this.turns = [];
      this.loaded = true;
      this.emitChange();
    });
  }
}
