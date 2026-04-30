import crypto from "node:crypto";
import fs from "node:fs/promises";
import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  ImageAssetAnalysisService,
  ImageAssetImportService,
  ImageAssetRepository,
  ImageAssetService,
  JobRepository,
  applySchemaMigrations,
  getAppConfig,
  getMysqlPool
} from "@zhihu-mvp/core";
import {
  XWorkspaceRepository
} from "@zhihu-mvp/x-core";
// Source-mode import avoids relying on a stale core dist during standalone service startup.
import { getModelCenterView, updateModelCenterView } from "../../../packages/core/src/config/model-center-view.js";
import {
  bindJobImageSchema,
  createImageAssetUsageRecordSchema,
  createImageImportJobSchema,
  suggestImageAssetsSchema,
  updateImageAssetSchema,
  updateModelCenterSchema
} from "@zhihu-mvp/shared";

const app = Fastify({ logger: true });
const pool = getMysqlPool();
await applySchemaMigrations(pool);

const imageAssetRepository = new ImageAssetRepository(pool);
const jobRepository = new JobRepository(pool);
const xWorkspaceRepository = new XWorkspaceRepository();
const imageAssetAnalysisService = new ImageAssetAnalysisService(imageAssetRepository);
const imageAssetImportService = new ImageAssetImportService(imageAssetRepository, imageAssetAnalysisService);
const imageAssetService = new ImageAssetService(imageAssetRepository, imageAssetAnalysisService, jobRepository);

await imageAssetImportService.ensureReady();
await xWorkspaceRepository.ensureReady();

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
      message: error instanceof Error ? error.message : "Control API error."
    }
  });
});

app.get("/health", async () => ({
  ok: true,
  service: "control-api",
  modules: ["model-center", "image-assets"]
}));

app.get("/model-center", async () => ({
  modelCenter: getModelCenterView()
}));

app.put("/model-center", async (request) => {
  const body = updateModelCenterSchema.parse(request.body ?? {});

  return {
    ok: true,
    modelCenter: updateModelCenterView(body)
  };
});

app.get("/image-assets", async (request) => ({
  items: await imageAssetService.listAssets(parseImageAssetListQuery(request.query))
}));

app.get("/image-assets/import-jobs", async () => ({
  jobs: await imageAssetService.listImportJobs()
}));

app.post("/image-assets/import-jobs", async (request) => {
  const body = createImageImportJobSchema.parse(request.body ?? {});
  return {
    ok: true,
    job: await imageAssetImportService.createDirectoryImportJob(body.sourcePath)
  };
});

app.get("/image-assets/import-jobs/:id", async (request) => {
  const params = request.params as { id: string };
  return {
    job: await imageAssetService.getImportJob(params.id)
  };
});

app.post("/image-assets/suggest", async (request) => {
  const body = suggestImageAssetsSchema.parse(request.body ?? {});
  const items = await imageAssetService.suggestAssets(body);
  return {
    items,
    assets: items
  };
});

app.get("/image-assets/usage-records", async (request) => ({
  records: await imageAssetService.listUsageRecords(parseImageUsageRecordFilter(request.query))
}));

app.post("/image-assets/:id/usage-records", async (request) => {
  const params = request.params as { id: string };
  const body = createImageAssetUsageRecordSchema.parse({
    ...(request.body as Record<string, unknown>),
    assetId: params.id
  });

  return {
    ok: true,
    record: await imageAssetRepository.createUsageRecord({
      id: crypto.randomUUID(),
      assetId: body.assetId,
      platform: body.platform,
      accountId: body.accountId ?? null,
      taskId: body.taskId ?? null,
      contentId: body.contentId ?? null,
      usageType: body.usageType,
      selectedBy: body.selectedBy,
      note: body.note ?? null
    })
  };
});

app.post("/image-assets/:id/analyze", async (request) => {
  const params = request.params as { id: string };
  return {
    ok: true,
    asset: await imageAssetService.reanalyzeAsset(params.id)
  };
});

app.post("/bindings/zhihu-jobs/:id/image", async (request) => {
  const params = request.params as { id: string };
  const jobId = parsePositiveInteger(params.id);
  if (!jobId) {
    throw createHttpError(400, "Invalid Zhihu job id.");
  }

  const job = await jobRepository.getJobById(jobId);
  if (!job) {
    throw createHttpError(404, "Zhihu job does not exist.");
  }

  const body = bindJobImageSchema.parse(request.body ?? {});
  const result = await imageAssetService.bindImageToJob(jobId, body, {
    accountId: job.accountId
  });

  return {
    ok: true,
    job: await jobRepository.getJobById(jobId),
    asset: result.asset,
    usageRecord: result.usageRecord
  };
});

app.post("/bindings/x-tasks/:id/image", async (request) => {
  const params = request.params as { id: string };
  const task = await xWorkspaceRepository.getTask(params.id);
  if (!task) {
    throw createHttpError(404, "X task does not exist.");
  }

  const body = bindJobImageSchema.parse(request.body ?? {});
  if (!body.assetId) {
    return {
      ok: true,
      task: await xWorkspaceRepository.updateTask(task.id, {
        imageAssetId: null
      }),
      asset: null,
      usageRecord: null
    };
  }

  const account = await xWorkspaceRepository.getAccount(task.accountId);
  const result = await imageAssetService.bindImageToExternalTask({
    platform: "x",
    taskId: task.id,
    accountId: account?.id ?? null,
    assetId: body.assetId,
    usageType: body.usageType,
    note: body.note ?? null
  });

  return {
    ok: true,
    task: await xWorkspaceRepository.updateTask(task.id, {
      imageAssetId: body.assetId
    }),
    asset: result.asset,
    usageRecord: result.usageRecord
  };
});

