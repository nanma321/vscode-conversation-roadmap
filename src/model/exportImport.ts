/**
 * Versioned JSON export/import for the roadmap document (Phase 8).
 *
 * Export is intentionally trivial: {@link exportRoadmapDocument} just
 * serializes the already-versioned {@link RoadmapDocument} produced by
 * `RoadmapStore` (see `types.ts#CURRENT_SCHEMA_VERSION`), so the exported
 * file *is* a valid on-disk document and nothing extra needs to round-trip.
 *
 * Import is the more delicate half, per the Key Engineering Principles - an
 * imported file is untrusted input exactly like a Webview message or an AI
 * response, and must never be allowed to silently overwrite a user's
 * existing roadmaps:
 *
 *   - {@link parseImportPayload} parses, migrates (old exports must still
 *     import - "a version-one export can round-trip without information
 *     loss"), and validates the raw text before anything from it is
 *     trusted.
 *   - {@link planImport} then decides how the parsed document combines with
 *     whatever is already persisted: roadmaps whose `id` doesn't collide
 *     are added as-is; a colliding id is *never* silently overwritten -
 *     the incoming roadmap is imported under a new, non-colliding id and
 *     the collision is reported back to the caller as a conflict so the
 *     user can decide (e.g. rename, delete the duplicate) rather than
 *     have data disappear.
 *
 * Both halves are pure/no-`vscode`-dependency so they can be unit-tested in
 * isolation; the extension host (`extension.ts`) wires them to
 * `vscode.window.showSaveDialog`/`showOpenDialog` and `RoadmapStore`.
 */
import { migrateRoadmapDocument, MigrationError } from "./migrations";
import { validateRoadmapDocument } from "./schema";
import { RoadmapDocument } from "./types";

/** The result of parsing+migrating+validating raw import text. Never throws. */
export interface ParsedImport {
  valid: boolean;
  /** Human-readable error messages. Empty when `valid` is true. */
  errors: string[];
  /** The parsed, migrated, validated document. Only meaningful when `valid` is true. */
  document?: RoadmapDocument;
}

/** One roadmap id collision found while planning an import. */
export interface ImportConflict {
  /** The id the incoming roadmap originally declared. */
  originalId: string;
  /** The non-colliding id the incoming roadmap was assigned instead. */
  importedAsId: string;
  reason: string;
}

/** The result of planning how a validated import document merges with the currently persisted document. */
export interface ImportPlan {
  /** The full document to persist: `existing`'s roadmaps plus every roadmap from the import (renamed where it collided). */
  document: RoadmapDocument;
  /** Ids of every roadmap that came from the import, after any renaming - i.e. what actually got added. */
  importedRoadmapIds: string[];
  /** Every id collision that was detected and resolved by renaming. Empty for a clean install / non-colliding import. */
  conflicts: ImportConflict[];
}

/**
 * Serializes `document` for export. The result is itself a valid
 * version-{@link RoadmapDocument.version} document, so it can be written
 * directly to a `.json` file and later fed back into
 * {@link parseImportPayload} unchanged.
 */
export function exportRoadmapDocument(document: RoadmapDocument): string {
  return JSON.stringify(document, null, 2);
}

/**
 * Parses `raw` (the untrusted text of an imported file) as a
 * {@link RoadmapDocument}: JSON-parses it, migrates it to
 * {@link CURRENT_SCHEMA_VERSION} if it declares an older version, then runs
 * it through {@link validateRoadmapDocument}. Never throws - any failure at
 * any stage (malformed JSON, an unmigratable version, a document that fails
 * validation even after migration) is reported as `{ valid: false, errors }`.
 */
export function parseImportPayload(raw: string): ParsedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { valid: false, errors: [`could not parse import file as JSON: ${(err as Error).message}`] };
  }

  let migrated: Record<string, unknown>;
  try {
    migrated = migrateRoadmapDocument(parsed);
  } catch (err) {
    if (err instanceof MigrationError) {
      return { valid: false, errors: [err.message] };
    }
    throw err;
  }

  const result = validateRoadmapDocument(migrated);
  if (!result.valid || !result.value) {
    return { valid: false, errors: result.errors };
  }
  return { valid: true, errors: [], document: result.value };
}

/** Generates an id of the form `${baseId}-imported` (or `-imported-2`, `-imported-3`, ...) that does not collide with any id in `existingIds`. */
function generateNonCollidingId(baseId: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }
  let n = 2;
  let candidate = `${baseId}-imported`;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}-imported-${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Plans merging `incoming` (an already-validated import) into `existing`
 * (the currently persisted document), without mutating either input.
 *
 * Every roadmap in `incoming` is kept: one whose `id` doesn't already exist
 * in `existing` is added unchanged; one that collides is imported under a
 * new id (its `id` field renamed to match) and reported as an
 * {@link ImportConflict} rather than overwriting the existing roadmap of
 * the same id, so an import can never destroy a user's existing graph.
 *
 * On a clean installation (`existing.roadmaps` is empty) every incoming
 * roadmap is added as-is with no conflicts, satisfying the exit criterion
 * that exported data can be imported into a clean installation.
 */
export function planImport(existing: RoadmapDocument, incoming: RoadmapDocument): ImportPlan {
  const existingIds = new Set(existing.roadmaps.map((r) => r.id));
  const conflicts: ImportConflict[] = [];
  const importedRoadmapIds: string[] = [];

  const importedRoadmaps = incoming.roadmaps.map((roadmap) => {
    if (!existingIds.has(roadmap.id)) {
      existingIds.add(roadmap.id);
      importedRoadmapIds.push(roadmap.id);
      return roadmap;
    }
    const newId = generateNonCollidingId(roadmap.id, existingIds);
    existingIds.add(newId);
    importedRoadmapIds.push(newId);
    conflicts.push({
      originalId: roadmap.id,
      importedAsId: newId,
      reason: `a roadmap with id "${roadmap.id}" already exists; imported as "${newId}" instead of overwriting it`,
    });
    return { ...roadmap, id: newId };
  });

  return {
    document: { version: existing.version, roadmaps: [...existing.roadmaps, ...importedRoadmaps] },
    importedRoadmapIds,
    conflicts,
  };
}
