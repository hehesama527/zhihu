import fs from "node:fs/promises";
import path from "node:path";
import { getAppConfig } from "../config/env.js";

export function getManualLoginLockPath(accountId: number) {
  return path.join(getAppConfig().dataDir, "locks", `manual-login-account-${accountId}.lock`);
}

export async function createManualLoginLock(accountId: number) {
  const lockPath = getManualLoginLockPath(accountId);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    JSON.stringify({
      accountId,
      createdAt: new Date().toISOString()
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
