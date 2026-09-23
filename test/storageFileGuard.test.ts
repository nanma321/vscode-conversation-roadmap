import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { withStorageFileLock } from "../src/storageFileGuard";

describe("storage file guard", () => {
  it("reclaims a non-retained lock left by an interrupted old operation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-file-lock-"));
    const filePath = path.join(dir, "turns.json");
    const lockPath = `${filePath}.lock`;
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        version: 1,
        pid: 999999,
        createdAt: "2020-01-01T00:00:00.000Z",
        retained: false,
      }),
      "utf8"
    );
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(lockPath, old, old);

    let ran = false;
    await withStorageFileLock(filePath, async () => {
      ran = true;
    });

    assert.strictEqual(ran, true);
    assert.ok(!fs.existsSync(lockPath));
  });

  it("reclaims malformed lock metadata after the stale lease expires", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-file-lock-"));
    const filePath = path.join(dir, "roadmaps.json");
    const lockPath = `${filePath}.lock`;
    fs.writeFileSync(lockPath, "{partial", "utf8");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(lockPath, old, old);

    let ran = false;
    await withStorageFileLock(filePath, async () => {
      ran = true;
    });

    assert.strictEqual(ran, true);
    assert.ok(!fs.existsSync(lockPath));
  });
});
