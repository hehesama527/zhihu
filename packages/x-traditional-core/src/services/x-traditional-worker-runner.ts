import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import {
  XAccountSoulService,
  XHotspotScoutService,
  XPublisherService,
  XReviewAgentService,
  XWriterService,
  XLlmService,
  toXTaskExecutionError,
  type XAccount,
  type XHotspotDetail,
  type XMainAgentDecision,
  type XPublishPlan,
  type XReviewAgentResult,
  type XReviewResult,
  type XTask,
  type XTaskExecutionError,
  type XWorkerTickSummary
} from "@zhihu-mvp/x-core";
import { getXTraditionalAppConfig } from "../config.js";
import { XTraditionalWorkspaceRepository } from "../repositories/x-traditional-workspace-repository.js";
import { XTraditionalLlmService } from "./x-traditional-llm-service.js";
import { XTraditionalMainAgentService } from "./x-traditional-main-agent-service.js";
import { XTraditionalRagService } from "./x-traditional-rag-service.js";

type CreateTraditionalTaskInput = {
  accountId: string;
  title?: string;
  brief?: string;
  goal: string;
  preferredMode: XTask["preferredMode"];
  scheduledAt: string | null;
};

type RunTaskResult = {
  task: XTask;
  published: boolean;
  blocked: boolean;
  skipped: boolean;
};

const MAX_TRADITIONAL_REVIEW_REVISIONS = 5;

export class XTraditionalWorkerRunner {
  private readonly accountSoulService: XAccountSoulService;

  constructor(
    private readonly repository: XTraditionalWorkspaceRepository,
    private readonly llmService: XTraditionalLlmService,
    private readonly writerService: XWriterService,
    private readonly reviewAgentService: XReviewAgentService,
    private readonly mainAgentService: XTraditionalMainAgentService,
    private readonly ragService: XTraditionalRagService,
    private readonly hotspotScoutService: XHotspotScoutService,
    private readonly publisherService: XPublisherService
  ) {
    this.accountSoulService = new XAccountSoulService(repository);
  }

  static createDefault() {
    const config = getXTraditionalAppConfig();
    const repository = new XTraditionalWorkspaceRepository();
    const llmService = new XTraditionalLlmService();
    const writerService = new XWriterService(llmService, undefined, {
      writerPromptSetName: "x_traditional_writer_agent",
      writerRuntimeTarget: "x",
      humanizerAgentName: "x_traditional_writer_agent"
    });
    const reviewAgentService = new XReviewAgentService(llmService, {
      reviewPromptSetName: "x_traditional_review_agent"
    });
    const mainAgentService = new XTraditionalMainAgentService(llmService);
    const ragService = new XTraditionalRagService();
    const hotspotScoutService = new XHotspotScoutService(new XLlmService());
    const publisherService = new XPublisherService(config);

    return new XTraditionalWorkerRunner(
      repository,
      llmService,
      writerService,
      reviewAgentService,
      mainAgentService,
      ragService,
      hotspotScoutService,
      publisherService
    );
  }

  async createTask(input: CreateTraditionalTaskInput) {
    const account = await this.repository.getAccount(input.accountId);
    if (!account) {
      throw new Error("X traditional account does not exist.");
    }

    return this.repository.createTask({
      accountId: input.accountId,
      title: input.title?.trim() || "待选题",
      brief: input.brief?.trim() || "由传统链路 MainAgent 根据热点、账号 Soul 和任务目标自动选题。",
      goal: input.goal.trim() || "结合当前热点为该账号选择一个适合发布的 X 选题。",
      preferredMode: input.preferredMode,
      scheduledAt: input.scheduledAt
    });
  }

