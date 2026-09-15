/**
 * Session id assigned to {@link TurnRecord}s persisted before sessions
 * existed (see `turnStore.ts`).
 *
 * Kept in its own module (rather than exported from `turnStore.ts`) because
 * `turnStore.ts` pulls in Node's `fs`/`path` modules, which cannot be
 * bundled into the graph Webview (`src/webview/`, a browser bundle built by
 * `esbuild.js`). This constant needs to be usable from both.
 */
export const LEGACY_SESSION_ID = "legacy";
