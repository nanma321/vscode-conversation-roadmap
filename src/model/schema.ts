/**
 * Runtime schema validation for {@link RoadmapDocument} and its nested
 * shapes (Phase 2).
 *
 * There is no dependency on a JSON-schema library: the document shape is
 * small and stable enough that a hand-written structural validator is
 * easier to audit and keeps the extension's dependency surface minimal.
 * The exported {@link SCHEMA_DESCRIPTION} documents the shape declaratively
 * for reference/tests, while {@link validateRoadmapDocument} performs the
 * actual checks used by persistence.
 *
 * Per the Key Engineering Principles, all AI-generated and imported data
 * must be validated before it is trusted; this module is the single
 * gate all such data passes through before becoming part of a
 * {@link RoadmapDocument}.
 */
import {
  CURRENT_SCHEMA_VERSION,
  EdgeKind,
  NodeStatus,
  NodeType,
  Roadmap,
  RoadmapDocument,
  RoadmapEdge,
  RoadmapNode,
  RoadmapSettings,
  SourceReference,
} from "./types";
import { HEX_COLOR_PATTERN } from "./colorPattern";

/** Declarative description of the version-1 document schema, for documentation and tests. */
export const SCHEMA_DESCRIPTION = {
  version: CURRENT_SCHEMA_VERSION,
  description:
    "Version 1 of the roadmap document schema: a `version` number and a list of `roadmaps`, " +
    "each with `nodes`, `edges`, and `settings`.",
} as const;

const NODE_STATUSES: readonly NodeStatus[] = ["open", "in-progress", "done", "blocked"];
const NODE_TYPES: readonly NodeType[] = ["topic", "decision", "question", "task", "outcome", "blocker"];
const EDGE_KINDS: readonly EdgeKind[] = ["topic", "branch", "manual"];

/** The result of validating an unknown value against the roadmap document schema. */
export interface ValidationResult<T> {
  valid: boolean;
  /** Human-readable, path-prefixed error messages. Empty when `valid` is true. */
  errors: string[];
  /** The validated value, narrowed to `T`. Only meaningful when `valid` is true. */
  value?: T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function pushError(errors: string[], path: string, message: string): void {
  errors.push(`${path}: ${message}`);
}

function validateSourceReference(value: unknown, path: string, errors: string[]): value is SourceReference {
  if (!isPlainObject(value)) {
    pushError(errors, path, "must be an object");
    return false;
  }
  let ok = true;
  if (!isNonEmptyString(value.turnId)) {
    pushError(errors, `${path}.turnId`, "must be a non-empty string");
    ok = false;
  }
  if (!isNonEmptyString(value.sessionId)) {
    pushError(errors, `${path}.sessionId`, "must be a non-empty string");
    ok = false;
  }
  return ok;
}

function validateNodePosition(value: unknown, path: string, errors: string[]): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isPlainObject(value)) {
    pushError(errors, path, "must be an object when present");
    return false;
  }
  let ok = true;
  if (typeof value.x !== "number" || !Number.isFinite(value.x)) {
    pushError(errors, `${path}.x`, "must be a finite number");
    ok = false;
  }
  if (typeof value.y !== "number" || !Number.isFinite(value.y)) {
    pushError(errors, `${path}.y`, "must be a finite number");
    ok = false;
  }
  return ok;
}

function validateNode(value: unknown, path: string, errors: string[]): value is RoadmapNode {
  if (!isPlainObject(value)) {
    pushError(errors, path, "must be an object");
    return false;
  }
  let ok = true;
  if (!isNonEmptyString(value.id)) {
    pushError(errors, `${path}.id`, "must be a non-empty string");
    ok = false;
  }
  if (typeof value.title !== "string") {
    pushError(errors, `${path}.title`, "must be a string");
    ok = false;
  }
  if (typeof value.summary !== "string") {
    pushError(errors, `${path}.summary`, "must be a string");
    ok = false;
  }
  if (typeof value.status !== "string" || !NODE_STATUSES.includes(value.status as NodeStatus)) {
    pushError(errors, `${path}.status`, `must be one of ${NODE_STATUSES.join(", ")}`);
    ok = false;
  }
  if (value.nodeType !== undefined && !NODE_TYPES.includes(value.nodeType as NodeType)) {
    pushError(errors, `${path}.nodeType`, `must be one of ${NODE_TYPES.join(", ")} when present`);
    ok = false;
  }
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) {
    pushError(errors, `${path}.tags`, "must be an array of strings");
    ok = false;
  }
  if (typeof value.notes !== "string") {
    pushError(errors, `${path}.notes`, "must be a string");
    ok = false;
  }
  if (!validateNodePosition(value.position, `${path}.position`, errors)) {
    ok = false;
  }
  if (value.color !== undefined && (typeof value.color !== "string" || !HEX_COLOR_PATTERN.test(value.color))) {
    pushError(errors, `${path}.color`, "must be a #rgb or #rrggbb hex color string when present");
    ok = false;
  }
  if (value.highlighted !== undefined && typeof value.highlighted !== "boolean") {
    pushError(errors, `${path}.highlighted`, "must be a boolean when present");
    ok = false;
  }
  if (!Array.isArray(value.sourceRefs)) {
    pushError(errors, `${path}.sourceRefs`, "must be an array");
    ok = false;
  } else {
    value.sourceRefs.forEach((ref, i) => {
      if (!validateSourceReference(ref, `${path}.sourceRefs[${i}]`, errors)) {
        ok = false;
      }
    });
  }
  if (!isNonEmptyString(value.createdAt)) {
    pushError(errors, `${path}.createdAt`, "must be a non-empty string");
    ok = false;
  }
  if (!isNonEmptyString(value.updatedAt)) {
    pushError(errors, `${path}.updatedAt`, "must be a non-empty string");
    ok = false;
  }
  return ok;
}