  async tick(limit = 5): Promise<XWorkerTickSummary> {
    await this.repository.ensureReady();
    await this.ragService.ensureReady();
    const tasks = await this.repository.listTasks();
    const summary: XWorkerTickSummary = {
      processedTaskIds: [],
      publishedTaskIds: [],
      blockedTaskIds: []
    };

    for (const task of tasks) {
      if (summary.processedTaskIds.length >= limit) {
        break;
      }

      if (task.status === "published" || task.status === "blocked") {
        continue;
      }

      const result = await this.runTaskNow(task.id);
      if (result.skipped) {
        continue;
      }

      summary.processedTaskIds.push(result.task.id);
      if (result.published) {
        summary.publishedTaskIds.push(result.task.id);
      }
      if (result.blocked) {
        summary.blockedTaskIds.push(result.task.id);
      }
    }

    return summary;
  }

  async runTaskNow(taskId: string): Promise<RunTaskResult> {
    await this.repository.ensureReady();
    await this.ragService.ensureReady();
    let task = await this.requireTask(taskId);
    const account = await this.requireAccount(task.accountId);

    try {
      if (task.status === "planned" && isFutureTime(task.scheduledAt)) {
        return {
          task,
          published: false,
          blocked: false,
          skipped: true
        };
      }

      if (task.status === "approved_to_publish" || task.status === "publishing") {
        return this.runApprovedPublish(task, account);
      }

      if (account.status !== "active") {
        return this.blockTask(task, "Account is paused and cannot execute traditional tasks.", {
          stage: "unknown",
          type: "unknown_error"
        });
      }

      task = await this.requireUpdatedTask(task.id, {
        startedAt: task.startedAt ?? new Date().toISOString(),
        failureStage: null,
        failureType: null,
        failureReason: null
      });

      const promptContext = await this.ensurePromptSnapshot(task);
      if (!task.promptVersionSnapshotJson && promptContext.promptSnapshotJson) {
        task = await this.requireUpdatedTask(task.id, {
          promptVersionSnapshotJson: promptContext.promptSnapshotJson
        });
      }

      const accountSoul = await this.accountSoulService.ensureSoulDocument(account);
      if (!task.soulMarkdownSnapshot) {
        task = await this.requireUpdatedTask(task.id, {
          soulVersion: accountSoul.version,
          soulMarkdownSnapshot: accountSoul.markdown
        });
      }
      const taskSoulMarkdown = task.soulMarkdownSnapshot ?? accountSoul.markdown;
      const planningBundle = await this.selectTopic(task, account, taskSoulMarkdown, promptContext.promptSnapshot);
      task = planningBundle.task;

      if (task.mainAgentPlan?.decision === "block") {
        return this.blockTask(task, task.mainAgentPlan.reason, {
          stage: "review",
          type: "invalid_output"
        });
      }

      if (task.mainAgentPlan?.decision === "defer") {
        return {
          task,
          published: false,
          blocked: false,
          skipped: false
        };
      }

      let draftTask = await this.generateDraft(
        task,
        account,
        taskSoulMarkdown,
        undefined,
        promptContext.promptSnapshot
      );
      let reviewBundle = await this.reviewDraft(
        draftTask,
        account,
        taskSoulMarkdown,
        promptContext.promptSnapshot
      );

      while (reviewBundle.reviewResult.decision === "revise") {
        if (draftTask.revisionCount >= MAX_TRADITIONAL_REVIEW_REVISIONS) {
          return this.blockTask(
            draftTask,
            `Traditional review still requires revision after ${MAX_TRADITIONAL_REVIEW_REVISIONS} rounds: ${reviewBundle.reviewResult.reason}`,
            {
              stage: "review",
              type: "invalid_output"
            }
          );
        }

        draftTask = await this.requireUpdatedTask(draftTask.id, {
          status: "revision_required",
          currentStage: "revision_required",
          reviewAgentResult: reviewBundle.reviewAgentResult,
          reviewResult: reviewBundle.reviewResult,
          publishPlan: reviewBundle.publishPlan,
          revisionCount: draftTask.revisionCount + 1
        });

        draftTask = await this.generateDraft(
          draftTask,
          account,
          taskSoulMarkdown,
          buildWriterRevisionInstructions(reviewBundle.reviewResult),
          promptContext.promptSnapshot
        );
        reviewBundle = await this.reviewDraft(
          draftTask,
          account,
          taskSoulMarkdown,
          promptContext.promptSnapshot
        );
      }

      if (reviewBundle.reviewResult.decision === "block") {
        return this.blockTask(draftTask, reviewBundle.reviewResult.reason, {
          stage: "review",
          type: "invalid_output"
        });
      }

      let approvedTask = await this.requireUpdatedTask(draftTask.id, {
        status: "approved_to_publish",
        currentStage: "approved_to_publish",
        reviewAgentResult: reviewBundle.reviewAgentResult,
        reviewResult: reviewBundle.reviewResult,
        publishPlan: reviewBundle.publishPlan,
        failureStage: null,
        failureType: null,
        failureReason: null
      });

      if (reviewBundle.publishPlan.cadence === "defer") {
        const deferMinutes = Math.max(reviewBundle.publishPlan.deferMinutes, 10);
        const nextScheduledAt = approvedTask.scheduledAt ?? new Date(Date.now() + deferMinutes * 60_000).toISOString();

        approvedTask = await this.requireUpdatedTask(approvedTask.id, {
          scheduledAt: nextScheduledAt,
          publishPlan: {
            ...reviewBundle.publishPlan,
            shouldPublish: true,
            deferMinutes
          }
        });

        if (isFutureTime(approvedTask.scheduledAt)) {
          return {
            task: approvedTask,
            published: false,
            blocked: false,
            skipped: false
          };
        }
      }

      const publishingTask = await this.requireUpdatedTask(approvedTask.id, {
        status: "publishing",
        currentStage: "publishing"
      });

      const publishResult = await this.runPublish(account, publishingTask);
      const publishedTask = await this.requireUpdatedTask(publishingTask.id, {
        status: "published",
        currentStage: "published",
        publishResult,
        finishedAt: publishResult.publishedAt,
        failureStage: null,
        failureType: null,
        failureReason: null
      });

      await this.repository.updateAccount(account.id, {
        lastPublishedAt: publishResult.publishedAt,
        authStatus: "ready",
        authStatusReason: null,
        authCheckedAt: publishResult.publishedAt
      });

      return {
        task: publishedTask,
        published: true,
        blocked: false,
        skipped: false
      };
    } catch (error) {
      const failedTask = await this.persistTaskFailure(account, task.id, error);
      return {
        task: failedTask,
        published: false,
        blocked: failedTask.status === "blocked",
        skipped: false
      };
    }
  }