app.post("/image-assets/reanalyze", async (request) => {
  const body = (request.body ?? {}) as {
    status?: unknown;
    limit?: unknown;
  };
  const status = normalizeImageStatus(body.status);
  const limit = normalizePositiveInteger(body.limit, 5000) ?? 5000;

  return {
    ok: true,
    progress: await imageAssetService.reanalyzeAssets({
      status,
      limit
    })
  };
});

app.get("/image-assets/reanalyze/status", async () => ({
  progress: await imageAssetService.getReanalyzeProgress()
}));

app.post("/image-assets/reanalyze/pause", async () => ({
  ok: true,
  progress: await imageAssetService.pauseReanalyzeAssets()
}));

app.post("/image-assets/reanalyze/resume", async () => ({
  ok: true,
  progress: await imageAssetService.resumeReanalyzeAssets()
}));

app.get("/image-assets/:id/thumbnail", async (request, reply) => {
  const params = request.params as { id: string };
  const asset = await imageAssetService.getAsset(params.id);
  if (!asset?.thumbnailPath) {
    throw createHttpError(404, "Thumbnail does not exist.");
  }

  const filePath = await imageAssetService.resolveThumbnailFilePath(asset);
  if (!filePath) {
    throw createHttpError(404, "Thumbnail does not exist.");
  }

  const buffer = await fs.readFile(filePath);
  reply.type("image/webp").send(buffer);
});

app.get("/image-assets/:id/original", async (request, reply) => {
  const params = request.params as { id: string };
  const asset = await imageAssetService.getAsset(params.id);
  if (!asset) {
    throw createHttpError(404, "Image asset does not exist.");
  }

  const filePath = await imageAssetService.resolveOriginalFilePath(asset);
  const buffer = await fs.readFile(filePath);
  reply.type(asset.mimeType).send(buffer);
});

app.get("/image-assets/:id", async (request) => {
  const params = request.params as { id: string };
  return {
    asset: await imageAssetService.getAsset(params.id),
    usageRecords: await imageAssetService.listUsageRecords({
      assetId: params.id,
      limit: 50
    })
  };
});

app.patch("/image-assets/:id", async (request) => {
  const params = request.params as { id: string };
  const body = updateImageAssetSchema.parse(request.body ?? {});
  return {
    ok: true,
    asset: await imageAssetService.updateAsset(params.id, body)
  };
});

const address = await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.CONTROL_API_PORT ?? 8790)
});

app.log.info({ address }, "control-api listening");

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

function parseImageAssetListQuery(query: unknown) {
  const value = (query ?? {}) as Record<string, unknown>;
  const limit = normalizePositiveInteger(value.pageSize ?? value.limit, 5000) ?? 100;
  return {
    query: typeof value.query === "string" ? value.query : "",
    anchorKeyword: typeof value.anchorKeyword === "string" ? value.anchorKeyword : "",
    entity: typeof value.entity === "string" ? value.entity : "",
    platformScope: normalizeImagePlatformScope(value.platform ?? value.platformScope),
    assetType: normalizeImageAssetType(value.assetType),
    usageScope: normalizeImageUsageScope(value.usageScope),
    hasText: normalizeHasTextFilter(value.hasText),
    aspectRatio: normalizeAspectRatio(value.aspectRatio),
    riskLevel: normalizeRiskLevel(value.riskLevel),
    status: normalizeImageStatus(value.status),
    limit
  } as const;
}

function parseImageUsageRecordFilter(query: unknown): {
  assetId?: string;
  taskId?: string;
  platform?: "zhihu" | "x";
  limit?: number;
} {
  const value = (query ?? {}) as Record<string, unknown>;
  const platform = value.platform === "zhihu" || value.platform === "x" ? value.platform : undefined;
  return {
    assetId: typeof value.assetId === "string" ? value.assetId : undefined,
    taskId: typeof value.taskId === "string" ? value.taskId : undefined,
    platform,
    limit: normalizePositiveInteger(value.limit, 5000) ?? 100
  };
}

function normalizeImagePlatformScope(value: unknown) {
  if (value === "zhihu" || value === "x" || value === "both" || value === "unknown" || value === "all") {
    return value;
  }

  return "all" as const;
}

function normalizeImageAssetType(value: unknown) {
  if (value === "meme" || value === "illustration" || value === "cover" || value === "screenshot" || value === "other" || value === "all") {
    return value;
  }

  return "all" as const;
}

function normalizeImageUsageScope(value: unknown) {
  if (
    value === "zhihu_answer" ||
    value === "x_post" ||
    value === "cover" ||
    value === "reaction" ||
    value === "general" ||
    value === "all"
  ) {
    return value;
  }

  return "all" as const;
}

function normalizeHasTextFilter(value: unknown) {
  if (value === "yes" || value === "no" || value === "all") {
    return value;
  }

  return "all" as const;
}

function normalizeAspectRatio(value: unknown) {
  if (value === "landscape" || value === "portrait" || value === "square" || value === "all") {
    return value;
  }

  return "all" as const;
}

function normalizeRiskLevel(value: unknown) {
  if (value === "low" || value === "medium" || value === "high" || value === "unknown" || value === "all") {
    return value;
  }

  return "all" as const;
}

function normalizeImageStatus(value: unknown) {
  if (value === "pending_review" || value === "active" || value === "disabled" || value === "rejected" || value === "all") {
    return value;
  }

  return "all" as const;
}

function normalizePositiveInteger(value: unknown, max: number) {
  const parsed =
    typeof value === "string"
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.min(parsed, max);
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
