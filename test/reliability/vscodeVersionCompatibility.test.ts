/**
 * Phase 9 reliability: the extension declares a minimum supported VS Code
 * version via `package.json#engines.vscode`. That declaration is only
 * trustworthy if the `@types/vscode` typings the extension is actually
 * compiled against are pinned to that *same* version - otherwise
 * `tsc` would happily accept a call to an API that only exists in some
 * newer VS Code release, and the extension would compile cleanly but fail
 * at runtime on the oldest version it claims to support.
 *
 * This test does not (and cannot, from a unit test) launch every supported
 * VS Code build; it instead asserts the one precondition that makes the
 * declared `engines.vscode` minimum meaningful: the installed `@types/vscode`
 * major/minor exactly matches it. `npm run compile` succeeding on top of
 * that is what actually verifies no API newer than the minimum is used
 * (see README's "Security, privacy, and reliability" section).
 */
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

interface PackageJson {
  engines?: { vscode?: string };
  devDependencies?: { "@types/vscode"?: string };
}

function readJson<T>(relativePath: string): T {
  // `npm test` always runs from the repository root, so resolving against
  // it (rather than `__dirname`, which is unavailable when ts-mocha loads
  // this file as an ES module) keeps this test independent of module mode.
  const filePath = path.join(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

/** Extracts the bare `major.minor.patch` from a semver range like `^1.90.0`. */
function bareVersion(range: string): string {
  return range.replace(/^[\^~]/, "");
}

describe("VS Code version compatibility (Phase 9)", () => {
  it("declares a minimum supported VS Code version in package.json#engines.vscode", () => {
    const pkg = readJson<PackageJson>("package.json");
    assert.ok(pkg.engines?.vscode, "package.json must declare engines.vscode");
  });

  it("pins @types/vscode to the same minimum version as engines.vscode, so tsc rejects any API newer than the declared minimum", () => {
    const pkg = readJson<PackageJson>("package.json");
    const enginesVersion = bareVersion(pkg.engines!.vscode!);
    const typesVersion = pkg.devDependencies?.["@types/vscode"];
    assert.ok(typesVersion, "package.json devDependencies must include @types/vscode");
    assert.ok(
      !/^[\^~]/.test(typesVersion!),
      `@types/vscode must be an exact version (no ^ or ~ range prefix), but was "${typesVersion}" - ` +
        "a caret/tilde range would let npm install install a newer typings package than the declared minimum"
    );
    // Compare the raw (un-stripped) @types/vscode string against the bare engines.vscode
    // version, since @types/vscode itself must never carry a range prefix (asserted above).
    assert.strictEqual(
      typesVersion,
      enginesVersion,
      "@types/vscode must be pinned to the same version as engines.vscode - a newer typings package " +
        "would let tsc silently accept APIs that do not exist on the declared minimum supported VS Code version"
    );
  });

  it("installs an @types/vscode package version that matches engines.vscode exactly (not just the declared range)", () => {
    const lock = readJson<{
      packages?: Record<string, { version?: string }>;
    }>("package-lock.json");
    const installed = lock.packages?.["node_modules/@types/vscode"]?.version;
    assert.ok(installed, "package-lock.json must record an installed @types/vscode version");
    const pkg = readJson<PackageJson>("package.json");
    const enginesVersion = bareVersion(pkg.engines!.vscode!);
    assert.strictEqual(
      installed,
      enginesVersion,
      `installed @types/vscode (${installed}) must match the minimum supported VS Code version (${enginesVersion}) ` +
        "declared by engines.vscode, otherwise compiling successfully does not guarantee the extension runs on " +
        "the oldest version it claims to support"
    );
  });
});
