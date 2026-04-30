import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  ImageAnalysisQueueSnapshot,
  ImageAnalysisRuntimeAsset,
  ImageAnalysisSuggestion,
  ImageAssetDetail,
  ImageAssetStatus,
  ImageAssetType,
  ImageEmotionTag,
  ImageEntityTag,
  ImagePlatformScope,
  ImageRiskLevel,
  ImageWeightedTag,
  ImageUsageScope
} from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";
import { readImageRuntimeConfig } from "../config/image-runtime-config.js";
import { ImageAssetRepository } from "../repositories/image-asset-repository.js";

type OllamaMessage = {
  role: "system" | "user";
  content: string;
  images?: string[];
};

type OcrCandidate = {
  hasText: boolean;
  ocrText: string;
};

type OcrTextRole = "main" | "incidental" | "none";

type OcrJudgeResult = OcrCandidate & {
  textRole: OcrTextRole;
};

export class ImageAssetAnalysisService {
  private readonly queue: string[] = [];
  private readonly pending = new Set<string>();
  private readonly running = new Set<string>();
  private readonly inflight = new Map<string, Promise<ImageAssetDetail | null>>();
  private serialAnalysis: Promise<void> = Promise.resolve();
  private currentAssetId: string | null = null;
  private currentStartedAt: string | null = null;
  private currentStageLabel: string | null = null;
  private currentStep = 0;
  private totalSteps = 0;

  constructor(private readonly repository: ImageAssetRepository) {}

  enqueue(assetId: string) {
    if (this.pending.has(assetId) || this.running.has(assetId)) {
      return;
    }

    this.pending.add(assetId);
    this.queue.push(assetId);
    void this.pump();
  }

  async analyzeNow(assetId: string, force = false) {
    const existing = this.inflight.get(assetId);
    if (existing) {
      return existing;
    }

    const task = this.runSerial(async () => {
      const asset = await this.repository.getAssetById(assetId);
      if (!asset) {
        return null;
      }

      if (!force && asset.analysisStatus === "completed") {
        return asset;
      }

      this.running.add(assetId);
      this.currentAssetId = assetId;
      this.currentStartedAt = new Date().toISOString();
      this.setCurrentProgress("准备图片", 1, 5);

      try {
        await this.repository.updateAsset(assetId, {
          analysisStatus: "running",
          analysisError: null
        });

        const suggestion = await this.runVisionAnalysis(asset);
        const patch = buildAnalysisPatch(asset, suggestion);
        this.setCurrentProgress("写回结果", 5, 5);
        await this.repository.updateAsset(assetId, {
          ...patch,
          analysisStatus: "completed",
          analysisError: null,
          analysisSuggestion: suggestion,
          status: resolveAutoReviewStatus(asset.status, suggestion.riskLevel, "completed")
        });
      } catch (error) {
        if (error instanceof ImageAssetAnalysisSkippedError) {
          await this.repository.updateAsset(assetId, {
            analysisStatus: "skipped",
            analysisError: error.message,
            status: resolveAutoReviewStatus(asset.status, "unknown", "skipped")
          });
          return this.repository.getAssetById(assetId);
        }

        await this.repository.updateAsset(assetId, {
          analysisStatus: "failed",
          analysisError: error instanceof Error ? error.message : String(error),
          status: resolveAutoReviewStatus(asset.status, "unknown", "failed")
        });
      } finally {
        this.running.delete(assetId);
        this.pending.delete(assetId);
        if (this.currentAssetId === assetId) {
          this.currentAssetId = null;
          this.currentStartedAt = null;
          this.currentStageLabel = null;
          this.currentStep = 0;
          this.totalSteps = 0;
        }
        void this.pump();
      }

      return this.repository.getAssetById(assetId);
    });

    this.inflight.set(assetId, task);

    try {
      return await task;
    } finally {
      if (this.inflight.get(assetId) === task) {
        this.inflight.delete(assetId);
      }
    }
  }

  private async pump() {
    const appConfig = getAppConfig();
    while (this.running.size < Math.max(1, appConfig.imageAnalysisConcurrency) && this.queue.length > 0) {
      const assetId = this.queue.shift();
      if (!assetId) {
        return;
      }

      if (this.running.has(assetId)) {
        continue;
      }

      void this.analyzeNow(assetId).catch(() => {
        // analyzeNow already persists the failure state
      });
    }
  }

