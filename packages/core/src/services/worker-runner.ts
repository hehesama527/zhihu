import type { FailureType, JobDetail, JobListItem, PromptSnapshotMap, WorkerTickSummary } from "@zhihu-mvp/shared";
import { AccountRepository } from "../repositories/account-repository.js";
import { JobRepository } from "../repositories/job-repository.js";
import { ScheduleRepository } from "../repositories/schedule-repository.js";
import { TopicRepository } from "../repositories/topic-repository.js";
import { safeParseJson } from "../utils/json.js";
import { hasManualLoginLock } from "../utils/manual-login-lock.js";
import { FailureResolutionService } from "./failure-resolution-service.js";
import { LlmService } from "./llm-service.js";
import { PublishFlowError, PublishService, type PublishResumeAnchor } from "./publish-service.js";
import { ScheduleService } from "./schedule-service.js";
import { SessionStateError } from "./session-service.js";
import { TopicDiscoveryService } from "./topic-discovery-service.js";
import { TopicPipelineService } from "./topic-pipeline-service.js";

type TickBranchResult = {
  blockedByLogin: boolean;
  message: string | null;
};

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
    private readonly llmService: LlmService
  ) {}

  async tick(): Promise<WorkerTickSummary> {
    const generatedSlots = await this.scheduleService.bootstrapTodaySchedule();
    const account = await this.accountRepository.getAccount();
    if (!account) {
      throw new Error("默认账号不存在，无法启动 Worker。");
    }

    const manualLoginLocked = await hasManualLoginLock(account.id);
    if (account.status === "manual_login_required" || manualLoginLocked) {
      return {
        generatedSlots,
        harvestedCandidates: 0,
        preparedJobs: 0,
        processedJobs: 0,
        blockedByLogin: true,
        accountStatus: account.status,
        message:
          account.statusReason ??
          (manualLoginLocked
            ? "当前账号正在人工登录处理中，请完成登录后再点击确认恢复。"
            : "当前账号需要人工恢复登录后才能继续执行。")
      };
    }

    await this.fillScheduleSlots(account.id);

    let harvestedCandidates = 0;
    if (account.profileDir) {
      try {
        harvestedCandidates = await this.topicDiscoveryService.harvestCandidates({
          accountId: account.id,
          profileDir: account.profileDir
        });
      } catch (error) {
        if (error instanceof SessionStateError) {
          await this.pauseAccountForLogin(account.id, error.message, {
            failureType: error.sessionState === "session_expired" ? "session_expired" : "login_required"
          });

          return {
            generatedSlots,
            harvestedCandidates: 0,
            preparedJobs: 0,
            processedJobs: 0,
            blockedByLogin: true,
            accountStatus: "manual_login_required",
            message: error.message
          };
        }

        console.error("[worker] topic discovery failed", error);
      }
    }

    const prepareResult = await this.prepareQueuedJobs();
    if (prepareResult.blockedByLogin) {
      return {
        generatedSlots,
        harvestedCandidates,
        preparedJobs: prepareResult.preparedJobs,
        processedJobs: 0,
        blockedByLogin: true,
        accountStatus: "manual_login_required",
        message: prepareResult.message
      };
    }

    const processResult = await this.processDueJobs();

    return {
      generatedSlots,
      harvestedCandidates,
      preparedJobs: prepareResult.preparedJobs,
      processedJobs: processResult.processedJobs,
      blockedByLogin: processResult.blockedByLogin,
      accountStatus: processResult.blockedByLogin ? "manual_login_required" : "active",
      message: processResult.message
    };
  }

  private async fillScheduleSlots(accountId: number) {
    let createdJobs = 0;

    while (true) {
      const slot = await this.scheduleService.getNextUnassignedSlot();
      if (!slot) {
        break;
      }

      const jobId = await this.jobRepository.createQueuedJob({
        accountId,
        scheduledAt: slot.scheduledAt
      });
      await this.scheduleRepository.assignJobToSlot(slot.id, jobId);
      createdJobs += 1;
    }

    return createdJobs;
  }

  private async prepareQueuedJobs(): Promise<{ preparedJobs: number } & TickBranchResult> {
    const jobs = await this.jobRepository.getJobsNeedingPreparation(10);
    let preparedJobs = 0;

    for (const job of jobs) {
      try {
        const promptContext = await this.ensurePromptSnapshot(job);
        const preparedDraft = await this.topicPipelineService.prepareNextPublishableDraft({
          publishJobId: job.id,
          promptSnapshot: promptContext.promptSnapshot,
          onStage: async (stage) => {
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
          break;
        }

        await this.jobRepository.replaceJobPayload(job.id, {
          topicCardId: preparedDraft.topicCardId,
          reviewId: preparedDraft.reviewId,
          title: preparedDraft.title,
          promptVersionSnapshotJson: promptContext.promptSnapshotJson
        });
        preparedJobs += 1;
      } catch (error) {
        if (error instanceof SessionStateError) {
          await this.pauseAccountForLogin(job.accountId, error.message, {
            failureType: error.sessionState === "session_expired" ? "session_expired" : "login_required"
          });

          return {
            preparedJobs,
            blockedByLogin: true,
            message: error.message
          };
        }

        await this.failJob(
          job.id,
          job.scheduleSlotId,
          "unknown_failure",
          error instanceof Error ? error.message : "准备稿件时发生未知错误。"
        );
      }
    }

    return {
      preparedJobs,
      blockedByLogin: false,
      message: null
    };
  }

  private async processDueJobs(): Promise<{ processedJobs: number } & TickBranchResult> {
    const dueJobs = await this.jobRepository.getDueJobs();
    let processedJobs = 0;

    for (const job of dueJobs) {
      const account = await this.accountRepository.getAccount(job.accountId);
      if (!account || !account.profileDir) {
        continue;
      }

      const result = await this.executeJob(job, account.profileDir);
      processedJobs += 1;

      if (result.blockedByLogin) {
        return {
          processedJobs,
          blockedByLogin: true,
          message: result.message
        };
      }
    }

    return {
      processedJobs,
      blockedByLogin: false,
      message: null
    };
  }

  private async executeJob(job: JobListItem, profileDir: string): Promise<TickBranchResult> {
    let jobDetail = await this.jobRepository.getJobById(job.id);
    const slot = await this.scheduleRepository.getSlotByJobId(job.id);

    if (!jobDetail || !jobDetail.questionUrl || !jobDetail.questionTitle) {
      await this.failJob(job.id, slot?.id ?? null, "network_or_page_error", "任务缺少完整的题目信息。");
      return { blockedByLogin: false, message: null };
    }

    let questionTitle = jobDetail.questionTitle;
    let questionUrl = jobDetail.questionUrl;
    let content = jobDetail.approvedContent ?? jobDetail.humanizedContent ?? jobDetail.draftContent;
    if (!content) {
      await this.failJob(job.id, slot?.id ?? null, "content_risk_block", "没有可发布的正文内容。", jobDetail.topicCardId);
      return { blockedByLogin: false, message: null };
    }

    const promptContext = await this.ensurePromptSnapshot(jobDetail);
    let promptSnapshot = promptContext.promptSnapshot;
    let retryCount = job.retryCount;
    let rewriteCount = 0;
    const sessionKey = `publish-job-${job.id}`;
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
        const publishResult = await this.publishService.runPublishAttempt({
          sessionKey,
          traceGroupId,
          profileDir,
          questionUrl,
          content,
          publishJobId: job.id,
          publishAttemptId: attemptId,
          promptSnapshot,
          resumeAnchor: safeParseJson<PublishResumeAnchor | null>(jobDetail.resumeAnchorJson ?? "", null)
        });

        await this.jobRepository.updatePublishAttempt(attemptId, {
          status: "published",
          currentUrl: publishResult.finalUrl,
          payload: {
            ...attemptPayload,
            finishedAt: new Date().toISOString(),
            pageSnapshot: publishResult.pageSnapshot
          },
          failureType: null,
          failureReason: null
        });

        await this.jobRepository.createArtifact(attemptId, "screenshot", publishResult.screenshotPath, {
          phase: "publish-success"
        });

        await this.jobRepository.updateJobStatus(job.id, "published", {
          finalUrl: publishResult.finalUrl,
          failureReason: null,
          currentStage: "published",
          resumeAnchorJson: null,
          lastErrorType: null,
          promptVersionSnapshotJson: promptContext.promptSnapshotJson
        });

        if (slot) {
          await this.scheduleRepository.updateSlotStatus(slot.id, "published");
        }

        if (jobDetail.topicCardId) {
          await this.topicRepository.markCandidatePublishedByTopicCard(jobDetail.topicCardId);
        }

        await this.accountRepository.touchPublishSuccess(job.accountId);
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
          traceGroupId
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
          await this.pauseAccountForLogin(job.accountId, failure.message, {
            jobId: job.id,
            slotId: slot?.id ?? null,
            resumeAnchorJson,
            failureType: failure.failureType
          });
          await this.publishService.closeSession(sessionKey);

          return {
            blockedByLogin: true,
            message: failure.message
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
            promptSnapshot
          });

          if (verifyResult.ok) {
            await this.jobRepository.createArtifact(attemptId, "screenshot", verifyResult.screenshotPath, {
              phase: "publish-verify"
            });

            await this.jobRepository.updatePublishAttempt(attemptId, {
              status: "published",
              currentUrl: verifyResult.finalUrl,
              payload: {
                verifyResult
              },
              failureType: null,
              failureReason: null
            });

            await this.jobRepository.updateJobStatus(job.id, "published", {
              finalUrl: verifyResult.finalUrl,
              failureReason: null,
              currentStage: "published",
              resumeAnchorJson: null,
              lastErrorType: null,
              promptVersionSnapshotJson: promptContext.promptSnapshotJson
            });

            if (slot) {
              await this.scheduleRepository.updateSlotStatus(slot.id, "published");
            }

            if (jobDetail.topicCardId) {
              await this.topicRepository.markCandidatePublishedByTopicCard(jobDetail.topicCardId);
            }

            await this.accountRepository.touchPublishSuccess(job.accountId);
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
              rewritten.reason
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
            failure.message
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
    reason: string
  ) {
    if (currentTopicCardId) {
      await this.topicRepository.markCandidateDuplicateByTopicCard(currentTopicCardId, reason);
    }

    const promptSnapshot = safeParseJson<PromptSnapshotMap>(promptSnapshotJson, {});
    const replacement = await this.topicPipelineService.prepareNextPublishableDraft({
      publishJobId: jobId,
      promptSnapshot,
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

  private async failJob(
    jobId: number,
    slotId: number | null,
    failureType: FailureType,
    message: string,
    topicCardId?: number | null
  ) {
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
        promptSnapshot: input.promptSnapshot
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
        }
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
        phase: "publish-verify"
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

    await this.accountRepository.touchPublishSuccess(input.job.accountId);
  }

  private async pauseAccountForLogin(
    accountId: number,
    reason: string,
    options?: {
      jobId?: number | null;
      slotId?: number | null;
      resumeAnchorJson?: string | null;
      failureType?: FailureType;
    }
  ) {
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
  }

  private async ensurePromptSnapshot(job: Pick<JobListItem, "id" | "status" | "currentStage" | "promptVersionSnapshotJson">) {
    if (job.promptVersionSnapshotJson) {
      return {
        promptSnapshotJson: job.promptVersionSnapshotJson,
        promptSnapshot: safeParseJson<PromptSnapshotMap>(job.promptVersionSnapshotJson, {})
      };
    }

    const promptSnapshot = await this.llmService.getActivePromptSnapshot();
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
}

function normalizePublishError(error: unknown) {
  if (error instanceof PublishFlowError) {
    return {
      failureType: error.failureType,
      message: error.message,
      currentUrl: error.currentUrl,
      meta: error.meta
    };
  }

  return {
    failureType: "network_or_page_error" as FailureType,
    message: error instanceof Error ? error.message : "发布流程发生未知错误。",
    currentUrl: null,
    meta: {}
  };
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
