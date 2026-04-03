import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OpsIncidentSource, OpsScanSummary } from "@zhihu-mvp/shared";
import { AccountRepository } from "../repositories/account-repository.js";
import { JobRepository } from "../repositories/job-repository.js";
import { getAppConfig } from "../config/env.js";
import { sanitizeSensitiveText } from "../utils/sensitive-data.js";
import { OpsIncidentService, buildEmptyOpsScanSummary } from "./ops-incident-service.js";
import { OpsLogScanService } from "./ops-log-scan-service.js";
import { ScheduleService } from "./schedule-service.js";

const execFileAsync = promisify(execFile);
const ACTIVE_SCAN_SOURCES: OpsIncidentSource[] = [
  "api_health",
  "pm2_scan",
  "log_scan",
  "publish_attempt_scan",
  "schedule_scan"
];

type Pm2ProcessEntry = {
  name?: string;
  pm2_env?: {
    status?: string;
  };
  monit?: {
    memory?: number;
    cpu?: number;
  };
};

type OpsScannerServiceOptions = {
  logScanService?: OpsLogScanService;
};

export class OpsScannerService {
  private runningScan: Promise<OpsScanSummary> | null = null;
  private lastSummary: OpsScanSummary = buildEmptyOpsScanSummary();
  private readonly logScanService: OpsLogScanService;

  constructor(
    private readonly incidentService: OpsIncidentService,
    private readonly jobRepository: JobRepository,
    private readonly accountRepository: AccountRepository,
    private readonly scheduleService: ScheduleService,
    options: OpsScannerServiceOptions = {}
  ) {
    this.logScanService = options.logScanService ?? new OpsLogScanService();
  }

  async scan(): Promise<OpsScanSummary> {
    const summary = buildEmptyOpsScanSummary();
    const activeFingerprints: string[] = [];

    for (const candidate of await this.scanApiHealth()) {
      const result = await this.incidentService.reportIncident(candidate);
      activeFingerprints.push(result.incident.fingerprint);
      if (result.created) {
        summary.createdCount += 1;
      } else {
        summary.dedupedCount += 1;
      }
      if (result.notified) {
        summary.notifiedCount += 1;
      }
    }

    for (const candidate of await this.scanPm2Status()) {
      const result = await this.incidentService.reportIncident(candidate);
      activeFingerprints.push(result.incident.fingerprint);
      if (result.created) {
        summary.createdCount += 1;
      } else {
        summary.dedupedCount += 1;
      }
      if (result.notified) {
        summary.notifiedCount += 1;
      }
    }

    for (const candidate of await this.scanWorkerFreshness()) {
      const result = await this.incidentService.reportIncident(candidate);
      activeFingerprints.push(result.incident.fingerprint);
      if (result.created) {
        summary.createdCount += 1;
      } else {
        summary.dedupedCount += 1;
      }
      if (result.notified) {
        summary.notifiedCount += 1;
      }
    }

    for (const candidate of await this.scanStalePublishAttempts()) {
      const result = await this.incidentService.reportIncident(candidate);
      activeFingerprints.push(result.incident.fingerprint);
      if (result.created) {
        summary.createdCount += 1;
      } else {
        summary.dedupedCount += 1;
      }
      if (result.notified) {
        summary.notifiedCount += 1;
      }
    }

    for (const candidate of await this.scanScheduleCoverage()) {
      const result = await this.incidentService.reportIncident(candidate);
      activeFingerprints.push(result.incident.fingerprint);
      if (result.created) {
        summary.createdCount += 1;
      } else {
        summary.dedupedCount += 1;
      }
      if (result.notified) {
        summary.notifiedCount += 1;
      }
    }

    for (const candidate of await this.scanRecentLogs()) {
      const result = await this.incidentService.reportIncident(candidate);
      activeFingerprints.push(result.incident.fingerprint);
      if (result.created) {
        summary.createdCount += 1;
      } else {
        summary.dedupedCount += 1;
      }
      if (result.notified) {
        summary.notifiedCount += 1;
      }
    }

    summary.resolvedCount = await this.incidentService.resolveScanIncidents(activeFingerprints, ACTIVE_SCAN_SOURCES);
    summary.openCount = (await this.incidentService.getSummary()).openCount;
    summary.scannedAt = new Date().toISOString();
    this.lastSummary = summary;

    return summary;
  }

  getLastSummary() {
    return this.lastSummary;
  }

  isScanRunning() {
    return this.runningScan !== null;
  }

  startScan() {
    if (!this.runningScan) {
      this.runningScan = this.scan().finally(() => {
        this.runningScan = null;
      });
    }

    return this.runningScan;
  }

  private async scanApiHealth() {
    const { apiPort } = getAppConfig();
    const healthUrl = `http://127.0.0.1:${apiPort}/health`;

    try {
      const response = await fetch(healthUrl, {
        method: "GET",
        headers: {
          accept: "application/json"
        }
      });

      if (response.ok) {
        return [];
      }

      return [
        {
          source: "api_health" as const,
          severity: "critical" as const,
          serviceName: "zhihu-api",
          failureType: "api_health_failed",
          title: "API health check failed",
          rawErrorExcerpt: `Health endpoint returned HTTP ${response.status}.`,
          evidence: {
            healthUrl,
            httpStatus: response.status,
            responseBody: sanitizeSensitiveText(await response.text())
          }
        }
      ];
    } catch (error) {
      return [
        {
          source: "api_health" as const,
          severity: "critical" as const,
          serviceName: "zhihu-api",
          failureType: "api_health_failed",
          title: "API health check failed",
          rawErrorExcerpt: error instanceof Error ? error.message : String(error),
          evidence: {
            healthUrl
          }
        }
      ];
    }
  }

