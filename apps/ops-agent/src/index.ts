import {
  AccountRepository,
  FeishuNotificationService,
  JobRepository,
  LogCleanupService,
  OpsAgentErrorLogService,
  OpsDiagnosisService,
  OpsIncidentRepository,
  OpsIncidentService,
  OpsScannerService,
  ScheduleRepository,
  ScheduleService,
  applySchemaMigrations,
  getAppConfig,
  getMysqlPool
} from "@zhihu-mvp/core";

const opsAgentErrorLogService = new OpsAgentErrorLogService();

process.on("uncaughtExceptionMonitor", (error, origin) => {
  void persistLocalErrorTrace({
    source: "uncaught_exception",
    error,
    context: {
      origin
    }
  });
});

const pool = getMysqlPool();
await applySchemaMigrations(pool);

const accountRepository = new AccountRepository(pool);
const scheduleRepository = new ScheduleRepository(pool);
const scheduleService = new ScheduleService(scheduleRepository, accountRepository);
const jobRepository = new JobRepository(pool);
const feishuNotificationService = new FeishuNotificationService();
const opsIncidentRepository = new OpsIncidentRepository(pool);
const opsDiagnosisService = new OpsDiagnosisService();
const logCleanupService = new LogCleanupService();
const opsIncidentService = new OpsIncidentService(
  opsIncidentRepository,
  opsDiagnosisService,
  feishuNotificationService
);
const opsScannerService = new OpsScannerService(
  opsIncidentService,
  jobRepository,
  accountRepository,
  scheduleService
);

let timer: NodeJS.Timeout | null = null;
let stopped = false;

async function boot() {
  await accountRepository.ensureDefaultAccount();

  const loop = async () => {
    if (stopped) {
      return;
    }

    try {
      try {
        const errorLogCleanupResult = await opsAgentErrorLogService.runMonthlyCleanupIfNeeded();
        if (errorLogCleanupResult.ran && errorLogCleanupResult.summary) {
          console.log("[ops-agent] error-log-cleanup", JSON.stringify(errorLogCleanupResult.summary));
        }
      } catch (errorLogCleanupError) {
        console.error("[ops-agent] error log cleanup failed", errorLogCleanupError);
      }

      try {
        const cleanupResult = await logCleanupService.runIfNeeded();
        if (cleanupResult.ran && cleanupResult.summary) {
          console.log("[ops-agent] log-cleanup", JSON.stringify(cleanupResult.summary));
        }
      } catch (cleanupError) {
        console.error("[ops-agent] log cleanup failed", cleanupError);
        await persistLocalErrorTrace({
          source: "log_cleanup",
          error: cleanupError,
          context: {
            action: "runIfNeeded"
          }
        });
      }

      const summary = await opsScannerService.scan();
      console.log("[ops-agent] scan", JSON.stringify(summary));
    } catch (error) {
      console.error("[ops-agent] scan failed", error);
      await persistLocalErrorTrace({
        source: "scan",
        error,
        context: {
          action: "scan"
        }
      });
      try {
        await opsIncidentService.reportIncident({
          source: "worker_runtime",
          severity: "high",
          serviceName: "zhihu-ops-agent",
          failureType: "ops_scan_failed",
          title: "Ops agent scan failed",
          currentStage: "ops_scan",
          rawErrorExcerpt: error instanceof Error ? error.message : String(error),
          evidence: {
            stack: error instanceof Error ? error.stack ?? null : null
          }
        });
      } catch (reportError) {
        console.error("[ops-agent] failed to report incident", reportError);
        await persistLocalErrorTrace({
          source: "incident_report",
          error: reportError,
          context: {
            action: "reportIncident",
            originalError: error instanceof Error ? error.message : String(error)
          }
        });
      }
    } finally {
      if (!stopped) {
        timer = setTimeout(loop, getAppConfig().opsAgentIntervalMs);
      }
    }
  };

  await loop();
}

async function shutdown() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
  }
  await pool.end();
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

await boot().catch(async (error) => {
  await persistLocalErrorTrace({
    source: "boot",
    error,
    context: {
      action: "boot"
    }
  });
  throw error;
});

async function persistLocalErrorTrace(input: {
  source: string;
  error: unknown;
  context?: Record<string, unknown>;
}) {
  try {
    await opsAgentErrorLogService.recordError(input);
  } catch (logError) {
    console.error("[ops-agent] failed to append local error log", logError);
  }
}
