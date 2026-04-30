import cors from "@fastify/cors";
import Fastify from "fastify";
import { safeParseJson } from "@zhihu-mvp/core";
import {
  createXAccountSchema,
  createXTaskSchema,
  getXAppConfig,
  saveXAccountSoulSchema,
  updateXAccountSchema,
  workerTickSchema,
  XAccountSoulService,
  XHotspotScoutService,
  XMainAgentService,
  XNotificationService,
  XPublisherService,
  XPromptService,
  XReviewAgentService,
  type XAccount,
  XWorkspaceRepository,
  XWorkerRunner,
  XWriterService,
  XLlmService,
  XBrowserRuntime
} from "@zhihu-mvp/x-core";

const app = Fastify({ logger: true });
const repository = new XWorkspaceRepository();
const llmService = new XLlmService();
const browserRuntime = new XBrowserRuntime();
const promptService = new XPromptService(llmService);
const accountSoulService = new XAccountSoulService(repository);
const writerService = new XWriterService(llmService);
const reviewAgentService = new XReviewAgentService(llmService);
const mainAgentService = new XMainAgentService(llmService);
const publisherService = new XPublisherService();
const notificationService = new XNotificationService();
const hotspotScoutService = new XHotspotScoutService(llmService);
const workerRunner = new XWorkerRunner(
  repository,
  llmService,
  writerService,
  reviewAgentService,
  mainAgentService,
  hotspotScoutService,
  publisherService,
  notificationService,
  accountSoulService
);

await repository.ensureReady();
await promptService.bootstrapDefaults();
await hotspotScoutService.ensureReady();

await app.register(cors, {
  origin: parseCorsAllowedOrigins(),
  credentials: true
});

app.setErrorHandler((error, _request, reply) => {
  const statusCode =
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 500;

  reply.status(statusCode).send({
    error: {
      code: statusCode,
      message: error instanceof Error ? error.message : "Unknown X API error."
    }
  });
});

app.get("/health", async () => ({
  ok: true,
  service: "x-api",
  publishMode: getXAppConfig().publishMode
}));

app.get("/accounts", async () => ({
  accounts: await listAccountsWithPromptBindings()
}));

app.post("/accounts", async (request) => {
  const body = createXAccountSchema.parse(request.body ?? {});
  await validateAccountPromptBindings(body);
  const createdAccount = await repository.createAccount({
    name: body.name?.trim() ? body.name.trim() : `@${body.handle.trim()}`,
    handle: body.handle.trim(),
    persona: body.persona.trim(),
    targetAudience: body.targetAudience.trim(),
    styleGuide: body.styleGuide.trim(),
    learningTargets: body.learningTargets,
    manualNotes: body.manualNotes.trim(),
    profileDir: body.profileDir ?? "",
    proxyUrl: body.proxyUrl ?? null,
    status: body.status,
    accessToken: body.accessToken ?? null,
    authStatus: body.authStatus ?? null,
    authStatusReason: body.authStatusReason ?? null,
    authCheckedAt: body.authCheckedAt ?? null,
    mainPromptVersionId: null,
    writerPromptVersionId: null,
    reviewPromptVersionId: body.reviewPromptVersionId ?? null,
    publishPromptVersionId: body.publishPromptVersionId ?? null,
    writerPromptSource: body.writerPromptSource,
    publishStyleRatios: body.publishStyleRatios
  });
  const account = await ensureAccountPromptBindings(createdAccount);
  await accountSoulService.ensureSoulDocument(account);

  return {
    ok: true,
    account
  };
});

