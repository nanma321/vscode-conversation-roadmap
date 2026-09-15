/**
 * Shared helpers for reading and writing the single "default" roadmap that
 * both the graph Webview (`webviewPanel.ts`) and the incremental
 * summarization service (`summarization/summarizationService.ts`) operate on.
 *
 * Extracting these here guarantees both call sites resolve, create, and
 * persist the *same* roadmap (same id, same shape), so a turn summarized into
 * the roadmap by the background summarizer is exactly the roadmap the open
 * Webview renders. Kept dependency-free (no `vscode`) so it stays unit-testable.
 */
import { RoadmapStore } from "./roadmapStore";
import { createDefaultSettings, Roadmap, RoadmapDocument } from "./types";

/** Single roadmap the graph Webview and summarizer read/write for now; multi-roadmap selection is a later phase. */
export const DEFAULT_ROADMAP_ID = "default";

/**
 * Returns the single default roadmap from `document`, creating (but not yet
 * persisting) an empty one if it doesn't exist. When it had to be created, the
 * returned `document` is a new object (distinct from the input), so callers can
 * detect that and persist it.
 */
export function getOrCreateDefaultRoadmap(document: RoadmapDocument): { roadmap: Roadmap; document: RoadmapDocument } {
  const existing = document.roadmaps.find((r) => r.id === DEFAULT_ROADMAP_ID);
  if (existing) {
    return { roadmap: existing, document };
  }
  const now = new Date().toISOString();
  const roadmap: Roadmap = {
    id: DEFAULT_ROADMAP_ID,
    title: "Roadmap",
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    settings: createDefaultSettings(),
  };
  return { roadmap, document: { ...document, roadmaps: [...document.roadmaps, roadmap] } };
}

/** Loads (creating if necessary) the default roadmap, persisting it if it had to be created. */
export async function loadDefaultRoadmap(store: RoadmapStore): Promise<Roadmap> {
  const doc = await store.load();
  const { roadmap, document } = getOrCreateDefaultRoadmap(doc);
  if (document !== doc) {
    await store.save(document);
  }
  return roadmap;
}

/** Persists `roadmap` back into its document, replacing the prior copy of the same id. */
export async function saveRoadmap(store: RoadmapStore, roadmap: Roadmap): Promise<void> {
  const doc = await store.load();
  const nextRoadmaps = doc.roadmaps.some((r) => r.id === roadmap.id)
    ? doc.roadmaps.map((r) => (r.id === roadmap.id ? roadmap : r))
    : [...doc.roadmaps, roadmap];
  await store.save({ ...doc, roadmaps: nextRoadmaps });
}
