export interface TagPreview {
  visible: string[];
  hidden: string[];
}

/** Limits only the graph-card preview; callers retain the complete tag array. */
export function previewTags(tags: readonly string[], maximumVisible = 3): TagPreview {
  const limit = Math.max(0, Math.floor(maximumVisible));
  return {
    visible: tags.slice(0, limit),
    hidden: tags.slice(limit),
  };
}