app.patch("/accounts/:id", async (request) => {
  const params = request.params as { id: string };
  const body = updateXAccountSchema.parse(request.body ?? {});
  const currentAccount = await getAccountOrThrow(params.id);
  await validateAccountPromptBindings(body, currentAccount);
  const account = await repository.updateAccount(params.id, {
    ...(body.name !== undefined ? { name: body.name.trim() } : {}),
    ...(body.handle !== undefined ? { handle: body.handle.trim() } : {}),
    ...(body.persona !== undefined ? { persona: body.persona.trim() } : {}),
    ...(body.targetAudience !== undefined ? { targetAudience: body.targetAudience.trim() } : {}),
    ...(body.styleGuide !== undefined ? { styleGuide: body.styleGuide.trim() } : {}),
    ...(body.learningTargets !== undefined ? { learningTargets: body.learningTargets } : {}),
    ...(body.manualNotes !== undefined ? { manualNotes: body.manualNotes.trim() } : {}),
    ...(body.profileDir !== undefined ? { profileDir: body.profileDir.trim() } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "proxyUrl") ? { proxyUrl: body.proxyUrl ?? null } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "mainPromptVersionId")
      ? { mainPromptVersionId: body.mainPromptVersionId ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "writerPromptVersionId")
      ? { writerPromptVersionId: body.writerPromptVersionId ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "reviewPromptVersionId")
      ? { reviewPromptVersionId: body.reviewPromptVersionId ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "publishPromptVersionId")
      ? { publishPromptVersionId: body.publishPromptVersionId ?? null }
      : {}),
    ...(body.writerPromptSource !== undefined ? { writerPromptSource: body.writerPromptSource } : {}),
    ...(body.publishStyleRatios !== undefined ? { publishStyleRatios: body.publishStyleRatios } : {})
  });

  if (!account) {
    throw notFoundError("X account does not exist.");
  }

  const ensuredAccount = await ensureAccountPromptBindings(account);

  return {
    ok: true,
    account: ensuredAccount
  };
});

app.get("/accounts/:id/soul", async (request) => {
  const params = request.params as { id: string };
  const account = await getAccountOrThrow(params.id);

  return {
    account,
    soulDocument: await accountSoulService.ensureSoulDocument(account)
  };
});

app.put("/accounts/:id/soul", async (request) => {
  const params = request.params as { id: string };
  const body = saveXAccountSoulSchema.parse(request.body ?? {});
  const account = await getAccountOrThrow(params.id);

  return {
    ok: true,
    soulDocument: await accountSoulService.saveSoulDocument(account, {
      coreIdentity: body.coreIdentity,
      targetReader: body.targetReader,
      voiceTraits: body.voiceTraits,
      worldview: body.worldview,
      proofAnchors: body.proofAnchors,
      signatureMoves: body.signatureMoves,
      productMentionPolicy: body.productMentionPolicy,
      hardBoundaries: body.hardBoundaries,
      tabooLexicon: body.tabooLexicon,
      exemplarLines: body.exemplarLines,
      updateReason: body.updateReason
    })
  };
});

app.get("/accounts/:id/account-prompts/:category", async (request) => {
  const params = request.params as { id: string; category: string };
  const category = parseAccountPromptCategory(params.category);
  const account = await getAccountOrThrow(params.id);

  return {
    account,
    panel: await promptService.getAccountScopedPromptPanel(category, account)
  };
});

app.post("/accounts/:id/account-prompts/:category/drafts", async (request) => {
  const params = request.params as { id: string; category: string };
  const category = parseAccountPromptCategory(params.category);
  const account = await getAccountOrThrow(params.id);
  const body = (request.body ?? {}) as {
    label?: string;
    content?: string;
    notes?: string;
    bind?: boolean;
    sourceVersionId?: number | null;
  };

  if (!body.label?.trim()) {
    throw new Error("Prompt draft label is required.");
  }

  if (!body.content?.trim()) {
    throw new Error("Prompt draft content is required.");
  }

  const promptVersionId = await promptService.createAccountScopedPromptDraft(category, account, {
    label: body.label,
    content: body.content,
    notes: body.notes,
    sourceVersionId: normalizeOptionalPositiveInteger(body.sourceVersionId)
  });

  const shouldBind = body.bind !== false;
  const updatedAccount = shouldBind
    ? await repository.updateAccount(account.id, buildAccountPromptBindingPatch(category, promptVersionId))
    : account;

  if (!updatedAccount) {
    throw new Error(`Failed to bind the new ${category} prompt draft to @${account.handle}.`);
  }

  return {
    ok: true,
    promptVersionId,
    account: shouldBind ? await ensureAccountPromptBindings(updatedAccount) : updatedAccount,
    panel: await promptService.getAccountScopedPromptPanel(
      category,
      shouldBind ? await ensureAccountPromptBindings(updatedAccount) : account
    )
  };
});

