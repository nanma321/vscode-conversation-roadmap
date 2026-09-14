/**
 * Schema migration infrastructure for the roadmap document format (Phase 2).
 *
 * Each migration upgrades a document from exactly one schema version to the
 * next. `migrateRoadmapDocument` walks the chain from whatever version a
 * document declares up to {@link CURRENT_SCHEMA_VERSION}, so old exports and
 * on-disk files keep working after a schema change (a stated exit criterion:
 * "a version-one export can round-trip without information loss").
 *
 * There is deliberately no migration registered *to* version 1: version 1 is
 * the baseline shape produced by `createEmptyDocument()`/`RoadmapStore`, so
 * documents already at version 1 pass through unchanged. When a version 2
 * ships, add a `{ from: 1, to: 2, migrate(doc) { ... } }` entry below.
 */
import { CURRENT_SCHEMA_VERSION } from "./types";

/** A single step that upgrades a raw (not yet validated) document from one version to the next. */
export interface Migration {
  from: number;
  to: number;
  migrate: (document: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Ordered list of migrations, one per version bump. Kept in ascending `from`
 * order; {@link migrateRoadmapDocument} looks up the applicable step for the
 * document's current version on each iteration rather than assuming order,
 * so the list can be extended without renumbering existing entries.
 */
const MIGRATIONS: Migration[] = [];

/** Thrown when a document's declared version cannot be migrated to {@link CURRENT_SCHEMA_VERSION}. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Migrates a raw parsed-JSON document up to {@link CURRENT_SCHEMA_VERSION}.
 * Does not perform full schema validation - callers must still run the
 * result through {@link validateRoadmapDocument} (see `schema.ts`) before
 * trusting it, since a migration only guarantees the version number was
 * advanced, not that every field is well-formed.
 *
 * Throws {@link MigrationError} if the document has no usable version, or
 * if its version is newer than what this build understands (e.g. the file
 * was written by a newer version of the extension).
 */
export function migrateRoadmapDocument(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new MigrationError("document must be an object to migrate");
  }
  let document = raw;
  let version = typeof document.version === "number" ? document.version : undefined;
  if (version === undefined) {
    throw new MigrationError("document is missing a numeric 'version' field");
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `document version ${version} is newer than the highest version this extension supports (${CURRENT_SCHEMA_VERSION})`
    );
  }

  // Guard against an infinite loop if a migration's `to` doesn't advance the version.
  const maxSteps = MIGRATIONS.length + 1;
  let steps = 0;
  while (version !== CURRENT_SCHEMA_VERSION) {
    if (steps >= maxSteps) {
      throw new MigrationError(`no migration path found from version ${version} to ${CURRENT_SCHEMA_VERSION}`);
    }
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      throw new MigrationError(`no migration found for version ${version}`);
    }
    document = step.migrate(document);
    version = typeof document.version === "number" ? document.version : step.to;
    steps += 1;
  }
  return document;
}
