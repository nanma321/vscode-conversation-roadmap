/**
 * Atomic persistence for the domain-model {@link RoadmapDocument} (Phase 2).
 *
 * Mirrors the write pattern already established by `turnStore.ts` (write to
 * a temp file, then rename) so a crash mid-write cannot corrupt the
 * previously persisted document, and adds schema validation + migration on
 * load so invalid or stale data is never silently accepted:
 *
 * - On load, a document at an older schema version is migrated first, then
 *   validated; a document that is invalid (even after migration) is
 *   rejected and the store falls back to its last known-good in-memory
 *   state rather than persisting the bad data over the file on disk.
 * - On save, the document is validated before it is written; an invalid
 *   document is never written, so prior valid data on disk is preserved.
 */
import * as fs from "fs";
import * as path from "path";
import { CURRENT_SCHEMA_VERSION, RoadmapDocument, createEmptyDocument } from "./types";
import { validateRoadmapDocument } from "./schema";
import { migrateRoadmapDocument, MigrationError } from "./migrations";

const STORE_FILE_NAME = "roadmaps.json";

/** Thrown when a document fails schema validation (optionally after migration). */
export class RoadmapValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid roadmap document:\n${errors.join("\n")}`);
    this.name = "RoadmapValidationError";
  }
}

/**
 * Loads and persists a single {@link RoadmapDocument} to a JSON file on disk,
 * validating and migrating on the way in, and validating on the way out.
 */
export class RoadmapStore {
  private readonly filePath: string;
  private document: RoadmapDocument = createEmptyDocument();
  private loaded = false;

  constructor(private readonly storageDir: string) {
    this.filePath = path.join(storageDir, STORE_FILE_NAME);
  }

  /**
   * Loads the persisted document from disk into memory, migrating it to the
   * current schema version and validating it first. If the file does not
   * exist, starts from an empty document. If the file exists but is
   * unreadable, unparsable, or fails validation/migration, the in-memory
   * document falls back to empty *without touching the file on disk* -
   * corrupt input is never used as a basis for a subsequent write.
   */
  async load(): Promise<RoadmapDocument> {
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    await this.cleanupOrphanedTempFiles();
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const migrated = migrateRoadmapDocument(parsed);
      const result = validateRoadmapDocument(migrated);
      if (!result.valid || !result.value) {
        throw new RoadmapValidationError(result.errors);
      }
      this.document = result.value;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        this.document = createEmptyDocument();
      } else {
        // Corrupt file, failed migration, or failed validation: never throw
        // out of load() and never overwrite the file. Keep the safe, empty
        // in-memory document and leave the on-disk file untouched for
        // inspection/manual recovery.
        this.document = createEmptyDocument();
      }
    }
    this.loaded = true;
    return this.getDocument();
  }

  /** Returns a defensive deep copy of the currently loaded document. */
  getDocument(): RoadmapDocument {
    return JSON.parse(JSON.stringify(this.document)) as RoadmapDocument;
  }

  /**
   * Validates and atomically persists a full replacement document. Rejects
   * (throwing {@link RoadmapValidationError}) without writing anything if the
   * document is invalid, so the previously persisted, valid document on disk
   * is never overwritten by bad data.
   */
  async save(document: RoadmapDocument): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    const result = validateRoadmapDocument(document);
    if (!result.valid || !result.value) {
      throw new RoadmapValidationError(result.errors);
    }
    await this.persist(result.value);
    this.document = result.value;
  }

  private async persist(document: RoadmapDocument): Promise<void> {
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tempPath, JSON.stringify(document, null, 2), "utf8");
    await fs.promises.rename(tempPath, this.filePath);
  }

  /**
   * Removes any leftover `roadmaps.json.tmp-*` file from `storageDir`. Such
   * a file can only exist if a previous `save()` was interrupted (e.g. the
   * process crashed or the window was force-closed) between the temp-file
   * write and the atomic rename that replaces `roadmaps.json` - the rename
   * itself is a single filesystem operation, so `roadmaps.json` can never be
   * left partially written. Run at the start of every `load()` so recovery
   * happens automatically the next time the extension starts, without ever
   * touching the real `roadmaps.json`.
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
   * Permanently deletes the locally stored roadmap document: resets
   * in-memory state to an empty document and removes `roadmaps.json` (and
   * any leftover temp file) from disk. Used by the "delete all local data"
   * command (Phase 9); irreversible, so callers must confirm with the user
   * before calling this.
   */
  async deleteAll(): Promise<void> {
    this.document = createEmptyDocument();
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
  }
}

export { CURRENT_SCHEMA_VERSION };
export { MigrationError };
