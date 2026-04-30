import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  XHotspotScoutService,
  XLlmService,
  XPromptService,
  XWorkspaceRepository,
  createXHotspotWatchlistItemSchema,
  createXHotspotWatchlistSchema,
  createXTaskFromHotspotSchema,
  scanXHotspotsSchema,
  type XHotspotWatchlistItemType,
  updateXHotspotSchema,
  updateXHotspotWatchlistItemSchema,
  updateXHotspotWatchlistSchema
} from "@zhihu-mvp/x-core";

const app = Fastify({ logger: true });
const repository = new XWorkspaceRepository();
const llmService = new XLlmService();
const promptService = new XPromptService(llmService);
const hotspotScoutService = new XHotspotScoutService(llmService);
const HOTSPOT_PROMPT_CATEGORY = "hotspot_scout" as const;

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
      message: error instanceof Error ? error.message : "Hotspot API error."
    }
  });
});

app.get("/health", async () => ({
  ok: true,
  service: "hotspot-api",
  modules: ["x-hotspots"]
}));

app.get("/accounts", async () => ({
  accounts: (await repository.listAccounts()).map((account) => ({
    id: account.id,
    name: account.name,
    handle: account.handle
  }))
}));

app.get("/prompts", async () => {
  const prompt = await promptService.getPrompt(HOTSPOT_PROMPT_CATEGORY);
  return {
    prompts: prompt ? [prompt] : []
  };
});

app.get("/prompts/:id", async (request) => {
  const params = request.params as { id: string };
  const prompt = await promptService.getPrompt(params.id);
  if (!prompt || prompt.category !== HOTSPOT_PROMPT_CATEGORY) {
    throw createHttpError(404, "Prompt not found.");
  }

  return { prompt };
});

