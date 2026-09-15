/**
 * Phase 9: verifies the graph Webview's Content-Security-Policy is as
 * strict as its needs allow - no unrestricted defaults, no unnonced or
 * `unsafe-eval` script execution, and every resource directive scoped to
 * the extension's own Webview origin.
 */
import * as assert from "assert";
import { buildContentSecurityPolicy } from "../../src/webviewCsp";

describe("buildContentSecurityPolicy", () => {
  it("denies everything by default", () => {
    const csp = buildContentSecurityPolicy("vscode-webview://abc", "nonce-value");
    assert.ok(/default-src 'none'/.test(csp), "expected a default-deny default-src");
  });

  it("only allows scripts tagged with the current nonce, never 'unsafe-inline' or 'unsafe-eval'", () => {
    const csp = buildContentSecurityPolicy("vscode-webview://abc", "the-nonce");
    const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? "";
    assert.ok(scriptSrc.includes("'nonce-the-nonce'"), "script-src must include the per-load nonce");
    assert.ok(!scriptSrc.includes("unsafe-inline"), "script-src must not allow unsafe-inline");
    assert.ok(!scriptSrc.includes("unsafe-eval"), "script-src must not allow unsafe-eval");
    assert.ok(!scriptSrc.includes("*"), "script-src must not use a wildcard source");
  });

  it("scopes image/font/style sources to the Webview's own cspSource, not an arbitrary remote origin", () => {
    const cspSource = "vscode-webview://abc123";
    const csp = buildContentSecurityPolicy(cspSource, "n");
    assert.ok(csp.includes(`style-src ${cspSource}`));
    assert.ok(csp.includes(`img-src ${cspSource}`));
    assert.ok(csp.includes(`font-src ${cspSource}`));
    assert.ok(!/https:|http:/.test(csp), "the policy must not allow any generic remote http(s) origin");
  });

  it("produces a distinct nonce-scoped policy per call, so a leaked nonce cannot be reused across loads", () => {
    const first = buildContentSecurityPolicy("vscode-webview://abc", "nonce-one");
    const second = buildContentSecurityPolicy("vscode-webview://abc", "nonce-two");
    assert.notStrictEqual(first, second);
  });
});
