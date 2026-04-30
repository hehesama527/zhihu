import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  XAccountSoulService,
  type XAccount
} from "@zhihu-mvp/x-core";
import {
  createXTraditionalAccountSchema,
  xTraditionalNoteAgentApplySchema,
  xTraditionalNoteAgentGenerateSchema,
  createXTraditionalTaskSchema,
  getXTraditionalAppConfig,
  saveXAccountSoulSchema,
  updateXTraditionalAccountSchema,
  workerTickSchema,
  type XTraditionalNoteAgentApplyInput,
  type XTraditionalPromptCategory,
  XTraditionalLlmService,
  XTraditionalNoteAgentService,
  XTraditionalPromptService,
  XTraditionalWorkerRunner,
  XTraditionalWorkspaceRepository
} from "@zhihu-mvp/x-traditional-core";

const app = Fastify({ logger: true });
const config = getXTraditionalAppConfig();
const repository = new XTraditionalWorkspaceRepository();
const llmService = new XTraditionalLlmService();
const promptService = new XTraditionalPromptService(llmService);
const noteAgentService = new XTraditionalNoteAgentService(llmService);
const accountSoulService = new XAccountSoulService(repository);
const workerRunner = XTraditionalWorkerRunner.createDefault();

await repository.ensureReady();
await promptService.bootstrapDefaults();

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
      message: error instanceof Error ? error.message : "X traditional API error."
    }
  });
});

app.get("/health", async () => ({
  ok: true,
  service: "x-traditional-api",
  module: "x-traditional",
  publishMode: config.publishMode,
  dataDir: config.dataDir
}));

app.get("/accounts", async () => ({
  accounts: await repository.listAccounts()
}));

app.post("/accounts", async (request) => {
  const body = createXTraditionalAccountSchema.parse(request.body ?? {});
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
    mainPromptVersionId: body.mainPromptVersionId ?? null,
    writerPromptVersionId: body.writerPromptVersionId ?? null,
    reviewPromptVersionId: body.reviewPromptVersionId ?? null,
    publishPromptVersionId: body.publishPromptVersionId ?? null,
    writerPromptSource: "database",
    publishStyleRatios: body.publishStyleRatios
  });

  await accountSoulService.ensureSoulDocument(createdAccount);

  return {
    ok: true,
    account: createdAccount
  };
});

