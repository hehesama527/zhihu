import { getMysqlPool, safeParseJson } from "@zhihu-mvp/core";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  XHotspot,
  XHotspotDetail,
  XHotspotPriority,
  XHotspotResearchRun,
  XHotspotResearchStatus,
  XHotspotScanRun,
  XHotspotSource,
  XHotspotSourceType,
  XHotspotStatus,
  XHotspotTaskLink,
  XHotspotWatchlist,
  XHotspotWatchlistItem,
  XHotspotWatchlistItemType
} from "../types.js";

const HOTSPOT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS x_hotspots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hotspot_key VARCHAR(128) NOT NULL UNIQUE,
  title VARCHAR(512) NOT NULL,
  summary_text LONGTEXT NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  topic_type VARCHAR(64) NOT NULL,
  symbols_json LONGTEXT NULL,
  keywords_json LONGTEXT NULL,
  matched_watchlist_values_json LONGTEXT NULL,
  canonical_url VARCHAR(1024) NULL,
  score INT NOT NULL DEFAULT 0,
  priority VARCHAR(16) NOT NULL DEFAULT 'DROP',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  research_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  source_count INT NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  event_time DATETIME NULL,
  expires_at DATETIME NOT NULL,
  task_linked_at DATETIME NULL,
  research_summary_text LONGTEXT NULL,
  research_updated_at DATETIME NULL,
  suggested_task_title VARCHAR(512) NULL,
  suggested_task_brief LONGTEXT NULL,
  angles_json LONGTEXT NULL,
  risks_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_x_hotspots_priority_status (priority, status, last_seen_at),
  INDEX idx_x_hotspots_expires_at (expires_at),
  INDEX idx_x_hotspots_source_type (source_type, last_seen_at)
);

CREATE TABLE IF NOT EXISTS x_hotspot_sources (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hotspot_id BIGINT NOT NULL,
  source_hash CHAR(64) NOT NULL UNIQUE,
  source_type VARCHAR(64) NOT NULL,
  source_label VARCHAR(255) NOT NULL,
  source_url VARCHAR(1024) NULL,
  title VARCHAR(512) NOT NULL,
  summary_text LONGTEXT NOT NULL,
  raw_payload_json LONGTEXT NULL,
  event_time DATETIME NULL,
  detected_at DATETIME NOT NULL,
  score_delta INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_x_hotspot_sources_hotspot (hotspot_id, detected_at),
  INDEX idx_x_hotspot_sources_type (source_type, detected_at),
  CONSTRAINT fk_x_hotspot_sources_hotspot FOREIGN KEY (hotspot_id) REFERENCES x_hotspots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS x_hotspot_research_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hotspot_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  summary LONGTEXT NOT NULL,
  why_now LONGTEXT NOT NULL,
  recommended_action VARCHAR(32) NOT NULL,
  suggested_task_title VARCHAR(512) NOT NULL,
  suggested_task_brief LONGTEXT NOT NULL,
  angles_json LONGTEXT NULL,
  risks_json LONGTEXT NULL,
  operator_hints_json LONGTEXT NULL,
  raw_output_json LONGTEXT NULL,
  error_text LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_x_hotspot_research_runs_hotspot (hotspot_id, created_at),
  CONSTRAINT fk_x_hotspot_research_runs_hotspot FOREIGN KEY (hotspot_id) REFERENCES x_hotspots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS x_hotspot_task_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hotspot_id BIGINT NULL,
  task_id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  account_handle VARCHAR(255) NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_x_hotspot_task_links_task (task_id),
  INDEX idx_x_hotspot_task_links_hotspot (hotspot_id, created_at)
);

