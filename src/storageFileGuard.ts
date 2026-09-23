import * as fs from "fs";
import { StorageBlockedError } from "./storageRecovery";

interface StorageBlockedMarker {
  version: 1;
  storeName: string;
  filePath: string;
  loadError: string;
  backupPath?: string;
}

export interface StorageFileLock {
  retain(): void;
}

const LOCK_RETRY_COUNT = 3000;
const LOCK_RETRY_DELAY_MS = 100;
const STALE_LOCK_AGE_MS = 60 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function blockedMarkerPath(filePath: string): string {
  return `${filePath}.blocked`;
}

function lockPath(filePath: string): string {
  return `${filePath}.lock`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reclaimStaleLock(fileLockPath: string): Promise<boolean> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(fileLockPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT";
  }
  if (Date.now() - stat.mtimeMs < STALE_LOCK_AGE_MS) {
    return false;
  }

  try {
    const raw = await fs.promises.readFile(fileLockPath, "utf8");
    const metadata = JSON.parse(raw) as { retained?: unknown };
    if (metadata.retained === true) {
      return false;
    }
    await fs.promises.unlink(fileLockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return true;
    }
    try {
      await fs.promises.unlink(fileLockPath);
      return true;
    } catch (unlinkError) {
      return (unlinkError as NodeJS.ErrnoException)?.code === "ENOENT";
    }
  }
}

export async function withStorageFileLock<T>(
  filePath: string,
  operation: (lock: StorageFileLock) => Promise<T>
): Promise<T> {
  const fileLockPath = lockPath(filePath);
  let handle: fs.promises.FileHandle | undefined;
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      handle = await fs.promises.open(fileLockPath, "wx");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw error;
      }
      if (await reclaimStaleLock(fileLockPath)) {
        continue;
      }
      await delay(LOCK_RETRY_DELAY_MS);
    }
  }
  if (!handle) {
    throw new Error(
      `Conversation Roadmap storage is locked by another VS Code window or an interrupted operation: "${fileLockPath}".`
    );
  }

  let retain = false;
  try {
    await handle.writeFile(
      JSON.stringify({
        version: 1,
        pid: process.pid,
        createdAt: new Date().toISOString(),
        retained: false,
      }),
      "utf8"
    );
    return await operation({
      retain(): void {
        retain = true;
      },
    });
  } finally {
    if (retain) {
      await fs.promises.writeFile(
        fileLockPath,
        JSON.stringify({
          version: 1,
          pid: process.pid,
          createdAt: new Date().toISOString(),
          retained: true,
        }),
        "utf8"
      );
    }
    await handle.close();
    if (!retain) {
      try {
        await fs.promises.unlink(fileLockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}

export async function writeStorageBlockedMarker(
  filePath: string,
  error: StorageBlockedError
): Promise<void> {
  const marker: StorageBlockedMarker = {
    version: 1,
    storeName: error.storeName,
    filePath,
    loadError: errorMessage(error.loadError),
    ...(error.backupPath ? { backupPath: error.backupPath } : {}),
  };
  await fs.promises.writeFile(
    blockedMarkerPath(filePath),
    JSON.stringify(marker, null, 2),
    { encoding: "utf8", flag: "w" }
  );
}

export async function clearStorageBlockedMarker(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(blockedMarkerPath(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function assertNoStorageBlockedMarker(
  storeName: string,
  filePath: string
): Promise<void> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(blockedMarkerPath(filePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  try {
    const marker = JSON.parse(raw) as Partial<StorageBlockedMarker>;
    throw new StorageBlockedError(
      storeName,
      filePath,
      new Error(
        typeof marker.loadError === "string"
          ? marker.loadError
          : "another VS Code window blocked this storage file"
      ),
      typeof marker.backupPath === "string" ? marker.backupPath : undefined,
      typeof marker.backupPath === "string"
        ? undefined
        : new Error("see the durable .blocked marker beside the storage file")
    );
  } catch (error) {
    if (error instanceof StorageBlockedError) {
      throw error;
    }
    throw new StorageBlockedError(
      storeName,
      filePath,
      new Error("the durable storage block marker is unreadable"),
      undefined,
      error
    );
  }
}
