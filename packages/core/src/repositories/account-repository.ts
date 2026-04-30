import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getAppConfig } from "../config/env.js";

type AccountRow = RowDataPacket & {
  id: number;
  name: string;
  zhihu_user_name: string | null;
  writer_prompt_version_id: number | null;
  risk_domain: string;
  status: string;
  status_reason: string | null;
  profile_dir: string | null;
  cooldown_until: Date | null;
  last_risk_at: Date | null;
  last_login_check_at: Date | null;
  last_publish_at: Date | null;
};

type AccountRecord = {
  id: number;
  name: string;
  zhihuUserName: string | null;
  writerPromptVersionId: number | null;
  riskDomain: string;
  status: string;
  statusReason: string | null;
  profileDir: string | null;
  cooldownUntil: string | null;
  lastRiskAt: string | null;
  lastLoginCheckAt: string | null;
  lastPublishAt: string | null;
};

export type AccountDeletionSummary = {
  publishJobCount: number;
  topicCandidateCount: number;
  answeredTopicCount: number;
  scheduleSlotCount: number;
  canDelete: boolean;
};

const INITIAL_LOGIN_REQUIRED_REASON = "需要先完成一次人工登录初始化，之后系统才会复用这个账号的独立浏览器沙箱。";

const DEFAULT_ACCOUNT_NAME = "默认知乎账号";
const DEFAULT_ZHIHU_USER_NAME = "二牛是个老实人";
const DEFAULT_RISK_DOMAIN = "default";

export class AccountRepository {
  constructor(private readonly pool: Pool) {}

  async ensureDefaultAccount() {
    await this.pool.query<ResultSetHeader>(
      `INSERT INTO accounts (name, zhihu_user_name, risk_domain, status, status_reason, profile_dir)
       SELECT ?, ?, ?, 'manual_login_required', ?, NULL
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1
         FROM accounts
         LIMIT 1
       )`,
      [DEFAULT_ACCOUNT_NAME, DEFAULT_ZHIHU_USER_NAME, DEFAULT_RISK_DOMAIN, INITIAL_LOGIN_REQUIRED_REASON]
    );

    const primaryAccount = await this.getPrimaryAccount();
    if (!primaryAccount || primaryAccount.profileDir) {
      return primaryAccount;
    }

    const profileDir = this.buildProfileDir(primaryAccount.id);
    await this.pool.query(
      `UPDATE accounts
       SET profile_dir = COALESCE(profile_dir, ?)
       WHERE id = ?`,
      [profileDir, primaryAccount.id]
    );

    return this.getPrimaryAccount();
  }

  async listAccounts() {
    const [rows] = await this.pool.query<AccountRow[]>(`SELECT * FROM accounts ORDER BY id ASC`);
    return rows.map((row) => mapAccountRow(row));
  }

  async getAccountDeletionSummary(accountId: number): Promise<AccountDeletionSummary> {
    const [publishJobCount, topicCandidateCount, answeredTopicCount, scheduleSlotCount] = await Promise.all([
      this.countRows(`SELECT COUNT(*) AS count FROM publish_jobs WHERE account_id = ?`, [accountId]),
      this.countRows(`SELECT COUNT(*) AS count FROM topic_candidates WHERE account_id = ?`, [accountId]),
      this.countRows(`SELECT COUNT(*) AS count FROM answered_topics WHERE account_id = ?`, [accountId]),
      this.countRows(`SELECT COUNT(*) AS count FROM daily_publish_schedule WHERE account_id = ?`, [accountId])
    ]);

    return {
      publishJobCount,
      topicCandidateCount,
      answeredTopicCount,
      scheduleSlotCount,
      canDelete: publishJobCount === 0 && topicCandidateCount === 0 && answeredTopicCount === 0
    };
  }