CREATE TABLE IF NOT EXISTS x_hotspot_watchlists (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description LONGTEXT NULL,
  scope VARCHAR(32) NOT NULL DEFAULT 'global',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS x_hotspot_watchlist_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  watchlist_id BIGINT NOT NULL,
  type VARCHAR(32) NOT NULL,
  value VARCHAR(255) NOT NULL,
  label VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 50,
  notes LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_x_hotspot_watchlist_item (watchlist_id, type, value),
  INDEX idx_x_hotspot_watchlist_items_lookup (watchlist_id, type, enabled),
  CONSTRAINT fk_x_hotspot_watchlist_items_watchlist FOREIGN KEY (watchlist_id) REFERENCES x_hotspot_watchlists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS x_hotspot_scan_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  summary_text LONGTEXT NULL,
  created_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  research_count INT NOT NULL DEFAULT 0,
  error_text LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_x_hotspot_scan_runs_source_started (source_type, started_at)
);
`;

type HotspotUpsertInput = {
  hotspotKey: string;
  title: string;
  summaryText: string;
  sourceType: XHotspotSourceType;
  topicType: XHotspot["topicType"];
  symbols: string[];
  keywords: string[];
  matchedWatchlistValues: string[];
  canonicalUrl: string | null;
  score: number;
  priority: XHotspotPriority;
  firstSeenAt: string;
  lastSeenAt: string;
  eventTime: string | null;
  expiresAt: string;
  source: {
    sourceHash: string;
    sourceType: XHotspotSourceType;
    sourceLabel: string;
    sourceUrl: string | null;
    title: string;
    summaryText: string;
    rawPayloadJson: string | null;
    eventTime: string | null;
    detectedAt: string;
    scoreDelta: number;
  };
};

type ListHotspotsFilters = {
  priority?: XHotspotPriority | null;
  status?: XHotspotStatus | null;
  sourceType?: XHotspotSourceType | null;
  includeExpired?: boolean;
};

type UpdateWatchlistInput = {
  name?: string;
  description?: string;
  enabled?: boolean;
};

type UpdateWatchlistItemInput = {
  label?: string;
  enabled?: boolean;
  priority?: number;
  notes?: string;
};

type MysqlHotspotRow = RowDataPacket & {
  id: number;
  hotspot_key: string;
  title: string;
  summary_text: string;
  source_type: XHotspotSourceType;
  topic_type: XHotspot["topicType"];
  symbols_json: string | null;
  keywords_json: string | null;
  matched_watchlist_values_json: string | null;
  canonical_url: string | null;
  score: number;
  priority: XHotspotPriority;
  status: XHotspotStatus;
  research_status: XHotspotResearchStatus;
  source_count: number;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  event_time: Date | string | null;
  expires_at: Date | string;
  task_linked_at: Date | string | null;
  research_summary_text: string | null;
  research_updated_at: Date | string | null;
  suggested_task_title: string | null;
  suggested_task_brief: string | null;
  angles_json: string | null;
  risks_json: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MysqlHotspotSourceRow = RowDataPacket & {
  id: number;
  hotspot_id: number;
  source_hash: string;
  source_type: XHotspotSourceType;
  source_label: string;
  source_url: string | null;
  title: string;
  summary_text: string;
  raw_payload_json: string | null;
  event_time: Date | string | null;
  detected_at: Date | string;
  score_delta: number;
  created_at: Date | string;
};

type MysqlResearchRunRow = RowDataPacket & {
  id: number;
  hotspot_id: number;
  status: "completed" | "failed";
  summary: string;
  why_now: string;
  recommended_action: "create_task" | "watch" | "ignore";
  suggested_task_title: string;
  suggested_task_brief: string;
  angles_json: string | null;
  risks_json: string | null;
  operator_hints_json: string | null;
  raw_output_json: string | null;
  error_text: string | null;
  created_at: Date | string;
};

type MysqlTaskLinkRow = RowDataPacket & {
  id: number;
  hotspot_id: number | null;
  task_id: string;
  account_id: string;
  account_handle: string;
  snapshot_json: string;
  created_at: Date | string;
};

type MysqlWatchlistRow = RowDataPacket & {
  id: number;
  name: string;
  description: string | null;
  scope: "global";
  enabled: 0 | 1 | boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type MysqlWatchlistItemRow = RowDataPacket & {
  id: number;
  watchlist_id: number;
  type: XHotspotWatchlistItemType;
  value: string;
  label: string;
  enabled: 0 | 1 | boolean;
  priority: number;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MysqlScanRunRow = RowDataPacket & {
  id: number;
  source_type: XHotspotSourceType;
  status: "success" | "failed";
  started_at: Date | string;
  finished_at: Date | string | null;
  summary_text: string | null;
  created_count: number;
  updated_count: number;
  research_count: number;
  error_text: string | null;
};

type MysqlIdRow = RowDataPacket & {
  id: number;
};

type MysqlHotspotIdRow = RowDataPacket & {
  hotspot_id: number;
};

export class XHotspotRepository {
  private readonly pool = getMysqlPool();
  private ready = false;

  async ensureReady() {
    if (this.ready) {
      return;
    }

    await this.pool.query(HOTSPOT_SCHEMA_SQL);
    this.ready = true;
  }

  async ensureDefaultWatchlist() {
    await this.ensureReady();
    const [rows] = await this.pool.query<MysqlIdRow[]>(`SELECT id FROM x_hotspot_watchlists LIMIT 1`);
    if (rows.length > 0) {
      return;
    }

    await this.pool.query(
      `INSERT INTO x_hotspot_watchlists (name, description, scope, enabled)
       VALUES (?, ?, 'global', 1)`,
      ["Global Watchlist", "X 热点链路的全局监控配置。"]
    );
  }

  async listHotspots(filters: ListHotspotsFilters = {}) {
    await this.ensureReady();
    const conditions = ["1 = 1"];
    const params: unknown[] = [];

    if (filters.priority) {
      conditions.push("priority = ?");
      params.push(filters.priority);
    }

    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    if (filters.sourceType) {
      conditions.push("source_type = ?");
      params.push(filters.sourceType);
    }

    if (!filters.includeExpired) {
      conditions.push("expires_at >= UTC_TIMESTAMP()");
    }

    const [rows] = await this.pool.query<MysqlHotspotRow[]>(
      `SELECT *
       FROM x_hotspots
       WHERE ${conditions.join(" AND ")}
       ORDER BY FIELD(priority, 'P0', 'P1', 'P2', 'DROP'), score DESC, last_seen_at DESC`,
      params
    );

    return rows.map((row) => mapHotspotRow(row));
  }

  async getHotspotDetail(hotspotId: number) {
    await this.ensureReady();
    const hotspotRow = await this.getHotspotRow(hotspotId);
    if (!hotspotRow) {
      return null;
    }

    const [sourceResult, researchResult, taskLinkResult] = await Promise.all([
      this.pool.query<MysqlHotspotSourceRow[]>(
        `SELECT *
         FROM x_hotspot_sources
         WHERE hotspot_id = ?
         ORDER BY detected_at DESC, id DESC`,
        [hotspotId]
      ),
      this.pool.query<MysqlResearchRunRow[]>(
        `SELECT *
         FROM x_hotspot_research_runs
         WHERE hotspot_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [hotspotId]
      ),
      this.pool.query<MysqlTaskLinkRow[]>(
        `SELECT *
         FROM x_hotspot_task_links
         WHERE hotspot_id = ?
         ORDER BY created_at DESC, id DESC`,
        [hotspotId]
      )
    ]);

    return {
      ...mapHotspotRow(hotspotRow),
      sources: sourceResult[0].map((row) => mapHotspotSourceRow(row)),
      latestResearchRun: researchResult[0][0] ? mapResearchRunRow(researchResult[0][0]) : null,
      taskLinks: taskLinkResult[0].map((row) => mapTaskLinkRow(row))
    } satisfies XHotspotDetail;
  }

  async upsertHotspot(input: HotspotUpsertInput) {
    await this.ensureReady();

    const [existingSourceRows] = await this.pool.query<MysqlHotspotIdRow[]>(
      `SELECT hotspot_id
       FROM x_hotspot_sources
       WHERE source_hash = ?
       LIMIT 1`,
      [input.source.sourceHash]
    );

    if (existingSourceRows[0]?.hotspot_id) {
      const hotspot = await this.refreshHotspot(existingSourceRows[0].hotspot_id, input, false);
      return {
        hotspot,
        created: false,
        updated: true,
        duplicateSource: true
      };
    }

    const [existingRows] = await this.pool.query<MysqlHotspotRow[]>(
      `SELECT *
       FROM x_hotspots
       WHERE hotspot_key = ?
       LIMIT 1`,
      [input.hotspotKey]
    );

    let hotspotId = existingRows[0]?.id ?? null;
    if (!hotspotId) {
      const [insertResult] = await this.pool.query<ResultSetHeader>(
        `INSERT INTO x_hotspots (
           hotspot_key,
           title,
           summary_text,
           source_type,
           topic_type,
           symbols_json,
           keywords_json,
           matched_watchlist_values_json,
           canonical_url,
           score,
           priority,
           status,
           research_status,
           source_count,
           first_seen_at,
           last_seen_at,
           event_time,
           expires_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?, ?)`,
        [
          input.hotspotKey,
          input.title.trim(),
          input.summaryText.trim(),
          input.sourceType,
          input.topicType,
          JSON.stringify(uniqueStrings(input.symbols)),
          JSON.stringify(uniqueStrings(input.keywords)),
          JSON.stringify(uniqueStrings(input.matchedWatchlistValues)),
          normalizeNullableString(input.canonicalUrl),
          Math.max(0, Math.round(input.score)),
          input.priority,
          resolveResearchStatusForPriority(input.priority, null),
          toMysqlDateTime(input.firstSeenAt),
          toMysqlDateTime(input.lastSeenAt),
          toMysqlDateTime(input.eventTime),
          toMysqlDateTime(input.expiresAt)
        ]
      );

      hotspotId = Number(insertResult.insertId);
    } else {
      await this.refreshHotspot(hotspotId, input, true);
    }

    await this.pool.query(
      `INSERT INTO x_hotspot_sources (
         hotspot_id,
         source_hash,
         source_type,
         source_label,
         source_url,
         title,
         summary_text,
         raw_payload_json,
         event_time,
         detected_at,
         score_delta
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hotspotId,
        input.source.sourceHash,
        input.source.sourceType,
        input.source.sourceLabel.trim(),
        normalizeNullableString(input.source.sourceUrl),
        input.source.title.trim(),
        input.source.summaryText.trim(),
        normalizeNullableString(input.source.rawPayloadJson),
        toMysqlDateTime(input.source.eventTime),
        toMysqlDateTime(input.source.detectedAt),
        Math.round(input.source.scoreDelta)
      ]
    );

    if (existingRows[0]?.id) {
      const hotspot = await this.refreshHotspot(hotspotId, input, true);
      return {
        hotspot,
        created: false,
        updated: true,
        duplicateSource: false
      };
    }

    const hotspot = await this.getHotspotById(hotspotId);
    if (!hotspot) {
      throw new Error(`Failed to resolve hotspot #${hotspotId} after insertion.`);
    }

    return {
      hotspot,
      created: true,
      updated: false,
      duplicateSource: false
    };
  }

  async setHotspotResearchStatus(hotspotId: number, status: XHotspotResearchStatus) {
    await this.ensureReady();
    await this.pool.query(
      `UPDATE x_hotspots
       SET research_status = ?
       WHERE id = ?`,
      [status, hotspotId]
    );
  }

  async saveResearchRun(
    hotspotId: number,
    input: {
      status: "completed" | "failed";
      summary: string;
      whyNow: string;
      recommendedAction: "create_task" | "watch" | "ignore";
      suggestedTaskTitle: string;
      suggestedTaskBrief: string;
      angles: string[];
      risks: string[];
      operatorHints: string[];
      rawOutputJson?: string | null;
      errorText?: string | null;
    }
  ) {
    await this.ensureReady();
    const [insertResult] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO x_hotspot_research_runs (
         hotspot_id,
         status,
         summary,
         why_now,
         recommended_action,
         suggested_task_title,
         suggested_task_brief,
         angles_json,
         risks_json,
         operator_hints_json,
         raw_output_json,
         error_text
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hotspotId,
        input.status,
        input.summary.trim(),
        input.whyNow.trim(),
        input.recommendedAction,
        input.suggestedTaskTitle.trim(),
        input.suggestedTaskBrief.trim(),
        JSON.stringify(uniqueStrings(input.angles)),
        JSON.stringify(uniqueStrings(input.risks)),
        JSON.stringify(uniqueStrings(input.operatorHints)),
        normalizeNullableString(input.rawOutputJson),
        normalizeNullableString(input.errorText)
      ]
    );

    await this.pool.query(
      `UPDATE x_hotspots
       SET research_status = ?,
           research_summary_text = ?,
           research_updated_at = UTC_TIMESTAMP(),
           suggested_task_title = ?,
           suggested_task_brief = ?,
           angles_json = ?,
           risks_json = ?
       WHERE id = ?`,
      [
        input.status === "completed" ? "completed" : "failed",
        input.summary.trim(),
        nullableTrimmed(input.suggestedTaskTitle),
        nullableTrimmed(input.suggestedTaskBrief),
        JSON.stringify(uniqueStrings(input.angles)),
        JSON.stringify(uniqueStrings(input.risks)),
        hotspotId
      ]
    );

    const run = await this.getResearchRunById(Number(insertResult.insertId));
    if (!run) {
      throw new Error("Failed to load hotspot research run after save.");
    }

    return run;
  }

  async listHotspotsNeedingResearch(limit = 3, hotspotIds?: number[]) {
    await this.ensureReady();
    const conditions = [
      `status = 'active'`,
      `priority IN ('P0', 'P1')`,
      `research_status IN ('pending', 'failed')`,
      `expires_at >= UTC_TIMESTAMP()`
    ];
    const params: unknown[] = [];

    if (hotspotIds && hotspotIds.length > 0) {
      conditions.push(`id IN (${hotspotIds.map(() => "?").join(", ")})`);
      params.push(...hotspotIds);
    }

    const [rows] = await this.pool.query<MysqlHotspotRow[]>(
      `SELECT *
       FROM x_hotspots
       WHERE ${conditions.join(" AND ")}
       ORDER BY FIELD(priority, 'P0', 'P1'), score DESC, last_seen_at DESC
       LIMIT ?`,
      [...params, Math.max(1, Math.round(limit))]
    );

    return rows.map((row) => mapHotspotRow(row));
  }

  async updateHotspotStatus(hotspotId: number, status: XHotspotStatus) {
    await this.ensureReady();
    await this.pool.query(
      `UPDATE x_hotspots
       SET status = ?
       WHERE id = ?`,
      [status, hotspotId]
    );

    return this.getHotspotById(hotspotId);
  }

  async markHotspotTaskLinked(hotspotId: number) {
    await this.ensureReady();
    await this.pool.query(
      `UPDATE x_hotspots
       SET status = 'tasked',
           task_linked_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [hotspotId]
    );
  }

  async createTaskLink(input: {
    hotspotId: number | null;
    taskId: string;
    accountId: string;
    accountHandle: string;
    snapshotJson: string;
  }) {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO x_hotspot_task_links (hotspot_id, task_id, account_id, account_handle, snapshot_json)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         hotspot_id = VALUES(hotspot_id),
         account_id = VALUES(account_id),
         account_handle = VALUES(account_handle),
         snapshot_json = VALUES(snapshot_json)`,
      [input.hotspotId, input.taskId, input.accountId, input.accountHandle.trim(), input.snapshotJson]
    );

    if (input.hotspotId) {
      await this.markHotspotTaskLinked(input.hotspotId);
    }

    const link = await this.getTaskLinkByTaskId(input.taskId);
    if (!link) {
      throw new Error(`Failed to resolve hotspot task link for task ${input.taskId}.`);
    }

    return link;
  }

  async createWatchlist(input: { name: string; description: string; enabled: boolean }) {
    await this.ensureReady();
    const [insertResult] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO x_hotspot_watchlists (name, description, scope, enabled)
       VALUES (?, ?, 'global', ?)`,
      [input.name.trim(), input.description.trim(), input.enabled ? 1 : 0]
    );

    const watchlist = await this.getWatchlistById(Number(insertResult.insertId));
    if (!watchlist) {
      throw new Error("Failed to resolve hotspot watchlist after creation.");
    }

    return watchlist;
  }

  async updateWatchlist(watchlistId: number, input: UpdateWatchlistInput) {
    await this.ensureReady();
    await this.pool.query(
      `UPDATE x_hotspot_watchlists
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           enabled = COALESCE(?, enabled)
       WHERE id = ?`,
      [
        input.name?.trim() || null,
        input.description?.trim() ?? null,
        input.enabled === undefined ? null : input.enabled ? 1 : 0,
        watchlistId
      ]
    );

    return this.getWatchlistById(watchlistId);
  }

  async deleteWatchlist(watchlistId: number) {
    await this.ensureReady();
    await this.pool.query(`DELETE FROM x_hotspot_watchlists WHERE id = ?`, [watchlistId]);
  }

  async createWatchlistItem(input: {
    watchlistId: number;
    type: XHotspotWatchlistItemType;
    value: string;
    label: string;
    enabled: boolean;
    priority: number;
    notes: string;
  }) {
    await this.ensureReady();
    const normalizedValue = normalizeWatchlistValue(input.type, input.value);
    const normalizedLabel = normalizeWatchlistLabel(input.type, input.label, normalizedValue);
    const normalizedPriority = Math.max(1, Math.min(100, Math.round(input.priority)));
    const normalizedNotes = input.notes.trim();

    if (input.type === "x_account") {
      const equivalentItem = await this.findEquivalentXAccountWatchlistItem(input.watchlistId, normalizedValue);
      if (equivalentItem) {
        await this.pool.query(
          `UPDATE x_hotspot_watchlist_items
           SET value = ?, label = ?, enabled = ?, priority = ?, notes = ?
           WHERE id = ?`,
          [
            normalizedValue,
            normalizedLabel,
            input.enabled ? 1 : 0,
            normalizedPriority,
            normalizedNotes,
            equivalentItem.id
          ]
        );

        return this.getWatchlistById(input.watchlistId);
      }
    }

    await this.pool.query(
      `INSERT INTO x_hotspot_watchlist_items (watchlist_id, type, value, label, enabled, priority, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         enabled = VALUES(enabled),
         priority = VALUES(priority),
         notes = VALUES(notes)`,
      [
        input.watchlistId,
        input.type,
        normalizedValue,
        normalizedLabel,
        input.enabled ? 1 : 0,
        normalizedPriority,
        normalizedNotes
      ]
    );

    return this.getWatchlistById(input.watchlistId);
  }

  private async findEquivalentXAccountWatchlistItem(watchlistId: number, normalizedValue: string) {
    const [rows] = await this.pool.query<MysqlWatchlistItemRow[]>(
      `SELECT id, watchlist_id, type, value, label, enabled, priority, notes, created_at, updated_at
       FROM x_hotspot_watchlist_items
       WHERE watchlist_id = ? AND type = 'x_account'`,
      [watchlistId]
    );

    let fallbackMatch: MysqlWatchlistItemRow | null = null;
    for (const row of rows) {
      if (normalizeWatchlistValue(row.type, row.value) !== normalizedValue) {
        continue;
      }

      if (row.value === normalizedValue) {
        return row;
      }

      fallbackMatch ??= row;
    }

    return fallbackMatch;
  }

  async updateWatchlistItem(itemId: number, input: UpdateWatchlistItemInput) {
    await this.ensureReady();
    await this.pool.query(
      `UPDATE x_hotspot_watchlist_items
       SET label = COALESCE(?, label),
           enabled = COALESCE(?, enabled),
           priority = COALESCE(?, priority),
           notes = COALESCE(?, notes)
       WHERE id = ?`,
      [
        input.label?.trim() || null,
        input.enabled === undefined ? null : input.enabled ? 1 : 0,
        input.priority === undefined ? null : Math.max(1, Math.min(100, Math.round(input.priority))),
        input.notes?.trim() ?? null,
        itemId
      ]
    );

    return this.getWatchlistItemById(itemId);
  }

  async deleteWatchlistItem(itemId: number) {
    await this.ensureReady();
    await this.pool.query(`DELETE FROM x_hotspot_watchlist_items WHERE id = ?`, [itemId]);
  }

  async listWatchlists() {
    await this.ensureReady();
    const [watchlistResult, itemResult] = await Promise.all([
      this.pool.query<MysqlWatchlistRow[]>(
        `SELECT *
         FROM x_hotspot_watchlists
         ORDER BY enabled DESC, updated_at DESC, id DESC`
      ),
      this.pool.query<MysqlWatchlistItemRow[]>(
        `SELECT *
         FROM x_hotspot_watchlist_items
         ORDER BY enabled DESC, priority DESC, updated_at DESC, id DESC`
      )
    ]);

    return groupWatchlists(watchlistResult[0], itemResult[0]);
  }

  async listEnabledWatchlistItems() {
    await this.ensureReady();
    const [rows] = await this.pool.query<MysqlWatchlistItemRow[]>(
      `SELECT items.*
       FROM x_hotspot_watchlist_items items
       JOIN x_hotspot_watchlists lists ON lists.id = items.watchlist_id
       WHERE items.enabled = 1 AND lists.enabled = 1
       ORDER BY items.priority DESC, items.id DESC`
    );

    return rows.map((row) => mapWatchlistItemRow(row));
  }

  async createScanRun(sourceType: XHotspotSourceType, startedAt: string) {
    await this.ensureReady();
    const [insertResult] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO x_hotspot_scan_runs (source_type, status, started_at)
       VALUES (?, 'success', ?)`,
      [sourceType, toMysqlDateTime(startedAt)]
    );

    const run = await this.getScanRunById(Number(insertResult.insertId));
    if (!run) {
      throw new Error("Failed to resolve hotspot scan run after creation.");
    }

    return run;
  }

  async completeScanRun(
    scanRunId: number,
    input: {
      status: "success" | "failed";
      finishedAt: string;
      summaryText: string;
      createdCount: number;
      updatedCount: number;
      researchCount: number;
      errorText?: string | null;
    }
  ) {
    await this.ensureReady();
    await this.pool.query(
      `UPDATE x_hotspot_scan_runs
       SET status = ?,
           finished_at = ?,
           summary_text = ?,
           created_count = ?,
           updated_count = ?,
           research_count = ?,
           error_text = ?
       WHERE id = ?`,
      [
        input.status,
        toMysqlDateTime(input.finishedAt),
        input.summaryText.trim(),
        Math.max(0, Math.round(input.createdCount)),
        Math.max(0, Math.round(input.updatedCount)),
        Math.max(0, Math.round(input.researchCount)),
        normalizeNullableString(input.errorText),
        scanRunId
      ]
    );

    return this.getScanRunById(scanRunId);
  }

  async getLatestScanRun(sourceType: XHotspotSourceType) {
    await this.ensureReady();
    const [rows] = await this.pool.query<MysqlScanRunRow[]>(
      `SELECT *
       FROM x_hotspot_scan_runs
       WHERE source_type = ?
       ORDER BY started_at DESC, id DESC
       LIMIT 1`,
      [sourceType]
    );

    return rows[0] ? mapScanRunRow(rows[0]) : null;
  }

  async cleanupExpiredHotspots(limit = 200) {
    await this.ensureReady();
    const [rows] = await this.pool.query<MysqlIdRow[]>(
      `SELECT id
       FROM x_hotspots
       WHERE expires_at < UTC_TIMESTAMP()
       LIMIT ?`,
      [Math.max(1, Math.round(limit))]
    );

    if (rows.length === 0) {
      return 0;
    }

    await this.pool.query(
      `DELETE FROM x_hotspots
       WHERE id IN (${rows.map(() => "?").join(", ")})`,
      rows.map((row) => row.id)
    );

    return rows.length;
  }

  private async refreshHotspot(hotspotId: number, input: HotspotUpsertInput, sourceInserted: boolean) {
    const current = await this.getHotspotById(hotspotId);
    if (!current) {
      throw new Error(`Hotspot #${hotspotId} does not exist.`);
    }

    const nextSymbols = uniqueStrings([...current.symbols, ...input.symbols]);
    const nextKeywords = uniqueStrings([...current.keywords, ...input.keywords]);
    const nextMatchedValues = uniqueStrings([...current.matchedWatchlistValues, ...input.matchedWatchlistValues]);
    const nextPriority = pickHigherPriority(current.priority, input.priority);
    const nextResearchStatus = resolveResearchStatusForPriority(nextPriority, current.researchStatus);
    const nextTitle = pickPreferredText(current.title, input.title);
    const nextSummary = pickPreferredText(current.summaryText, input.summaryText);
    const nextCanonicalUrl = current.canonicalUrl ?? normalizeNullableString(input.canonicalUrl);
    const nextSourceCount = current.sourceCount + (sourceInserted ? 1 : 0);
    const nextEventTime = pickLaterDateString(current.eventTime, input.eventTime);

    await this.pool.query(
      `UPDATE x_hotspots
       SET title = ?,
           summary_text = ?,
           source_type = ?,
           topic_type = ?,
           symbols_json = ?,
           keywords_json = ?,
           matched_watchlist_values_json = ?,
           canonical_url = ?,
           score = ?,
           priority = ?,
           research_status = ?,
           source_count = ?,
           last_seen_at = ?,
           event_time = ?,
           expires_at = ?
       WHERE id = ?`,
      [
        nextTitle,
        nextSummary,
        current.sourceType === "watchlist" ? input.sourceType : current.sourceType,
        current.topicType === "other" ? input.topicType : current.topicType,
        JSON.stringify(nextSymbols),
        JSON.stringify(nextKeywords),
        JSON.stringify(nextMatchedValues),
        nextCanonicalUrl,
        Math.max(current.score, Math.round(input.score)),
        nextPriority,
        nextResearchStatus,
        nextSourceCount,
        toMysqlDateTime(pickLaterDateString(current.lastSeenAt, input.lastSeenAt) ?? input.lastSeenAt),
        toMysqlDateTime(nextEventTime),
        toMysqlDateTime(input.expiresAt),
        hotspotId
      ]
    );

    const hotspot = await this.getHotspotById(hotspotId);
    if (!hotspot) {
      throw new Error(`Failed to resolve hotspot #${hotspotId} after update.`);
    }

    return hotspot;
  }

  private async getHotspotById(hotspotId: number) {
    const row = await this.getHotspotRow(hotspotId);
    return row ? mapHotspotRow(row) : null;
  }

  private async getHotspotRow(hotspotId: number) {
    const [rows] = await this.pool.query<MysqlHotspotRow[]>(
      `SELECT *
       FROM x_hotspots
       WHERE id = ?
       LIMIT 1`,
      [hotspotId]
    );

    return rows[0] ?? null;
  }

  private async getResearchRunById(researchRunId: number) {
    const [rows] = await this.pool.query<MysqlResearchRunRow[]>(
      `SELECT *
       FROM x_hotspot_research_runs
       WHERE id = ?
       LIMIT 1`,
      [researchRunId]
    );

    return rows[0] ? mapResearchRunRow(rows[0]) : null;
  }

  private async getTaskLinkByTaskId(taskId: string) {
    const [rows] = await this.pool.query<MysqlTaskLinkRow[]>(
      `SELECT *
       FROM x_hotspot_task_links
       WHERE task_id = ?
       LIMIT 1`,
      [taskId]
    );

    return rows[0] ? mapTaskLinkRow(rows[0]) : null;
  }

  private async getWatchlistById(watchlistId: number) {
    const watchlists = await this.listWatchlists();
    return watchlists.find((watchlist) => watchlist.id === watchlistId) ?? null;
  }

  private async getWatchlistItemById(itemId: number) {
    const [rows] = await this.pool.query<MysqlWatchlistItemRow[]>(
      `SELECT *
       FROM x_hotspot_watchlist_items
       WHERE id = ?
       LIMIT 1`,
      [itemId]
    );

    return rows[0] ? mapWatchlistItemRow(rows[0]) : null;
  }

  private async getScanRunById(scanRunId: number) {
    const [rows] = await this.pool.query<MysqlScanRunRow[]>(
      `SELECT *
       FROM x_hotspot_scan_runs
       WHERE id = ?
       LIMIT 1`,
      [scanRunId]
    );

    return rows[0] ? mapScanRunRow(rows[0]) : null;
  }
}

