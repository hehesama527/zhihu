import path from "node:path";
import fs from "node:fs/promises";

/**
 * Browser audit log entry - captures anti-detection related session metadata
 */
export type BrowserAuditLog = {
  timestamp: string;
  accountId: string | number;
  platform: 'zhihu' | 'x' | 'x-traditional';
  profileDir: string;
  fingerprintHash?: string;
  userAgent?: string;
  operation: 'publish' | 'reply' | 'quote' | 'scan' | 'login_check' | 'recovery';
  startedAt: string;
  finishedAt?: string;
  status: 'success' | 'failed' | 'risk_paused';
  riskSignals: string[];
  screenshotPath: string | null;
  failureStage: string | null;
  failureReason: string | null;
  lockPath?: string;
  lockOwner?: string;
};

/**
 * Profile validation issue
 */
export type ProfileValidationIssue = {
  type: 'profile_shared' | 'profile_missing' | 'profile_malformed';
  severity: 'critical' | 'warning';
  message: string;
  accountId: string | number;
  relatedAccounts?: (string | number)[];
};

/**
 * Log a browser audit entry to the audit log file
 */
export async function logBrowserAudit(
  dataDir: string,
  log: BrowserAuditLog
): Promise<void> {
  try {
    const auditDir = path.join(dataDir, 'audit');
    await fs.mkdir(auditDir, { recursive: true });

    const dateStr = new Date().toISOString().slice(0, 10);
    const auditFile = path.join(auditDir, `browser-${dateStr}.jsonl`);

    const entry = {
      ts: log.timestamp,
      account: log.accountId,
      platform: log.platform,
      profile: log.profileDir,
      fpHash: log.fingerprintHash,
      op: log.operation,
      status: log.status,
      risk: log.riskSignals.length > 0 ? log.riskSignals : undefined,
      failStage: log.failureStage,
      failReason: log.failureReason,
      screenshot: log.screenshotPath,
      duration: log.finishedAt
        ? Math.round((new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)
        : undefined
    };

    await fs.appendFile(auditFile, JSON.stringify(entry) + '\n');
  } catch {
    // Audit logging should never break the main flow
    console.error('[Audit] Failed to write audit log:', log);
  }
}

/**
 * Validate that no two accounts share the same profile directory.
 * Returns critical issues if profile sharing is detected.
 */
export function validateProfileOneToOne(
  accounts: Array<{ id: string | number; profileDir?: string | null; platform?: string }>,
  profileRoot?: string
): ProfileValidationIssue[] {
  const profileMap = new Map<string, (string | number)[]>();
  const accountPlatforms = new Map<string | number, string>();

  for (const account of accounts) {
    if (!account.profileDir) continue;

    const resolved = profileRoot
      ? (path.isAbsolute(account.profileDir) ? account.profileDir : path.join(profileRoot, account.profileDir))
      : account.profileDir;

    if (!profileMap.has(resolved)) {
      profileMap.set(resolved, []);
    }
    profileMap.get(resolved)!.push(account.id);
    if (account.platform) {
      accountPlatforms.set(account.id, account.platform);
    }
  }

  const issues: ProfileValidationIssue[] = [];

  // Check for shared profiles
  for (const [profileDir, accountIds] of profileMap) {
    if (accountIds.length > 1) {
      issues.push({
        type: 'profile_shared',
        severity: 'critical',
        message: `Profile ${profileDir} is shared by ${accountIds.length} accounts: ${accountIds.join(', ')}. Each account must have a unique profile.`,
        accountId: accountIds[0],
        relatedAccounts: accountIds
      });
    }
  }

  // Check for missing profiles
  for (const account of accounts) {
    if (!account.profileDir) {
      issues.push({
        type: 'profile_missing',
        severity: 'critical',
        message: `Account ${account.id} has no profile directory configured.`,
        accountId: account.id
      });
    }
  }

  return issues;
}

/**
 * Validate a single profile path format
 */
export function validateProfilePath(profileDir: string): ProfileValidationIssue | null {
  if (!profileDir || !profileDir.trim()) {
    return {
      type: 'profile_malformed',
      severity: 'critical',
      message: 'Profile directory is empty.',
      accountId: 'unknown'
    };
  }

  // Check for suspicious patterns that indicate profile copying
  const normalized = profileDir.toLowerCase();
  if (normalized.includes('cookie-fetch') || normalized.includes('manual-') || normalized.includes('temp-')) {
    return {
      type: 'profile_malformed',
      severity: 'warning',
      message: `Profile directory ${profileDir} appears to be a temporary/non-production profile.`,
      accountId: 'unknown'
    };
  }

  return null;
}
