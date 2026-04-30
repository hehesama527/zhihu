import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import { safeParseJson } from "@zhihu-mvp/core";
import { XWorkspaceRepository } from "../repositories/x-workspace-repository.js";
import type { XAccount, XReviewAgentResult, XTask, XWorkerTickSummary } from "../types.js";
import { XAccountSoulService } from "./x-account-soul-service.js";
import { XLlmService } from "./x-llm-service.js";
import { XMainAgentService } from "./x-main-agent-service.js";
import { XNotificationService } from "./x-notification-service.js";
import { buildCandidateTweetTargets } from "./x-planning-utils.js";
import { XPublisherService } from "./x-publisher-service.js";
import { XReviewAgentService } from "./x-review-agent-service.js";
import { XHotspotScoutService } from "./x-hotspot-scout-service.js";
import { XTaskExecutionError, toXTaskExecutionError } from "./x-task-error.js";
import { XWriterService } from "./x-writer-service.js";

type CreateTaskInput = {
  accountId: string;
  title: string;
  brief: string;
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

const MAX_REVIEW_REVISIONS = 5;

export class XWorkerRunner {
  constructor(
    private readonly repository: XWorkspaceRepository,
    private readonly llmService: XLlmService,
    private readonly writerService: XWriterService,
    private readonly reviewAgentService: XReviewAgentService,
    private readonly mainAgentService: XMainAgentService,
    private readonly hotspotScoutService: XHotspotScoutService,
    private readonly publisherService: XPublisherService,
    private readonly notificationService: XNotificationService,
    private readonly accountSoulService = new XAccountSoulService(repository)
  ) {}

  async createTask(input: CreateTaskInput) {
    const account = await this.repository.getAccount(input.accountId);
    if (!account) {
      throw new Error("X account does not exist.");
    }

    return this.repository.createTask(input);
  }

  async tick(limit = 5): Promise<XWorkerTickSummary> {
    await this.repository.ensureReady();
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

      // 串行执行：在每个任务之间增加小延迟，避免 429 限流
      if (summary.processedTaskIds.length > 0) {
        await this.sleep(2000); // 2 秒间隔
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

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async runTaskNow(taskId: string): Promise<RunTaskResult> {
    await this.repository.ensureReady();
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

      const promptContext = await this.ensurePromptSnapshot(task, account);
      if (!task.promptVersionSnapshotJson && promptContext.promptSnapshotJson) {
        task = await this.requireUpdatedTask(task.id, {
          promptVersionSnapshotJson: promptContext.promptSnapshotJson
        });
      }

      if (account.status !== "active") {
        const blockedTask = await this.requireUpdatedTask(task.id, {
          status: "blocked",
          currentStage: "blocked",
          failureStage: "unknown",
          failureType: "unknown_error",
          failureReason: "Account is paused and cannot execute tasks.",
          finishedAt: new Date().toISOString()
        });

        return {
          task: blockedTask,
          published: false,
          blocked: true,
          skipped: false
        };
      }

      task = await this.requireUpdatedTask(task.id, {
        startedAt: task.startedAt ?? new Date().toISOString(),
        failureStage: null,
        failureType: null,
        failureReason: null
      });

      const accountSoul = await this.accountSoulService.ensureSoulDocument(account);
      if (!task.soulMarkdownSnapshot) {
        task = await this.requireUpdatedTask(task.id, {
          soulVersion: accountSoul.version,
          soulMarkdownSnapshot: accountSoul.markdown
        });
      }
      const taskSoulMarkdown = task.soulMarkdownSnapshot ?? accountSoul.markdown;

      const planningBundle = await this.planTask(
        task,
        account,
        taskSoulMarkdown,
        promptContext.promptSnapshot
      );

      task = planningBundle.task;
      if (planningBundle.result) {
        return planningBundle.result;
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
        if (draftTask.revisionCount >= MAX_REVIEW_REVISIONS) {
          return this.blockTask(
            draftTask,
            `Main agent still requires revision after ${MAX_REVIEW_REVISIONS} rounds: ${reviewBundle.reviewResult.reason}`,
            {
              stage: "review",
              type: "invalid_output"
            }
          );
        }

        draftTask = await this.requireUpdatedTask(draftTask.id, {
          status: "revision_required",
          currentStage: "revision_required",
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

      if (!approvedTask.publishPlan?.shouldPublish && approvedTask.publishPlan?.cadence !== "defer") {
        return this.blockTask(approvedTask, "Main agent decided not to publish this task.", {
          stage: "review",
          type: "invalid_output"
        });
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
      await this.notificationService.sendPublishSuccess(account, publishedTask);

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
      return this.blockTask(task, "Account is paused and cannot publish approved tasks.", {
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
      return this.blockTask(task, "Approved task is missing draft content.", {
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
      await this.notificationService.sendPublishSuccess(account, publishedTask);

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

  private async planTask(
    task: XTask,
    account: XAccount,
    accountSoulMarkdown: string | null,
    promptSnapshot: PromptSnapshotMap | null
  ) {
    const [recentPublishedTasks, hotspotCandidates] = await Promise.all([
      this.repository.listRecentPublishedTasks(account.id, 8),
      this.hotspotScoutService.listRelevantPlanningHotspots(task, 6)
    ]);
    const candidateTweetTargets = buildCandidateTweetTargets(task, hotspotCandidates);
    const mainAgentPlan = await this.mainAgentService.planTask({
      account,
      task,
      accountSoulMarkdown,
      hotspotCandidates,
      candidateTweetTargets,
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

    const plannedTask = await this.requireUpdatedTask(task.id, {
      mainAgentPlan,
      status: "planned",
      currentStage: "planned",
      scheduledAt:
        mainAgentPlan.decision === "defer"
          ? new Date(Date.now() + Math.max(mainAgentPlan.deferMinutes || 30, 10) * 60_000).toISOString()
          : task.scheduledAt
    });

    if (mainAgentPlan.decision === "block") {
      const blockedResult = await this.blockTask(plannedTask, mainAgentPlan.reason, {
        stage: "review",
        type: "invalid_output"
      });

      return {
        task: blockedResult.task,
        result: blockedResult
      };
    }

    if (mainAgentPlan.decision === "defer") {
      return {
        task: plannedTask,
        result: {
          task: plannedTask,
          published: false,
          blocked: false,
          skipped: false
        } satisfies RunTaskResult
      };
    }

    return {
      task: plannedTask,
      result: null
    };
  }

  private async generateDraft(
    task: XTask,
    account: XAccount,
    accountSoulMarkdown: string | null,
    revisionInstructions?: string[],
    promptSnapshot?: PromptSnapshotMap | null
  ) {
    const selectedHotspots = task.mainAgentPlan?.selectedHotspotIds?.length
      ? await this.hotspotScoutService.getHotspotDetailsByIds(task.mainAgentPlan.selectedHotspotIds)
      : [];

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
      account,
      task,
      accountSoulMarkdown,
      revisionInstructions,
      mainAgentPlan: task.mainAgentPlan,
      selectedHotspots,
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
      recentPublishedTitles: recentPublishedTasks.map((item) => item.title),
      promptSnapshot: promptSnapshot ?? null
    });

    const taskWithReviewAgentResult = await this.requireUpdatedTask(task.id, {
      reviewAgentResult
    });

    if (shouldForcePlanningFallbackRewrite(taskWithReviewAgentResult, reviewAgentResult)) {
      return buildPlanningFallbackRewriteBundle(taskWithReviewAgentResult, reviewAgentResult);
    }

    return this.runMainReview({
      account,
      task: taskWithReviewAgentResult,
      accountSoulMarkdown,
      draftPack: taskWithReviewAgentResult.draftPack!,
      reviewAgentResult,
      recentPublishedSignals: recentPublishedTasks.map((item) => ({
        title: item.title,
        publishedAt: item.publishResult?.publishedAt ?? item.finishedAt,
        mode: item.publishPlan?.mode ?? null,
        action: item.publishPlan?.action ?? null,
        contentStyle: item.publishPlan?.contentStyle ?? null,
        targetTweetUrl: item.publishPlan?.targetTweetUrl ?? null
      })),
      promptSnapshot: promptSnapshot ?? null
    });
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
      throw new Error("X task does not exist.");
    }

    return task;
  }

  private async requireAccount(accountId: string) {
    const account = await this.repository.getAccount(accountId);
    if (!account) {
      throw new Error("X account does not exist.");
    }

    return account;
  }

  private async requireUpdatedTask(taskId: string, patch: Partial<XTask>) {
    const updatedTask = await this.repository.updateTask(taskId, patch);
    if (!updatedTask) {
      throw new Error("Failed to persist X task update.");
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

  private async runMainReview(input: Parameters<XMainAgentService["reviewTask"]>[0]) {
    try {
      return await this.mainAgentService.reviewTask(input);
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

    await this.notificationService.sendTaskFailure(account, failedTask, failure.stage, failure.message);
    return failedTask;
  }

  private async ensurePromptSnapshot(task: XTask, account: XAccount) {
    if (task.promptVersionSnapshotJson) {
      return {
        promptSnapshotJson: task.promptVersionSnapshotJson,
        promptSnapshot: safeParseJson<PromptSnapshotMap>(task.promptVersionSnapshotJson, {})
      };
    }

    const promptSnapshot = await this.llmService.getPromptSnapshotForAccount(account);
    return {
      promptSnapshotJson: JSON.stringify(promptSnapshot),
      promptSnapshot
    };
  }
}

function isFutureTime(value: string | null) {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).valueOf();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function shouldForcePlanningFallbackRewrite(task: XTask, reviewAgentResult: XReviewAgentResult) {
  return Boolean(
    task.mainAgentPlan?.usedFallback &&
      task.mainAgentPlan.fallbackStage === "plan" &&
      task.revisionCount === 0 &&
      reviewAgentResult.verdict !== "block"
  );
}

function buildPlanningFallbackRewriteBundle(
  task: XTask,
  reviewAgentResult: XReviewAgentResult
): {
  reviewResult: NonNullable<XTask["reviewResult"]>;
  publishPlan: NonNullable<XTask["publishPlan"]>;
} {
  const mainAgentPlan = task.mainAgentPlan;
  const revisionInstructions = normalizeStringArray([
    ...reviewAgentResult.suggestedFixes,
    "这轮是 planning fallback 后的审稿改写。必须重新对齐原任务语义，不要沿用泛化的兜底写法。",
    "所有改写必须锚定原任务的 title、brief、goal，不要擅自引入任务里没有明确要求的新热点、新主体或新叙事。",
    "重新检查 publishAction、contentStyle、targetTweetUrl、useHotspot 与 writerBrief 是否真的匹配任务。",
    mainAgentPlan?.publishAction === "reply"
      ? "首句必须像真人在回这条具体推文，不能写成独立帖子开头。"
      : mainAgentPlan?.publishAction === "quote"
        ? "首句必须像借这条外部内容表达观点，不能假装没有目标推文。"
        : "正文必须像独立原生发帖，不要误写成 quote/reply 口吻。"
  ]);
  const qualityNotes = normalizeStringArray([
    "Planning fallback triggered one mandatory review-led rewrite before final approval.",
    `Review summary: ${reviewAgentResult.summary}`,
    ...reviewAgentResult.issues.map((item) => `Review issue: ${item}`),
    ...reviewAgentResult.riskFlags.map((item) => `Review risk: ${item}`)
  ]);

  return {
    reviewResult: {
      decision: "revise",
      reason: `Planning fallback was used in the first pass. ReviewAgent is requesting one rewrite before final approval. ${reviewAgentResult.summary}`,
      revisionInstructions,
      qualityNotes
    } satisfies NonNullable<XTask["reviewResult"]>,
    publishPlan: {
      shouldPublish: false,
      mode: mainAgentPlan?.preferredMode === "thread" ? "thread" : "single",
      action: mainAgentPlan?.publishAction ?? "post",
      contentStyle: mainAgentPlan?.contentStyle ?? "casual_note",
      cadence: "defer",
      deferMinutes: 30,
      targetTweetUrl: mainAgentPlan?.targetTweetUrl ?? null,
      selectedHotspotIds: mainAgentPlan?.selectedHotspotIds ?? [],
      tagPlan: mainAgentPlan?.tagPlan ?? {
        hashtags: [],
        placement: "none",
        applyTo: mainAgentPlan?.preferredMode === "thread" ? "last_post" : "single",
        maxTags: 0,
        reason: ""
      },
      reason: "Planning fallback triggered a mandatory review-led rewrite before publish approval."
    } satisfies NonNullable<XTask["publishPlan"]>
  };
}

function normalizeStringArray(value: string[]) {
  return value.map((item) => item.trim()).filter(Boolean);
}

function buildWriterRevisionInstructions(reviewResult: NonNullable<XTask["reviewResult"]>) {
  const evidence = normalizeStringArray([
    reviewResult.reason,
    ...reviewResult.revisionInstructions,
    ...reviewResult.qualityNotes
  ]).join("\n");
  const instructions = [...reviewResult.revisionInstructions];

  if (containsAnyReviewSignal(evidence, ["具体数字", "数字作为核心", "堆数字", "时间数字", "倍数", "数据堆砌"])) {
    instructions.push("删除所有具体数字、倍数、次数、月份和日期表达，不要把它们作为论据中心。统一改写成定性表达，例如“连续一段时间”“高杠杆”“反复试错”“明显降温”。");
  }

  if (containsAnyReviewSignal(evidence, ["过于绝对", "绝对化", "诚实推测", "确定性过强", "语气过满"])) {
    instructions.push("去掉绝对化判断和结论口气，避免“正在、一定、必然、就是”这类写法。优先改成“我更愿意理解为”“更像是”“可能在”“至少现在看”。");
  }

  if (containsAnyReviewSignal(evidence, ["说教", "建议感", "教育用户", "通用建议"])) {
    instructions.push("把建议口气改回个人经验或个人观察，不要教别人怎么做。优先使用“对我来说”“我现在更在意”“我不接受的其实是”。");
  }

  if (containsAnyReviewSignal(evidence, ["新闻播报", "复述新闻", "搬运", "数据转译"])) {
    instructions.push("不要复述新闻句式，不要按资讯播报顺序展开。直接写你的判断，再用少量背景支撑。");
  }

  if (containsAnyReviewSignal(evidence, ["逻辑链条", "因果解释", "转译", "第一人称锚定不足", "第一人称不足"])) {
    instructions.push("按“现象 -> 我怎么理解 -> 为什么会这样 -> 这意味着什么”重组正文，避免只并列结论词。必须把因果链写出来。");
    instructions.push("至少两处明确使用第一人称锚定，例如“我更愿意理解为”“我现在更在意的不是…而是…”，不要让观点像匿名旁白。");
  }

  return normalizeStringArray(Array.from(new Set(instructions)));
}

function containsAnyReviewSignal(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}
