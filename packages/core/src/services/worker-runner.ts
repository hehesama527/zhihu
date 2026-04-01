import type { FailureType, JobDetail, JobListItem, JobStage, PromptSnapshotMap, WorkerTickSummary } from "@zhihu-mvp/shared";
import { AccountRepository } from "../repositories/account-repository.js";
import { JobRepository } from "../repositories/job-repository.js";
import { ScheduleRepository } from "../repositories/schedule-repository.js";
import { TopicRepository } from "../repositories/topic-repository.js";
import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { safeParseJson } from "../utils/json.js";
import { hasManualLoginLock } from "../utils/manual-login-lock.js";
import { FeishuNotificationService } from "./feishu-notification-service.js";
import { FailureResolutionService } from "./failure-resolution-service.js";
import { LlmService } from "./llm-service.js";
import { OpsIncidentService } from "./ops-incident-service.js";
import { PublishFlowError, PublishService, type PublishResumeAnchor } from "./publish-service.js";
import { ScheduleService } from "./schedule-service.js";
import { SessionStateError } from "./session-service.js";
import type { AccountPromptContext } from "./account-prompt-context.js";
import { TopicDiscoveryService } from "./topic-discovery-service.js";
import { TopicPipelineService } from "./topic-pipeline-service.js";

type TickBranchResult = {
  blockedByLogin: boolean;
  message: string | null;
};

type PrepareJobResult = {
  prepared: boolean;
  blockedByLogin: boolean;
  message: string | null;
};

type WorkerAccount = NonNullable<Awaited<ReturnType<AccountRepository["getAccount"]>>>;
const MAX_PREPARE_JOBS_PER_TICK = 3;
const PREPARE_WINDOW_MINUTES = 120;
const HARVEST_SKIP_WINDOW_MINUTES = 30;
const PUBLISH_ATTEMPT_TIMEOUT_MS = 180_000;