  private async selectTopic(
    task: XTask,
    account: XAccount,
    accountSoulMarkdown: string,
    promptSnapshot: PromptSnapshotMap | null
  ) {
    const [recentPublishedTasks, hotspotCandidates] = await Promise.all([
      this.repository.listRecentPublishedTasks(account.id, 8),
      this.hotspotScoutService.listPlanningHotspots(8)
    ]);
    const { selection, mainAgentPlan } = await this.mainAgentService.selectTopic({
      account,
      task,
      accountSoulMarkdown,
      hotspotCandidates,
      recentPublishedSignals: recentPublishedTasks.map((item) => ({
        title: item.title,
        publishedAt: item.publishResult?.publishedAt ?? item.finishedAt,
        mode: item.publishPlan?.mode ?? null,
        action: item.publishPlan?.action ?? null,
        contentStyle: item.publishPlan?.contentStyle ?? null,
        targetTweetUrl: item.publishPlan?.targetTweetUrl ?? null
      })),
      promptSnapshot
    });

    const scheduledAt =
      mainAgentPlan.decision === "defer"
        ? new Date(Date.now() + Math.max(mainAgentPlan.deferMinutes || 30, 10) * 60_000).toISOString()
        : task.scheduledAt;

    return {
      task: await this.requireUpdatedTask(task.id, {
        title: selection.title,
        brief: selection.brief,
        goal: selection.goal,
        mainAgentPlan,
        status: "planned",
        currentStage: "topic_selected",
        scheduledAt,
        reviewAgentResult: null,
        reviewResult: null,
        publishPlan: null
      })
    };
  }

