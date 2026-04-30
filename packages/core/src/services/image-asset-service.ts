import crypto from "node:crypto";
import path from "node:path";
import type {
  BindJobImageInput,
  ImageAssetReanalyzeProgress,
  ImageAssetCandidate,
  ImageAssetDetail,
  ImageAssetStatus,
  ImagePlatformScope,
  ImageSearchFilters,
  SuggestImageAssetsInput,
  UpdateImageAssetInput
} from "@zhihu-mvp/shared";
import { scoreImageAsset } from "../repositories/image-asset-repository.js";
import { ImageAssetRepository } from "../repositories/image-asset-repository.js";
import { JobRepository } from "../repositories/job-repository.js";
import { getAppConfig } from "../config/env.js";
import { ImageAssetAnalysisService } from "./image-asset-analysis-service.js";

export class ImageAssetService {
  private readonly config = getAppConfig();
  private reanalyzeBatch: {
    id: string;
    status: "running" | "paused" | "completed";
    pauseRequested: boolean;
    scopeStatus: ImageAssetStatus | "all";
    assetIds: string[];
    requestedCount: number;
    completedCount: number;
    failedCount: number;
    currentAssetId: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null = null;

  constructor(
    private readonly repository: ImageAssetRepository,
    private readonly analysisService: ImageAssetAnalysisService,
    private readonly jobRepository?: JobRepository
  ) {}

  async getAsset(id: string) {
    return this.repository.getAssetById(id);
  }

  async listAssets(filters: ImageSearchFilters) {
    const effectiveFilters = buildEffectiveSearchFilters(filters);
    if (!effectiveFilters.query.trim()) {
      return (await this.repository.listAssets(filters)).map((asset) => ({
        asset,
        score: 0,
        hitReasons: []
      }));
    }

    return this.searchAssets(effectiveFilters);
  }

  async listImportJobs(limit = 50) {
    return this.repository.listImportJobs(limit);
  }

  async getImportJob(id: string) {
    return this.repository.getImportJobById(id);
  }

  async reanalyzeAsset(id: string) {
    return this.analysisService.analyzeNow(id, true);
  }

  async reanalyzeAssets(input?: { status?: ImageAssetStatus | "all"; limit?: number }) {
    const items = await this.repository.listAssets({
      query: "",
      platformScope: "all",
      assetType: "all",
      usageScope: "all",
      hasText: "all",
      aspectRatio: "all",
      riskLevel: "all",
      status: input?.status ?? "pending_review",
      limit: input?.limit ?? 5000
    });

    if (this.reanalyzeBatch && (this.reanalyzeBatch.status === "running" || this.reanalyzeBatch.status === "paused")) {
      return this.getReanalyzeProgress();
    }

    const batch = {
      id: crypto.randomUUID(),
      status: items.length ? ("running" as const) : ("completed" as const),
      pauseRequested: false,
      scopeStatus: input?.status ?? "pending_review",
      assetIds: items.map((item) => item.id),
      requestedCount: items.length,
      completedCount: 0,
      failedCount: 0,
      currentAssetId: null,
      startedAt: new Date().toISOString(),
      finishedAt: items.length ? null : new Date().toISOString()
    };

    this.reanalyzeBatch = batch;

    if (items.length) {
      void this.runReanalyzeBatch(batch);
    }

    return this.getReanalyzeProgress();
  }

  async pauseReanalyzeAssets() {
    if (!this.reanalyzeBatch || this.reanalyzeBatch.status === "completed") {
      return this.getReanalyzeProgress();
    }

    this.reanalyzeBatch.pauseRequested = true;
    if (!this.reanalyzeBatch.currentAssetId) {
      this.reanalyzeBatch.status = "paused";
    }

    return this.getReanalyzeProgress();
  }

  async resumeReanalyzeAssets() {
    if (!this.reanalyzeBatch || this.reanalyzeBatch.status === "completed") {
      return this.getReanalyzeProgress();
    }

    this.reanalyzeBatch.pauseRequested = false;
    if (this.reanalyzeBatch.status === "paused") {
      this.reanalyzeBatch.status = "running";
    }

    return this.getReanalyzeProgress();
  }

  async getReanalyzeProgress(): Promise<ImageAssetReanalyzeProgress> {
    const queue = await this.analysisService.getQueueSnapshot();
    const batch = this.reanalyzeBatch;
    const currentAssetId = batch?.currentAssetId ?? queue.currentAsset?.id ?? null;
    const currentAsset = currentAssetId ? await this.repository.getAssetById(currentAssetId) : null;
    const currentRuntimeAsset = currentAsset
      ? {
          id: currentAsset.id,
          fileName: currentAsset.fileName,
          sourcePath: currentAsset.sourcePath,
          thumbnailUrl: currentAsset.thumbnailUrl,
          analysisStatus: currentAsset.analysisStatus,
          status: currentAsset.status
        }
      : queue.currentAsset;

    if (!batch) {
      return {
        id: null,
        status: "idle",
        pauseRequested: false,
        scopeStatus: "pending_review",
        requestedCount: 0,
        completedCount: 0,
        failedCount: 0,
        remainingCount: queue.queuedCount,
        startedAt: null,
        finishedAt: null,
        currentAsset: currentRuntimeAsset,
        queue
      };
    }

    return {
      id: batch.id,
      status: batch.status,
      pauseRequested: batch.pauseRequested,
      scopeStatus: batch.scopeStatus,
      requestedCount: batch.requestedCount,
      completedCount: batch.completedCount,
      failedCount: batch.failedCount,
      remainingCount: Math.max(
        0,
        batch.requestedCount
          - batch.completedCount
          - batch.failedCount
          - (batch.currentAssetId ? 1 : 0)
      ),
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
      currentAsset: currentRuntimeAsset,
      queue
    };
  }

  async updateAsset(id: string, input: UpdateImageAssetInput) {
    const current = await this.repository.getAssetById(id);
    if (!current) {
      return null;
    }

    const manualOverrideFields = new Set(current.manualOverrideFields);
    const patch: UpdateImageAssetInput & { hasText?: boolean } = { ...input };

    if (Object.prototype.hasOwnProperty.call(input, "assetType")) {
      manualOverrideFields.add("assetType");
    }

    if (Object.prototype.hasOwnProperty.call(input, "platformScope")) {
      manualOverrideFields.add("platformScope");
    }

    if (Object.prototype.hasOwnProperty.call(input, "usageScope")) {
      manualOverrideFields.add("usageScope");
    }

    if (Object.prototype.hasOwnProperty.call(input, "ocrText")) {
      manualOverrideFields.add("ocrText");
      patch.hasText = typeof input.ocrText === "string" && input.ocrText.trim().length > 0;
    }

    if (Object.prototype.hasOwnProperty.call(input, "anchorKeyword")) {
      manualOverrideFields.add("anchorKeyword");
    }

    if (Object.prototype.hasOwnProperty.call(input, "captionShort")) {
      manualOverrideFields.add("captionShort");
    }

    if (Object.prototype.hasOwnProperty.call(input, "captionLong")) {
      manualOverrideFields.add("captionLong");
    }

    if (Object.prototype.hasOwnProperty.call(input, "manualCaption")) {
      manualOverrideFields.add("manualCaption");
    }

    if (Object.prototype.hasOwnProperty.call(input, "entityTags")) {
      manualOverrideFields.add("entityTags");
    }

    if (Object.prototype.hasOwnProperty.call(input, "topicTags")) {
      manualOverrideFields.add("topicTags");
    }

    if (Object.prototype.hasOwnProperty.call(input, "emotionTags")) {
      manualOverrideFields.add("emotionTags");
    }

    if (Object.prototype.hasOwnProperty.call(input, "sceneTags")) {
      manualOverrideFields.add("sceneTags");
    }

    if (Object.prototype.hasOwnProperty.call(input, "styleTags")) {
      manualOverrideFields.add("styleTags");
    }

    if (Object.prototype.hasOwnProperty.call(input, "riskLevel")) {
      manualOverrideFields.add("riskLevel");
    }

    if (Object.prototype.hasOwnProperty.call(input, "riskNotes")) {
      manualOverrideFields.add("riskNotes");
    }

    return this.repository.updateAsset(id, {
      ...patch,
      manualOverrideFields: Array.from(manualOverrideFields)
    });
  }

  async listUsageRecords(filter?: { assetId?: string; taskId?: string; platform?: "zhihu" | "x"; limit?: number }) {
    return this.repository.listUsageRecords(filter);
  }

  async suggestAssets(input: SuggestImageAssetsInput) {
    const mergedQuery = [input.query, input.contentTitle, input.contentText, ...(input.preferredTags ?? [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");
    const candidates = await this.searchAssets({
      query: mergedQuery,
      platformScope: input.platform ?? "all",
      assetType: input.assetType ?? "all",
      usageScope: mapUsageTypeToSearchScope(input.usageType),
      hasText:
        input.hasText === undefined
          ? "all"
          : input.hasText
            ? "yes"
            : "no",
      aspectRatio: input.aspectRatio ?? "all",
      riskLevel: input.riskLevel ?? "all",
      status: "active",
      limit: input.limit
    });

    return candidates.slice(0, input.limit);
  }

  async bindImageToJob(jobId: number, input: BindJobImageInput, context?: { accountId?: number | null }) {
    if (!this.jobRepository) {
      throw new Error("Job repository is not configured.");
    }

    if (!input.assetId) {
      await this.jobRepository.bindImageAsset(jobId, null);
      return {
        asset: null,
        usageRecord: null
      };
    }

    const asset = await this.repository.getAssetById(input.assetId);
    if (!asset) {
      throw new Error("图片资产不存在。");
    }

    assertAssetSelectable(asset, "zhihu");

    await this.jobRepository.bindImageAsset(jobId, input.assetId);
    const usageRecord = await this.repository.createUsageRecord({
      id: crypto.randomUUID(),
      assetId: input.assetId,
      platform: "zhihu",
      accountId: context?.accountId != null ? String(context.accountId) : null,
      taskId: String(jobId),
      usageType: input.usageType,
      selectedBy: "manual",
      note: input.note ?? null
    });

    return {
      asset,
      usageRecord
    };
  }

  async bindImageToExternalTask(input: {
    platform: "zhihu" | "x";
    taskId: string;
    accountId?: string | null;
    assetId: string | null;
    usageType: BindJobImageInput["usageType"];
    note?: string | null;
  }) {
    if (!input.assetId) {
      return {
        asset: null,
        usageRecord: null
      };
    }

    const asset = await this.repository.getAssetById(input.assetId);
    if (!asset) {
      throw new Error("图片资产不存在。");
    }

    assertAssetSelectable(asset, input.platform);

    const usageRecord = await this.repository.createUsageRecord({
      id: crypto.randomUUID(),
      assetId: input.assetId,
      platform: input.platform,
      accountId: input.accountId ?? null,
      taskId: input.taskId,
      usageType: input.usageType,
      selectedBy: "manual",
      note: input.note ?? null
    });

    return {
      asset,
      usageRecord
    };
  }

  async resolveOriginalFilePath(asset: ImageAssetDetail) {
    return resolveAssetPath(this.config.imageAssetsDir, asset.storagePath);
  }

  async resolveThumbnailFilePath(asset: ImageAssetDetail) {
    if (!asset.thumbnailPath) {
      return null;
    }

    return resolveAssetPath(this.config.imageAssetsDir, asset.thumbnailPath);
  }

  private async searchAssets(filters: ImageSearchFilters) {
    const all = await this.repository.listAllSearchableAssets({
      anchorKeyword: filters.anchorKeyword,
      entity: filters.entity,
      platformScope: filters.platformScope ?? "all",
      assetType: filters.assetType ?? "all",
      usageScope: filters.usageScope ?? "all",
      hasText: filters.hasText ?? "all",
      aspectRatio: filters.aspectRatio ?? "all",
      riskLevel: filters.riskLevel ?? "all",
      status: filters.status ?? "all"
    });

    const candidates = all
      .map((asset) => {
        const baseCandidate = scoreImageAsset(asset, filters.query);
        return {
          baseCandidate,
          candidate: enhanceCandidate(baseCandidate, filters.platformScope ?? "all")
        };
      })
      .filter(({ baseCandidate }) => (filters.query.trim() ? baseCandidate.hitReasons.length > 0 : true))
      .map(({ candidate }) => candidate)
      .sort(compareCandidates);

    return candidates.slice(0, filters.limit ?? 100);
  }

  private async runReanalyzeBatch(batch: NonNullable<ImageAssetService["reanalyzeBatch"]>) {
    try {
      for (const assetId of batch.assetIds) {
        await this.waitIfPaused(batch);
        batch.status = "running";
        batch.currentAssetId = assetId;

        const result = await this.analysisService.analyzeNow(assetId, true);
        if (result?.analysisStatus === "completed") {
          batch.completedCount += 1;
        } else {
          batch.failedCount += 1;
        }

        batch.currentAssetId = null;
      }
    } finally {
      batch.currentAssetId = null;
      batch.pauseRequested = false;
      batch.status = "completed";
      batch.finishedAt = new Date().toISOString();
    }
  }

  private async waitIfPaused(batch: NonNullable<ImageAssetService["reanalyzeBatch"]>) {
    while (batch.pauseRequested) {
      batch.status = "paused";
      await sleep(500);
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildEffectiveSearchFilters(filters: ImageSearchFilters): ImageSearchFilters {
  const query = [filters.query, filters.anchorKeyword, filters.entity]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .trim();

  return {
    ...filters,
    query
  };
}

function enhanceCandidate(candidate: ImageAssetCandidate, platformScope: ImagePlatformScope | "all") {
  let score = candidate.score;
  const reasons = [...candidate.hitReasons];

  if (platformScope !== "all") {
    if (candidate.asset.platformScope === platformScope) {
      score += 3;
      reasons.push("平台完全匹配");
    } else if (candidate.asset.platformScope === "both") {
      score += 1.5;
      reasons.push("平台通用");
    }
  }

  if (candidate.asset.manualCaption) {
    score += 1;
  }

  if (candidate.asset.anchorKeyword) {
    score += 0.8;
  }

  if (candidate.asset.captionShort) {
    score += 0.6;
  }

  if (candidate.asset.ocrText) {
    score += 0.8;
  }

  if (candidate.asset.riskLevel === "medium") {
    score -= 1;
  }

  if (candidate.asset.riskLevel === "high") {
    score -= 5;
  }

  return {
    ...candidate,
    score,
    hitReasons: Array.from(new Set(reasons))
  };
}

function compareCandidates(left: ImageAssetCandidate, right: ImageAssetCandidate) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return right.asset.createdAt.localeCompare(left.asset.createdAt);
}

function mapUsageTypeToSearchScope(value: SuggestImageAssetsInput["usageType"]) {
  if (!value) {
    return "all" as const;
  }

  if (value === "body_image" || value === "preview") {
    return "general" as const;
  }

  return value;
}

function assertAssetSelectable(asset: ImageAssetDetail, platform: "zhihu" | "x") {
  if (asset.status !== "active") {
    throw new Error("只有已审核启用的图片才能绑定到任务。");
  }

  if (asset.riskLevel === "high") {
    throw new Error("高风险图片默认不能进入任务候选集。");
  }

  if (!(asset.platformScope === platform || asset.platformScope === "both" || asset.platformScope === "unknown")) {
    throw new Error("该图片的平台适配范围与当前任务不匹配。");
  }
}

function resolveAssetPath(baseDir: string, relativeOrAbsolutePath: string) {
  const root = path.resolve(baseDir);
  const candidate = path.resolve(root, relativeOrAbsolutePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("图片路径超出 image-assets 根目录。");
  }

  return candidate;
}
