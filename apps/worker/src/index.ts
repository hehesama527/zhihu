import {
  AccountRepository,
  BrowserSkillService,
  FailureResolutionService,
  HumanizerService,
  JobRepository,
  LlmService,
  PlaywrightToolRuntime,
  PromptRepository,
  PublishService,
  ReviewService,
  ScheduleRepository,
  ScheduleService,
  SessionService,
  TopicBatchPlannerService,
  TopicDiscoveryService,
  TopicPipelineService,
  TopicRepository,
  TopicReviewService,
  WorkerRunner,
  applySchemaMigrations,
  getAppConfig,
  getMysqlPool
} from "@zhihu-mvp/core";

const pool = getMysqlPool();
await applySchemaMigrations(pool);

const promptRepository = new PromptRepository(pool);
const llmService = new LlmService(promptRepository);
const scheduleRepository = new ScheduleRepository(pool);
const scheduleService = new ScheduleService(scheduleRepository);
const accountRepository = new AccountRepository(pool);
const topicRepository = new TopicRepository(pool);
const topicBatchPlannerService = new TopicBatchPlannerService(llmService, topicRepository);
const topicReviewService = new TopicReviewService(llmService);
const reviewService = new ReviewService(llmService);
const jobRepository = new JobRepository(pool);
const humanizerService = new HumanizerService(jobRepository);
const topicPipelineService = new TopicPipelineService(
  llmService,
  topicRepository,
  topicBatchPlannerService,
  topicReviewService,
  reviewService,
  humanizerService
);
const runtime = new PlaywrightToolRuntime(jobRepository);
const browserSkillService = new BrowserSkillService(runtime, jobRepository);
const sessionService = new SessionService(browserSkillService, llmService);
const topicDiscoveryService = new TopicDiscoveryService(topicRepository, browserSkillService, sessionService, llmService);
const publishService = new PublishService(llmService, browserSkillService, sessionService);
const failureResolutionService = new FailureResolutionService(llmService);
const runner = new WorkerRunner(
  scheduleService,
  scheduleRepository,
  accountRepository,
  topicRepository,
  topicDiscoveryService,
  topicPipelineService,
  jobRepository,
  publishService,
  failureResolutionService,
  llmService
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
      const summary = await runner.tick();
      console.log("[worker] tick", JSON.stringify(summary));
    } catch (error) {
      console.error("[worker] tick failed", error);
    } finally {
      if (!stopped) {
        timer = setTimeout(loop, getAppConfig().workerIntervalMs);
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