  private async runVisionAnalysis(asset: ImageAssetDetail) {
    let suggestion: ImageAnalysisSuggestion | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      suggestion = await this.runVisionAnalysisOnce(asset);
      if (!isLowSignalSuggestion(suggestion)) {
        return suggestion;
      }

      if (attempt < 2) {
        await sleep(1_200);
      }
    }

    if (!suggestion) {
      throw new Error("Image analysis returned no suggestion.");
    }

    return suggestion;
  }

  private async runVisionAnalysisOnce(asset: ImageAssetDetail) {
    const appConfig = getAppConfig();
    const runtimeConfig = readImageRuntimeConfig();
    if (looksLikeThumbnailSource(asset.fileName, asset.sourcePath)) {
      throw new ImageAssetAnalysisSkippedError("检测到缩略图来源文件，已跳过自动标注，请人工审核。");
    }

    this.setCurrentProgress("准备图片", 1, 5);
    const assetFilePath = await resolveAnalysisImagePath(appConfig.imageAssetsDir, asset);
    const buffer = await fs.readFile(assetFilePath);
    const normalizedBuffer = await normalizeAnalysisImageBuffer(buffer);
    this.setCurrentProgress("主分析", 2, 5);
    const rawContent = await this.requestOllamaJson(
      runtimeConfig.imageAnalysisModel,
      [
        {
          role: "system",
          content:
            "你是配图中心的审核助手。你只能根据图片内容判断，不允许利用文件名、路径或上下文猜测。先理解图片的核心情绪和用途，再输出严格 JSON，不要输出解释。"
        },
        {
          role: "user",
          content: [
            "请基于这张图片输出 JSON。",
            "字段要求：ocrText, captionShort, captionLong, anchorKeyword, entityTags, assetType, platformScope, usageScope, hasText, primaryTopic, topicTags, primaryEmotion, emotionTags, sceneTags, styleTags, riskLevel, riskNotes。",
            "captionShort 必须是 8 到 20 个字的简短中文短句。",
            "captionLong 需要更具体，说明这张图适合什么场景、表达什么情绪、为什么能用。",
            "anchorKeyword 优先输出一个最适合直接搜图的核心词，格式为 {\"label\":\"奥特曼\",\"confidence\":93}。如果没有可靠锚点就返回 null。",
            "entityTags 只用于角色 / IP / 视觉原型识别，元素格式为 {\"name\":\"奥特曼\",\"category\":\"ip_character\",\"confidence\":93}。拿不准就返回空数组，不要硬猜。",
            "assetType 只允许 meme / illustration / cover / screenshot / other。",
            "platformScope 只允许 zhihu / x / both / unknown。",
            "usageScope 只允许 zhihu_answer / x_post / cover / reaction / general。",
            "riskLevel 只允许 low / medium / high / unknown。",
            "ocrText 只保留对图片表达有贡献的主文案；背景招牌、水印、角落小字、界面字都忽略。没有主文案就留空。",
            "如果没有主文案，hasText 必须为 false，ocrText 必须为空字符串，这不算失败。",
            "primaryTopic 格式为 {\"label\":\"反应图\",\"confidence\":82,\"importance\":92}，primaryEmotion 格式为 {\"label\":\"无语\",\"confidence\":85,\"intensity\":78}。",
            "topicTags、sceneTags、styleTags 的每个元素都必须带 label / confidence / importance；emotionTags 的每个元素都必须带 label / confidence / intensity。",
            "topicTags、sceneTags、styleTags 最多 5 个；emotionTags 最多 3 个；entityTags 最多 3 个。全部使用简短中文短语，不要英文，不要句子。",
            "如果识别到了角色或 IP，优先把角色名或 IP 名作为 anchorKeyword；像“吐槽”“无奈”“表情包”这类泛词不要当主锚点。"
          ].join("\n"),
          images: [normalizedBuffer.toString("base64")]
        }
      ],
      runtimeConfig.imageAnalysisTimeoutMs
    );

    const parsed = parseAnalysisPayload(rawContent);
    if (!parsed) {
      throw new Error("Ollama 返回内容无法解析为 JSON。");
    }

    return this.maybeRescueOcr(asset, parsed);
  }

  private async maybeRescueOcr(asset: ImageAssetDetail, suggestion: ImageAnalysisSuggestion) {
    const appConfig = getAppConfig();
    if (!shouldRunOcrRescue(suggestion)) {
      return suggestion;
    }

    try {
      this.setCurrentProgress("OCR 补救", 3, 5);
      const extractionBuffers = await buildOcrExtractionImageBuffers(appConfig.imageAssetsDir, asset);
      const extractedCandidates: Array<OcrCandidate | null> = [];

      for (const buffer of extractionBuffers) {
        try {
          extractedCandidates.push(await this.runOcrExtraction(buffer));
        } catch {
          extractedCandidates.push(null);
        }
      }

      const judgeBuffers = await buildOcrJudgeImageBuffers(appConfig.imageAssetsDir, asset);
      const judgeHint = chooseBestOcrText(
        suggestion.caption,
        suggestion.ocrText,
        ...extractedCandidates.map((candidate) => candidate?.ocrText ?? "")
      );
      this.setCurrentProgress("OCR 复核", 4, 5);
      const judgement = await this.judgeOcrText(judgeBuffers, judgeHint);
      return mergeOcrSuggestion(suggestion, extractedCandidates, judgement);
    } catch {
      return suggestion;
    }
  }

  private async runOcrExtraction(imageBuffer: Buffer) {
    const runtimeConfig = readImageRuntimeConfig();
    const rawContent = await this.requestOllamaJson(
      runtimeConfig.imageOcrModel,
      [
        {
          role: "system",
          content:
            "你是梗图 OCR 助手。只提取图片里肉眼可见的主文案，不要推测，不要解释，也不要根据文件名、目录名或上下文猜测。输出严格 JSON。"
        },
        {
          role: "user",
          content: [
            "请只提取这张图真正的主文案。",
            "主文案指用户检索这张梗图时真正会搜的字；背景招牌、水印、角落小字、界面字都忽略。",
            "如果没有主文案，返回 {\"hasText\":false,\"ocrText\":\"\"}。",
            "如果有主文案，返回 {\"hasText\":true,\"ocrText\":\"逐行文字\"}。",
            "ocrText 可以用 \\n 分行，不要补全看不清的字。"
          ].join("\n"),
          images: [imageBuffer.toString("base64")]
        }
      ],
      Math.min(runtimeConfig.imageAnalysisTimeoutMs, 45_000)
    );

    return parseOcrPayload(rawContent);
  }

  private async judgeOcrText(imageBuffers: Buffer[], extractedText: string) {
    const runtimeConfig = readImageRuntimeConfig();
    const rawContent = await this.requestOllamaJson(
      runtimeConfig.imageOcrJudgeModel,
      [
        {
          role: "system",
          content:
            "你是梗图 OCR 裁决助手。你会看到同一张图的多个视图。你的目标不是识别所有可见文字，而是判断这张图有没有主文案。主文案是用户检索这张图时真正会搜的字；背景招牌、路牌、水印、角落小字、界面字都算无关字。输出严格 JSON。"
        },
        {
          role: "user",
          content: [
            "请综合这些视图判断。",
            `提取模型当前识别出的文本：${extractedText || "(空)"}。这行只作参考，必须以图片本身为准。`,
            "如果存在主文案，返回 {\"hasText\":true,\"ocrText\":\"逐行文字\",\"textRole\":\"main\"}。",
            "如果只能看到背景杂字或无关小字，返回 {\"hasText\":false,\"ocrText\":\"\",\"textRole\":\"incidental\"}。",
            "如果压根没有可用主文案，返回 {\"hasText\":false,\"ocrText\":\"\",\"textRole\":\"none\"}。",
            "不要补字，不要猜，不要解释。"
          ].join("\n"),
          images: imageBuffers.map((buffer) => buffer.toString("base64"))
        }
      ],
      Math.min(runtimeConfig.imageAnalysisTimeoutMs, 60_000)
    );

    return parseOcrJudgePayload(rawContent);
  }

  private async requestOllamaJson(model: string, messages: OllamaMessage[], timeoutMs: number) {
    const appConfig = getAppConfig();
    const maxAttempts = Math.max(1, appConfig.imageAnalysisRetryCount + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.requestOllamaJsonOnce(model, messages, timeoutMs);
      } catch (error) {
        if (attempt < maxAttempts && isRetryableOllamaError(error)) {
          await sleep(getOllamaRetryDelayMs(attempt));
          continue;
        }

        throw error;
      }
    }

    throw new Error("Ollama analysis failed without a response.");
  }

  private async requestOllamaJsonOnce(model: string, messages: OllamaMessage[], timeoutMs: number) {
    const runtimeConfig = readImageRuntimeConfig();
    const response = await fetchWithTimeout(
      `${runtimeConfig.ollamaBaseUrl.replace(/\/$/, "")}/api/chat`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          messages
        })
      },
      timeoutMs
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama 分析失败，${response.status} ${text}`.trim());
    }

    const payload = (await response.json()) as {
      message?: {
        content?: string;
      };
    };

    return payload.message?.content ?? "";
  }

  async getQueueSnapshot(): Promise<ImageAnalysisQueueSnapshot> {
    const appConfig = getAppConfig();
    const currentAsset = this.currentAssetId ? await this.repository.getAssetById(this.currentAssetId) : null;

    return {
      currentAsset: currentAsset ? mapRuntimeAsset(currentAsset) : null,
      currentStageLabel: this.currentStageLabel,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      currentProgressPercent: this.totalSteps ? Math.round((this.currentStep / this.totalSteps) * 100) : 0,
      queuedCount: this.queue.length,
      runningCount: this.running.size,
      pendingCount: this.queue.length + this.running.size,
      concurrency: Math.max(1, appConfig.imageAnalysisConcurrency),
      currentStartedAt: this.currentStartedAt
    };
  }

  private setCurrentProgress(stageLabel: string, currentStep: number, totalSteps: number) {
    this.currentStageLabel = stageLabel;
    this.currentStep = currentStep;
    this.totalSteps = totalSteps;
  }

  private async runSerial<T>(task: () => Promise<T>) {
    const previous = this.serialAnalysis;
    let release!: () => void;
    this.serialAnalysis = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await task();
    } finally {
      release();
    }
  }
}

function mapRuntimeAsset(asset: ImageAssetDetail): ImageAnalysisRuntimeAsset {
  return {
    id: asset.id,
    fileName: asset.fileName,
    sourcePath: asset.sourcePath,
    thumbnailUrl: asset.thumbnailUrl,
    analysisStatus: asset.analysisStatus,
    status: asset.status
  };
}

class ImageAssetAnalysisSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageAssetAnalysisSkippedError";
  }
}

function resolveAutoReviewStatus(
  currentStatus: ImageAssetStatus,
  riskLevel: ImageRiskLevel,
  analysisStatus: "completed" | "failed" | "skipped"
): ImageAssetStatus {
  if (currentStatus === "disabled" || currentStatus === "rejected") {
    return currentStatus;
  }

  if (analysisStatus !== "completed") {
    return "pending_review";
  }

  if (riskLevel === "high") {
    return "pending_review";
  }

  return "active";
}

function buildAnalysisPatch(asset: ImageAssetDetail, suggestion: ImageAnalysisSuggestion) {
  const locked = new Set(asset.manualOverrideFields);
  const patch: Partial<{
    assetType: ImageAssetType;
    platformScope: ImagePlatformScope;
    usageScope: ImageUsageScope;
    anchorKeyword: string | null;
    captionShort: string | null;
    captionLong: string | null;
    entityTags: ImageEntityTag[];
    topicTags: ImageWeightedTag[];
    emotionTags: ImageEmotionTag[];
    sceneTags: ImageWeightedTag[];
    styleTags: ImageWeightedTag[];
    riskLevel: ImageRiskLevel;
    riskNotes: string | null;
    ocrText: string | null;
    autoCaption: string | null;
    hasText: boolean;
  }> = {
    autoCaption: suggestion.captionShort || suggestion.caption || null
  };

  if (!locked.has("ocrText")) {
    patch.ocrText = suggestion.ocrText || null;
    patch.hasText = suggestion.hasText || suggestion.ocrText.trim().length > 0;
  }

  if (!locked.has("assetType")) {
    patch.assetType = suggestion.assetType;
  }

  if (!locked.has("platformScope")) {
    patch.platformScope = suggestion.platformScope;
  }

  if (!locked.has("usageScope")) {
    patch.usageScope = suggestion.usageScope;
  }

  if (!locked.has("anchorKeyword")) {
    patch.anchorKeyword = suggestion.anchorKeyword?.label ?? null;
  }

  if (!locked.has("captionShort")) {
    patch.captionShort = suggestion.captionShort || null;
  }

  if (!locked.has("captionLong")) {
    patch.captionLong = suggestion.captionLong || null;
  }

  if (!locked.has("entityTags")) {
    patch.entityTags = suggestion.entityTags;
  }

  if (!locked.has("topicTags")) {
    patch.topicTags = suggestion.topicTags;
  }

  if (!locked.has("emotionTags")) {
    patch.emotionTags = suggestion.emotionTags;
  }

  if (!locked.has("sceneTags")) {
    patch.sceneTags = suggestion.sceneTags;
  }

  if (!locked.has("styleTags")) {
    patch.styleTags = suggestion.styleTags;
  }

  if (!locked.has("riskLevel")) {
    patch.riskLevel = suggestion.riskLevel;
  }

  if (!locked.has("riskNotes")) {
    patch.riskNotes = suggestion.riskNotes || null;
  }

  return patch;
}

function parseAnalysisPayload(content: string): ImageAnalysisSuggestion | null {
  const cleaned = cleanJsonContent(content);

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const captionShort = normalizeText(parsed.captionShort ?? parsed.caption_short ?? parsed.caption);
    const topicTags = normalizeWeightedTags(parsed.topicTags ?? parsed.topic_tags);
    const emotionTags = normalizeEmotionTags(parsed.emotionTags ?? parsed.emotion_tags);
    return {
      ocrText: normalizeText(parsed.ocrText ?? parsed.ocr_text),
      caption: captionShort,
      captionShort,
      captionLong: normalizeText(parsed.captionLong ?? parsed.caption_long),
      anchorKeyword: normalizeAnchorKeyword(parsed.anchorKeyword ?? parsed.anchor_keyword),
      assetType: normalizeAssetType(parsed.assetType ?? parsed.asset_type),
      platformScope: normalizePlatformScope(parsed.platformScope ?? parsed.platform_scope),
      usageScope: normalizeUsageScope(parsed.usageScope ?? parsed.usage_scope),
      hasText: Boolean(parsed.hasText ?? parsed.has_text),
      entityTags: normalizeEntityTags(parsed.entityTags ?? parsed.entity_tags),
      primaryTopic: normalizeWeightedTag(parsed.primaryTopic ?? parsed.primary_topic) ?? topicTags[0] ?? null,
      topicTags,
      primaryEmotion: normalizeEmotionTag(parsed.primaryEmotion ?? parsed.primary_emotion) ?? emotionTags[0] ?? null,
      emotionTags,
      sceneTags: normalizeWeightedTags(parsed.sceneTags ?? parsed.scene_tags),
      styleTags: normalizeWeightedTags(parsed.styleTags ?? parsed.style_tags),
      riskLevel: normalizeRiskLevel(parsed.riskLevel ?? parsed.risk_level),
      riskNotes: normalizeText(parsed.riskNotes ?? parsed.risk_notes)
    };
  } catch {
    return null;
  }
}

function parseOcrPayload(content: string): OcrCandidate | null {
  const cleaned = cleanJsonContent(content);

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      hasText: Boolean(parsed.hasText ?? parsed.has_text),
      ocrText: normalizeText(parsed.ocrText ?? parsed.ocr_text)
    };
  } catch {
    return null;
  }
}

function parseOcrJudgePayload(content: string): OcrJudgeResult | null {
  const cleaned = cleanJsonContent(content);

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      hasText: Boolean(parsed.hasText ?? parsed.has_text),
      ocrText: normalizeText(parsed.ocrText ?? parsed.ocr_text),
      textRole: normalizeOcrTextRole(parsed.textRole ?? parsed.text_role)
    };
  } catch {
    return null;
  }
}

function isLowSignalSuggestion(suggestion: ImageAnalysisSuggestion) {
  if (suggestion.hasText && suggestion.ocrText.trim()) {
    return false;
  }

  if (suggestion.captionShort.trim() || suggestion.captionLong.trim()) {
    return false;
  }

  if (suggestion.anchorKeyword?.label?.trim()) {
    return false;
  }

  if (
    suggestion.entityTags.length > 0
    || suggestion.topicTags.length > 0
    || suggestion.emotionTags.length > 0
    || suggestion.sceneTags.length > 0
    || suggestion.styleTags.length > 0
    || suggestion.primaryTopic != null
    || suggestion.primaryEmotion != null
  ) {
    return false;
  }

  if (suggestion.assetType !== "other") {
    return false;
  }

  if (suggestion.platformScope !== "unknown") {
    return false;
  }

  if (suggestion.usageScope !== "general") {
    return false;
  }

  return suggestion.riskLevel === "unknown";
}

function cleanJsonContent(content: string) {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function normalizeAnchorKeyword(value: unknown) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const label = normalizeText(value);
    return label
      ? {
          label,
          confidence: 75
        }
      : null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = normalizeText(record.label ?? record.name);
  if (!label) {
    return null;
  }

  return {
    label,
    confidence: normalizeScore(record.confidence, 75)
  };
}

function normalizeWeightedTag(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = normalizeText(record.label ?? record.name);
  if (!label) {
    return null;
  }

  return {
    label,
    confidence: normalizeScore(record.confidence, 75),
    importance: normalizeScore(record.importance, 70)
  };
}

function normalizeEmotionTag(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = normalizeText(record.label ?? record.name);
  if (!label) {
    return null;
  }

  return {
    label,
    confidence: normalizeScore(record.confidence, 75),
    intensity: normalizeScore(record.intensity, 70)
  };
}

function normalizeWeightedTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value.flatMap((item, index) => {
    if (typeof item === "string") {
      const label = normalizeText(item);
      return label
        ? [
            {
              label,
              confidence: 75,
              importance: Math.max(40, 70 - index * 6)
            }
          ]
        : [];
    }

    const tag = normalizeWeightedTag(item);
    return tag ? [tag] : [];
  });

  return dedupeWeightedTags(normalized).slice(0, 5);
}

function normalizeEmotionTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value.flatMap((item, index) => {
    if (typeof item === "string") {
      const label = normalizeText(item);
      return label
        ? [
            {
              label,
              confidence: 75,
              intensity: Math.max(40, 70 - index * 8)
            }
          ]
        : [];
    }

    const tag = normalizeEmotionTag(item);
    return tag ? [tag] : [];
  });

  return dedupeEmotionTags(normalized).slice(0, 3);
}

function normalizeEntityTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value.flatMap((item) => {
    if (typeof item === "string") {
      const name = normalizeText(item);
      return name
        ? [
            {
              name,
              category: "other" as const,
              confidence: 70
            }
          ]
        : [];
    }

    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const name = normalizeText(record.name ?? record.label);
    if (!name) {
      return [];
    }

    return [
      {
        name,
        category: normalizeEntityCategory(record.category),
        confidence: normalizeScore(record.confidence, 70)
      }
    ];
  });

  return dedupeEntityTags(normalized).slice(0, 3);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScore(value: unknown, fallback: number) {
  const score = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(score)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeEntityCategory(value: unknown): ImageEntityTag["category"] {
  if (
    value === "ip_character"
    || value === "meme_archetype"
    || value === "brand_mascot"
    || value === "public_figure"
  ) {
    return value;
  }

  return "other" as const;
}

function dedupeWeightedTags(tags: ImageWeightedTag[]) {
  const map = new Map<string, ImageWeightedTag>();

  for (const tag of tags) {
    const key = tag.label.toLowerCase();
    const existing = map.get(key);
    if (!existing || tag.confidence * 0.6 + tag.importance * 0.4 > existing.confidence * 0.6 + existing.importance * 0.4) {
      map.set(key, tag);
    }
  }

  return Array.from(map.values());
}

function dedupeEmotionTags(tags: ImageEmotionTag[]) {
  const map = new Map<string, ImageEmotionTag>();

  for (const tag of tags) {
    const key = tag.label.toLowerCase();
    const existing = map.get(key);
    if (!existing || tag.confidence * 0.6 + tag.intensity * 0.4 > existing.confidence * 0.6 + existing.intensity * 0.4) {
      map.set(key, tag);
    }
  }

  return Array.from(map.values());
}

function dedupeEntityTags(tags: ImageEntityTag[]) {
  const map = new Map<string, ImageEntityTag>();

  for (const tag of tags) {
    const key = `${tag.name.toLowerCase()}::${tag.category}`;
    const existing = map.get(key);
    if (!existing || tag.confidence > existing.confidence) {
      map.set(key, tag);
    }
  }

  return Array.from(map.values());
}

function normalizeAssetType(value: unknown): ImageAssetType {
  if (value === "meme" || value === "illustration" || value === "cover" || value === "screenshot") {
    return value;
  }

  return "other";
}

function normalizePlatformScope(value: unknown): ImagePlatformScope {
  if (value === "zhihu" || value === "x" || value === "both") {
    return value;
  }

  return "unknown";
}

function normalizeUsageScope(value: unknown): ImageUsageScope {
  if (value === "zhihu_answer" || value === "x_post" || value === "cover" || value === "reaction") {
    return value;
  }

  return "general";
}

function normalizeRiskLevel(value: unknown): ImageRiskLevel {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return "unknown";
}

function normalizeOcrTextRole(value: unknown): OcrTextRole {
  if (value === "main" || value === "incidental") {
    return value;
  }

  return "none";
}

async function resolveAnalysisImagePath(baseDir: string, asset: Pick<ImageAssetDetail, "thumbnailPath" | "storagePath">) {
  if (asset.thumbnailPath) {
    const thumbnailPath = resolveAssetPath(baseDir, asset.thumbnailPath);

    try {
      await fs.access(thumbnailPath);
      return thumbnailPath;
    } catch {
      // Thumbnail is an optimization path only; the original image remains the source of truth.
    }
  }

  return resolveAssetPath(baseDir, asset.storagePath);
}

async function normalizeAnalysisImageBuffer(buffer: Buffer) {
  return sharp(buffer, { animated: true, pages: 1 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}

async function buildOcrExtractionImageBuffers(baseDir: string, asset: Pick<ImageAssetDetail, "storagePath">) {
  const buffer = await readOriginalAssetBuffer(baseDir, asset);
  const base = sharp(buffer, { animated: true, pages: 1 }).rotate();
  const metadata = await base.metadata();
  const width = Math.max(1, metadata.width ?? 1);
  const height = Math.max(1, metadata.height ?? 1);
  const bottomTop = Math.min(height - 1, Math.max(0, Math.floor(height * 0.45)));
  const bottomHeight = Math.max(1, height - bottomTop);

  const fullBuffer = await base
    .clone()
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside"
    })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
  const bottomBuffer = await base
    .clone()
    .extract({ left: 0, top: bottomTop, width, height: bottomHeight })
    .resize({ width: 1200, fit: "inside" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();

  return [fullBuffer, bottomBuffer];
}

async function buildOcrJudgeImageBuffers(baseDir: string, asset: Pick<ImageAssetDetail, "storagePath">) {
  const buffer = await readOriginalAssetBuffer(baseDir, asset);
  const base = sharp(buffer, { animated: true, pages: 1 }).rotate();
  const metadata = await base.metadata();
  const width = Math.max(1, metadata.width ?? 1);
  const height = Math.max(1, metadata.height ?? 1);
  const topHeight = Math.max(1, Math.floor(height * 0.55));
  const bottomTop = Math.min(height - 1, Math.max(0, Math.floor(height * 0.45)));
  const bottomHeight = Math.max(1, height - bottomTop);

  const originalBuffer = await base
    .clone()
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const normalizedBuffer = await base
    .clone()
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside"
    })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
  const topBuffer = await base
    .clone()
    .extract({ left: 0, top: 0, width, height: topHeight })
    .resize({ width: 1200, fit: "inside" })
    .flatten({ background: "#ffffff" })
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
  const bottomBuffer = await base
    .clone()
    .extract({ left: 0, top: bottomTop, width, height: bottomHeight })
    .resize({ width: 1200, fit: "inside" })
    .flatten({ background: "#ffffff" })
    .normalise()
    .sharpen()
    .png()
    .toBuffer();

  return [originalBuffer, normalizedBuffer, topBuffer, bottomBuffer];
}

async function readOriginalAssetBuffer(baseDir: string, asset: Pick<ImageAssetDetail, "storagePath">) {
  const originalFilePath = resolveAssetPath(baseDir, asset.storagePath);
  return fs.readFile(originalFilePath);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new ImageAssetAnalysisSkippedError(
        `图片分析超时（${Math.round(timeoutMs / 1000)} 秒），已跳过自动标注，请人工审核。`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetryOllamaStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableOllamaError(error: unknown) {
  if (error instanceof ImageAssetAnalysisSkippedError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const statusMatch = error.message.match(/\b(\d{3})\b/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (shouldRetryOllamaStatus(status)) {
      return true;
    }
  }

  return /fetch failed|timeout|timed out|econnreset|econnrefused|socket hang up|network|aborted/i.test(error.message);
}

function getOllamaRetryDelayMs(attempt: number) {
  return Math.min(12_000, 1_500 * 2 ** Math.max(0, attempt - 1));
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function looksLikeThumbnailSource(fileName: string, sourcePath?: string | null) {
  const normalized = `${sourcePath ?? ""}/${fileName}`.replaceAll("\\", "/").toLowerCase();
  return /(?:^|[/._\-\s])(thumb|thumbnail|preview|mini)(?:[/._\-\s]|$)/i.test(normalized)
    || normalized.includes("缩略图")
    || normalized.includes("预览图")
    || normalized.includes("缩略");
}

function shouldRunOcrRescue(suggestion: Pick<ImageAnalysisSuggestion, "assetType" | "hasText" | "ocrText">) {
  if (suggestion.assetType === "meme" || suggestion.assetType === "screenshot") {
    return true;
  }

  if (suggestion.hasText) {
    return true;
  }

  return countMeaningfulChars(suggestion.ocrText) > 0;
}

function mergeOcrSuggestion(
  suggestion: ImageAnalysisSuggestion,
  extractedCandidates: Array<OcrCandidate | null>,
  judgement: OcrJudgeResult | null
): ImageAnalysisSuggestion {
  const currentText = normalizeText(suggestion.ocrText);

  if (judgement && judgement.textRole !== "main") {
    if (scoreTextQuality(currentText) <= 4) {
      return {
        ...suggestion,
        hasText: false,
        ocrText: ""
      };
    }

    return suggestion;
  }

  const candidateText = chooseBestOcrText(
    suggestion.caption,
    currentText,
    ...extractedCandidates.map((candidate) => candidate?.ocrText ?? ""),
    judgement?.ocrText ?? ""
  );
  if (!candidateText) {
    return suggestion;
  }

  if (shouldSuppressShortScreenshotRescue(suggestion, currentText, candidateText)) {
    return {
      ...suggestion,
      hasText: false,
      ocrText: ""
    };
  }

  if (!currentText || shouldReplaceOcrResult(currentText, candidateText)) {
    return {
      ...suggestion,
      hasText: true,
      ocrText: candidateText
    };
  }

  return suggestion;
}

function chooseBestOcrText(caption: string, ...texts: string[]) {
  const normalized = Array.from(new Set(texts.map((text) => normalizeText(text)).filter(Boolean)));
  if (normalized.length === 0) {
    return "";
  }

  normalized.sort((left, right) => {
    const scoreDiff = scoreOcrCandidate(right, caption) - scoreOcrCandidate(left, caption);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return countMeaningfulChars(right) - countMeaningfulChars(left);
  });

  return normalized[0] ?? "";
}

function scoreOcrCandidate(text: string, caption: string) {
  return scoreTextQuality(text) * 10 + scoreCaptionAgreement(text, caption);
}

function scoreCaptionAgreement(text: string, caption: string) {
  const normalizedText = normalizeText(text);
  const normalizedCaption = normalizeText(caption);
  if (!normalizedText || !normalizedCaption) {
    return 0;
  }

  const textChars = new Set(normalizedText.match(/[\u4e00-\u9fffA-Za-z0-9]/g) ?? []);
  let score = 0;

  for (const char of normalizedCaption.match(/[\u4e00-\u9fffA-Za-z0-9]/g) ?? []) {
    if (textChars.has(char)) {
      score += 1;
    }
  }

  return score;
}

function shouldReplaceOcrResult(currentText: string, rescuedText: string) {
  const rescuedScore = scoreTextQuality(rescuedText);
  if (rescuedScore === 0) {
    return false;
  }

  const currentScore = scoreTextQuality(currentText);
  if (rescuedScore > currentScore) {
    return true;
  }

  return rescuedScore === currentScore && countMeaningfulChars(rescuedText) > countMeaningfulChars(currentText);
}

function shouldSuppressShortScreenshotRescue(
  suggestion: Pick<ImageAnalysisSuggestion, "assetType" | "hasText" | "ocrText">,
  currentText: string,
  rescuedText: string
) {
  if (suggestion.assetType !== "screenshot") {
    return false;
  }

  if (suggestion.hasText || normalizeText(currentText)) {
    return false;
  }

  const meaningfulChars = countMeaningfulChars(rescuedText);
  if (meaningfulChars > 4) {
    return false;
  }

  return scoreTextQuality(rescuedText) <= 4;
}

function scoreTextQuality(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return 0;
  }

  const meaningful = countMeaningfulChars(normalized);
  const lines = normalized.split(/\n+/).filter(Boolean).length;
  const weird = (normalized.match(/[^\u4e00-\u9fffA-Za-z0-9，。！？、；,.!?\s]/g) ?? []).length;
  return meaningful + Math.min(lines, 3) - weird;
}

function countMeaningfulChars(text: string) {
  return (normalizeText(text).match(/[\u4e00-\u9fffA-Za-z0-9]/g) ?? []).length;
}

function resolveAssetPath(baseDir: string, relativeOrAbsolutePath: string) {
  const root = path.resolve(baseDir);
  const candidate = path.resolve(root, relativeOrAbsolutePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("图片路径超出 image-assets 根目录。");
  }

  return candidate;
}
