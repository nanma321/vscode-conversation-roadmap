/**
 * Shared validation pattern for the `RoadmapNode.color` field (Phase 5).
 *
 * Extracted so `model/schema.ts` (which validates documents loaded from
 * disk) and `webviewMessages.ts` (which validates messages from the graph
 * Webview) can never silently drift apart on what counts as a valid color.
 */

/** Matches `#rgb` or `#rrggbb`, the only node color shapes the graph Webview (Phase 5) accepts. */
export const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