export class WorkerRunner {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly scheduleRepository: ScheduleRepository,
    private readonly accountRepository: AccountRepository,
    private readonly topicRepository: TopicRepository,
    private readonly topicDiscoveryService: TopicDiscoveryService,
    private readonly topicPipelineService: TopicPipelineService,
    private readonly jobRepository: JobRepository,
    private readonly publishService: PublishService,
    private readonly failureResolutionService: FailureResolutionService,
    private readonly llmService: LlmService,
    private readonly feishuNotificationService: FeishuNotificationService,
    private readonly opsIncidentService?: OpsIncidentService
  ) {}

  async tick(): Promise<WorkerTickSummary> {
    const tickStartedAt = Date.now();
    logDebugTiming("worker.tick", "start");

    const generatedSlots = await this.scheduleService.bootstrapTodaySchedule();
    const accounts = await this.accountRepository.listAccounts();
    if (!accounts.length) {
      throw new Error("没有可运行账号，无法启动 Worker。");
    }

    const accountsById = new Map<number, WorkerAccount>(accounts.map((account) => [account.id, account]));
    const blockedAccountIds = new Set<number>();
    const blockedMessages: string[] = [];
    const runnableAccounts: WorkerAccount[] = [];

    for (const account of accounts) {
      const manualLoginLocked = await hasManualLoginLock(account.id);
      if (isLoginBlockedAccount(account) || manualLoginLocked) {
        blockedAccountIds.add(account.id);
        blockedMessages.push(
          account.statusReason ??
            (manualLoginLocked
              ? `账号「${account.name}」正在等待人工登录完成。`
              : `账号「${account.name}」需要先恢复登录态。`)
        );
        continue;
      }

      runnableAccounts.push(account);
    }

    for (const account of runnableAccounts) {
      if (!account.profileDir) {
        continue;
      }

      await this.fillScheduleSlots(account);
    }
    logDebugTiming("worker.tick", "filled_schedule_slots", {
      elapsedMs: getElapsedMs(tickStartedAt),
      runnableAccounts: runnableAccounts.length
    });

    const dueJobs = await this.jobRepository.getDueJobs();
    const hasDuePublishJobs = dueJobs.length > 0;
    logDebugTiming("worker.tick", "loaded_due_jobs", {
      elapsedMs: getElapsedMs(tickStartedAt),
      dueJobs: dueJobs.map((job) => ({ id: job.id, status: job.status, scheduledAt: job.scheduledAt }))
    });
    const processResult = await this.processDueJobs(dueJobs, accountsById, blockedAccountIds, blockedMessages);
    logDebugTiming("worker.tick", "processed_due_jobs", {
      elapsedMs: getElapsedMs(tickStartedAt),
      processedJobs: processResult.processedJobs
    });
    const prepareResult = hasDuePublishJobs
      ? { preparedJobs: 0 }
      : await this.prepareQueuedJobs(accountsById, blockedAccountIds, blockedMessages);
    const blockedByLogin = blockedAccountIds.size > 0;
    logDebugTiming("worker.tick", "finished_prepare", {
      elapsedMs: getElapsedMs(tickStartedAt),
      preparedJobs: prepareResult.preparedJobs,
      blockedAccounts: blockedAccountIds.size
    });

    let harvestedCandidates = 0;
    const harvestCheckStart = new Date();
    const hasImminentJobs = hasDuePublishJobs
      ? true
      : await this.jobRepository.hasScheduledJobsInWindow({
          start: harvestCheckStart,
          end: addMinutes(harvestCheckStart, HARVEST_SKIP_WINDOW_MINUTES)
        });
    logDebugTiming("worker.tick", "resolved_harvest_window", {
      elapsedMs: getElapsedMs(tickStartedAt),
      hasImminentJobs,
      hasDuePublishJobs,
      preparedJobs: prepareResult.preparedJobs
    });

    if (!hasImminentJobs && prepareResult.preparedJobs === 0) {
      for (const account of runnableAccounts) {
        if (!account.profileDir || blockedAccountIds.has(account.id)) {
          continue;
        }

        try {
          const harvestStartedAt = Date.now();
          logDebugTiming("worker.tick", "harvest_start", {
            accountId: account.id
          });
          harvestedCandidates += await this.topicDiscoveryService.harvestCandidates({
            accountId: account.id,
            profileDir: account.profileDir,
            accountContext: toAccountPromptContext(account)
          });
          logDebugTiming("worker.tick", "harvest_done", {
            accountId: account.id,
            elapsedMs: getElapsedMs(harvestStartedAt),
            harvestedCandidates
          });
        } catch (error) {
          if (error instanceof SessionStateError) {
            await this.pauseAccountForLogin(account.id, error.message, {
              failureType: mapSessionFailureType(error.sessionState),
              triggerStage: "topic_discovery"
            });
            blockedAccountIds.add(account.id);
            blockedMessages.push(error.message);
            accountsById.set(account.id, {
              ...account,
              status: "manual_login_required",
              statusReason: error.message
            });
            continue;
          }

          console.error("[worker] topic discovery failed", error);
        }
      }
    }
    logDebugTiming("worker.tick", "finished_harvest", {
      elapsedMs: getElapsedMs(tickStartedAt),
      harvestedCandidates
    });

    const summary = {
      generatedSlots,
      harvestedCandidates,
      preparedJobs: prepareResult.preparedJobs,
      processedJobs: processResult.processedJobs,
      blockedByLogin,
      accountStatus: resolveTickAccountStatus(accounts.length, blockedAccountIds.size),
      message: buildBlockedSummary(accounts.length, blockedAccountIds.size, blockedMessages)
    };

    logDebugTiming("worker.tick", "done", {
      elapsedMs: getElapsedMs(tickStartedAt),
      summary
    });

    return summary;
  }

  async runJobNow(jobId: number): Promise<{
    prepared: boolean;
    processed: boolean;
    blockedByLogin: boolean;
    message: string | null;
    job: JobDetail | null;
  }> {
    const job = await this.jobRepository.getJobById(jobId);
    if (!job) {
      throw new Error("任务不存在。");
    }

    const account = await this.accountRepository.getAccount(job.accountId);
    if (!account) {
      throw new Error("任务对应账号不存在。");
    }
    if (!account.profileDir) {
      throw new Error("账号缺少浏览器 profile，无法立即执行。");
    }

    const manualLoginLocked = await hasManualLoginLock(account.id);
    if (manualLoginLocked || isLoginBlockedAccount(account)) {
      return {
        prepared: false,
        processed: false,
        blockedByLogin: true,
        message:
          account.statusReason ??
          (manualLoginLocked
            ? `账号「${account.name}」正在等待人工登录完成。`
            : `账号「${account.name}」需要先恢复登录态。`),
        job
      };
    }

    const preparationStatuses = new Set<JobDetail["status"]>([
      "queued",
      "topic_discovery",
      "topic_agent",
      "topic_review",
      "writer",
      "humanizing",
      "review_hard_gate",
      "review_editorial",
      "review_publish"
    ]);
    const runnableStatuses = new Set<JobDetail["status"]>([
      "review_passed",
      "login_checking",
      "publishing",
      "publish_verify",
      "retry_waiting",
      "manual_login_required"
    ]);

    let prepared = false;
    let latestJob: JobDetail | null = job;

    if (preparationStatuses.has(job.status)) {
      const prepareResult = await this.prepareJob(job, account);
      prepared = prepareResult.prepared;
      latestJob = await this.jobRepository.getJobById(jobId);
      if (prepareResult.blockedByLogin) {
        return {
          prepared,
          processed: false,
          blockedByLogin: true,
          message: prepareResult.message,
          job: latestJob
        };
      }
    }

    latestJob = await this.jobRepository.getJobById(jobId);
    if (!latestJob) {
      return {
        prepared,
        processed: false,
        blockedByLogin: false,
        message: "任务在执行过程中已不存在。",
        job: null
      };
    }

    if (!runnableStatuses.has(latestJob.status)) {
      return {
        prepared,
        processed: false,
        blockedByLogin: false,
        message: `任务当前状态为 ${latestJob.status}，暂不需要立即发布执行。`,
        job: latestJob
      };
    }

    const latestAccount = await this.accountRepository.getAccount(latestJob.accountId);
    if (!latestAccount || !latestAccount.profileDir) {
      throw new Error("任务对应账号缺少可用浏览器 profile。");
    }

    const result = await this.executeJob(latestJob, latestAccount as WorkerAccount);
    return {
      prepared,
      processed: true,
      blockedByLogin: result.blockedByLogin,
      message: result.message,
      job: await this.jobRepository.getJobById(jobId)
    };
  }

  private async fillScheduleSlots(account: WorkerAccount) {
    const startedAt = Date.now();
    let createdJobs = 0;

    while (true) {
      const slot = await this.scheduleService.getNextUnassignedSlot(account.id);
      if (!slot) {
        break;
      }

      const promptSnapshot = await this.llmService.getPromptSnapshotForAccount({
        writerPromptVersionId: account.writerPromptVersionId
      });
      const promptSnapshotJson = JSON.stringify(promptSnapshot);

      const jobId = await this.jobRepository.createQueuedJob({
        accountId: account.id,
        scheduledAt: slot.scheduledAt,
        promptVersionSnapshotJson: promptSnapshotJson
      });
      await this.scheduleRepository.assignJobToSlot(slot.id, jobId);
      createdJobs += 1;
    }

    logDebugTiming("worker.fillScheduleSlots", "done", {
      accountId: account.id,
      createdJobs,
      elapsedMs: getElapsedMs(startedAt)
    });

    return createdJobs;
  }

  private async prepareQueuedJobs(
    accountsById: Map<number, WorkerAccount>,
    blockedAccountIds: Set<number>,
    blockedMessages: string[]
  ): Promise<{ preparedJobs: number }> {
    const startedAt = Date.now();
    const jobs = await this.jobRepository.getJobsNeedingPreparation(MAX_PREPARE_JOBS_PER_TICK, {
      now: new Date(),
      withinMinutes: PREPARE_WINDOW_MINUTES
    });
    logDebugTiming("worker.prepareQueuedJobs", "loaded_jobs", {
      elapsedMs: getElapsedMs(startedAt),
      jobs: jobs.map((job) => ({ id: job.id, accountId: job.accountId, status: job.status, scheduledAt: job.scheduledAt }))
    });
    let preparedJobs = 0;

    for (const job of jobs) {
      const account = accountsById.get(job.accountId);
      if (!account || blockedAccountIds.has(job.accountId) || isLoginBlockedAccount(account)) {
        continue;
      }

      const result = await this.prepareJob(job, account);
      if (result.prepared) {
        preparedJobs += 1;
      }
      if (result.blockedByLogin) {
        blockedAccountIds.add(job.accountId);
        blockedMessages.push(result.message ?? `账号 #${job.accountId} 需要人工登录恢复。`);
        accountsById.set(job.accountId, {
          ...account,
          status: "manual_login_required",
          statusReason: result.message
        });
      }
    }

    logDebugTiming("worker.prepareQueuedJobs", "done", {
      preparedJobs,
      elapsedMs: getElapsedMs(startedAt)
    });

    return { preparedJobs };
  }

  private async prepareJob(job: JobListItem, account: WorkerAccount): Promise<PrepareJobResult> {
    try {
      const jobStartedAt = Date.now();
      logDebugTiming("worker.prepareQueuedJobs", "job_start", {
        jobId: job.id,
        accountId: job.accountId,
        status: job.status,
        scheduledAt: job.scheduledAt
      });
      const promptContext = await this.ensurePromptSnapshot(job, account);
      const preparedDraft = await this.topicPipelineService.prepareNextPublishableDraft({
        publishJobId: job.id,
        promptSnapshot: promptContext.promptSnapshot,
        accountContext: toAccountPromptContext(account),
        onStage: async (stage) => {
          logDebugTiming("worker.prepareQueuedJobs", "job_stage", {
            jobId: job.id,
            accountId: job.accountId,
            stage,
            elapsedMs: getElapsedMs(jobStartedAt)
          });
          await this.jobRepository.updateJobStatus(job.id, stage, {
            currentStage: stage,
            promptVersionSnapshotJson: promptContext.promptSnapshotJson,
            failureReason: null,
            lastErrorType: null
          });
        }
      });

      if (!preparedDraft) {
        await this.jobRepository.updateJobStatus(job.id, "queued", {
          currentStage: "queued",
          promptVersionSnapshotJson: promptContext.promptSnapshotJson,
          failureReason: "当前没有可用选题，等待下一轮采题后重试。",
          lastErrorType: null
        });
        logDebugTiming("worker.prepareQueuedJobs", "job_no_candidate", {
          jobId: job.id,
          accountId: job.accountId,
          elapsedMs: getElapsedMs(jobStartedAt)
        });
        return {
          prepared: false,
          blockedByLogin: false,
          message: "当前没有可用选题，等待下一轮采题后重试。"
        };
      }

      await this.jobRepository.replaceJobPayload(job.id, {
        topicCardId: preparedDraft.topicCardId,
        reviewId: preparedDraft.reviewId,
        title: preparedDraft.title,
        promptVersionSnapshotJson: promptContext.promptSnapshotJson
      });
      logDebugTiming("worker.prepareQueuedJobs", "job_ready", {
        jobId: job.id,
        accountId: job.accountId,
        topicCardId: preparedDraft.topicCardId,
        reviewId: preparedDraft.reviewId,
        elapsedMs: getElapsedMs(jobStartedAt)
      });
      return {
        prepared: true,
        blockedByLogin: false,
        message: null
      };
    } catch (error) {
      if (error instanceof SessionStateError) {
        await this.pauseAccountForLogin(job.accountId, error.message, {
          jobId: job.id,
          slotId: job.scheduleSlotId,
          failureType: mapSessionFailureType(error.sessionState),
          triggerStage: job.currentStage ?? "queued"
        });
        logDebugTiming("worker.prepareQueuedJobs", "job_blocked_by_login", {
          jobId: job.id,
          accountId: job.accountId,
          message: error.message
        });
        return {
          prepared: false,
          blockedByLogin: true,
          message: error.message
        };
      }

      logDebugTiming("worker.prepareQueuedJobs", "job_failed", {
        jobId: job.id,
        accountId: job.accountId,
        error: error instanceof Error ? error.message : String(error)
      });

      if (isLlmConnectionError(error)) {
        console.error("[worker] LLM connection error during prepare, will retry next tick", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error)
        });
        return {
          prepared: false,
          blockedByLogin: false,
          message: error instanceof Error ? error.message : "LLM 连接失败，等待下一轮自动重试。"
        };
      }

      await this.failJob(
        job.id,
        job.scheduleSlotId,
        "unknown_failure",
        error instanceof Error ? error.message : "准备稿件时发生未知错误。"
      );
      return {
        prepared: false,
        blockedByLogin: false,
        message: error instanceof Error ? error.message : "准备稿件时发生未知错误。"
      };
    }
  }

  private async processDueJobs(
    dueJobs: JobListItem[],
    accountsById: Map<number, WorkerAccount>,
    blockedAccountIds: Set<number>,
    blockedMessages: string[]
  ): Promise<{ processedJobs: number }> {
    const startedAt = Date.now();
    logDebugTiming("worker.processDueJobs", "start", {
      dueJobs: dueJobs.map((job) => ({ id: job.id, accountId: job.accountId, status: job.status, scheduledAt: job.scheduledAt }))
    });
    let processedJobs = 0;

    for (const job of dueJobs) {
      if (blockedAccountIds.has(job.accountId)) {
        continue;
      }

      const account =
        accountsById.get(job.accountId) ??
        (await this.accountRepository.getAccount(job.accountId)) ??
        null;
      if (!account || isLoginBlockedAccount(account) || !account.profileDir) {
        continue;
      }

      accountsById.set(account.id, account);
      const result = await this.executeJob(job, account);
      processedJobs += 1;
      logDebugTiming("worker.processDueJobs", "job_processed", {
        jobId: job.id,
        accountId: job.accountId,
        blockedByLogin: result.blockedByLogin,
        elapsedMs: getElapsedMs(startedAt)
      });

      if (result.blockedByLogin) {
        blockedAccountIds.add(job.accountId);
        blockedMessages.push(result.message ?? `账号 #${job.accountId} 需要人工登录恢复。`);
        accountsById.set(job.accountId, {
          ...account,
          status: "manual_login_required",
          statusReason: result.message
        });
      }
    }

    logDebugTiming("worker.processDueJobs", "done", {
      processedJobs,
      elapsedMs: getElapsedMs(startedAt)
    });

    return { processedJobs };
  }

  private async executeJob(job: JobListItem, account: WorkerAccount): Promise<TickBranchResult> {
    let jobDetail = await this.jobRepository.getJobById(job.id);
    const slot = await this.scheduleRepository.getSlotByJobId(job.id);
    const profileDir = account.profileDir;

    if (!profileDir) {
      return { blockedByLogin: false, message: null };
    }

    if (!jobDetail) {
      await this.failJob(job.id, slot?.id ?? null, "network_or_page_error", "任务缺少完整的题目信息。");
      return { blockedByLogin: false, message: null };
    }

    const promptContext = await this.ensurePromptSnapshot(jobDetail, account);
    if (!jobDetail.questionUrl || !jobDetail.questionTitle || !resolveJobContent(jobDetail)) {
      const repairedJobDetail = await this.tryRehydrateJobPayload(job.id, account, promptContext);
      if (repairedJobDetail) {
        jobDetail = repairedJobDetail;
      }
    }

    if (!jobDetail.questionUrl || !jobDetail.questionTitle) {
      if (!jobDetail.topicCardId || !jobDetail.reviewId) {
        await this.requeueJobForPreparation(
          job.id,
          slot?.id ?? null,
          promptContext.promptSnapshotJson,
          "任务缺少完整的题目信息，已转回待准备队列等待自动补齐。"
        );
        return { blockedByLogin: false, message: null };
      }

      await this.failJob(job.id, slot?.id ?? null, "network_or_page_error", "任务缺少完整的题目信息。");
      return { blockedByLogin: false, message: null };
    }

    let questionTitle = jobDetail.questionTitle;
    let questionUrl = jobDetail.questionUrl;
    let content = resolveJobContent(jobDetail);
    if (!content) {
      if (!jobDetail.topicCardId || !jobDetail.reviewId) {
        await this.requeueJobForPreparation(
          job.id,
          slot?.id ?? null,
          promptContext.promptSnapshotJson,
          "任务缺少完整的正文载荷，已转回待准备队列等待自动补齐。"
        );
        return { blockedByLogin: false, message: null };
      }

      await this.failJob(job.id, slot?.id ?? null, "content_risk_block", "没有可发布的正文内容。", jobDetail.topicCardId);
      return { blockedByLogin: false, message: null };
    }

    let promptSnapshot = promptContext.promptSnapshot;
    let retryCount = job.retryCount;
    let rewriteCount = 0;
    const sessionKey = `publish-account-${job.accountId}-job-${job.id}`;
    const baseTraceGroupId = `job-${job.id}-${Date.now()}`;

    await this.jobRepository.updateJobStatus(job.id, "publishing", {
      currentStage: "login_checking",
      resumeAnchorJson: jobDetail.resumeAnchorJson,
      promptVersionSnapshotJson: promptContext.promptSnapshotJson,
      failureReason: null
    });

    if (slot) {
      await this.scheduleRepository.updateSlotStatus(slot.id, "in_progress");
    }

    while (true) {
      const attemptNo = retryCount + 1;
      const traceGroupId = `${baseTraceGroupId}-attempt-${attemptNo}`;
      const attemptPayload = {
        questionUrl,
        traceGroupId,
        startedAt: new Date().toISOString()
      };

      const attemptId = await this.jobRepository.createPublishAttempt(
        job.id,
        attemptNo,
        "running",
        questionUrl,
        attemptPayload
      );

      logExecutionContext({
        jobId: job.id,
        accountId: job.accountId,
        stage: "publishing",
        traceId: traceGroupId,
        attemptNo
      });

      try {
        const publishResult = await withTimeoutReject(
          this.publishService.runPublishAttempt({
            sessionKey,
            traceGroupId,
            profileDir,
            questionUrl,
            content,
            publishJobId: job.id,
            publishAttemptId: attemptId,
            promptSnapshot,
            resumeAnchor: safeParseJson<PublishResumeAnchor | null>(jobDetail.resumeAnchorJson ?? "", null),
            expectedZhihuUserName: account.zhihuUserName,
            accountName: account.name
          }),
          PUBLISH_ATTEMPT_TIMEOUT_MS,
          `发布步骤超时（>${Math.round(PUBLISH_ATTEMPT_TIMEOUT_MS / 1000)}s），已中断并重试。`
        );

        await this.finalizePublishedJob({
          job,
          jobDetail,
          slotId: slot?.id ?? null,
          attemptId,
          finalUrl: publishResult.finalUrl,
          screenshotPath: publishResult.screenshotPath,
          promptSnapshotJson: promptContext.promptSnapshotJson,
          attemptPayload: {
            ...attemptPayload,
            finishedAt: new Date().toISOString(),
            pageSnapshot: publishResult.pageSnapshot
          },
          publishStage: "publish_verify",
          artifactPhase: "publish-success"
        });

        await this.publishService.closeSession(sessionKey);
        return { blockedByLogin: false, message: null };
      } catch (error) {
        const failure = normalizePublishError(error);

        await this.jobRepository.updatePublishAttempt(attemptId, {
          status: "failed",
          currentUrl: failure.currentUrl,
          payload: {
            ...attemptPayload,
            finishedAt: new Date().toISOString(),
            meta: failure.meta
          },
          failureType: failure.failureType,
          failureReason: failure.message
        });

        const screenshotPath = typeof failure.meta.screenshotPath === "string" ? failure.meta.screenshotPath : null;
        if (screenshotPath) {
          await this.jobRepository.createArtifact(attemptId, "screenshot", screenshotPath, {
            phase: "publish-failure"
          });
        }

        const recoveredAsPublished = await this.tryFinalizePublishedFromExistingResult({
          job,
          jobDetail,
          slotId: slot?.id ?? null,
          attemptId,
          attemptPayload,
          failure,
          sessionKey,
          profileDir,
          content,
          promptSnapshot,
          promptSnapshotJson: promptContext.promptSnapshotJson,
          traceGroupId,
          expectedZhihuUserName: account.zhihuUserName,
          accountName: account.name
        });
        if (recoveredAsPublished) {
          await this.publishService.closeSession(sessionKey);
          return { blockedByLogin: false, message: null };
        }

        const resolution = await this.failureResolutionService.resolve(
          {
            failureType: failure.failureType,
            retryCount,
            context: {
              jobId: job.id,
              slotId: slot?.id ?? null,
              meta: failure.meta
            }
          },
          promptSnapshot
        );

        const resumeAnchorJson = JSON.stringify(
          normalizeResumeAnchor(failure.meta.resumeAnchor, failure.currentUrl ?? questionUrl)
        );

        if (resolution.action === "MANUAL_LOGIN") {
          const keepChallengePageOpen = shouldKeepChallengePageOpenForManualRecovery(failure);
          const recoveryMessage = buildManualRecoveryMessage(failure.message, keepChallengePageOpen);

          await this.pauseAccountForLogin(job.accountId, recoveryMessage, {
            jobId: job.id,
            slotId: slot?.id ?? null,
            resumeAnchorJson,
            failureType: keepChallengePageOpen ? "challenge_required" : failure.failureType
          });
          if (!keepChallengePageOpen) {
            await this.publishService.closeSession(sessionKey);
          }

          return {
            blockedByLogin: true,
            message: recoveryMessage
          };
        }

        if (resolution.action === "VERIFY_ONCE") {
          const verifyResult = await this.publishService.verifyExistingResult({
            sessionKey,
            traceGroupId: `${traceGroupId}-verify`,
            profileDir,
            publishJobId: job.id,
            publishAttemptId: attemptId,
            currentUrl: failure.currentUrl ?? questionUrl,
            content,
            promptSnapshot,
            expectedZhihuUserName: account.zhihuUserName,
            accountName: account.name
          });

          if (verifyResult.ok) {
            await this.finalizePublishedJob({
              job,
              jobDetail,
              slotId: slot?.id ?? null,
              attemptId,
              finalUrl: verifyResult.finalUrl,
              screenshotPath: verifyResult.screenshotPath,
              promptSnapshotJson: promptContext.promptSnapshotJson,
              attemptPayload: {
                verifyResult,
                finishedAt: new Date().toISOString()
              },
              publishStage: "publish_verify",
              artifactPhase: "publish-verify"
            });

            await this.publishService.closeSession(sessionKey);
            return { blockedByLogin: false, message: null };
          }
        }

        if (resolution.action === "REWRITE_ONCE") {
          if (rewriteCount >= 1 || !jobDetail.topicCardId) {
            await this.failJob(
              job.id,
              slot?.id ?? null,
              failure.failureType,
              `${failure.message}；内容重写次数已用尽。`,
              jobDetail.topicCardId
            );
            await this.publishService.closeSession(sessionKey);
            return { blockedByLogin: false, message: null };
          }

          const rewritten = await this.topicPipelineService.rewriteExistingTopic({
            publishJobId: job.id,
            topicCardId: jobDetail.topicCardId,
            candidateTitle: questionTitle,
            questionUrl,
            revisionFeedback: `${failure.message}；${resolution.reason}`,
            promptVersionSnapshotJson: promptContext.promptSnapshotJson,
            accountContext: toAccountPromptContext(account),
            onStage: async (stage) => {
              await this.jobRepository.updateJobStatus(job.id, stage, {
                currentStage: stage,
                promptVersionSnapshotJson: promptContext.promptSnapshotJson,
                failureReason: null,
                lastErrorType: null
              });
            }
          });

          if (rewritten?.kind === "ready") {
            await this.jobRepository.replaceJobPayload(job.id, {
              topicCardId: jobDetail.topicCardId,
              reviewId: rewritten.reviewId,
              title: rewritten.title,
              promptVersionSnapshotJson: promptContext.promptSnapshotJson
            });

            jobDetail = await this.jobRepository.getJobById(job.id);
            content = jobDetail?.approvedContent ?? jobDetail?.humanizedContent ?? jobDetail?.draftContent ?? null;
            if (!jobDetail || !content) {
              await this.failJob(job.id, slot?.id ?? null, "content_risk_block", "重写后没有得到可发布内容。", jobDetail?.topicCardId);
              await this.publishService.closeSession(sessionKey);
              return { blockedByLogin: false, message: null };
            }
            if (jobDetail.questionTitle && jobDetail.questionUrl) {
              questionTitle = jobDetail.questionTitle;
              questionUrl = jobDetail.questionUrl;
            }

            promptSnapshot = safeParseJson<PromptSnapshotMap>(jobDetail.promptVersionSnapshotJson ?? "{}", {});
            rewriteCount += 1;
            retryCount = 0;
            await this.publishService.restartSession({
              sessionKey,
              profileDir,
              traceGroupId: `${traceGroupId}-rewrite`
            });
            continue;
          }

          if (rewritten?.kind === "duplicate") {
            const replacementSucceeded = await this.reselectTopicForJob(
              job.id,
              jobDetail.topicCardId ?? null,
              slot?.id ?? null,
              promptContext.promptSnapshotJson,
              rewritten.reason,
              toAccountPromptContext(account)
            );
            if (!replacementSucceeded) {
              await this.failJob(job.id, slot?.id ?? null, "duplicate_block", rewritten.reason, jobDetail.topicCardId);
              await this.publishService.closeSession(sessionKey);
              return { blockedByLogin: false, message: null };
            }

            jobDetail = await this.jobRepository.getJobById(job.id);
            content = jobDetail?.approvedContent ?? jobDetail?.humanizedContent ?? jobDetail?.draftContent ?? null;
            if (!jobDetail || !content) {
              await this.failJob(job.id, slot?.id ?? null, "duplicate_block", "换题后没有得到可发布内容。", jobDetail?.topicCardId);
              await this.publishService.closeSession(sessionKey);
              return { blockedByLogin: false, message: null };
            }
            if (jobDetail.questionTitle && jobDetail.questionUrl) {
              questionTitle = jobDetail.questionTitle;
              questionUrl = jobDetail.questionUrl;
            }

            promptSnapshot = safeParseJson<PromptSnapshotMap>(jobDetail.promptVersionSnapshotJson ?? "{}", {});
            retryCount = 0;
            await this.publishService.restartSession({
              sessionKey,
              profileDir,
              traceGroupId: `${traceGroupId}-reselect`
            });
            continue;
          }

          await this.failJob(
            job.id,
            slot?.id ?? null,
            failure.failureType,
            rewritten?.reason ?? resolution.reason,
            jobDetail.topicCardId
          );
          await this.publishService.closeSession(sessionKey);
          return { blockedByLogin: false, message: null };
        }

        if (resolution.action === "RESELECT_TOPIC") {
          const replacementSucceeded = await this.reselectTopicForJob(
            job.id,
            jobDetail.topicCardId ?? null,
            slot?.id ?? null,
            promptContext.promptSnapshotJson,
            failure.message,
            toAccountPromptContext(account)
          );
          if (!replacementSucceeded) {
            await this.failJob(job.id, slot?.id ?? null, "duplicate_block", failure.message, jobDetail.topicCardId);
            await this.publishService.closeSession(sessionKey);
            return { blockedByLogin: false, message: null };
          }

          jobDetail = await this.jobRepository.getJobById(job.id);
          content = jobDetail?.approvedContent ?? jobDetail?.humanizedContent ?? jobDetail?.draftContent ?? null;
          if (!jobDetail || !content) {
            await this.failJob(job.id, slot?.id ?? null, "duplicate_block", "换题后没有得到可发布内容。", jobDetail?.topicCardId);
            await this.publishService.closeSession(sessionKey);
            return { blockedByLogin: false, message: null };
          }
          if (jobDetail.questionTitle && jobDetail.questionUrl) {
            questionTitle = jobDetail.questionTitle;
            questionUrl = jobDetail.questionUrl;
          }

          promptSnapshot = safeParseJson<PromptSnapshotMap>(jobDetail.promptVersionSnapshotJson ?? "{}", {});
          retryCount = 0;
          await this.publishService.restartSession({
            sessionKey,
            profileDir,
            traceGroupId: `${traceGroupId}-reselect`
          });
          continue;
        }

        if (
          resolution.action === "RETRY_SAME_SESSION" ||
          resolution.action === "RESTART_BROWSER" ||
          resolution.action === "VERIFY_ONCE"
        ) {
          if (retryCount >= 2) {
            await this.failJob(
              job.id,
              slot?.id ?? null,
              failure.failureType,
              `${failure.message}；浏览器重试次数已用尽。`,
              jobDetail.topicCardId
            );
            await this.publishService.closeSession(sessionKey);
            return { blockedByLogin: false, message: null };
          }

          retryCount += 1;
          await this.jobRepository.incrementRetry(job.id);
          await this.jobRepository.updateJobStatus(job.id, "retry_waiting", {
            failureReason: `${failure.message}；${resolution.reason}`,
            currentStage: "retry_waiting",
            resumeAnchorJson,
            lastErrorType: failure.failureType,
            promptVersionSnapshotJson: promptContext.promptSnapshotJson
          });

          if (resolution.action === "RESTART_BROWSER") {
            await this.publishService.restartSession({
              sessionKey,
              profileDir,
              traceGroupId: `${traceGroupId}-restart`
            });
          }
          continue;
        }

        await this.failJob(
          job.id,
          slot?.id ?? null,
          failure.failureType,
          `${failure.message}；${resolution.reason}`,
          jobDetail.topicCardId
        );
        await this.publishService.closeSession(sessionKey);
        return { blockedByLogin: false, message: null };
      }
    }
  }

  private async reselectTopicForJob(
    jobId: number,
    currentTopicCardId: number | null,
    slotId: number | null,
    promptSnapshotJson: string,
    reason: string,
    accountContext?: AccountPromptContext | null
  ) {
    if (currentTopicCardId) {
      await this.topicRepository.markCandidateDuplicateByTopicCard(currentTopicCardId, reason);
    }

    const promptSnapshot = safeParseJson<PromptSnapshotMap>(promptSnapshotJson, {});
    const replacement = await this.topicPipelineService.prepareNextPublishableDraft({
      publishJobId: jobId,
      promptSnapshot,
      accountContext,
      onStage: async (stage) => {
        await this.jobRepository.updateJobStatus(jobId, stage, {
          currentStage: stage,
          promptVersionSnapshotJson: promptSnapshotJson,
          failureReason: null,
          lastErrorType: null
        });
      }
    });

    if (!replacement) {
      return false;
    }

    await this.jobRepository.replaceJobPayload(jobId, {
      topicCardId: replacement.topicCardId,
      reviewId: replacement.reviewId,
      title: replacement.title,
      promptVersionSnapshotJson: promptSnapshotJson
    });

    if (slotId) {
      await this.scheduleRepository.updateSlotStatus(slotId, "in_progress");
    }

    return true;
  }

  private async requeueJobForPreparation(
    jobId: number,
    slotId: number | null,
    promptVersionSnapshotJson: string,
    message: string
  ) {
    await this.jobRepository.retryJob(jobId);
    await this.jobRepository.updateJobStatus(jobId, "queued", {
      currentStage: "queued",
      promptVersionSnapshotJson,
      failureReason: message,
      resumeAnchorJson: null,
      lastErrorType: null
    });

    if (slotId) {
      await this.scheduleRepository.updateSlotStatus(slotId, "pending");
    }
  }

  private async failJob(
    jobId: number,
    slotId: number | null,
    failureType: FailureType,
    message: string,
    topicCardId?: number | null
  ) {
    const jobDetail = await this.jobRepository.getJobById(jobId);
    const account = jobDetail ? await this.accountRepository.getAccount(jobDetail.accountId) : null;
    const triggerStage = resolveNotificationTriggerStage({
      resumeAnchorJson: jobDetail?.resumeAnchorJson ?? null,
      preferredStage: jobDetail?.currentStage ?? null,
      fallbackStage: "failed_terminal"
    });
    const entryUrl = resolveNotificationEntryUrl({
      resumeAnchorJson: jobDetail?.resumeAnchorJson ?? null,
      questionUrl: jobDetail?.questionUrl ?? null,
      finalUrl: jobDetail?.finalUrl ?? null
    });

    await this.jobRepository.updateJobStatus(jobId, "failed_terminal", {
      failureReason: `${failureType}: ${message}`,
      currentStage: "failed_terminal",
      lastErrorType: failureType
    });

    if (topicCardId) {
      if (failureType === "network_or_page_error" || failureType === "topic_invalid") {
        await this.topicRepository.markCandidateValidityByTopicCard(
          topicCardId,
          "invalid",
          `${failureType}: ${message}`
        );
      }

      if (failureType === "duplicate_block") {
        await this.topicRepository.markCandidateDuplicateByTopicCard(topicCardId, `${failureType}: ${message}`);
      } else {
        await this.topicRepository.markCandidatePublishFailedByTopicCard(topicCardId, `${failureType}: ${message}`);
      }
    }

    if (slotId) {
      await this.scheduleRepository.updateSlotStatus(slotId, "failed");
    }

    await this.reportOpsProblem(
      {
        source: "worker_job",
        severity: mapFailureSeverity(failureType),
        serviceName: "zhihu-worker",
        accountId: account?.id ?? jobDetail?.accountId ?? null,
        jobId,
        failureType,
        title: `Publish job #${jobId} failed`,
        currentStage: "failed_terminal",
        triggerStage,
        entryUrl,
        questionTitle: jobDetail?.questionTitle ?? jobDetail?.title ?? null,
        rawErrorExcerpt: message,
        evidence: {
          topicCardId: topicCardId ?? null
        }
      },
      {
        accountName: account?.name ?? (jobDetail ? `账号#${jobDetail.accountId}` : `账号任务#${jobId}`),
        zhihuUserName: account?.zhihuUserName ?? null,
        jobId,
        currentStage: "failed_terminal",
        triggerStage,
        failureType,
        failureReason: message,
        questionTitle: jobDetail?.questionTitle ?? jobDetail?.title ?? null,
        entryUrl,
        note: buildFailureDiagnosticNote(message)
      }
    );
  }

  private async tryFinalizePublishedFromExistingResult(input: {
    job: JobListItem;
    jobDetail: JobDetail;
    slotId: number | null;
    attemptId: number;
    attemptPayload: Record<string, unknown>;
    failure: {
      failureType: FailureType;
      message: string;
      currentUrl: string | null;
      meta: Record<string, unknown>;
    };
    sessionKey: string;
    profileDir: string;
    content: string;
    promptSnapshot: PromptSnapshotMap;
    promptSnapshotJson: string;
    traceGroupId: string;
    expectedZhihuUserName: string | null;
    accountName: string;
  }) {
    const verificationUrl = pickVerificationUrl(input.jobDetail, input.failure);
    if (!verificationUrl) {
      return false;
    }

    try {
      const verifyResult = await this.publishService.verifyExistingResult({
        sessionKey: input.sessionKey,
        traceGroupId: `${input.traceGroupId}-recover`,
        profileDir: input.profileDir,
        publishJobId: input.job.id,
        publishAttemptId: input.attemptId,
        currentUrl: verificationUrl,
        content: input.content,
        promptSnapshot: input.promptSnapshot,
        expectedZhihuUserName: input.expectedZhihuUserName,
        accountName: input.accountName
      });

      if (!verifyResult.ok) {
        return false;
      }

      await this.finalizePublishedJob({
        job: input.job,
        jobDetail: input.jobDetail,
        slotId: input.slotId,
        attemptId: input.attemptId,
        finalUrl: verifyResult.finalUrl,
        screenshotPath: verifyResult.screenshotPath,
        promptSnapshotJson: input.promptSnapshotJson,
        attemptPayload: {
          ...input.attemptPayload,
          recoveredFromFailureType: input.failure.failureType,
          recoveredFromUrl: verificationUrl,
          finishedAt: new Date().toISOString(),
          verifyResult
        },
        publishStage: "publish_verify",
        artifactPhase: "publish-verify"
      });

      return true;
    } catch {
      return false;
    }
  }

  private async finalizePublishedJob(input: {
    job: JobListItem;
    jobDetail: JobDetail;
    slotId: number | null;
    attemptId: number;
    finalUrl: string;
    screenshotPath?: string | null;
    promptSnapshotJson: string;
    attemptPayload: Record<string, unknown>;
    publishStage?: string | null;
    artifactPhase?: string;
  }) {
    await this.jobRepository.updatePublishAttempt(input.attemptId, {
      status: "published",
      currentUrl: input.finalUrl,
      payload: input.attemptPayload,
      failureType: null,
      failureReason: null
    });

    if (input.screenshotPath) {
      await this.jobRepository.createArtifact(input.attemptId, "screenshot", input.screenshotPath, {
        phase: input.artifactPhase ?? "publish-verify"
      });
    }

    await this.jobRepository.updateJobStatus(input.job.id, "published", {
      finalUrl: input.finalUrl,
      failureReason: null,
      currentStage: "published",
      resumeAnchorJson: null,
      lastErrorType: null,
      promptVersionSnapshotJson: input.promptSnapshotJson
    });

    if (input.slotId) {
      await this.scheduleRepository.updateSlotStatus(input.slotId, "published");
    }

    if (input.jobDetail.topicCardId) {
      await this.topicRepository.markCandidatePublishedByTopicCard(input.jobDetail.topicCardId);
    }

    if (input.jobDetail.questionUrl && input.jobDetail.questionTitle) {
      try {
        await this.topicRepository.upsertAnsweredTopic({
          accountId: input.job.accountId,
          questionUrl: input.jobDetail.questionUrl,
          questionTitle: input.jobDetail.questionTitle,
          topicCardId: input.jobDetail.topicCardId,
          reviewId: input.jobDetail.reviewId,
          publishJobId: input.job.id,
          answerUrl: input.finalUrl,
          answeredAt: new Date()
        });
      } catch (error) {
        console.error("[worker] failed to persist answered topic history", error);
      }
    }

    await this.accountRepository.touchPublishSuccess(input.job.accountId);

    const account = await this.accountRepository.getAccount(input.job.accountId);
    await this.feishuNotificationService.sendPublishSuccessNotification({
      accountName: account?.name ?? `账号#${input.job.accountId}`,
      zhihuUserName: account?.zhihuUserName ?? null,
      jobId: input.job.id,
      publishStage: input.publishStage ?? "publish_verify",
      questionTitle: input.jobDetail.questionTitle ?? input.jobDetail.title ?? input.job.title,
      publishedAt: new Date(),
      scheduledAt: input.jobDetail.scheduledAt ?? input.job.scheduledAt,
      finalUrl: input.finalUrl
    });
  }

  private async pauseAccountForLogin(
    accountId: number,
    reason: string,
    options?: {
      jobId?: number | null;
      slotId?: number | null;
      resumeAnchorJson?: string | null;
      failureType?: FailureType;
      triggerStage?: string | null;
    }
  ) {
    const account = await this.accountRepository.getAccount(accountId);
    const targetJob = options?.jobId != null ? await this.jobRepository.getJobById(options.jobId) : null;
    const triggerStage = resolveNotificationTriggerStage({
      resumeAnchorJson: options?.resumeAnchorJson ?? targetJob?.resumeAnchorJson ?? null,
      preferredStage: options?.triggerStage ?? targetJob?.currentStage ?? null,
      fallbackStage: "manual_login_required"
    });
    const entryUrl = resolveNotificationEntryUrl({
      resumeAnchorJson: options?.resumeAnchorJson ?? targetJob?.resumeAnchorJson ?? null,
      questionUrl: targetJob?.questionUrl ?? null,
      finalUrl: targetJob?.finalUrl ?? null
    });

    await this.accountRepository.markManualLoginRequired(accountId, reason);

    const dueJobs = (await this.jobRepository.getDueJobs()).filter((job) => job.accountId === accountId);
    const targetIds = new Set<number>(dueJobs.map((job) => job.id));
    if (options?.jobId) {
      targetIds.add(options.jobId);
    }

    for (const jobId of targetIds) {
      const slot =
        options?.jobId === jobId && options.slotId
          ? { id: options.slotId }
          : await this.scheduleRepository.getSlotByJobId(jobId);

      await this.jobRepository.updateJobStatus(jobId, "manual_login_required", {
        failureReason: reason,
        currentStage: "manual_login_required",
        resumeAnchorJson: options?.jobId === jobId ? options.resumeAnchorJson ?? null : null,
        lastErrorType: options?.jobId === jobId ? options.failureType ?? "login_required" : "login_required"
      });

      if (slot) {
        await this.scheduleRepository.updateSlotStatus(slot.id, "manual_login_required");
      }
    }

    await this.reportOpsProblem(
      {
        source: "manual_login",
        severity: "high",
        serviceName: "zhihu-worker",
        accountId,
        jobId: targetJob?.id ?? options?.jobId ?? null,
        failureType: options?.failureType ?? "login_required",
        title: `Account #${accountId} requires manual login`,
        currentStage: "manual_login_required",
        triggerStage,
        entryUrl,
        questionTitle: targetJob?.questionTitle ?? targetJob?.title ?? null,
        rawErrorExcerpt: reason,
        evidence: {
          note: targetJob ? null : "Account-level block without a linked publish job."
        }
      },
      {
        accountName: account?.name ?? `账号#${accountId}`,
        zhihuUserName: account?.zhihuUserName ?? null,
        jobId: targetJob?.id ?? options?.jobId ?? null,
        currentStage: "manual_login_required",
        triggerStage,
        failureType: options?.failureType ?? "login_required",
        failureReason: reason,
        questionTitle: targetJob?.questionTitle ?? targetJob?.title ?? null,
        entryUrl,
        note: targetJob ? null : "当前为账号级阻塞，无关联发布任务。"
      }
    );
  }

  private async reportOpsProblem(
    incidentInput: Parameters<OpsIncidentService["reportIncident"]>[0],
    fallbackInput: Parameters<FeishuNotificationService["sendProblemNotification"]>[0]
  ) {
    if (this.opsIncidentService) {
      try {
        await this.opsIncidentService.reportIncident(incidentInput);
        return;
      } catch (error) {
        console.error("[worker] failed to report ops incident", error);
      }
    }

    await this.feishuNotificationService.sendProblemNotification(fallbackInput);
  }

  private async ensurePromptSnapshot(
    job: Pick<JobListItem, "id" | "status" | "currentStage" | "promptVersionSnapshotJson">,
    account?: Pick<WorkerAccount, "writerPromptVersionId">
  ) {
    if (job.promptVersionSnapshotJson) {
      return {
        promptSnapshotJson: job.promptVersionSnapshotJson,
        promptSnapshot: safeParseJson<PromptSnapshotMap>(job.promptVersionSnapshotJson, {})
      };
    }

    const promptSnapshot = await this.llmService.getPromptSnapshotForAccount({
      writerPromptVersionId: account?.writerPromptVersionId ?? null
    });
    const promptSnapshotJson = JSON.stringify(promptSnapshot);

    await this.jobRepository.updateJobStatus(job.id, job.status, {
      currentStage: job.currentStage ?? job.status,
      promptVersionSnapshotJson: promptSnapshotJson
    });

    return {
      promptSnapshotJson,
      promptSnapshot
    };
  }

  private async tryRehydrateJobPayload(
    jobId: number,
    account: WorkerAccount,
    promptContext: { promptSnapshotJson: string; promptSnapshot: PromptSnapshotMap }
  ) {
    const replacement = await this.topicPipelineService.prepareNextPublishableDraft({
      publishJobId: jobId,
      promptSnapshot: promptContext.promptSnapshot,
      accountContext: toAccountPromptContext(account),
      onStage: async (stage) => {
        await this.jobRepository.updateJobStatus(jobId, stage, {
          currentStage: stage,
          promptVersionSnapshotJson: promptContext.promptSnapshotJson,
          failureReason: null,
          lastErrorType: null
        });
      }
    });

    if (!replacement) {
      return null;
    }

    await this.jobRepository.replaceJobPayload(jobId, {
      topicCardId: replacement.topicCardId,
      reviewId: replacement.reviewId,
      title: replacement.title,
      promptVersionSnapshotJson: promptContext.promptSnapshotJson
    });

    return this.jobRepository.getJobById(jobId);
  }
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function resolveJobContent(jobDetail: Pick<JobDetail, "approvedContent" | "humanizedContent" | "draftContent">) {
  return jobDetail.approvedContent ?? jobDetail.humanizedContent ?? jobDetail.draftContent;
}