function mapHotspotRow(row: MysqlHotspotRow): XHotspot {
  return {
    id: row.id,
    hotspotKey: row.hotspot_key,
    title: row.title,
    summaryText: row.summary_text,
    sourceType: row.source_type,
    topicType: row.topic_type,
    symbols: parseStringArray(row.symbols_json),
    keywords: parseStringArray(row.keywords_json),
    matchedWatchlistValues: parseStringArray(row.matched_watchlist_values_json),
    canonicalUrl: row.canonical_url,
    score: Number(row.score ?? 0),
    priority: row.priority,
    status: row.status,
    researchStatus: row.research_status,
    sourceCount: Number(row.source_count ?? 0),
    firstSeenAt: toIsoString(row.first_seen_at),
    lastSeenAt: toIsoString(row.last_seen_at),
    eventTime: row.event_time ? toIsoString(row.event_time) : null,
    expiresAt: toIsoString(row.expires_at),
    taskLinkedAt: row.task_linked_at ? toIsoString(row.task_linked_at) : null,
    researchSummaryText: row.research_summary_text,
    researchUpdatedAt: row.research_updated_at ? toIsoString(row.research_updated_at) : null,
    suggestedTaskTitle: row.suggested_task_title,
    suggestedTaskBrief: row.suggested_task_brief,
    angles: parseStringArray(row.angles_json),
    risks: parseStringArray(row.risks_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapHotspotSourceRow(row: MysqlHotspotSourceRow): XHotspotSource {
  return {
    id: row.id,
    hotspotId: row.hotspot_id,
    sourceHash: row.source_hash,
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    title: row.title,
    summaryText: row.summary_text,
    rawPayloadJson: row.raw_payload_json,
    eventTime: row.event_time ? toIsoString(row.event_time) : null,
    detectedAt: toIsoString(row.detected_at),
    scoreDelta: Number(row.score_delta ?? 0),
    createdAt: toIsoString(row.created_at)
  };
}

function mapResearchRunRow(row: MysqlResearchRunRow): XHotspotResearchRun {
  return {
    id: row.id,
    hotspotId: row.hotspot_id,
    status: row.status,
    summary: row.summary,
    whyNow: row.why_now,
    recommendedAction: row.recommended_action,
    suggestedTaskTitle: row.suggested_task_title,
    suggestedTaskBrief: row.suggested_task_brief,
    angles: parseStringArray(row.angles_json),
    risks: parseStringArray(row.risks_json),
    operatorHints: parseStringArray(row.operator_hints_json),
    rawOutputJson: row.raw_output_json,
    errorText: row.error_text,
    createdAt: toIsoString(row.created_at)
  };
}

function mapTaskLinkRow(row: MysqlTaskLinkRow): XHotspotTaskLink {
  return {
    id: row.id,
    hotspotId: row.hotspot_id,
    taskId: row.task_id,
    accountId: row.account_id,
    accountHandle: row.account_handle,
    snapshotJson: row.snapshot_json,
    createdAt: toIsoString(row.created_at)
  };
}

function mapWatchlistRow(row: MysqlWatchlistRow, items: XHotspotWatchlistItem[]): XHotspotWatchlist {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    scope: row.scope,
    enabled: normalizeBoolean(row.enabled),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    items
  };
}

function mapWatchlistItemRow(row: MysqlWatchlistItemRow): XHotspotWatchlistItem {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    type: row.type,
    value: row.value,
    label: row.label,
    enabled: normalizeBoolean(row.enabled),
    priority: Number(row.priority ?? 50),
    notes: row.notes ?? "",
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapScanRunRow(row: MysqlScanRunRow): XHotspotScanRun {
  return {
    id: row.id,
    sourceType: row.source_type,
    status: row.status,
    startedAt: toIsoString(row.started_at),
    finishedAt: row.finished_at ? toIsoString(row.finished_at) : null,
    summaryText: row.summary_text,
    createdCount: Number(row.created_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    researchCount: Number(row.research_count ?? 0),
    errorText: row.error_text
  };
}

function groupWatchlists(rows: MysqlWatchlistRow[], itemRows: MysqlWatchlistItemRow[]) {
  const itemsByWatchlist = new Map<number, XHotspotWatchlistItem[]>();
  for (const itemRow of itemRows) {
    const items = itemsByWatchlist.get(itemRow.watchlist_id) ?? [];
    items.push(mapWatchlistItemRow(itemRow));
    itemsByWatchlist.set(itemRow.watchlist_id, items);
  }

  return rows.map((row) => mapWatchlistRow(row, itemsByWatchlist.get(row.id) ?? []));
}

function parseStringArray(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  const parsed = safeParseJson<unknown[]>(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return uniqueStrings(parsed.map((item) => String(item ?? "")).filter(Boolean));
}

function uniqueStrings(values: string[]) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function toIsoString(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toMysqlDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeNullableString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function nullableTrimmed(value: string | null | undefined) {
  return normalizeNullableString(value);
}

function normalizeWatchlistValue(type: XHotspotWatchlistItemType, value: string) {
  const trimmed = value.trim();
  if (type !== "x_account") {
    return trimmed;
  }

  const handle = extractXHandle(trimmed);
  return handle ? `https://x.com/${handle}` : trimmed;
}

function normalizeWatchlistLabel(type: XHotspotWatchlistItemType, label: string, normalizedValue: string) {
  const trimmed = label.trim();
  if (trimmed) {
    return trimmed;
  }

  if (type !== "x_account") {
    return normalizedValue;
  }

  const handle = extractXHandle(normalizedValue);
  return handle ? `@${handle}` : normalizedValue;
}

function extractXHandle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const domainMatch = withoutProtocol.match(/^(?:www\.)?(?:x\.com|twitter\.com)\/([^/?#]+)/i);
  const candidate = (domainMatch?.[1] ?? withoutProtocol)
    .replace(/^@+/, "")
    .split(/[/?#]/)[0]
    ?.trim();

  return candidate && /^[A-Za-z0-9_]{1,15}$/.test(candidate) ? candidate : "";
}

function normalizeBoolean(value: 0 | 1 | boolean) {
  return value === true || value === 1;
}

function pickHigherPriority(left: XHotspotPriority, right: XHotspotPriority): XHotspotPriority {
  const order: Record<XHotspotPriority, number> = {
    P0: 4,
    P1: 3,
    P2: 2,
    DROP: 1
  };

  return order[right] > order[left] ? right : left;
}

function resolveResearchStatusForPriority(
  priority: XHotspotPriority,
  current: XHotspotResearchStatus | null
): XHotspotResearchStatus {
  if (priority !== "P0" && priority !== "P1") {
    return current === "completed" ? current : "not_needed";
  }

  if (current === "completed" || current === "running") {
    return current;
  }

  return "pending";
}

function pickPreferredText(current: string, incoming: string) {
  return incoming.trim().length > current.trim().length ? incoming.trim() : current.trim();
}

function pickLaterDateString(current: string | null, incoming: string | null) {
  if (!current) {
    return incoming;
  }

  if (!incoming) {
    return current;
  }

  return new Date(incoming).getTime() > new Date(current).getTime() ? incoming : current;
}
