import fs from "node:fs/promises";
import path from "node:path";
import { getAppConfig } from "../config/env.js";

type ManualLoginLockRecord = {
  accountId: number;
  createdAt: string;
  browserPids?: number[];
};

export function getManualLoginLockPath(accountId: number) {
  return path.join(getAppConfig().dataDir, "locks", `manual-login-account-${accountId}.lock`);
}

export async function createManualLoginLock(
  accountId: number,
  metadata?: {
    browserPids?: Array<number | null | undefined>;
  }
) {
  const lockPath = getManualLoginLockPath(accountId);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const browserPids =
    metadata?.browserPids
      ?.map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0) ?? [];
  await fs.writeFile(
    lockPath,
    JSON.stringify({
      accountId,
      createdAt: new Date().toISOString(),
      browserPids
    })
  );
}

export async function removeManualLoginLock(accountId: number) {
  const lockPath = getManualLoginLockPath(accountId);
  await fs.rm(lockPath, { force: true });
}

export async function hasManualLoginLock(accountId: number) {
  const lockPath = getManualLoginLockPath(accountId);
  try {
    await fs.access(lockPath);
    return true;
  } catch {
    return false;
  }
}

export async function readManualLoginLock(accountId: number): Promise<ManualLoginLockRecord | null> {
  const lockPath = getManualLoginLockPath(accountId);

  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ManualLoginLockRecord>;

    return {
      accountId,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      browserPids: Array.isArray(parsed.browserPids)
        ? parsed.browserPids.map((pid) => Number(pid)).filter((pid) => Number.isInteger(pid) && pid > 0)
        : []
    };
  } catch {
    return null;
  }
}