function normalizePublishError(error: unknown) {
  if (error instanceof PublishFlowError) {
    const normalizedFailureType = normalizeFailureTypeByMessage(error.failureType, error.message);
    return {
      failureType: normalizedFailureType,
      message: error.message,
      currentUrl: error.currentUrl,
      meta: error.meta
    };
  }

  if (isLlmConnectionError(error)) {
    return {
      failureType: "llm_connection_error" as FailureType,
      message: error instanceof Error ? error.message : "LLM 连接失败。",
      currentUrl: null,
      meta: {}
    };
  }
  return {
    failureType: normalizeFailureTypeByMessage(
      "network_or_page_error" as FailureType,
      error instanceof Error ? error.message : "发布流程发生未知错误。"
    ),
    message: error instanceof Error ? error.message : "发布流程发生未知错误。",
    currentUrl: null,
    meta: {}
  };
}

function normalizeFailureTypeByMessage(failureType: FailureType, message: string): FailureType {
  if (isChallengeSignalText(message)) {
    return "challenge_required";
  }

  if (failureType !== "network_or_page_error" && failureType !== "unknown_failure") {
    return failureType;
  }

  const normalized = message.toLowerCase();
  if (
    normalized.includes("尚未登录") ||
    normalized.includes("需要人工登录") ||
    normalized.includes("login required") ||
    normalized.includes("not logged in")
  ) {
    return "login_required";
  }

  if (normalized.includes("账号不一致") || normalized.includes("identity mismatch")) {
    return "account_identity_mismatch";
  }

  if (normalized.includes("session expired") || normalized.includes("登录态失效")) {
    return "session_expired";
  }

  return failureType;
}