app.patch("/accounts/:id/account-prompts/:category/drafts/:versionId", async (request) => {
  const params = request.params as { id: string; category: string; versionId: string };
  const category = parseAccountPromptCategory(params.category);
  const versionId = normalizeRequiredPositiveInteger(params.versionId, "Prompt version id");
  const account = await getAccountOrThrow(params.id);
  const body = (request.body ?? {}) as {
    label?: string;
    content?: string;
    notes?: string;
  };

  if (body.label === undefined && body.content === undefined && body.notes === undefined) {
    throw new Error("At least one draft field must be provided.");
  }

  await promptService.updateAccountScopedPromptDraft(category, versionId, account, body);

  return {
    ok: true,
    panel: await promptService.getAccountScopedPromptPanel(category, account)
  };
});

app.post("/accounts/:id/account-prompts/:category/bind", async (request) => {
  const params = request.params as { id: string; category: string };
  const category = parseAccountPromptCategory(params.category);
  const account = await getAccountOrThrow(params.id);
  const body = (request.body ?? {}) as {
    versionId?: number;
  };
  const versionId = normalizeOptionalPositiveInteger(body.versionId);

  if (!versionId) {
    throw new Error("Prompt version id is required.");
  }

  await promptService.assertAccountScopedPromptVersionOwnership(category, versionId, account);
  const updatedAccount = await repository.updateAccount(account.id, buildAccountPromptBindingPatch(category, versionId));
  if (!updatedAccount) {
    throw new Error(`Failed to bind prompt version #${versionId} to @${account.handle}.`);
  }

  const ensuredAccount = await ensureAccountPromptBindings(updatedAccount);
  return {
    ok: true,
    account: ensuredAccount,
    panel: await promptService.getAccountScopedPromptPanel(category, ensuredAccount)
  };
});

app.get("/tasks", async (request) => {
  const query = (request.query ?? {}) as { accountId?: string };
  const tasks = await repository.listTasks();
  return {
    tasks: query.accountId ? tasks.filter((task) => task.accountId === query.accountId) : tasks
  };
});

app.get("/tasks/:id", async (request) => {
  const params = request.params as { id: string };
  return {
    task: await repository.getTask(params.id)
  };
});

app.post("/tasks", async (request) => {
  const body = createXTaskSchema.parse(request.body ?? {});
  const task = await workerRunner.createTask({
    accountId: body.accountId,
    title: body.title.trim(),
    brief: body.brief.trim(),
    goal: body.goal.trim(),
    preferredMode: body.preferredMode,
    scheduledAt: body.scheduledAt ?? null
  });

  return {
    ok: true,
    task
  };
});

app.post("/tasks/:id/run-now", async (request) => {
  const params = request.params as { id: string };
  return {
    ok: true,
    result: await workerRunner.runTaskNow(params.id)
  };
});

app.post("/worker/tick", async (request) => {
  const query = workerTickSchema.parse(request.body ?? {});
  return {
    summary: await workerRunner.tick(query.limit)
  };
});

// ============ Prompt 管理接口 ============
app.get("/prompts", async () => {
  const prompts = (await promptService.listPrompts()).filter((prompt) => isXApiPromptCategory(prompt.category));
  return { prompts };
});

app.get("/prompts/:id", async (request) => {
  const params = request.params as { id: string };
  const prompt = await promptService.getPrompt(params.id);
  if (!prompt || !isXApiPromptCategory(prompt.category)) {
    throw notFoundError("Prompt not found.");
  }
  return { prompt };
});

app.post("/prompts", async (request) => {
  const body = (request.body ?? {}) as {
    name: string;
    description: string;
    category: "main" | "writing" | "review" | "publish";
    template: string;
    variables?: string[];
    isActive?: boolean;
  };

  if (!isXApiPromptCategory(body.category)) {
    throw notFoundError("Prompt not found.");
  }

  const prompt = await promptService.createPrompt({
    category: body.category,
    label: body.name.trim(),
    content: body.template.trim(),
    notes: body.description.trim(),
    activate: body.isActive ?? true
  });

  return {
    ok: true,
    prompt
  };
});

app.patch("/prompts/:id", async (request) => {
  const params = request.params as { id: string };
  const body = (request.body ?? {}) as {
    name?: string;
    description?: string;
    template?: string;
    isActive?: boolean;
  };

  const currentPrompt = await promptService.getPrompt(params.id);
  if (!currentPrompt || !isXApiPromptCategory(currentPrompt.category)) {
    throw notFoundError("Prompt not found.");
  }

  const prompt = await promptService.updatePrompt(params.id, {
    label: body.name?.trim() || currentPrompt.name,
    content: body.template?.trim() || currentPrompt.template,
    notes: body.description?.trim() || currentPrompt.description,
    activate: body.isActive ?? true
  });

  if (!prompt) {
    throw notFoundError("Prompt not found.");
  }

  return {
    ok: true,
    prompt
  };
});

