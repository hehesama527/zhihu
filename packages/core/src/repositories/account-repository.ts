import path from "node:path";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { getAppConfig } from "../config/env.js";

type AccountRow = RowDataPacket & {
  id: number;
  name: string;
  zhihu_user_name: string | null;
  status: string;
  status_reason: string | null;
  profile_dir: string | null;
  last_login_check_at: Date | null;
  last_publish_at: Date | null;
};

export class AccountRepository {
  constructor(private readonly pool: Pool) {}

  async ensureDefaultAccount() {
    const defaultProfileDir = path.join(getAppConfig().dataDir, "profiles", "account-1");
    await this.pool.query(
      `INSERT IGNORE INTO accounts (id, name, zhihu_user_name, status, profile_dir)
       VALUES (?, ?, ?, 'active', ?)`,
      [1, "默认知乎账号", "二牛是个老实人", defaultProfileDir]
    );
  }

  async getAccount(accountId = 1) {
    const [rows] = await this.pool.query<AccountRow[]>(`SELECT * FROM accounts WHERE id = ? LIMIT 1`, [accountId]);
    const row = rows[0];

    return row
      ? {
          id: row.id,
          name: row.name,
          zhihuUserName: row.zhihu_user_name,
          status: row.status,
          statusReason: row.status_reason,
          profileDir: row.profile_dir,
          lastLoginCheckAt: row.last_login_check_at?.toISOString() ?? null,
          lastPublishAt: row.last_publish_at?.toISOString() ?? null
        }
      : null;
  }

  async markManualLoginRequired(accountId = 1, reason?: string | null) {
    await this.pool.query(
      `UPDATE accounts
       SET status = 'manual_login_required',
           status_reason = ?
       WHERE id = ?`,
      [reason ?? "没有检测到可复用的知乎登录态，请先完成人工登录后再恢复流程。", accountId]
    );
  }

  async markActive(accountId = 1) {
    await this.pool.query(
      `UPDATE accounts
       SET status = 'active',
           status_reason = NULL,
           last_login_check_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [accountId]
    );
  }

  async markSessionExpired(accountId = 1, reason?: string | null) {
    await this.pool.query(
      `UPDATE accounts
       SET status = 'session_expired',
           status_reason = ?
       WHERE id = ?`,
      [reason ?? "知乎登录态已经失效，请重新登录后恢复任务。", accountId]
    );
  }

  async touchPublishSuccess(accountId = 1) {
    await this.pool.query(
      `UPDATE accounts
       SET status = 'active',
           status_reason = NULL,
           last_publish_at = CURRENT_TIMESTAMP,
           last_login_check_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [accountId]
    );
  }
}