  private async generateDraft(
    task: XTask,
    account: XAccount,
    accountSoulMarkdown: string | null,
    revisionInstructions?: string[],
    promptSnapshot?: PromptSnapshotMap | null
  ) {
    const selectedHotspots = await this.getSelectedHotspots(task);
    const retrievalContext = await this.ragService.buildWriterContext({
      account,
      task,
      hotspotTitles: selectedHotspots.map((item) => item.title)
    });

    await this.requireUpdatedTask(task.id, {
      status: "writing_pending",
      currentStage: "writing_pending",
      soulVersion: task.soulVersion,
      soulMarkdownSnapshot: accountSoulMarkdown,
      reviewAgentResult: null,
      reviewResult: null,
      publishPlan: null
    });

    await this.requireUpdatedTask(task.id, {
      status: "writing",
      currentStage: "writing"
    });

    const draftPack = await this.runWriter({
      account: {
        ...account,
        writerPromptSource: "database"
      },
      task,
      accountSoulMarkdown,
      revisionInstructions,
      mainAgentPlan: task.mainAgentPlan,
      selectedHotspots,
      retrievalContext,
      promptSnapshot: promptSnapshot ?? null
    });

    return this.requireUpdatedTask(task.id, {
      status: "draft_ready",
      currentStage: "draft_ready",
      draftPack,
      soulVersion: task.soulVersion,
      soulMarkdownSnapshot: accountSoulMarkdown
    });
  }

  private async reviewDraft(
    task: XTask,
    account: XAccount,
    accountSoulMarkdown: string | null,
    promptSnapshot?: PromptSnapshotMap | null
  ) {
    if (!task.draftPack) {
      throw new Error("Task is missing draftPack before review.");
    }
    const retrievalContext = await this.ragService.buildReviewContext({
      account,
      task,
      draftPack: task.draftPack
    });

    await this.requireUpdatedTask(task.id, {
      status: "under_review",
      currentStage: "under_review"
    });

    const recentPublishedTasks = await this.repository.listRecentPublishedTasks(account.id, 5);
    const reviewAgentResult = await this.runDraftReview({
      account,
      task,
      accountSoulMarkdown,
      draftPack: task.draftPack,
      retrievalContext,
      recentPublishedTitles: recentPublishedTasks.map((item) => item.title),
      promptSnapshot: promptSnapshot ?? null
    });

    const reviewResult = mapReviewAgentResultToReviewResult(reviewAgentResult);
    const publishPlan = buildPublishPlanFromMainAgentPlan(task.mainAgentPlan, reviewResult, reviewAgentResult);

    return {
      reviewAgentResult,
      reviewResult,
      publishPlan
    };
  }

  private async getSelectedHotspots(task: XTask): Promise<XHotspotDetail[]> {
    const hotspotIds = task.mainAgentPlan?.selectedHotspotIds ?? [];
    if (!hotspotIds.length) {
      return [];
    }

    return this.hotspotScoutService.getHotspotDetailsByIds(hotspotIds);
  }

