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

/** A single captured request/response exchange with the `@roadmap` participant. */
export interface TurnRecord {
  /** Stable identifier for this turn (spike-level: not yet a full session model, see Phase 3). */
  id: string;
  /** ISO-8601 timestamp of when the turn was recorded. */
  timestamp: string;
  /** The user's request text, exactly as received by the participant handler. */
  request: string;
  /** The concatenated response text produced by the participant, if any. */
  response: string;
  /** Whether the response completed successfully (false for cancelled/errored turns). */
  completed: boolean;
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

  constructor(private readonly storageDir: string) {
    this.filePath = path.join(storageDir, STORE_FILE_NAME);
  }

  /** Loads persisted turns from disk into memory. Safe to call multiple times. */
  async load(): Promise<TurnRecord[]> {
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreFileShape;
      this.turns = Array.isArray(parsed.turns) ? parsed.turns : [];
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
  }

  private async persist(): Promise<void> {
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    const payload: StoreFileShape = { version: 1, turns: this.turns };
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.promises.rename(tempPath, this.filePath);
  }
}
