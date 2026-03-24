import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  AccountRepository,
  BrowserSkillService,
  DashboardService,
  FailureResolutionService,
  HumanizerService,
  JobRepository,
  LlmService,
  PlaywrightToolRuntime,
  PromptRepository,
  PromptService,
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
  getMysqlPool,
  safeParseJson
} from "@zhihu-mvp/core";
import {
  accountRecoveryActionSchema,
  createJobSchema,
  createPromptDraftSchema,
  promptSetNameSchema,
  promptTestRunSchema,
  reselectTopicSchema,
  retryJobSchema,
  updatePromptDraftSchema
} from "@zhihu-mvp/shared";

const app = Fastify({ logger: true });
const pool = getMysqlPool();
await applySchemaMigrations(pool);

const promptRepository = new PromptRepository(pool);
const promptService = new PromptService(promptRepository);
const llmService = new LlmService(promptRepository);
const scheduleRepository = new ScheduleRepository(pool);
const scheduleService = new ScheduleService(scheduleRepository);
const jobRepository = new JobRepository(pool);
const accountRepository = new AccountRepository(pool);
const topicRepository = new TopicRepository(pool);
const topicBatchPlannerService = new TopicBatchPlannerService(llmService, topicRepository);
const topicReviewService = new TopicReviewService(llmService);
const reviewService = new ReviewService(llmService);
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
const dashboardService = new DashboardService(accountRepository, scheduleRepository, jobRepository, topicRepository);
const workerRunner = new WorkerRunner(
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

await app.register(cors, {
  origin: true
});

app.setErrorHandler((error, _request, reply) => {
  const statusCode =
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 500;

  reply.status(statusCode).send({
    error: {
      code: statusCode,
      message: error instanceof Error ? error.message : "服务端发生未知错误。"
    }
  });
});

await promptService.bootstrapDefaults();
await accountRepository.ensureDefaultAccount();
await scheduleService.bootstrapTodaySchedule();

app.get("/health", async () => ({
  ok: true,
  service: "api"
}));

app.get("/dashboard/summary", async () => ({
  summary: await dashboardService.getSummary()
}));

app.get("/schedule/today", async () => ({
  slots: await scheduleService.getTodaySchedule()
}));

app.get("/schedule/week", async () => ({
  slots: await scheduleService.getWeekSchedule()
}));

app.get("/topics", async () => ({
  topics: await topicRepository.listTopics()
}));

app.get("/topics/batch-plan", async () => ({
  plan: await topicBatchPlannerService.getCurrentBatchPlan()
}));

app.get("/drafts", async () => ({
  drafts: await topicRepository.listDrafts()
}));

app.get("/jobs", async () => ({
  jobs: await jobRepository.listJobs()
}));

app.get("/publish-jobs", async () => ({
  jobs: await jobRepository.listPublishJobs()
}));

app.post("/jobs", async (request) => {
  const body = createJobSchema.parse(request.body ?? {});
  const account = await accountRepository.getAccount(body.accountId);
  if (!account) {
    throw new Error("指定账号不存在。");
  }

  const slot =
    (await scheduleService.getNextUnassignedSlot()) ??
    ({
      id: await scheduleRepository.createAdhocSlot(new Date(), "pending"),
      scheduledAt: new Date().toISOString(),
      status: "pending",
      publishJobId: null,
      title: null
    } as const);

  const jobId = await jobRepository.createQueuedJob({
    accountId: body.accountId,
    scheduledAt: slot.scheduledAt
  });
  await scheduleRepository.assignJobToSlot(slot.id, jobId);

  const job = await jobRepository.getJobById(jobId);
  if (!job) {
    throw new Error("任务已创建，但读取任务详情失败。");
  }

  return {
    jobId: job.id,
    status: job.status,
    displayStatus: job.displayStatus,
    currentStage: job.currentStage ?? "queued",
    scheduledAt: job.scheduledAt,
    message: "任务已创建，等待 Worker 推进选题、写作、审核和发布。"
  };
});

app.get("/jobs/:id", async (request) => {
  const params = request.params as { id: string };
  return {
    job: await jobRepository.getJobById(Number(params.id))
  };
});

app.get("/jobs/:id/publish-attempts", async (request) => {
  const params = request.params as { id: string };
  return {
    attempts: await jobRepository.listPublishAttempts(Number(params.id))
  };
});

app.get("/jobs/:id/artifacts", async (request) => {
  const params = request.params as { id: string };
  return {
    artifacts: await jobRepository.listArtifacts(Number(params.id))
  };
});

app.get("/jobs/:id/tool-traces", async (request) => {
  const params = request.params as { id: string };
  return {
    traces: await jobRepository.listToolTraces(Number(params.id))
  };
});

app.get("/jobs/:id/skill-runs", async (request) => {
  const params = request.params as { id: string };
  return {
    skillRuns: await jobRepository.listSkillRuns(Number(params.id))
  };
});

app.post("/jobs/:id/retry", async (request) => {
  const params = request.params as { id: string };
  retryJobSchema.parse(request.body ?? {});

  const jobId = Number(params.id);
  await jobRepository.retryJob(jobId);
  const slot = await scheduleRepository.getSlotByJobId(jobId);
  if (slot) {
    await scheduleRepository.updateSlotStatus(slot.id, "pending");
  }

  return { ok: true };
});

app.post("/jobs/:id/reselect-topic", async (request) => {
  const params = request.params as { id: string };
  reselectTopicSchema.parse(request.body ?? {});
  const jobId = Number(params.id);
  const job = await jobRepository.getJobById(jobId);
  if (!job) {
    throw new Error("任务不存在。");
  }

  const promptSnapshot =
    safeParseJson(job.promptVersionSnapshotJson ?? "", await llmService.getActivePromptSnapshot()) ??
    (await llmService.getActivePromptSnapshot());
  const promptSnapshotJson = JSON.stringify(promptSnapshot);

  const replacement = await topicPipelineService.prepareNextPublishableDraft({
    publishJobId: jobId,
    promptSnapshot,
    onStage: async (stage) => {
      await jobRepository.updateJobStatus(jobId, stage, {
        currentStage: stage,
        promptVersionSnapshotJson: promptSnapshotJson,
        failureReason: null,
        lastErrorType: null
      });
    }
  });

  if (!replacement) {
    throw new Error("当前没有新的可替换选题。");
  }

  await jobRepository.replaceJobPayload(jobId, {
    topicCardId: replacement.topicCardId,
    reviewId: replacement.reviewId,
    title: replacement.title,
    promptVersionSnapshotJson: promptSnapshotJson
  });

  const slot = await scheduleRepository.getSlotByJobId(jobId);
  if (slot && slot.status !== "published") {
    await scheduleRepository.updateSlotStatus(slot.id, "pending");
  }

  return { ok: true };
});

app.get("/account/status", async () => ({
  account: await dashboardService.getAccountView()
}));

app.post("/account/manual-login/start", async (request) => {
  const body = accountRecoveryActionSchema.parse(request.body);
  const account = await accountRepository.getAccount(body.accountId);
  if (!account?.profileDir) {
    throw new Error("账号没有配置浏览器 Profile 目录。");
  }

  const targetJob = body.publishJobId ? await jobRepository.getJobById(body.publishJobId) : null;
  const returnUrl = getReturnUrl(targetJob);

  await accountRepository.markManualLoginRequired(body.accountId, "需要人工确认知乎登录状态。");
  if (body.publishJobId) {
    await jobRepository.updateJobStatus(body.publishJobId, "manual_login_required", {
      currentStage: "manual_login_required",
      failureReason: "等待人工登录恢复。",
      resumeAnchorJson: returnUrl ? JSON.stringify({ stage: "login_checking", currentUrl: returnUrl }) : null,
      lastErrorType: "login_required"
    });

    const slot = await scheduleRepository.getSlotByJobId(body.publishJobId);
    if (slot) {
      await scheduleRepository.updateSlotStatus(slot.id, "manual_login_required");
    }
  }

  return sessionService.startManualLoginFlow(body.accountId, account.profileDir, returnUrl);
});

app.post("/account/recovery/confirm", async (request) => {
  const body = accountRecoveryActionSchema.parse(request.body);
  const account = await accountRepository.getAccount(body.accountId);
  if (!account?.profileDir) {
    throw new Error("账号没有配置浏览器 Profile 目录。");
  }

  const targetJob = body.publishJobId ? await jobRepository.getJobById(body.publishJobId) : null;
  const returnUrl = getReturnUrl(targetJob);
  const promptSnapshot = targetJob?.promptVersionSnapshotJson
    ? safeParseJson(targetJob.promptVersionSnapshotJson, {})
    : undefined;

  try {
    const recovery = await sessionService.confirmRecoveredSession({
      accountId: body.accountId,
      profileDir: account.profileDir,
      returnUrl,
      publishJobId: body.publishJobId ?? null,
      promptSnapshot
    });

    await accountRepository.markActive(body.accountId);

    if (body.publishJobId) {
      await jobRepository.updateJobStatus(body.publishJobId, "login_checking", {
        currentStage: "login_checking",
        failureReason: null,
        lastErrorType: null
      });

      const slot = await scheduleRepository.getSlotByJobId(body.publishJobId);
      if (slot) {
        await scheduleRepository.updateSlotStatus(slot.id, "pending");
      }
    }

    const summary = await workerRunner.tick();

    return {
      ok: true,
      blockedByLogin: false,
      message: "已确认登录状态，系统将继续推进流程。",
      sessionState: recovery.sessionState,
      summary
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "仍未检测到可复用的登录状态。";
    await accountRepository.markManualLoginRequired(body.accountId, message);

    if (body.publishJobId) {
      await jobRepository.updateJobStatus(body.publishJobId, "manual_login_required", {
        currentStage: "manual_login_required",
        failureReason: message,
        resumeAnchorJson: returnUrl ? JSON.stringify({ stage: "login_checking", currentUrl: returnUrl }) : null,
        lastErrorType: "login_required"
      });

      const slot = await scheduleRepository.getSlotByJobId(body.publishJobId);
      if (slot) {
        await scheduleRepository.updateSlotStatus(slot.id, "manual_login_required");
      }
    }

    return {
      ok: false,
      blockedByLogin: true,
      message,
      summary: null
    };
  }
});

app.get("/prompt-sets", async () => ({
  promptSets: await promptService.listPromptSets()
}));

app.get("/prompt-sets/:name", async (request) => {
  const params = request.params as { name: string };
  const name = promptSetNameSchema.parse(params.name);
  return {
    promptSet: await promptService.getPromptSet(name)
  };
});

app.post("/prompt-sets/:name/drafts", async (request) => {
  const params = request.params as { name: string };
  const name = promptSetNameSchema.parse(params.name);
  const body = createPromptDraftSchema.parse(request.body);
  return {
    promptVersionId: await promptService.createDraft(name, body)
  };
});

app.patch("/prompt-versions/:id", async (request) => {
  const params = request.params as { id: string };
  const body = updatePromptDraftSchema.parse(request.body);
  await promptService.updateDraft(Number(params.id), body);
  return { ok: true };
});

app.post("/prompt-versions/:id/test", async (request) => {
  const params = request.params as { id: string };
  const body = promptTestRunSchema.parse({
    ...(request.body as Record<string, unknown>),
    promptVersionId: Number(params.id)
  });
  return promptService.testPrompt(body);
});

app.post("/prompt-versions/:id/activate", async (request) => {
  const params = request.params as { id: string };
  await promptService.activatePromptVersion(Number(params.id));
  return { ok: true };
});

app.post("/prompt-versions/:id/rollback-target", async (request) => {
  const params = request.params as { id: string };
  await promptService.rollbackToVersion(Number(params.id));
  return { ok: true };
});

app.post("/worker/tick", async () => ({
  summary: await workerRunner.tick()
}));

await app.listen({
  host: "0.0.0.0",
  port: getAppConfig().apiPort
});

function getReturnUrl(job: Awaited<ReturnType<JobRepository["getJobById"]>>) {
  if (!job) {
    return null;
  }

  const resumeAnchor = safeParseJson<Record<string, unknown>>(job.resumeAnchorJson ?? "{}", {});
  if (typeof resumeAnchor.currentUrl === "string" && resumeAnchor.currentUrl) {
    return resumeAnchor.currentUrl;
  }

  return job.questionUrl ?? null;
}
