/**
 * Phase 10 release preparation: verifies package.json declares the
 * Marketplace metadata, command descriptions/icons, and settings required
 * before packaging a VSIX for distribution, and that the referenced icon
 * file actually exists on disk.
 */
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

interface CommandContribution {
  command: string;
  title: string;
  category?: string;
  icon?: string;
}

interface PackageJson {
  publisher?: string;
  license?: string;
  icon?: string;
  repository?: { type?: string; url?: string };
  keywords?: string[];
  galleryBanner?: { color?: string; theme?: string };
  contributes?: {
    commands?: CommandContribution[];
    configuration?: { properties?: Record<string, unknown> };
  };
}

function readJson<T>(relativePath: string): T {
  // `npm test` always runs from the repository root.
  const filePath = path.join(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

describe("Marketplace metadata (Phase 10)", () => {
  const pkg = readJson<PackageJson>("package.json");

  it("declares publisher, license, and repository metadata", () => {
    assert.ok(pkg.publisher, "package.json must declare a publisher");
    assert.ok(pkg.license, "package.json must declare a license");
    assert.ok(pkg.repository?.url, "package.json must declare a repository url");
  });

  it("declares an icon and the icon file exists under media/", () => {
    assert.ok(pkg.icon, "package.json must declare an icon");
    const iconPath = path.join(process.cwd(), pkg.icon!);
    assert.ok(fs.existsSync(iconPath), `icon file ${pkg.icon} referenced by package.json must exist`);
  });

  it("declares keywords for Marketplace discoverability", () => {
    assert.ok(pkg.keywords && pkg.keywords.length > 0, "package.json must declare at least one keyword");
  });

  it("gives every command a title, category, and icon", () => {
    const commands = pkg.contributes?.commands ?? [];
    assert.ok(commands.length > 0, "package.json must declare commands");
    for (const command of commands) {
      assert.ok(command.title, `command ${command.command} must have a title`);
      assert.ok(command.category, `command ${command.command} must have a category`);
      assert.ok(command.icon, `command ${command.command} must have an icon`);
      assert.ok(
        !command.title.startsWith(`${command.category}:`) && !command.title.startsWith("Roadmap:"),
        `command ${command.command} title must not repeat its category`
      );
    }
  });

  it("declares the onboarding command that reopens the known-limitations notice", () => {
    const commands = pkg.contributes?.commands ?? [];
    assert.ok(
      commands.some((c) => c.command === "conversationRoadmap.showOnboarding"),
      "package.json must declare conversationRoadmap.showOnboarding"
    );
  });

  it("declares a configuration setting controlling the onboarding notice", () => {
    const properties = pkg.contributes?.configuration?.properties ?? {};
    assert.ok(
      "conversationRoadmap.showOnboarding" in properties,
      "package.json must declare the conversationRoadmap.showOnboarding setting"
    );
  });
});