  private async runApprovedPublish(task: XTask, account: XAccount): Promise<RunTaskResult> {
    if (task.status === "approved_to_publish" && isFutureTime(task.scheduledAt)) {
      return {
        task,
        published: false,
        blocked: false,
        skipped: true
      };
    }

    if (account.status !== "active") {
      return this.blockTask(task, "Account is paused and cannot publish approved traditional tasks.", {
        stage: "publish",
        type: "publish_error"
      });
    }

    if (account.authStatus !== "ready") {
      return this.blockTask(task, account.authStatusReason || "Account authorization is not ready for publishing.", {
        stage: "publish",
        type: "publish_error"
      });
    }

    if (!task.draftPack || task.draftPack.posts.length === 0) {
      return this.blockTask(task, "Approved traditional task is missing draft content.", {
        stage: "publish",
        type: "invalid_output"
      });
    }

    const publishingTask =
      task.status === "publishing"
        ? task
        : await this.requireUpdatedTask(task.id, {
            status: "publishing",
            currentStage: "publishing",
            startedAt: task.startedAt ?? new Date().toISOString(),
            failureStage: null,
            failureType: null,
            failureReason: null
          });

    try {
      const publishResult = await this.runPublish(account, publishingTask);
      const publishedTask = await this.requireUpdatedTask(publishingTask.id, {
        status: "published",
        currentStage: "published",
        publishResult,
        finishedAt: publishResult.publishedAt,
        failureStage: null,
        failureType: null,
        failureReason: null
      });

      await this.repository.updateAccount(account.id, {
        lastPublishedAt: publishResult.publishedAt,
        authStatus: "ready",
        authStatusReason: null,
        authCheckedAt: publishResult.publishedAt
      });

      return {
        task: publishedTask,
        published: true,
        blocked: false,
        skipped: false
      };
    } catch (error) {
      const failedTask = await this.persistTaskFailure(account, task.id, error);
      return {
        task: failedTask,
        published: false,
        blocked: failedTask.status === "blocked",
        skipped: false
      };
    }
  }

  private async blockTask(
    task: XTask,
    reason: string,
    failure?: {
      stage?: XTaskExecutionError["stage"];
      type?: XTaskExecutionError["failureType"];
    }
  ): Promise<RunTaskResult> {
    const blockedTask = await this.requireUpdatedTask(task.id, {
      status: "blocked",
      currentStage: "blocked",
      failureStage: failure?.stage ?? "unknown",
      failureType: failure?.type ?? "unknown_error",
      failureReason: reason,
      finishedAt: new Date().toISOString()
    });

    return {
      task: blockedTask,
      published: false,
      blocked: true,
      skipped: false
    };
  }

  private async requireTask(taskId: string) {
    const task = await this.repository.getTask(taskId);
    if (!task) {
      throw new Error("X traditional task does not exist.");
    }

    return task;
  }

  private async requireAccount(accountId: string) {
    const account = await this.repository.getAccount(accountId);
    if (!account) {
      throw new Error("X traditional account does not exist.");
    }

    return {
      ...account,
      writerPromptSource: "database" as const
    };
  }

  private async requireUpdatedTask(taskId: string, patch: Partial<XTask>) {
    const updatedTask = await this.repository.updateTask(taskId, patch);
    if (!updatedTask) {
      throw new Error("Failed to persist X traditional task update.");
    }

    return updatedTask;
  }

  private async runWriter(input: Parameters<XWriterService["writeDraft"]>[0]) {
    try {
      return await this.writerService.writeDraft(input);
    } catch (error) {
      throw toXTaskExecutionError("writing", error, "llm_error");
    }
  }

  private async runDraftReview(input: Parameters<XReviewAgentService["reviewDraft"]>[0]) {
    try {
      return await this.reviewAgentService.reviewDraft(input);
    } catch (error) {
      throw toXTaskExecutionError("review", error, "llm_error");
    }
  }

  private async runPublish(account: XAccount, task: XTask) {
    try {
      return await this.publisherService.publishTask(account, task);
    } catch (error) {
      throw toXTaskExecutionError("publish", error, "publish_error");
    }
  }

  private async persistTaskFailure(account: XAccount, taskId: string, error: unknown) {
    const failure = toXTaskExecutionError("unknown", error, "unknown_error");
    const nextStatus = failure.stage === "publish" ? "publish_failed" : "blocked";
    const failedTask = await this.requireUpdatedTask(taskId, {
      status: nextStatus,
      currentStage: failure.currentStage,
      failureStage: failure.stage,
      failureType: failure.failureType,
      failureReason: failure.message,
      finishedAt: new Date().toISOString()
    });

    if (failure.accountAuthStatus) {
      await this.repository.updateAccount(account.id, {
        authStatus: failure.accountAuthStatus,
        authStatusReason: failure.accountAuthReason ?? failure.message,
        authCheckedAt: new Date().toISOString()
      });
    }

    return failedTask;
  }

