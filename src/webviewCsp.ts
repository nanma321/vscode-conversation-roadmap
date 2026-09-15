/**
 * Builds the Webview Content-Security-Policy string (Phase 9 hardening).
 * Kept as a small, `vscode`-free pure function - like `webviewMessages.ts`'s
 * validation logic - so the exact policy the graph Webview runs under can
 * be asserted in a unit test without needing the extension host, and so a
 * future change to it is a single, auditable place to review.
 *
 * The policy is intentionally as strict as the Webview's needs allow:
 * - `default-src 'none'` denies everything not explicitly allowed below,
 *   including any `connect-src`/`frame-src`/`object-src`/`worker-src` the
 *   bundled script might otherwise be able to reach.
 * - `script-src` only allows the single inline bootstrap script and the
 *   bundled `graph.js`, both tagged with the same per-load `nonce` - no
 *   `'unsafe-inline'` or `'unsafe-eval'`, so no other script (injected via
 *   an XSS in rendered content, for example) can ever execute.
 * - `style-src` allows `'unsafe-inline'` only because React itself sets
 *   inline `style` attributes for node colors/positions; it cannot inject
 *   `<script>` tags, so this does not weaken the script restriction above.
 * - `img-src`/`font-src` are scoped to `webview.cspSource` (plus `data:`
 *   for `img-src`, needed for any inlined icons) so only resources shipped
 *   with the extension - never arbitrary remote URLs - can load.
 */
export function buildContentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
  ].join("; ");
}
