import type { OpsIncidentDetail, OpsIncidentSeverity, OpsIncidentSource, OpsScanSummary, OpsSummary } from "@zhihu-mvp/shared";
import { OpsIncidentRepository, type UpsertOpsIncidentInput } from "../repositories/ops-incident-repository.js";
import { sanitizeSensitiveText, sanitizeUnknown } from "../utils/sensitive-data.js";
import type { FeishuNotificationResult } from "./feishu-notification-service.js";
import { FeishuNotificationService } from "./feishu-notification-service.js";
import { OpsDiagnosisService, buildIncidentFingerprint } from "./ops-diagnosis-service.js";

export type ReportOpsIncidentInput = {
  source: OpsIncidentSource;
  severity: OpsIncidentSeverity;
  serviceName: string;
  accountId?: number | null;
  jobId?: number | null;
  failureType?: string | null;
  title: string;
  currentStage?: string | null;
  triggerStage?: string | null;
  entryUrl?: string | null;
  questionTitle?: string | null;
  rawErrorExcerpt?: string | null;
  evidence?: unknown;
};

export type ReportOpsIncidentResult = {
  incident: OpsIncidentDetail;
  created: boolean;
  notified: boolean;
  notificationResult: FeishuNotificationResult | null;
};

export class OpsIncidentService {
  constructor(
    private readonly repository: OpsIncidentRepository,
    private readonly diagnosisService: OpsDiagnosisService,
    private readonly feishuNotificationService: FeishuNotificationService
  ) {}

  async reportIncident(input: ReportOpsIncidentInput): Promise<ReportOpsIncidentResult> {
    const sanitizedExcerpt = sanitizeSensitiveText(input.rawErrorExcerpt) ?? null;
    const sanitizedEvidence = sanitizeUnknown({
      currentStage: input.currentStage ?? null,
      triggerStage: input.triggerStage ?? null,
      entryUrl: input.entryUrl ?? null,
      questionTitle: input.questionTitle ?? null,
      ...(input.evidence && typeof input.evidence === "object" ? (input.evidence as Record<string, unknown>) : {})
    });
    const diagnosis = await this.diagnosisService.diagnose({
      serviceName: input.serviceName,
      source: input.source,
      severity: input.severity,
      failureType: input.failureType ?? null,
      title: input.title,
      rawErrorExcerpt: sanitizedExcerpt,
      evidence: sanitizedEvidence
    });

    const fingerprint = buildIncidentFingerprint([
      input.source,
      input.serviceName,
      input.failureType ?? "unknown",
      input.jobId ?? "",
      input.accountId ?? "",
      diagnosis.summary,
      sanitizedExcerpt ?? ""
    ]);

    const payload: UpsertOpsIncidentInput = {
      fingerprint,
      source: input.source,
      severity: input.severity,
      serviceName: input.serviceName,
      accountId: input.accountId ?? null,
      jobId: input.jobId ?? null,
      failureType: input.failureType ?? null,
      title: input.title,
      diagnosisSummary: diagnosis.summary,
      rootCause: diagnosis.rootCause,
      suggestedAction: diagnosis.suggestedAction,
      rawErrorExcerpt: sanitizedExcerpt,
      evidenceJson: JSON.stringify({
        provider: diagnosis.provider,
        keyEvidence: diagnosis.keyEvidence,
        currentStage: input.currentStage ?? null,
        triggerStage: input.triggerStage ?? null,
        entryUrl: input.entryUrl ?? null,
        questionTitle: input.questionTitle ?? null,
        evidence: sanitizedEvidence
      })
    };

    const upserted = await this.repository.upsertOpenIncident(payload);
    let notificationResult: FeishuNotificationResult | null = null;

    if (upserted.shouldNotify) {
      notificationResult = await this.feishuNotificationService.sendOpsIncidentNotification({
        serviceName: upserted.incident.serviceName,
        severity: upserted.incident.severity,
        source: upserted.incident.source,
        failureType: upserted.incident.failureType,
        accountId: upserted.incident.accountId,
        jobId: upserted.incident.jobId,
        title: upserted.incident.title,
        diagnosisSummary: upserted.incident.diagnosisSummary,
        rootCause: upserted.incident.rootCause,
        suggestedAction: upserted.incident.suggestedAction,
        rawErrorExcerpt: upserted.incident.rawErrorExcerpt,
        entryUrl: input.entryUrl ?? null,
        currentStage: input.currentStage ?? null,
        triggerStage: input.triggerStage ?? null,
        questionTitle: input.questionTitle ?? null
      });
      await this.repository.markNotificationResult(
        upserted.incident.id,
        notificationResult.delivery,
        notificationResult.message
      );
    }

    const incident = (await this.repository.getIncidentById(upserted.incident.id)) ?? upserted.incident;

    return {
      incident,
      created: upserted.disposition === "created",
      notified: upserted.shouldNotify,
      notificationResult
    };
  }

  async resolveScanIncidents(activeFingerprints: string[], sources: OpsIncidentSource[]) {
    return this.repository.resolveOpenScanIncidents(activeFingerprints, sources);
  }

  async listIncidents(limit = 50) {
    return this.repository.listIncidents(limit);
  }

  async getIncidentById(id: number) {
    return this.repository.getIncidentById(id);
  }

  async getSummary(limit = 20): Promise<OpsSummary> {
    return this.repository.getSummary(limit);
  }
}

export function buildEmptyOpsScanSummary(): OpsScanSummary {
  return {
    scannedAt: new Date().toISOString(),
    createdCount: 0,
    dedupedCount: 0,
    notifiedCount: 0,
    resolvedCount: 0,
    openCount: 0
  };
}
