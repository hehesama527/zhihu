import {
  AccountRepository,
  FeishuNotificationService,
  JobRepository,
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

const pool = getMysqlPool();
await applySchemaMigrations(pool);

const accountRepository = new AccountRepository(pool);
const scheduleRepository = new ScheduleRepository(pool);
const scheduleService = new ScheduleService(scheduleRepository, accountRepository);
const jobRepository = new JobRepository(pool);
const feishuNotificationService = new FeishuNotificationService();
const opsIncidentRepository = new OpsIncidentRepository(pool);
const opsDiagnosisService = new OpsDiagnosisService();
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
      const summary = await opsScannerService.scan();
      console.log("[ops-agent] scan", JSON.stringify(summary));
    } catch (error) {
      console.error("[ops-agent] scan failed", error);
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

await boot();