app.post("/prompts/:id/test", async (request) => {
  const params = request.params as { id: string };
  const body = (request.body ?? {}) as {
    input: Record<string, string>;
  };

  const prompt = await promptService.getPrompt(params.id);
  if (!prompt || !isXApiPromptCategory(prompt.category)) {
    throw notFoundError("Prompt not found.");
  }

  // 使用 LLM 测试 Prompt
  const result = await promptService.testPrompt(params.id, body.input);

  // 更新最后测试时间
  await repository.updatePromptTestedAt(params.id);

  return {
    ok: true,
    result
  };
});

app.post("/prompts/versions/:versionId/activate", async (request) => {
  const params = request.params as { versionId: string };
  const versionId = normalizeRequiredPositiveInteger(params.versionId, "Prompt version id");
  const category = await promptService.getPromptCategoryForVersion(versionId);
  if (!category || !isXApiPromptCategory(category)) {
    throw notFoundError("Prompt version not found.");
  }

  return {
    ok: true,
    prompt: await promptService.activatePromptVersion(versionId)
  };
});

// ============ 账号登录验证接口 ============
app.post("/accounts/:id/login", async (request) => {
  const params = request.params as { id: string };
  const body = (request.body ?? {}) as {
    profileDir?: string;
    proxyUrl?: string | null;
  };

  const account = await getAccountOrThrow(params.id);

  // 使用 XBrowserRuntime 验证登录状态
  const loginResult = await browserRuntime.verifyLogin(account, {
    profileDir: body.profileDir,
    proxyUrl: body.proxyUrl ?? account.proxyUrl
  });

  if (!loginResult.success) {
    await repository.updateAccount(params.id, {
      authStatus: "login_required",
      authStatusReason: loginResult.errorMessage ?? "Login verification failed.",
      authCheckedAt: new Date().toISOString()
    });

    return {
      ok: false,
      error: {
        code: "login_failed",
        message: loginResult.errorMessage
      }
    };
  }

  // 更新账号授权状态
  const updatedAccount = await repository.updateAccount(params.id, {
    authStatus: "ready",
    authStatusReason: null,
    authCheckedAt: new Date().toISOString()
  });

  return {
    ok: true,
    account: updatedAccount ? await ensureAccountPromptBindings(updatedAccount) : updatedAccount,
    sessionToken: loginResult.sessionToken
  };
});