function shouldKeepChallengePageOpenForManualRecovery(input: {
  failureType: FailureType;
  message: string;
  currentUrl: string | null;
  meta: Record<string, unknown>;
}) {
  if (input.failureType === "challenge_required") {
    return true;
  }

  const metaSnapshotUrl =
    typeof input.meta.snapshot === "object" &&
    input.meta.snapshot &&
    "url" in input.meta.snapshot &&
    typeof (input.meta.snapshot as { url?: unknown }).url === "string"
      ? ((input.meta.snapshot as { url: string }).url)
      : null;

  return isChallengeSignalText([input.message, input.currentUrl, metaSnapshotUrl].filter(Boolean).join(" "));
}

function buildManualRecoveryMessage(message: string, keepChallengePageOpen: boolean) {
  if (!keepChallengePageOpen) {
    return message;
  }

  if (message.includes("当前发布页已保留")) {
    return message;
  }

  return `${message} 当前发布页已保留，不会自动关闭。请直接在这个浏览器页面里完成人机验证、滑块或其他反爬挑战，处理完后再点“登录成功，继续下一步”。`;
}

function isChallengeSignalText(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("account/unhuman") ||
    normalized.includes("captcha") ||
    normalized.includes("challenge") ||
    normalized.includes("安全验证") ||
    normalized.includes("异常验证") ||
    normalized.includes("人机验证") ||
    normalized.includes("滑块") ||
    normalized.includes("风控") ||
    normalized.includes("反爬") ||
    normalized.includes("风险验证") ||
    normalized.includes("访问受限")
  );
}

function isLlmConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  // 覆盖常见的网络/连接类错误关键词
  return (
    msg.includes("connection error") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("socket hang up") ||
    msg.includes("llm did not return") ||
    msg.includes("llm stream idle") ||
    msg.includes("llm returned an empty stream")
  );
}

function mapSessionFailureType(sessionState: SessionStateError["sessionState"]): FailureType {
  if (sessionState === "session_expired") {
    return "session_expired";
  }

  if (sessionState === "account_identity_mismatch") {
    return "account_identity_mismatch";
  }

  return "login_required";
}

function normalizeResumeAnchor(anchor: unknown, fallbackUrl: string) {
  if (anchor && typeof anchor === "object" && "stage" in anchor) {
    return anchor as PublishResumeAnchor;
  }

  return {
    stage: "login_checking",
    currentUrl: fallbackUrl
  } satisfies PublishResumeAnchor;
}

function resolveNotificationTriggerStage(input: {
  resumeAnchorJson?: string | null;
  preferredStage?: string | JobStage | null;
  fallbackStage: string;
}) {
  const resumeAnchor = safeParseJson<{ stage?: string | null } | null>(input.resumeAnchorJson ?? "", null);
  return resumeAnchor?.stage ?? input.preferredStage ?? input.fallbackStage;
}