  private async scanPm2Status() {
    const expected = ["zhihu-api", "zhihu-worker", "zhihu-web", "zhihu-ops-agent"];
    const workspaceRoot = getAppConfig().workspaceRoot;
    const localPm2CliPath = path.join(workspaceRoot, "node_modules", "pm2", "bin", "pm2");

    try {
      if (!fs.existsSync(localPm2CliPath)) {
        throw new Error(`Local PM2 CLI not found: ${localPm2CliPath}`);
      }

      const { stdout } = await execFileAsync(process.execPath, [localPm2CliPath, "jlist"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 5 * 1024 * 1024
      });
      const processes = JSON.parse(stdout) as Pm2ProcessEntry[];
      const byName = new Map(processes.map((item) => [item.name ?? "", item]));

      return expected
        .map((name) => {
          const processInfo = byName.get(name);
          if (!processInfo) {
            return {
              source: "pm2_scan" as const,
              severity: "critical" as const,
              serviceName: name,
              failureType: "pm2_process_missing",
              title: `${name} is missing from PM2`,
              rawErrorExcerpt: `${name} was not returned by pm2 jlist.`,
              evidence: {
                expectedProcesses: expected
              }
            };
          }

          const status = processInfo.pm2_env?.status ?? "unknown";
          if (status === "online") {
            return null;
          }

          return {
            source: "pm2_scan" as const,
            severity: name === "zhihu-api" || name === "zhihu-worker" ? ("critical" as const) : ("high" as const),
            serviceName: name,
            failureType: "pm2_process_not_online",
            title: `${name} is not online`,
            rawErrorExcerpt: `PM2 reported status=${status}.`,
            evidence: {
              status,
              cpu: processInfo.monit?.cpu ?? null,
              memory: processInfo.monit?.memory ?? null
            }
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
    } catch (error) {
      return [
        {
          source: "pm2_scan" as const,
          severity: "high" as const,
          serviceName: "zhihu-ops-agent",
          failureType: "pm2_scan_failed",
          title: "PM2 status scan failed",
          rawErrorExcerpt: error instanceof Error ? error.message : String(error),
          evidence: {
            workspaceRoot,
            nodeExecutable: process.execPath,
            pm2CliPath: localPm2CliPath,
            platform: process.platform
          }
        }
      ];
    }
  }

  private async scanWorkerFreshness() {
    const { workspaceRoot, workerIntervalMs } = getAppConfig();
    const workerOutLog = path.join(workspaceRoot, ".runlogs", "zhihu-worker.out.log");

    if (!fs.existsSync(workerOutLog)) {
      return [];
    }

    const stats = fs.statSync(workerOutLog);
    const stallThresholdMs = Math.max(workerIntervalMs * 4, 180_000);
    const ageMs = Date.now() - stats.mtime.getTime();
    if (ageMs <= stallThresholdMs) {
      return [];
    }

    return [
      {
        source: "pm2_scan" as const,
        severity: "high" as const,
        serviceName: "zhihu-worker",
        failureType: "worker_tick_stalled",
        title: "Worker tick output looks stalled",
        rawErrorExcerpt: `zhihu-worker.out.log has not been updated for ${Math.round(ageMs / 1000)} seconds.`,
        fingerprintKey: workerOutLog,
        evidence: {
          logFile: workerOutLog,
          lastModifiedAt: stats.mtime.toISOString(),
          stallThresholdMs
        }
      }
    ];
  }

  private async scanStalePublishAttempts() {
    const attempts = await this.jobRepository.listStaleRunningAttempts(30);

    return attempts.map((attempt) => ({
      source: "publish_attempt_scan" as const,
      severity: "medium" as const,
      serviceName: "zhihu-worker",
      jobId: attempt.publishJobId,
      accountId: attempt.accountId,
      failureType: "stale_running_publish_attempt",
      title: `Publish attempt #${attempt.attemptId} is still running`,
      rawErrorExcerpt: `Publish attempt #${attempt.attemptId} has stayed in running status since ${attempt.createdAt}.`,
      evidence: attempt
    }));
  }

  private async scanScheduleCoverage() {
    const accounts = await this.accountRepository.listAccounts();
    if (!accounts.length) {
      return [];
    }

    const slots = await this.scheduleService.getTodaySchedule();
    if (slots.length > 0) {
      return [];
    }

    return [
      {
        source: "schedule_scan" as const,
        severity: "medium" as const,
        serviceName: "zhihu-worker",
        failureType: "schedule_missing",
        title: "No schedule slots were generated for today",
        rawErrorExcerpt: "Today schedule is empty while runnable accounts exist.",
        evidence: {
          accountCount: accounts.length
        }
      }
    ];
  }

  private async scanRecentLogs() {
    const incidents = await this.logScanService.scanRecentErrors();

    return incidents.map((incident) => ({
      ...incident,
      rawErrorExcerpt: sanitizeSensitiveText(incident.rawErrorExcerpt) ?? "Recent log errors were detected."
    }));
  }
}