// ============ 任务审核接口 ============
app.patch("/tasks/:id/review", async (request) => {
  const params = request.params as { id: string };
  const body = (request.body ?? {}) as {
    decision: "approve" | "revise" | "block";
    reason?: string;
    revisionInstructions?: string[];
  };

  const task = await repository.getTask(params.id);
  if (!task) {
    throw notFoundError("Task does not exist.");
  }

  if (!task.draftPack) {
    throw new Error("Task has no draft to review.");
  }

  const account = await repository.getAccount(task.accountId);
  if (!account) {
    throw notFoundError("X account does not exist.");
  }
  const ensuredAccount = await ensureAccountPromptBindings(account);

  if (body.decision === "approve") {
    let taskForReview = task;
    if (!taskForReview.soulMarkdownSnapshot) {
      const soulDocument = await accountSoulService.ensureSoulDocument(ensuredAccount);
      const taskWithSoulSnapshot = await repository.updateTask(task.id, {
        soulVersion: soulDocument.version,
        soulMarkdownSnapshot: soulDocument.markdown
      });
      if (!taskWithSoulSnapshot) {
        throw new Error("Failed to persist Soul snapshot for manual review.");
      }

      taskForReview = taskWithSoulSnapshot;
    }

    const accountSoulMarkdown = taskForReview.soulMarkdownSnapshot ?? null;
    const recentPublishedTasks = await repository.listRecentPublishedTasks(taskForReview.accountId, 5);
    const promptSnapshotContext = taskForReview.promptVersionSnapshotJson
      ? {
          promptSnapshotJson: taskForReview.promptVersionSnapshotJson,
          promptSnapshot: safeParseJson(taskForReview.promptVersionSnapshotJson, {})
        }
      : {
          promptSnapshot: await llmService.getPromptSnapshotForAccount(ensuredAccount),
          promptSnapshotJson: ""
        };

    if (!taskForReview.promptVersionSnapshotJson) {
      promptSnapshotContext.promptSnapshotJson = JSON.stringify(promptSnapshotContext.promptSnapshot);
      taskForReview =
        (await repository.updateTask(taskForReview.id, {
          promptVersionSnapshotJson: promptSnapshotContext.promptSnapshotJson
        })) ?? taskForReview;
    }

    const reviewAgentResult = await reviewAgentService.reviewDraft({
      account: ensuredAccount,
      task: taskForReview,
      accountSoulMarkdown,
      draftPack: taskForReview.draftPack!,
      recentPublishedTitles: recentPublishedTasks.map((item) => item.title),
      promptSnapshot: promptSnapshotContext.promptSnapshot
    });

    const taskWithReviewAgentResult = await repository.updateTask(params.id, {
      reviewAgentResult
    });
    if (!taskWithReviewAgentResult) {
      throw new Error("Failed to persist ReviewAgent result.");
    }

    const reviewBundle = await mainAgentService.reviewTask({
      account: ensuredAccount,
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
      promptSnapshot: promptSnapshotContext.promptSnapshot
    });

    if (reviewBundle.reviewResult.decision !== "approve") {
      const fallbackStatus =
        reviewBundle.reviewResult.decision === "revise"
          ? "revision_required"
          : reviewBundle.reviewResult.decision === "block"
              ? "blocked"
              : "under_review";

      const rejectedTask = await repository.updateTask(params.id, {
        status: fallbackStatus,
        currentStage: fallbackStatus,
        reviewAgentResult,
        reviewResult: reviewBundle.reviewResult,
        publishPlan: reviewBundle.publishPlan
      });

      return {
        ok: false,
        error: {
          code: "main_agent_not_approved",
          message: `MainAgent did not approve this draft: ${reviewBundle.reviewResult.reason}`
        },
        task: rejectedTask
      };
    }

    const approvedTask = await repository.updateTask(params.id, {
      status: "approved_to_publish",
      currentStage: "approved_to_publish",
      reviewAgentResult,
      reviewResult: reviewBundle.reviewResult,
      publishPlan: reviewBundle.publishPlan,
      scheduledAt:
        reviewBundle.publishPlan.cadence === "defer"
          ? taskForReview.scheduledAt ?? new Date(Date.now() + Math.max(reviewBundle.publishPlan.deferMinutes, 10) * 60_000).toISOString()
          : taskForReview.scheduledAt
    });

    return {
      ok: true,
      task: approvedTask
    };
  }

  const updatedTask = await repository.updateTask(params.id, {
    status: body.decision === "revise" ? "revision_required" : "blocked",
    currentStage: body.decision === "revise" ? "revision_required" : "blocked",
    reviewResult: {
      decision: body.decision,
      reason: body.reason || "",
      revisionInstructions: body.revisionInstructions || [],
      qualityNotes: []
    }
  });

  return {
    ok: true,
    task: updatedTask
  };
});

// ============ 发布控制接口 ============
app.post("/tasks/:id/run", async (request) => {
  const params = request.params as { id: string };
  const body = (request.body ?? {}) as {
    action: "run_now" | "reschedule" | "retry";
    scheduledAt?: string;
  };

  const task = await repository.getTask(params.id);
  if (!task) {
    throw notFoundError("Task does not exist.");
  }

  if (body.action === "run_now") {
    // 立即执行任务
    await workerRunner.runTaskNow(params.id);
  } else if (body.action === "reschedule" && body.scheduledAt) {
    const nextStatus =
      task.status === "approved_to_publish" || task.status === "publishing"
        ? "approved_to_publish"
        : task.status === "publish_failed" && task.reviewResult?.decision === "approve"
          ? "approved_to_publish"
          : "planned";

    await repository.updateTask(params.id, {
      scheduledAt: body.scheduledAt,
      status: nextStatus,
      currentStage: nextStatus
    });
  } else if (body.action === "retry") {
    // 重试失败的任务
    if (!task.failureStage && task.status !== "publish_failed" && task.status !== "blocked") {
      throw new Error("Only failed tasks can be retried.");
    }

    const nextStatus =
      task.reviewResult?.decision === "approve" || task.status === "publish_failed"
        ? "approved_to_publish"
        : "planned";

    await repository.updateTask(params.id, {
      status: nextStatus,
      currentStage: nextStatus,
      failureStage: null,
      failureType: null,
      failureReason: null,
      finishedAt: null
    });
    await workerRunner.runTaskNow(params.id);
  }

  return {
    ok: true,
    task: await repository.getTask(params.id)
  };
});

