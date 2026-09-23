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
import {
  blockStorageAfterLoadFailure,
  StorageBlockedError,
  StorageRecoveryDependencies,
} from "../storageRecovery";
import {
  assertNoStorageBlockedMarker,
  clearStorageBlockedMarker,
  StorageFileLock,
  withStorageFileLock,
  writeStorageBlockedMarker,
} from "../storageFileGuard";

const STORE_FILE_NAME = "roadmaps.json";

export interface RoadmapStoreAccess {
  load(): Promise<RoadmapDocument>;
  save(document: RoadmapDocument): Promise<void>;
  deleteAll(): Promise<void>;
}

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
  private blockedError: StorageBlockedError | undefined;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageDir: string,
    private readonly recoveryDependencies: StorageRecoveryDependencies = {}
  ) {
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
  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  load(): Promise<RoadmapDocument> {
    return this.enqueueOperation(() => this.loadFromDisk());
  }

  private async loadFromDisk(
    heldLock?: StorageFileLock
  ): Promise<RoadmapDocument> {
    if (this.blockedError) {
      throw this.blockedError;
    }
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    const load = async (lock: StorageFileLock): Promise<RoadmapDocument> => {
      try {
        await this.cleanupOrphanedTempFiles();
        const raw = await fs.promises.readFile(this.filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        const migrated = migrateRoadmapDocument(parsed);
        const result = validateRoadmapDocument(migrated);
        if (!result.valid || !result.value) {
          throw new RoadmapValidationError(result.errors);
        }
        this.document = result.value;
        await clearStorageBlockedMarker(this.filePath);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          this.document = createEmptyDocument();
          await clearStorageBlockedMarker(this.filePath);
        } else {
          this.document = createEmptyDocument();
          this.loaded = true;
          this.blockedError = new StorageBlockedError(
            "roadmap graph",
            this.filePath,
            err,
            undefined,
            new Error("diagnostic backup creation is still in progress")
          );
          this.blockedError = await blockStorageAfterLoadFailure(
            "roadmap graph",
            this.filePath,
            err,
            this.recoveryDependencies
          );
          try {
            await writeStorageBlockedMarker(this.filePath, this.blockedError);
          } catch (markerError) {
            lock.retain();
            this.blockedError = new StorageBlockedError(
              "roadmap graph",
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
      return this.getDocument();
    };
    return heldLock
      ? load(heldLock)
      : withStorageFileLock(this.filePath, load);
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
  save(document: RoadmapDocument): Promise<void> {
    return this.enqueueOperation(() => this.saveDirect(document));
  }

  private async saveDirect(
    document: RoadmapDocument,
    heldLock?: StorageFileLock
  ): Promise<void> {
    if (!this.loaded) {
      await this.loadFromDisk(heldLock);
    }
    this.assertWritable();
    const result = validateRoadmapDocument(document);
    if (!result.valid || !result.value) {
      throw new RoadmapValidationError(result.errors);
    }
    await this.persist(result.value, heldLock);
    this.document = result.value;
  }

  /**
   * Holds the same queue used by public load/save operations for a compound
   * read-model-write transaction. This prevents a Webview edit from being
   * overwritten by summarization that began from an older graph snapshot.
   */
  transaction<T>(
    operation: (store: RoadmapStoreAccess) => Promise<T>
  ): Promise<T> {
    return this.enqueueOperation(async () => {
      await fs.promises.mkdir(this.storageDir, { recursive: true });
      return withStorageFileLock(this.filePath, (lock) =>
        operation({
          load: () => this.loadFromDisk(lock),
          save: (document) => this.saveDirect(document, lock),
          deleteAll: () => this.deleteAllDirect(lock),
        })
      );
    });
  }

  private async persist(
    document: RoadmapDocument,
    heldLock?: StorageFileLock
  ): Promise<void> {
    this.assertWritable();
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    const persist = async (): Promise<void> => {
      await assertNoStorageBlockedMarker("roadmap graph", this.filePath);
      const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
      await fs.promises.writeFile(tempPath, JSON.stringify(document, null, 2), "utf8");
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
    const entries = await fs.promises.readdir(this.storageDir);
    const prefix = `${STORE_FILE_NAME}.tmp-`;
    for (const name of entries.filter((entry) => entry.startsWith(prefix))) {
      try {
        await fs.promises.unlink(path.join(this.storageDir, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          throw new Error(`Could not remove interrupted roadmap write "${name}": ${String(error)}`);
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

  private assertWritable(): void {
    if (this.blockedError) {
      throw this.blockedError;
    }
  }

  /**
   * Permanently deletes the locally stored roadmap document: resets
   * in-memory state to an empty document and removes `roadmaps.json` (and
   * any leftover temp file) from disk. Used by the "delete all local data"
   * command (Phase 9); irreversible, so callers must confirm with the user
   * before calling this.
   */
  deleteAll(): Promise<void> {
    return this.enqueueOperation(() => this.deleteAllDirect());
  }

  private async deleteAllDirect(heldLock?: StorageFileLock): Promise<void> {
    if (!this.loaded) {
      await this.loadFromDisk(heldLock);
    }
    this.assertWritable();
    const deleteStoredDocument = async (): Promise<void> => {
      await assertNoStorageBlockedMarker("roadmap graph", this.filePath);
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
    };
    if (heldLock) {
      await deleteStoredDocument();
    } else {
      await withStorageFileLock(this.filePath, deleteStoredDocument);
    }
    this.document = createEmptyDocument();
    this.loaded = true;
  }
}

export { CURRENT_SCHEMA_VERSION };
export { MigrationError };