app.post("/prompts", async (request) => {
  const body = (request.body ?? {}) as {
    name: string;
    description: string;
    category?: "hotspot_scout";
    template: string;
    variables?: string[];
    isActive?: boolean;
  };

  if (body.category && body.category !== HOTSPOT_PROMPT_CATEGORY) {
    throw createHttpError(404, "Prompt not found.");
  }

  return {
    ok: true,
    prompt: await promptService.createPrompt({
      category: HOTSPOT_PROMPT_CATEGORY,
      label: body.name.trim(),
      content: body.template.trim(),
      notes: body.description.trim(),
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
  if (!currentPrompt || currentPrompt.category !== HOTSPOT_PROMPT_CATEGORY) {
    throw createHttpError(404, "Prompt not found.");
  }

  return {
    ok: true,
    prompt: await promptService.updatePrompt(params.id, {
      label: body.name?.trim() || currentPrompt.name,
      content: body.template?.trim() || currentPrompt.template,
      notes: body.description?.trim() || currentPrompt.description,
      activate: body.isActive ?? true
    })
  };
});

app.post("/prompts/:id/test", async (request) => {
  const params = request.params as { id: string };
  const body = (request.body ?? {}) as {
    input: Record<string, unknown>;
  };

  const prompt = await promptService.getPrompt(params.id);
  if (!prompt || prompt.category !== HOTSPOT_PROMPT_CATEGORY) {
    throw createHttpError(404, "Prompt not found.");
  }

  return {
    ok: true,
    result: await promptService.testPrompt(params.id, body.input)
  };
});

app.post("/prompts/versions/:versionId/activate", async (request) => {
  const params = request.params as { versionId: string };
  const versionId = parsePositiveInteger(params.versionId);
  if (!versionId) {
    throw createHttpError(400, "Invalid prompt version id.");
  }

  const category = await promptService.getPromptCategoryForVersion(versionId);
  if (category !== HOTSPOT_PROMPT_CATEGORY) {
    throw createHttpError(404, "Prompt version not found.");
  }

  return {
    ok: true,
    prompt: await promptService.activatePromptVersion(versionId)
  };
});

app.get("/hotspots", async (request) => {
  const query = (request.query ?? {}) as {
    priority?: string;
    status?: string;
    sourceType?: string;
    includeExpired?: string;
  };

  return {
    hotspots: await hotspotScoutService.listHotspots({
      priority: normalizeOptionalHotspotPriority(query.priority),
      status: normalizeOptionalHotspotStatus(query.status),
      sourceType: normalizeOptionalHotspotSourceType(query.sourceType),
      includeExpired: query.includeExpired === "true"
    })
  };
});

app.get("/hotspots/:id", async (request) => {
  const params = request.params as { id: string };
  const hotspotId = parsePositiveInteger(params.id);
  if (!hotspotId) {
    throw createHttpError(400, "Invalid hotspot id.");
  }

  const hotspot = await hotspotScoutService.getHotspotDetail(hotspotId);
  if (!hotspot) {
    throw createHttpError(404, "Hotspot does not exist.");
  }

  return { hotspot };
});

app.post("/hotspots/scan", async (request) => {
  const body = scanXHotspotsSchema.parse(request.body ?? {});
  return {
    ok: true,
    summary: await hotspotScoutService.scanNow({
      sourceTypes: body.sourceTypes,
      force: body.force,
      includeResearch: body.includeResearch
    })
  };
});

app.post("/hotspots/:id/research", async (request) => {
  const params = request.params as { id: string };
  const hotspotId = parsePositiveInteger(params.id);
  if (!hotspotId) {
    throw createHttpError(400, "Invalid hotspot id.");
  }

  return {
    ok: true,
    hotspot: await hotspotScoutService.runResearchForHotspot(hotspotId)
  };
});

app.patch("/hotspots/:id", async (request) => {
  const params = request.params as { id: string };
  const hotspotId = parsePositiveInteger(params.id);
  if (!hotspotId) {
    throw createHttpError(400, "Invalid hotspot id.");
  }

  const body = updateXHotspotSchema.parse(request.body ?? {});
  const hotspot = await hotspotScoutService.updateHotspotStatus(hotspotId, body.status!);
  if (!hotspot) {
    throw createHttpError(404, "Hotspot does not exist.");
  }

  return {
    ok: true,
    hotspot
  };
});

app.post("/hotspots/:id/create-task", async (request) => {
  const params = request.params as { id: string };
  const hotspotId = parsePositiveInteger(params.id);
  if (!hotspotId) {
    throw createHttpError(400, "Invalid hotspot id.");
  }

  const hotspot = await hotspotScoutService.getHotspotDetail(hotspotId);
  if (!hotspot) {
    throw createHttpError(404, "Hotspot does not exist.");
  }

  const body = createXTaskFromHotspotSchema.parse(request.body ?? {});
  const account = await repository.getAccount(body.accountId);
  if (!account) {
    throw createHttpError(404, "X account does not exist.");
  }

  const draft = hotspotScoutService.buildTaskDraft(hotspot);
  const task = await repository.createTask({
    accountId: account.id,
    title: body.title?.trim() || draft.title,
    brief: body.brief?.trim() || draft.brief,
    goal: body.goal.trim() || draft.goal,
    preferredMode: body.preferredMode,
    scheduledAt: null
  });

  await hotspotScoutService.linkTaskToHotspot({
    hotspotId: hotspot.id,
    taskId: task.id,
    accountId: account.id,
    accountHandle: account.handle,
    snapshotJson: await hotspotScoutService.buildHotspotSnapshot(hotspot.id)
  });

  return {
    ok: true,
    task,
    hotspot: await hotspotScoutService.getHotspotDetail(hotspot.id)
  };
});

app.get("/watchlists", async () => ({
  watchlists: await hotspotScoutService.listWatchlists()
}));

app.post("/watchlists", async (request) => {
  const body = createXHotspotWatchlistSchema.parse(request.body ?? {});
  return {
    ok: true,
    watchlist: await hotspotScoutService.createWatchlist(body)
  };
});

app.patch("/watchlists/:id", async (request) => {
  const params = request.params as { id: string };
  const watchlistId = parsePositiveInteger(params.id);
  if (!watchlistId) {
    throw createHttpError(400, "Invalid watchlist id.");
  }

  const body = updateXHotspotWatchlistSchema.parse(request.body ?? {});
  return {
    ok: true,
    watchlist: await hotspotScoutService.updateWatchlist(watchlistId, body)
  };
});

app.delete("/watchlists/:id", async (request) => {
  const params = request.params as { id: string };
  const watchlistId = parsePositiveInteger(params.id);
  if (!watchlistId) {
    throw createHttpError(400, "Invalid watchlist id.");
  }

  await hotspotScoutService.deleteWatchlist(watchlistId);
  return { ok: true };
});

app.post("/watchlists/:id/items", async (request) => {
  const params = request.params as { id: string };
  const watchlistId = parsePositiveInteger(params.id);
  if (!watchlistId) {
    throw createHttpError(400, "Invalid watchlist id.");
  }

  const body = createXHotspotWatchlistItemSchema.parse(request.body ?? {});
  const normalizedValue = normalizeWatchlistItemValue(body.type, body.value);

  return {
    ok: true,
    watchlist: await hotspotScoutService.createWatchlistItem({
      watchlistId,
      type: body.type,
      value: normalizedValue,
      label: body.label?.trim() || getDefaultWatchlistItemLabel(body.type, normalizedValue),
      enabled: body.enabled,
      priority: body.priority,
      notes: body.notes
    })
  };
});

app.patch("/watchlists/:watchlistId/items/:itemId", async (request) => {
  const params = request.params as { watchlistId: string; itemId: string };
  const watchlistId = parsePositiveInteger(params.watchlistId);
  const itemId = parsePositiveInteger(params.itemId);
  if (!watchlistId || !itemId) {
    throw createHttpError(400, "Invalid watchlist item path.");
  }

  const body = updateXHotspotWatchlistItemSchema.parse(request.body ?? {});
  return {
    ok: true,
    item: await hotspotScoutService.updateWatchlistItem(itemId, body)
  };
});

app.delete("/watchlists/:watchlistId/items/:itemId", async (request) => {
  const params = request.params as { watchlistId: string; itemId: string };
  const watchlistId = parsePositiveInteger(params.watchlistId);
  const itemId = parsePositiveInteger(params.itemId);
  if (!watchlistId || !itemId) {
    throw createHttpError(400, "Invalid watchlist item path.");
  }

  await hotspotScoutService.deleteWatchlistItem(itemId);
  return { ok: true };
});

const address = await app.listen({
  host: process.env.HOTSPOT_API_HOST ?? "127.0.0.1",
  port: Number(process.env.HOTSPOT_API_PORT ?? 8789)
});

app.log.info({ address }, "hotspot-api listening");

function createHttpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
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

function parsePositiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalHotspotPriority(value: string | undefined) {
  return value === "P0" || value === "P1" || value === "P2" || value === "DROP" ? value : null;
}

function normalizeOptionalHotspotStatus(value: string | undefined) {
  return value === "active" || value === "ignored" || value === "tasked" || value === "expired" ? value : null;
}

function normalizeOptionalHotspotSourceType(value: string | undefined) {
  return value === "news" || value === "market" || value === "watchlist" ? value : null;
}

function normalizeWatchlistItemValue(type: XHotspotWatchlistItemType, value: string) {
  if (type !== "x_account") {
    return value.trim();
  }

  const handle = extractXHandle(value);
  if (!handle) {
    throw createHttpError(400, "x_account value must be a valid X/Twitter handle or profile URL.");
  }

  return `https://x.com/${handle}`;
}

function getDefaultWatchlistItemLabel(type: XHotspotWatchlistItemType, value: string) {
  if (type !== "x_account") {
    return value.trim();
  }

  const handle = extractXHandle(value);
  return handle ? `@${handle}` : value.trim();
}

function extractXHandle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const domainMatch = withoutProtocol.match(/^(?:www\.)?(?:x\.com|twitter\.com)\/([^/?#]+)/i);
  const candidate = (domainMatch?.[1] ?? withoutProtocol)
    .replace(/^@+/, "")
    .split(/[/?#]/)[0]
    ?.trim();

  return candidate && /^[A-Za-z0-9_]{1,15}$/.test(candidate) ? candidate : "";
}