function validateEdge(value: unknown, path: string, errors: string[]): value is RoadmapEdge {
  if (!isPlainObject(value)) {
    pushError(errors, path, "must be an object");
    return false;
  }
  let ok = true;
  if (!isNonEmptyString(value.id)) {
    pushError(errors, `${path}.id`, "must be a non-empty string");
    ok = false;
  }
  if (!isNonEmptyString(value.source)) {
    pushError(errors, `${path}.source`, "must be a non-empty string");
    ok = false;
  }
  if (!isNonEmptyString(value.target)) {
    pushError(errors, `${path}.target`, "must be a non-empty string");
    ok = false;
  }
  if (typeof value.kind !== "string" || !EDGE_KINDS.includes(value.kind as EdgeKind)) {
    pushError(errors, `${path}.kind`, `must be one of ${EDGE_KINDS.join(", ")}`);
    ok = false;
  }
  if (value.label !== undefined && typeof value.label !== "string") {
    pushError(errors, `${path}.label`, "must be a string when present");
    ok = false;
  }
  return ok;
}

function validateSettings(value: unknown, path: string, errors: string[]): value is RoadmapSettings {
  if (!isPlainObject(value)) {
    pushError(errors, path, "must be an object");
    return false;
  }
  let ok = true;
  if (typeof value.autoSummarize !== "boolean") {
    pushError(errors, `${path}.autoSummarize`, "must be a boolean");
    ok = false;
  }
  if (value.layout !== "auto" && value.layout !== "manual") {
    pushError(errors, `${path}.layout`, 'must be "auto" or "manual"');
    ok = false;
  }
  return ok;
}

function validateRoadmap(value: unknown, path: string, errors: string[]): value is Roadmap {
  if (!isPlainObject(value)) {
    pushError(errors, path, "must be an object");
    return false;
  }
  let ok = true;
  if (!isNonEmptyString(value.id)) {
    pushError(errors, `${path}.id`, "must be a non-empty string");
    ok = false;
  }
  if (typeof value.title !== "string") {
    pushError(errors, `${path}.title`, "must be a string");
    ok = false;
  }
  if (!isNonEmptyString(value.createdAt)) {
    pushError(errors, `${path}.createdAt`, "must be a non-empty string");
    ok = false;
  }
  if (!isNonEmptyString(value.updatedAt)) {
    pushError(errors, `${path}.updatedAt`, "must be a non-empty string");
    ok = false;
  }

  let nodeIds: Set<string> | undefined;
  if (!Array.isArray(value.nodes)) {
    pushError(errors, `${path}.nodes`, "must be an array");
    ok = false;
  } else {
    nodeIds = new Set();
    value.nodes.forEach((node, i) => {
      if (!validateNode(node, `${path}.nodes[${i}]`, errors)) {
        ok = false;
      } else {
        nodeIds!.add((node as RoadmapNode).id);
      }
    });
  }

  if (!Array.isArray(value.edges)) {
    pushError(errors, `${path}.edges`, "must be an array");
    ok = false;
  } else {
    value.edges.forEach((edge, i) => {
      if (!validateEdge(edge, `${path}.edges[${i}]`, errors)) {
        ok = false;
        return;
      }
      // Referential integrity: an edge must not dangle to a node that
      // doesn't exist in this roadmap, or invalid data could silently
      // corrupt the graph the user sees.
      const typedEdge = edge as RoadmapEdge;
      if (nodeIds && !nodeIds.has(typedEdge.source)) {
        pushError(errors, `${path}.edges[${i}].source`, `references unknown node id "${typedEdge.source}"`);
        ok = false;
      }
      if (nodeIds && !nodeIds.has(typedEdge.target)) {
        pushError(errors, `${path}.edges[${i}].target`, `references unknown node id "${typedEdge.target}"`);
        ok = false;
      }
    });
  }

  if (!validateSettings(value.settings, `${path}.settings`, errors)) {
    ok = false;
  }

  return ok;
}

/**
 * Validates an arbitrary parsed-JSON value as a version-{@link CURRENT_SCHEMA_VERSION}
 * {@link RoadmapDocument}. Callers that need to accept older documents should
 * migrate them first (see `migrations.ts`) and re-validate the result.
 */
export function validateRoadmapDocument(value: unknown): ValidationResult<RoadmapDocument> {
  const errors: string[] = [];

  if (!isPlainObject(value)) {
    return { valid: false, errors: ["document: must be an object"] };
  }
  if (typeof value.version !== "number" || !Number.isInteger(value.version)) {
    pushError(errors, "document.version", "must be an integer");
  } else if (value.version !== CURRENT_SCHEMA_VERSION) {
    pushError(
      errors,
      "document.version",
      `must equal the current schema version (${CURRENT_SCHEMA_VERSION}); got ${value.version}. Run migrations first.`
    );
  }

  let ok = errors.length === 0;
  if (!Array.isArray(value.roadmaps)) {
    pushError(errors, "document.roadmaps", "must be an array");
    ok = false;
  } else {
    const seenIds = new Set<string>();
    value.roadmaps.forEach((roadmap, i) => {
      if (!validateRoadmap(roadmap, `document.roadmaps[${i}]`, errors)) {
        ok = false;
      } else {
        const id = (roadmap as Roadmap).id;
        if (seenIds.has(id)) {
          pushError(errors, `document.roadmaps[${i}].id`, `duplicate roadmap id "${id}"`);
          ok = false;
        }
        seenIds.add(id);
      }
    });
  }

  if (!ok) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [], value: value as unknown as RoadmapDocument };
}