  async createAccount(input: { name: string; zhihuUserName?: string | null; riskDomain?: string | null }) {
    const riskDomain = normalizeRiskDomain(input.riskDomain);
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO accounts (name, zhihu_user_name, risk_domain, status, status_reason, profile_dir)
       VALUES (?, ?, ?, 'manual_login_required', ?, NULL)`,
      [input.name, input.zhihuUserName ?? null, riskDomain, INITIAL_LOGIN_REQUIRED_REASON]
    );

    const accountId = result.insertId;
    const profileDir = this.buildProfileDir(accountId);

    await this.pool.query(
      `UPDATE accounts
       SET profile_dir = ?
       WHERE id = ?`,
      [profileDir, accountId]
    );

    return this.getAccount(accountId);
  }

  async deleteAccount(accountId: number) {
    const account = await this.getAccount(accountId);
    if (!account) {
      return {
        deleted: false,
        summary: null,
        cleanupWarning: null
      } as const;
    }

    const summary = await this.getAccountDeletionSummary(accountId);
    if (!summary.canDelete) {
      return {
        deleted: false,
        summary,
        cleanupWarning: null
      } as const;
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(`DELETE FROM daily_publish_schedule WHERE account_id = ?`, [accountId]);
      await connection.query(`DELETE FROM accounts WHERE id = ?`, [accountId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const cleanupWarning = await cleanupAccountProfileDirs(account.id, account.profileDir);

    return {
      deleted: true,
      summary,
      cleanupWarning
    } as const;
  }

  async normalizeProfileDirs() {
    const accounts = await this.listAccounts();
    const normalized: Array<{
      accountId: number;
      previousProfileDir: string | null;
      profileDir: string;
      migrated: boolean;
    }> = [];

    for (const account of accounts) {
      const expectedProfileDir = path.resolve(this.buildProfileDir(account.id));
      const currentProfileDir = account.profileDir ? path.resolve(account.profileDir) : null;

      if (!currentProfileDir) {
        await this.updateProfileDir(account.id, expectedProfileDir);
        normalized.push({
          accountId: account.id,
          previousProfileDir: null,
          profileDir: expectedProfileDir,
          migrated: false
        });
        continue;
      }

      if (currentProfileDir === expectedProfileDir) {
        continue;
      }

      const migration = await moveProfileDirToCanonical(currentProfileDir, expectedProfileDir);
      if (migration.finalProfileDir === currentProfileDir) {
        continue;
      }

      await this.updateProfileDir(account.id, migration.finalProfileDir);
      normalized.push({
        accountId: account.id,
        previousProfileDir: currentProfileDir,
        profileDir: migration.finalProfileDir,
        migrated: migration.migrated
      });
    }

    return normalized;
  }

  async getPrimaryAccount() {
    const [rows] = await this.pool.query<AccountRow[]>(`SELECT * FROM accounts ORDER BY id ASC LIMIT 1`);
    const row = rows[0];
    return row ? mapAccountRow(row) : null;
  }

  async getAccount(accountId: number) {
    const [rows] = await this.pool.query<AccountRow[]>(`SELECT * FROM accounts WHERE id = ? LIMIT 1`, [accountId]);
    const row = rows[0];
    return row ? mapAccountRow(row) : null;
  }

  async updateAccount(
    accountId: number,
    input: {
      name?: string;
      zhihuUserName?: string | null;
      writerPromptVersionId?: number | null;
      riskDomain?: string | null;
    }
  ) {
    const hasName = Object.prototype.hasOwnProperty.call(input, "name");
    const hasZhihuUserName = Object.prototype.hasOwnProperty.call(input, "zhihuUserName");
    const hasWriterPromptVersionId = Object.prototype.hasOwnProperty.call(input, "writerPromptVersionId");
    const hasRiskDomain = Object.prototype.hasOwnProperty.call(input, "riskDomain");

    await this.pool.query(
      `UPDATE accounts
       SET name = CASE WHEN ? THEN ? ELSE name END,
           zhihu_user_name = CASE WHEN ? THEN ? ELSE zhihu_user_name END,
           writer_prompt_version_id = CASE WHEN ? THEN ? ELSE writer_prompt_version_id END,
           risk_domain = CASE WHEN ? THEN ? ELSE risk_domain END
       WHERE id = ?`,
      [
        hasName ? 1 : 0,
        input.name ?? null,
        hasZhihuUserName ? 1 : 0,
        input.zhihuUserName ?? null,
        hasWriterPromptVersionId ? 1 : 0,
        input.writerPromptVersionId ?? null,
        hasRiskDomain ? 1 : 0,
        normalizeRiskDomain(input.riskDomain),
        accountId
      ]
    );
  }

  async markManualLoginRequired(accountId: number, reason?: string | null) {
    await this.pool.query(
      `UPDATE accounts
       SET status = 'manual_login_required',
           status_reason = ?
       WHERE id = ?`,
      [reason ?? "没有检测到可复用的知乎登录态，请先完成人工登录后再恢复流程。", accountId]
    );
  }

  async markRiskDetected(accountId: number, options?: { cooldownHours?: number }) {
    const cooldownHours = Math.max(1, Math.round(options?.cooldownHours ?? 12));
    await this.pool.query(
      `UPDATE accounts
       SET last_risk_at = CURRENT_TIMESTAMP,
           cooldown_until = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR)
       WHERE id = ?`,
      [cooldownHours, accountId]
    );
  }

  async markActive(accountId: number) {
    await this.pool.query(
      `UPDATE accounts
       SET status = 'active',
           status_reason = NULL,
           cooldown_until = NULL,
           last_login_check_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [accountId]
    );
  }

  async markSessionExpired(accountId: number, reason?: string | null) {
    await this.pool.query(
      `UPDATE accounts
       SET status = 'session_expired',
           status_reason = ?,
           last_risk_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason ?? "知乎登录态已经失效，请重新登录后恢复任务。", accountId]
    );
  }

  async touchPublishSuccess(accountId: number) {
    await this.pool.query(
      `UPDATE accounts
       SET status = 'active',
           status_reason = NULL,
           cooldown_until = NULL,
           last_publish_at = CURRENT_TIMESTAMP,
           last_login_check_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [accountId]
    );
  }

  getExpectedProfileDir(accountId: number) {
    return this.buildProfileDir(accountId);
  }

  private async updateProfileDir(accountId: number, profileDir: string) {
    await this.pool.query(
      `UPDATE accounts
       SET profile_dir = ?
       WHERE id = ?`,
      [profileDir, accountId]
    );
  }

  private buildProfileDir(accountId: number) {
    return path.join(getAppConfig().dataDir, "profiles", `account-${accountId}`);
  }

  private async countRows(query: string, params: Array<number | string>) {
    const [rows] = await this.pool.query<RowDataPacket[]>(query, params);
    return Number(rows[0]?.count ?? 0);
  }
}