function resolveNotificationEntryUrl(input: {
  resumeAnchorJson?: string | null;
  questionUrl?: string | null;
  finalUrl?: string | null;
}) {
  const resumeAnchor = safeParseJson<{ currentUrl?: string | null } | null>(input.resumeAnchorJson ?? "", null);
  return resumeAnchor?.currentUrl ?? input.questionUrl ?? input.finalUrl ?? null;
}

function pickVerificationUrl(
  jobDetail: Pick<JobDetail, "finalUrl" | "resumeAnchorJson">,
  failure: {
    currentUrl: string | null;
    meta: Record<string, unknown>;
  }
) {
  const failureResumeAnchor =
    failure.meta.resumeAnchor && typeof failure.meta.resumeAnchor === "object"
      ? (failure.meta.resumeAnchor as { currentUrl?: unknown }).currentUrl
      : null;
  const storedResumeAnchor = safeParseJson<{ currentUrl?: string | null } | null>(jobDetail.resumeAnchorJson ?? "", null);

  const candidates = [
    failure.currentUrl,
    typeof failureResumeAnchor === "string" ? failureResumeAnchor : null,
    jobDetail.finalUrl,
    storedResumeAnchor?.currentUrl ?? null
  ];

  return candidates.find((url): url is string => Boolean(url && url.includes("/answer/"))) ?? null;
}

