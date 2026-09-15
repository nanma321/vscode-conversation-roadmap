/**
 * Bundles the graph Webview's React app (Phase 5) into a single browser
 * script + stylesheet under `media/`, which `webviewPanel.ts` loads via
 * `webview.asWebviewUri`. Kept separate from the `tsc` build that compiles
 * the extension host: the Webview runs in a browser context (DOM APIs,
 * JSX) while the host runs in Node, so the two have incompatible
 * TypeScript `lib` requirements and are built with different tools.
 */
const esbuild = require("esbuild");
const path = require("path");

const watch = process.argv.includes("--watch");

async function main() {
  const options = {
    entryPoints: [path.join(__dirname, "src", "webview", "main.tsx")],
    bundle: true,
    outfile: path.join(__dirname, "media", "graph.js"),
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    sourcemap: true,
    logLevel: "info",
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  } else {
    await esbuild.build(options);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