app.patch("/accounts/:id", async (request) => {
  const params = request.params as { id: string };
  const body = updateXTraditionalAccountSchema.parse(request.body ?? {});
  await getAccountOrThrow(params.id);

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
    ...(Object.prototype.hasOwnProperty.call(body, "accessToken") ? { accessToken: body.accessToken ?? null } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "authStatus") ? { authStatus: body.authStatus ?? null } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "authStatusReason")
      ? { authStatusReason: body.authStatusReason ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "authCheckedAt") ? { authCheckedAt: body.authCheckedAt ?? null } : {}),
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
    ...(body.publishStyleRatios !== undefined ? { publishStyleRatios: body.publishStyleRatios } : {}),
    writerPromptSource: "database"
  });

  if (!account) {
    throw notFoundError("X traditional account does not exist.");
  }

  return {
    ok: true,
    account
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

app.post("/accounts/:id/note-agent/generate", async (request) => {
  const params = request.params as { id: string };
  const body = xTraditionalNoteAgentGenerateSchema.parse(request.body ?? {});
  const account = await getAccountOrThrow(params.id);

  return {
    ok: true,
    draft: await noteAgentService.generateDraft(account, body)
  };
});

app.post("/accounts/:id/note-agent/apply", async (request) => {
  const params = request.params as { id: string };
  const body = xTraditionalNoteAgentApplySchema.parse(request.body ?? {}) as XTraditionalNoteAgentApplyInput;
  const account = await getAccountOrThrow(params.id);

  return {
    ok: true,
    result: await noteAgentService.applyDraft(account, body)
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
  const body = createXTraditionalTaskSchema.parse(request.body ?? {});
  const task = await workerRunner.createTask({
    accountId: body.accountId,
    title: body.title,
    brief: body.brief,
    goal: body.goal,
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
  const body = workerTickSchema.parse(request.body ?? {});

  return {
    summary: await workerRunner.tick(body.limit)
  };
});

app.get("/prompts", async () => ({
  prompts: await promptService.listPrompts()
}));

app.get("/prompts/:id", async (request) => {
  const params = request.params as { id: string };
  const prompt = await promptService.getPrompt(params.id);
  if (!prompt) {
    throw notFoundError("X traditional prompt not found.");
  }

  return {
    prompt
  };
});

app.post("/prompts", async (request) => {
  const body = (request.body ?? {}) as {
    name?: string;
    description?: string;
    category?: string;
    template?: string;
    isActive?: boolean;
  };
  const category = parseTraditionalPromptCategory(body.category);
  const label = normalizeRequiredString(body.name, "Prompt name");
  const content = normalizeRequiredString(body.template, "Prompt template");
  const notes = body.description?.trim() ?? "";

  return {
    ok: true,
    prompt: await promptService.createPrompt({
      category,
      label,
      content,
      notes,
      activate: body.isActive ?? true
    })
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
  if (!currentPrompt) {
    throw notFoundError("X traditional prompt not found.");
  }

  const prompt = await promptService.updatePrompt(params.id, {
    label: body.name?.trim() || currentPrompt.name,
    content: body.template?.trim() || currentPrompt.template,
    notes: body.description?.trim() || currentPrompt.description,
    activate: body.isActive ?? true
  });

  if (!prompt) {
    throw notFoundError("X traditional prompt not found.");
  }

  return {
    ok: true,
    prompt
  };
});

app.post("/prompts/:id/test", async (request) => {
  const params = request.params as { id: string };
  const body = (request.body ?? {}) as {
    input?: Record<string, unknown>;
  };
  const prompt = await promptService.getPrompt(params.id);
  if (!prompt) {
    throw notFoundError("X traditional prompt not found.");
  }

  return {
    ok: true,
    result: await promptService.testPrompt(params.id, body.input ?? {})
  };
});

app.post("/prompts/versions/:versionId/activate", async (request) => {
  const params = request.params as { versionId: string };
  const versionId = normalizeRequiredPositiveInteger(params.versionId, "Prompt version id");

  return {
    ok: true,
    prompt: await promptService.activatePromptVersion(versionId)
  };
});

app.post("/tasks/:id/run", async (request) => {
  const params = request.params as { id: string };
  const body = (request.body ?? {}) as {
    action?: "run_now" | "reschedule" | "retry";
    scheduledAt?: string;
  };
  const task = await repository.getTask(params.id);
  if (!task) {
    throw notFoundError("X traditional task does not exist.");
  }

  if (body.action === "run_now") {
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
    if (!task.failureStage && task.status !== "publish_failed" && task.status !== "blocked") {
      throw new Error("Only failed traditional tasks can be retried.");
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
  } else {
    throw new Error("Unsupported task action.");
  }

  return {
    ok: true,
    task: await repository.getTask(params.id)
  };
});

const address = await app.listen({
  host: process.env.X_TRADITIONAL_API_HOST ?? "127.0.0.1",
  port: config.apiPort
});

app.log.info({ address }, "x-traditional-api listening");

async function getAccountOrThrow(accountId: string): Promise<XAccount> {
  const account = await repository.getAccount(accountId);
  if (!account) {
    throw notFoundError("X traditional account does not exist.");
  }

  return {
    ...account,
    writerPromptSource: "database"
  };
}

function parseCorsAllowedOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw || raw === "false") {
    return true;
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTraditionalPromptCategory(value: unknown): XTraditionalPromptCategory {
  if (value === "main" || value === "writing" || value === "review" || value === "publish" || value === "note") {
    return value;
  }

  throw new Error("Unsupported X traditional prompt category.");
}

function normalizeRequiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function normalizeRequiredPositiveInteger(value: unknown, label: string) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function notFoundError(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}



