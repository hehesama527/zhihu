import type {
  OpsIncidentDetail,
  OpsIncidentNotificationDelivery,
  OpsIncidentSeverity,
  OpsIncidentSource,
  OpsIncidentStatus,
  OpsIncidentSummary,
  OpsSummary
} from "@zhihu-mvp/shared";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type OpsIncidentRow = RowDataPacket & {
  id: number;
  fingerprint: string;
  source: OpsIncidentSource;
  severity: OpsIncidentSeverity;
  status: OpsIncidentStatus;
  service_name: string;
  account_id: number | null;
  job_id: number | null;
  failure_type: string | null;
  title: string;
  diagnosis_summary: string | null;
  root_cause: string | null;
  suggested_action: string | null;
  raw_error_excerpt: string | null;
  evidence_json: string | null;
  notification_delivery: OpsIncidentNotificationDelivery | null;
  notification_message: string | null;
  notified_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type SummaryCountRow = RowDataPacket & {
  open_count: number;
  critical_count: number;
  high_count: number;
};

export type UpsertOpsIncidentInput = {
  fingerprint: string;
  source: OpsIncidentSource;
  severity: OpsIncidentSeverity;
  serviceName: string;
  accountId?: number | null;
  jobId?: number | null;
  failureType?: string | null;
  title: string;
  diagnosisSummary?: string | null;
  rootCause?: string | null;
  suggestedAction?: string | null;
  rawErrorExcerpt?: string | null;
  evidenceJson?: string | null;
};

export class OpsIncidentRepository {
  constructor(private readonly pool: Pool) {}

  async listIncidents(limit = 50): Promise<OpsIncidentSummary[]> {
    const [rows] = await this.pool.query<OpsIncidentRow[]>(
      `SELECT *
       FROM ops_incidents
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map(mapSummaryRow);
  }

  async getIncidentById(id: number): Promise<OpsIncidentDetail | null> {
    const [rows] = await this.pool.query<OpsIncidentRow[]>(
      `SELECT *
       FROM ops_incidents
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    return rows[0] ? mapDetailRow(rows[0]) : null;
  }

  async getIncidentByFingerprint(fingerprint: string): Promise<OpsIncidentDetail | null> {
    const [rows] = await this.pool.query<OpsIncidentRow[]>(
      `SELECT *
       FROM ops_incidents
       WHERE fingerprint = ?
       LIMIT 1`,
      [fingerprint]
    );

    return rows[0] ? mapDetailRow(rows[0]) : null;
  }

  async upsertOpenIncident(input: UpsertOpsIncidentInput) {
    const existing = await this.getIncidentByFingerprint(input.fingerprint);

    if (!existing) {
      const [result] = await this.pool.query<ResultSetHeader>(
        `INSERT INTO ops_incidents (
           fingerprint,
           source,
           severity,
           status,
           service_name,
           account_id,
           job_id,
           failure_type,
           title,
           diagnosis_summary,
           root_cause,
           suggested_action,
           raw_error_excerpt,
           evidence_json
         ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.fingerprint,
          input.source,
          input.severity,
          input.serviceName,
          input.accountId ?? null,
          input.jobId ?? null,
          input.failureType ?? null,
          input.title,
          input.diagnosisSummary ?? null,
          input.rootCause ?? null,
          input.suggestedAction ?? null,
          input.rawErrorExcerpt ?? null,
          input.evidenceJson ?? null
        ]
      );

      const incident = await this.getIncidentById(result.insertId);
      if (!incident) {
        throw new Error(`Failed to load ops incident #${result.insertId} after insert.`);
      }

      return {
        incident,
        disposition: "created" as const,
        shouldNotify: true
      };
    }

    const shouldNotify = existing.status === "resolved" || !existing.notifiedAt;

    await this.pool.query(
      `UPDATE ops_incidents
       SET source = ?,
           severity = ?,
           status = 'open',
           service_name = ?,
           account_id = ?,
           job_id = ?,
           failure_type = ?,
           title = ?,
           diagnosis_summary = ?,
           root_cause = ?,
           suggested_action = ?,
           raw_error_excerpt = ?,
           evidence_json = ?,
           resolved_at = NULL,
           notification_delivery = CASE WHEN ? THEN NULL ELSE notification_delivery END,
           notification_message = CASE WHEN ? THEN NULL ELSE notification_message END,
           notified_at = CASE WHEN ? THEN NULL ELSE notified_at END
       WHERE id = ?`,
      [
        input.source,
        input.severity,
        input.serviceName,
        input.accountId ?? null,
        input.jobId ?? null,
        input.failureType ?? null,
        input.title,
        input.diagnosisSummary ?? null,
        input.rootCause ?? null,
        input.suggestedAction ?? null,
        input.rawErrorExcerpt ?? null,
        input.evidenceJson ?? null,
        shouldNotify ? 1 : 0,
        shouldNotify ? 1 : 0,
        shouldNotify ? 1 : 0,
        existing.id
      ]
    );

    const incident = await this.getIncidentById(existing.id);
    if (!incident) {
      throw new Error(`Failed to load ops incident #${existing.id} after update.`);
    }

    return {
      incident,
      disposition: existing.status === "resolved" ? ("reopened" as const) : ("updated" as const),
      shouldNotify
    };
  }

  async markNotificationResult(id: number, delivery: OpsIncidentNotificationDelivery, message: string) {
    await this.pool.query(
      `UPDATE ops_incidents
       SET notification_delivery = ?,
           notification_message = ?,
           notified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [delivery, message, id]
    );
  }

  async resolveIncident(id: number) {
    await this.pool.query(
      `UPDATE ops_incidents
       SET status = 'resolved',
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status <> 'resolved'`,
      [id]
    );
  }

  async resolveOpenScanIncidents(activeFingerprints: string[], sources: OpsIncidentSource[]) {
    if (!sources.length) {
      return 0;
    }

    const placeholders = sources.map(() => "?").join(", ");
    const [rows] = await this.pool.query<OpsIncidentRow[]>(
      `SELECT *
       FROM ops_incidents
       WHERE status = 'open'
         AND source IN (${placeholders})`,
      sources
    );

    const activeFingerprintSet = new Set(activeFingerprints);
    const stale = rows.filter((row) => !activeFingerprintSet.has(row.fingerprint));
    for (const row of stale) {
      await this.resolveIncident(row.id);
    }

    return stale.length;
  }

  async getSummary(limit = 20): Promise<OpsSummary> {
    const [counts] = await this.pool.query<SummaryCountRow[]>(
      `SELECT
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
         SUM(CASE WHEN status = 'open' AND severity = 'critical' THEN 1 ELSE 0 END) AS critical_count,
         SUM(CASE WHEN status = 'open' AND severity = 'high' THEN 1 ELSE 0 END) AS high_count
       FROM ops_incidents`
    );
    const recentIncidents = await this.listIncidents(limit);

    return {
      openCount: Number(counts[0]?.open_count ?? 0),
      criticalCount: Number(counts[0]?.critical_count ?? 0),
      highCount: Number(counts[0]?.high_count ?? 0),
      recentIncidents
    };
  }
}

function mapSummaryRow(row: OpsIncidentRow): OpsIncidentSummary {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    source: row.source,
    severity: row.severity,
    status: row.status,
    serviceName: row.service_name,
    accountId: row.account_id,
    jobId: row.job_id,
    failureType: row.failure_type,
    title: row.title,
    diagnosisSummary: row.diagnosis_summary,
    rootCause: row.root_cause,
    suggestedAction: row.suggested_action,
    rawErrorExcerpt: row.raw_error_excerpt,
    notificationDelivery: row.notification_delivery,
    notificationMessage: row.notification_message,
    notifiedAt: row.notified_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapDetailRow(row: OpsIncidentRow): OpsIncidentDetail {
  return {
    ...mapSummaryRow(row),
    evidenceJson: row.evidence_json
  };
}
