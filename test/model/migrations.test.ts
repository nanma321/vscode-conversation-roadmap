import * as assert from "assert";
import { migrateRoadmapDocument, MigrationError } from "../../src/model/migrations";
import { validateRoadmapDocument } from "../../src/model/schema";
import { CURRENT_SCHEMA_VERSION, createEmptyDocument } from "../../src/model/types";

describe("migrateRoadmapDocument", () => {
  it("passes a document already at the current version through unchanged", () => {
    const doc = createEmptyDocument();
    const migrated = migrateRoadmapDocument(doc);
    assert.strictEqual(migrated.version, CURRENT_SCHEMA_VERSION);
    assert.deepStrictEqual(migrated, doc);
  });

  it("produces a document that still passes schema validation", () => {
    const doc = createEmptyDocument();
    const migrated = migrateRoadmapDocument(doc);
    const result = validateRoadmapDocument(migrated);
    assert.strictEqual(result.valid, true);
  });

  it("throws MigrationError for a non-object input", () => {
    assert.throws(() => migrateRoadmapDocument("nope"), MigrationError);
  });

  it("throws MigrationError when the version field is missing", () => {
    assert.throws(() => migrateRoadmapDocument({ roadmaps: [] }), MigrationError);
  });

  it("throws MigrationError when the document version is newer than supported", () => {
    assert.throws(
      () => migrateRoadmapDocument({ version: CURRENT_SCHEMA_VERSION + 1, roadmaps: [] }),
      MigrationError
    );
  });

  it("throws MigrationError when no migration path exists for an older version", () => {
    // Version 0 predates any registered migration step, so there is no path forward.
    assert.throws(() => migrateRoadmapDocument({ version: 0, roadmaps: [] }), MigrationError);
  });
});