await app.listen({
  host: process.env.X_API_HOST ?? "127.0.0.1",
  port: getXAppConfig().apiPort
});

function parseCorsAllowedOrigins() {
  const origins = process.env.CORS_ALLOWED_ORIGINS;
  if (!origins) {
    // 默认只允许同源请求（通过代理访问时）
    return false;
  }
  
  // 支持多个域名，逗号分隔
  const originList = origins.split(",").map((o) => o.trim()).filter(Boolean);
  if (originList.length === 0) {
    return false;
  }
  
  return originList;
}

async function listAccountsWithPromptBindings() {
  const accounts = await repository.listAccounts();
  return Promise.all(accounts.map((account) => ensureAccountPromptBindings(account)));
}

async function getAccountOrThrow(accountId: string) {
  const account = await repository.getAccount(accountId);
  if (!account) {
    throw notFoundError("X account does not exist.");
  }

  return ensureAccountPromptBindings(account);
}

async function ensureAccountPromptBindings(account: XAccount) {
  const bindingResult = await promptService.ensureAccountScopedPromptBindings(account);
  if (!bindingResult.changed) {
    return account;
  }

  const updatedAccount = await repository.updateAccount(account.id, {
    mainPromptVersionId: bindingResult.mainPromptVersionId,
    writerPromptVersionId: bindingResult.writerPromptVersionId
  });
  if (!updatedAccount) {
    throw new Error(`Failed to persist account-scoped prompt bindings for @${account.handle}.`);
  }

  return updatedAccount;
}

function parseAccountPromptCategory(value: string) {
  if (value === "main" || value === "writing") {
    return value;
  }

  throw new Error(`Unsupported account prompt category: ${value}.`);
}

function buildAccountPromptBindingPatch(category: "main" | "writing", versionId: number) {
  return category === "main"
    ? { mainPromptVersionId: versionId }
    : { writerPromptVersionId: versionId };
}

function normalizeOptionalPositiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeRequiredPositiveInteger(value: unknown, label: string) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

async function validateAccountPromptBindings(body: {
  mainPromptVersionId?: number | null;
  writerPromptVersionId?: number | null;
  reviewPromptVersionId?: number | null;
  publishPromptVersionId?: number | null;
  writerPromptSource?: "main_agent" | "database";
  publishStyleRatios?: {
    casualNote: number;
    smallInsight: number;
    pitfallLog: number;
    toolMention: number;
    industryTalk: number;
    interactiveQa: number;
    quoteRepost: number;
  };
}, account?: Pick<XAccount, "id" | "handle"> | null) {
  await assertAccountScopedPromptBinding("main", body.mainPromptVersionId, account);
  await assertAccountScopedPromptBinding("writing", body.writerPromptVersionId, account);
  await assertPromptVersionMatches(body.reviewPromptVersionId, "review");
  await assertPromptVersionMatches(body.publishPromptVersionId, "publish");
}

async function assertAccountScopedPromptBinding(
  category: "main" | "writing",
  versionId: number | null | undefined,
  account?: Pick<XAccount, "id" | "handle"> | null
) {
  if (versionId === undefined) {
    return;
  }

  if (account == null) {
    throw new Error(
      `${category} prompt is account-scoped and is created automatically during account creation. Do not set it manually here.`
    );
  }

  if (versionId == null) {
    throw new Error(`${category} prompt is account-scoped and cannot be cleared.`);
  }

  await promptService.assertAccountScopedPromptVersionOwnership(category, versionId, account);
}

async function assertPromptVersionMatches(
  versionId: number | null | undefined,
  category: "main" | "writing" | "review" | "publish"
) {
  if (versionId == null) {
    return;
  }

  const prompt = await promptService.getPrompt(category);
  if (!prompt?.versions.some((version) => version.id === versionId)) {
    throw new Error(`Prompt version #${versionId} does not belong to ${category}.`);
  }
}

function notFoundError(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}

function isXApiPromptCategory(category: string): category is "main" | "writing" | "review" | "publish" {
  return category === "main" || category === "writing" || category === "review" || category === "publish";
}
