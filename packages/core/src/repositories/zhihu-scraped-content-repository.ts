import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { ScrapedContentType, ScrapedContentStatus, ZhihuScrapedContent } from "@zhihu-mvp/shared";
import { createHash } from "node:crypto";

type ScrapedContentRow = RowDataPacket & {
  id: number;
  source_account: string;
  content_type: string;
  content_id: string;
  question_title: string | null;
  question_url: string | null;
  content_text: string | null;
  content_html: string | null;
  vote_count: number;
  comment_count: number;
  created_at: Date | null;
  scraped_at: Date;
  content_hash: string;
  status: string;
};

export type UpsertScrapedContentInput = {
  sourceAccount: string;
  contentType: ScrapedContentType;
  contentId: string;
  questionTitle?: string | null;
  questionUrl?: string | null;
  contentText?: string | null;
  contentHtml?: string | null;
  voteCount?: number;
  commentCount?: number;
  createdAt?: Date | string | null;
  contentHash?: string;
};

export class ZhihuScrapedContentRepository {
  constructor(private readonly pool: Pool) {}

  private mapRow(row: ScrapedContentRow): ZhihuScrapedContent {
    return {
      id: row.id,
      sourceAccount: row.source_account,
      contentType: row.content_type as ScrapedContentType,
      contentId: row.content_id,
      questionTitle: row.question_title ?? null,
      questionUrl: row.question_url ?? null,
      contentText: row.content_text ?? null,
      contentHtml: row.content_html ?? null,
      voteCount: row.vote_count,
      commentCount: row.comment_count,
      createdAt: row.created_at?.toISOString() ?? null,
      scrapedAt: row.scraped_at.toISOString(),
      contentHash: row.content_hash,
      status: row.status as ScrapedContentStatus
    };
  }

  private computeContentHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  async upsert(item: UpsertScrapedContentInput): Promise<void> {
    const contentHash = item.contentHash ?? (item.contentText ? this.computeContentHash(item.contentText) : "");
    const createdAt = normalizeDate(item.createdAt);
    const scrapedAt = new Date();

    await this.pool.query(
      `INSERT INTO zhihu_scraped_content (
         source_account, content_type, content_id,
         question_title, question_url, content_text, content_html,
         vote_count, comment_count, created_at, scraped_at,
         content_hash, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         question_title = COALESCE(VALUES(question_title), question_title),
         question_url = COALESCE(VALUES(question_url), question_url),
         content_text = COALESCE(VALUES(content_text), content_text),
         content_html = COALESCE(VALUES(content_html), content_html),
         vote_count = VALUES(vote_count),
         comment_count = VALUES(comment_count),
         content_hash = VALUES(content_hash),
         scraped_at = VALUES(scraped_at)`,
      [
        item.sourceAccount,
        item.contentType,
        item.contentId,
        item.questionTitle ?? null,
        item.questionUrl ?? null,
        item.contentText ?? null,
        item.contentHtml ?? null,
        item.voteCount ?? 0,
        item.commentCount ?? 0,
        createdAt,
        scrapedAt,
        contentHash
      ]
    );
  }

  async batchUpsert(items: UpsertScrapedContentInput[]): Promise<number> {
    if (items.length === 0) return 0;

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      let count = 0;
      for (const item of items) {
        await this.upsertOnConn(conn, item);
        count++;
      }
      await conn.commit();
      return count;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  private async upsertOnConn(
    conn: Awaited<ReturnType<Pool["getConnection"]>>,
    item: UpsertScrapedContentInput
  ): Promise<void> {
    const contentHash = item.contentHash ?? (item.contentText ? this.computeContentHash(item.contentText) : "");
    const createdAt = normalizeDate(item.createdAt);
    const scrapedAt = new Date();

    await conn.query(
      `INSERT INTO zhihu_scraped_content (
         source_account, content_type, content_id,
         question_title, question_url, content_text, content_html,
         vote_count, comment_count, created_at, scraped_at,
         content_hash, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         question_title = COALESCE(VALUES(question_title), question_title),
         question_url = COALESCE(VALUES(question_url), question_url),
         content_text = COALESCE(VALUES(content_text), content_text),
         content_html = COALESCE(VALUES(content_html), content_html),
         vote_count = VALUES(vote_count),
         comment_count = VALUES(comment_count),
         content_hash = VALUES(content_hash),
         scraped_at = VALUES(scraped_at)`,
      [
        item.sourceAccount,
        item.contentType,
        item.contentId,
        item.questionTitle ?? null,
        item.questionUrl ?? null,
        item.contentText ?? null,
        item.contentHtml ?? null,
        item.voteCount ?? 0,
        item.commentCount ?? 0,
        createdAt,
        scrapedAt,
        contentHash
      ]
    );
  }

  async listByAccount(
    account: string,
    options?: { contentType?: ScrapedContentType; status?: ScrapedContentStatus; limit?: number }
  ): Promise<ZhihuScrapedContent[]> {
    const { contentType, status, limit = 100 } = options ?? {};
    const conditions: string[] = ["source_account = ?"];
    const params: (string | number)[] = [account];

    if (contentType) {
      conditions.push("content_type = ?");
      params.push(contentType);
    }
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const [rows] = await this.pool.query<ScrapedContentRow[]>(
      `SELECT * FROM zhihu_scraped_content WHERE ${conditions.join(" AND ")} ORDER BY scraped_at DESC LIMIT ?`,
      [...params, limit]
    );

    return rows.map((row) => this.mapRow(row));
  }

  async listAllByAccount(account: string, limit = 1000): Promise<ZhihuScrapedContent[]> {
    return this.listByAccount(account, { limit });
  }

  async markUsed(id: number): Promise<void> {
    await this.pool.query(
      `UPDATE zhihu_scraped_content SET status = 'used' WHERE id = ?`,
      [id]
    );
  }

  async markRejected(id: number, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE zhihu_scraped_content SET status = 'rejected', rejected_reason = ? WHERE id = ?`,
      [reason, id]
    );
  }

  async batchUpdateStatus(items: Array<{ id: number; status: ScrapedContentStatus; rejectedReason?: string }>): Promise<void> {
    if (items.length === 0) return;
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const item of items) {
        if (item.status === 'rejected' && item.rejectedReason) {
          await conn.query(
            `UPDATE zhihu_scraped_content SET status = ?, rejected_reason = ? WHERE id = ?`,
            [item.status, item.rejectedReason, item.id]
          );
        } else {
          await conn.query(
            `UPDATE zhihu_scraped_content SET status = ? WHERE id = ?`,
            [item.status, item.id]
          );
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async countByAccount(account: string): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM zhihu_scraped_content WHERE source_account = ?`,
      [account]
    );
    return Number(rows[0]?.count ?? 0);
  }

  async countByStatus(account: string, status: ScrapedContentStatus): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM zhihu_scraped_content WHERE source_account = ? AND status = ?`,
      [account, status]
    );
    return Number(rows[0]?.count ?? 0);
  }
}

function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