  private async ensurePromptSnapshot(task: XTask) {
    if (task.promptVersionSnapshotJson) {
      return {
        promptSnapshotJson: task.promptVersionSnapshotJson,
        promptSnapshot: JSON.parse(task.promptVersionSnapshotJson) as PromptSnapshotMap
      };
    }

    const promptSnapshot = await this.llmService.getPromptSnapshotForAccount();
    return {
      promptSnapshotJson: JSON.stringify(promptSnapshot),
      promptSnapshot
    };
  }
}

function mapReviewAgentResultToReviewResult(reviewAgentResult: XReviewAgentResult): XReviewResult {
  if (reviewAgentResult.verdict === "block") {
    return {
      decision: "block",
      reason: reviewAgentResult.summary,
      revisionInstructions: [],
      qualityNotes: buildReviewQualityNotes(reviewAgentResult)
    };
  }

  if (reviewAgentResult.verdict === "major_issue") {
    return {
      decision: "revise",
      reason: reviewAgentResult.summary,
      revisionInstructions: reviewAgentResult.suggestedFixes,
      qualityNotes: buildReviewQualityNotes(reviewAgentResult)
    };
  }

  return {
    decision: "approve",
    reason: reviewAgentResult.summary,
    revisionInstructions: [],
    qualityNotes: buildReviewQualityNotes(reviewAgentResult)
  };
}

function buildReviewQualityNotes(reviewAgentResult: XReviewAgentResult) {
  return normalizeStringArray([
    `ReviewAgent verdict: ${reviewAgentResult.verdict}. ${reviewAgentResult.summary}`,
    ...reviewAgentResult.strengths.map((item) => `Review strength: ${item}`),
    ...reviewAgentResult.issues.map((item) => `Review issue: ${item}`),
    ...reviewAgentResult.riskFlags.map((item) => `Review risk: ${item}`)
  ]);
}

function buildPublishPlanFromMainAgentPlan(
  mainAgentPlan: XMainAgentDecision | null,
  reviewResult: XReviewResult,
  reviewAgentResult: XReviewAgentResult
): XPublishPlan {
  const preferredMode = mainAgentPlan?.preferredMode === "thread" ? "thread" : "single";

  return {
    shouldPublish: reviewResult.decision === "approve",
    mode: preferredMode,
    action: mainAgentPlan?.publishAction ?? "post",
    contentStyle: mainAgentPlan?.contentStyle ?? "casual_note",
    cadence: mainAgentPlan?.cadence ?? "defer",
    deferMinutes: mainAgentPlan?.deferMinutes ?? 0,
    targetTweetUrl: mainAgentPlan?.targetTweetUrl ?? null,
    selectedHotspotIds: mainAgentPlan?.selectedHotspotIds ?? [],
    tagPlan:
      mainAgentPlan?.tagPlan ?? {
        hashtags: [],
        placement: "none",
        applyTo: preferredMode === "thread" ? "last_post" : "single",
        maxTags: 0,
        reason: ""
      },
    reason:
      reviewResult.decision === "approve"
        ? `Traditional review approved: ${reviewAgentResult.summary}`
        : reviewResult.reason
  };
}

function buildWriterRevisionInstructions(reviewResult: XReviewResult) {
  return normalizeStringArray([
    reviewResult.reason,
    ...reviewResult.revisionInstructions,
    ...reviewResult.qualityNotes
  ]);
}

function isFutureTime(value: string | null) {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).valueOf();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function normalizeStringArray(value: string[]) {
  return value.map((item) => item.trim()).filter(Boolean);
}
