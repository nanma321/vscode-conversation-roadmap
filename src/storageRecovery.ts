import * as fs from "fs";
import * as path from "path";

export interface StorageRecoveryDependencies {
  now?: () => Date;
  copyFile?: (source: string, destination: string, flags: number) => Promise<void>;
}

export class StorageBlockedError extends Error {
  readonly code = "CONVERSATION_ROADMAP_STORAGE_BLOCKED";

  constructor(
    public readonly storeName: string,
    public readonly filePath: string,
    public readonly loadError: unknown,
    public readonly backupPath?: string,
    public readonly backupError?: unknown
  ) {
    const loadMessage = errorMessage(loadError);
    const backupMessage = backupPath
      ? ` A diagnostic copy was preserved at "${backupPath}".`
      : ` A diagnostic copy could not be created: ${errorMessage(backupError)}.`;
    const additionalRecoveryError =
      backupPath && backupError
        ? ` Additional recovery protection failed: ${errorMessage(backupError)}.`
        : "";
    super(
      `Conversation Roadmap could not load ${storeName} storage at "${filePath}": ${loadMessage}.` +
        `${backupMessage}${additionalRecoveryError} Writes are blocked to protect the original file. ` +
        "Close VS Code, inspect or restore the original file, then reload the window."
    );
    this.name = "StorageBlockedError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function backupTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function copyToUniqueBackup(
  filePath: string,
  dependencies: StorageRecoveryDependencies
): Promise<string> {
  const now = dependencies.now ?? (() => new Date());
  const copyFile =
    dependencies.copyFile ??
    ((source: string, destination: string, flags: number) =>
      fs.promises.copyFile(source, destination, flags));
  const basePath = `${filePath}.recovery-${backupTimestamp(now())}.bak`;

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const destination = suffix === 0 ? basePath : `${basePath}-${suffix}`;
    try {
      await copyFile(filePath, destination, fs.constants.COPYFILE_EXCL);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error(`Could not choose a unique recovery filename beside "${path.basename(filePath)}"`);
}

export async function blockStorageAfterLoadFailure(
  storeName: string,
  filePath: string,
  loadError: unknown,
  dependencies: StorageRecoveryDependencies = {}
): Promise<StorageBlockedError> {
  try {
    const backupPath = await copyToUniqueBackup(filePath, dependencies);
    return new StorageBlockedError(storeName, filePath, loadError, backupPath);
  } catch (backupError) {
    return new StorageBlockedError(
      storeName,
      filePath,
      loadError,
      undefined,
      backupError
    );
  }
}