function mapAccountRow(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    name: row.name,
    zhihuUserName: row.zhihu_user_name,
    writerPromptVersionId: row.writer_prompt_version_id ?? null,
    riskDomain: normalizeRiskDomain(row.risk_domain),
    status: row.status,
    statusReason: row.status_reason,
    profileDir: row.profile_dir,
    cooldownUntil: row.cooldown_until?.toISOString() ?? null,
    lastRiskAt: row.last_risk_at?.toISOString() ?? null,
    lastLoginCheckAt: row.last_login_check_at?.toISOString() ?? null,
    lastPublishAt: row.last_publish_at?.toISOString() ?? null
  };
}

function normalizeRiskDomain(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : DEFAULT_RISK_DOMAIN;
}

async function moveProfileDirToCanonical(sourceDir: string, targetDir: string) {
  const sourceExists = await pathExists(sourceDir);
  if (!sourceExists) {
    await fs.mkdir(targetDir, { recursive: true });
    return {
      finalProfileDir: targetDir,
      migrated: false
    };
  }

  const targetExists = await pathExists(targetDir);
  if (targetExists) {
    return {
      finalProfileDir: sourceDir,
      migrated: false
    };
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });

  try {
    await fs.rename(sourceDir, targetDir);
  } catch (error) {
    if (!(await pathExists(targetDir))) {
      throw error;
    }
  }

  return {
    finalProfileDir: targetDir,
    migrated: true
  };
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupAccountProfileDirs(accountId: number, profileDir: string | null) {
  const profilesRoot = path.resolve(path.join(getAppConfig().dataDir, "profiles"));
  const candidates = new Set<string>([path.resolve(path.join(profilesRoot, `account-${accountId}`))]);

  if (profileDir) {
    candidates.add(path.resolve(profileDir));
  }

  const warnings: string[] = [];

  for (const candidate of candidates) {
    if (!isSafeProfileDir(candidate, profilesRoot, accountId)) {
      warnings.push(`已跳过非标准 Profile 目录清理：${candidate}`);
      continue;
    }

    try {
      await fs.rm(candidate, {
        recursive: true,
        force: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Profile 目录清理失败：${candidate}。${message}`);
    }
  }

  return warnings.length ? warnings.join(" ") : null;
}

function isSafeProfileDir(candidate: string, profilesRoot: string, accountId: number) {
  const basename = path.basename(candidate);
  const relativePath = path.relative(profilesRoot, candidate);

  return (
    basename === `account-${accountId}` &&
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}