function logExecutionContext(input: {
  jobId: number;
  accountId: number;
  stage: string;
  traceId: string;
  attemptNo: number;
}) {
  console.log(
    JSON.stringify({
      type: "job_trace",
      job_id: input.jobId,
      account_id: input.accountId,
      current_stage: input.stage,
      trace_id: input.traceId,
      attempt_id: input.attemptNo
    })
  );
}

function toAccountPromptContext(account: WorkerAccount): AccountPromptContext {
  return {
    accountId: account.id,
    accountName: account.name,
    zhihuUserName: account.zhihuUserName
  };
}

function isLoginBlockedAccount(account: Pick<WorkerAccount, "status">) {
  return account.status === "manual_login_required" || account.status === "session_expired";
}

function resolveTickAccountStatus(totalAccounts: number, blockedAccounts: number) {
  if (blockedAccounts <= 0) {
    return "active";
  }

  if (blockedAccounts >= totalAccounts) {
    return "manual_login_required";
  }

  return "partially_blocked";
}

function buildBlockedSummary(totalAccounts: number, blockedAccounts: number, blockedMessages: string[]) {
  if (blockedAccounts <= 0) {
    return null;
  }

  const firstMessage = Array.from(new Set(blockedMessages.filter(Boolean)))[0] ?? null;
  const prefix =
    blockedAccounts >= totalAccounts
      ? `${blockedAccounts} 个账号当前需要人工登录恢复。`
      : `${blockedAccounts} 个账号被登录状态阻塞，其余账号继续执行。`;

  return firstMessage ? `${prefix} ${firstMessage}` : prefix;
}

function mapFailureSeverity(failureType: FailureType) {
  if (
    failureType === "auth_required" ||
    failureType === "login_required" ||
    failureType === "session_expired" ||
    failureType === "account_identity_mismatch" ||
    failureType === "challenge_required"
  ) {
    return "high" as const;
  }

  if (failureType === "llm_connection_error" || failureType === "network_or_page_error" || failureType === "unknown_failure") {
    return "critical" as const;
  }

  return "medium" as const;
}

function buildFailureDiagnosticNote(message: string) {
  if (!message) {
    return null;
  }

  const fields = ["category", "code", "status", "syscall", "hostname"]
    .map((key) => {
      const matched = message.match(new RegExp(`${key}=([^|；\\n]+)`));
      if (!matched?.[1]) {
        return null;
      }

      return `${key}=${matched[1].trim()}`;
    })
    .filter((item): item is string => Boolean(item));

  if (fields.length <= 0) {
    return null;
  }

  return `LLM诊断：${fields.join(", ")}`;
}

async function withTimeoutReject<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
