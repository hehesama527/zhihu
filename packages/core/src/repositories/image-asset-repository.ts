import type {
  ImageAnchorKeyword,
  ImageAnalysisStatus,
  ImageAnalysisSuggestion,
  ImageAssetCandidate,
  ImageAssetDetail,
  ImageAssetStatus,
  ImageAssetSummary,
  ImageAssetType,
  ImageAspectRatio,
  ImageEmotionTag,
  ImageEntityTag,
  ImageImportJobSummary,
  ImagePlatformScope,
  ImageRiskLevel,
  ImageSearchFilters,
  ImageSelectedBy,
  ImageSourceType,
  ImageWeightedTag,
  ImageUsageScope,
  ImageUsageType,
  ImageAssetUsageRecord
} from "@zhihu-mvp/shared";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getAppConfig } from "../config/env.js";

type ImageAssetRow = RowDataPacket & {
  id: string;
  asset_type: ImageAssetType;
  source_type: ImageSourceType;
  file_name: string;
  source_path: string | null;
  storage_path: string;
  thumbnail_path: string | null;
  file_hash: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  aspect_ratio: ImageAspectRatio;
  platform_scope: ImagePlatformScope;
  usage_scope: ImageUsageScope;
  has_text: number;
  ocr_text: string | null;
  anchor_keyword: string | null;
  caption_short: string | null;
  caption_long: string | null;
  auto_caption: string | null;
  manual_caption: string | null;
  entity_tags: string | null;
  topic_tags: string | null;
  emotion_tags: string | null;
  scene_tags: string | null;
  style_tags: string | null;
  risk_level: ImageRiskLevel;
  risk_notes: string | null;
  copyright_source: string | null;
  analysis_status: ImageAnalysisStatus;
  analysis_error: string | null;
  analysis_payload_json: string | null;
  manual_override_fields_json: string | null;
  status: ImageAssetStatus;
  use_count: number;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type ImageImportJobRow = RowDataPacket & {
  id: string;
  source_type: "upload" | "directory";
  source_path: string;
  status: "pending" | "running" | "completed" | "failed";
  total_count: number;
  imported_count: number;
  duplicated_count: number;
  skipped_count: number;
  failed_count: number;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
};

const imageApiBaseUrl = getAppConfig().imageApiPublicBaseUrl;

type ImageUsageRecordRow = RowDataPacket & {
  id: string;
  asset_id: string;
  platform: "zhihu" | "x";
  account_id: string | null;
  task_id: string | null;
  content_id: string | null;
  usage_type: ImageUsageType;
  selected_by: ImageSelectedBy;
  note: string | null;
  created_at: Date;
  file_name?: string | null;
  asset_type?: ImageAssetType | null;
  platform_scope?: ImagePlatformScope | null;
  status?: ImageAssetStatus | null;
  risk_level?: ImageRiskLevel | null;
  thumbnail_path?: string | null;
  manual_caption?: string | null;
  auto_caption?: string | null;
};

type CreateImageAssetInput = {
  id: string;
  assetType?: ImageAssetType;
  sourceType: ImageSourceType;
  fileName: string;
  sourcePath?: string | null;
  storagePath: string;
  thumbnailPath?: string | null;
  fileHash: string;
  mimeType: string;
  fileSize: number;
  width?: number | null;
  height?: number | null;
  aspectRatio: ImageAspectRatio;
  platformScope?: ImagePlatformScope;
  usageScope?: ImageUsageScope;
  hasText?: boolean;
  ocrText?: string | null;
  anchorKeyword?: string | null;
  captionShort?: string | null;
  captionLong?: string | null;
  autoCaption?: string | null;
  manualCaption?: string | null;
  entityTags?: ImageEntityTag[];
  topicTags?: ImageWeightedTag[];
  emotionTags?: ImageEmotionTag[];
  sceneTags?: ImageWeightedTag[];
  styleTags?: ImageWeightedTag[];
  riskLevel?: ImageRiskLevel;
  riskNotes?: string | null;
  copyrightSource?: string | null;
  analysisStatus?: ImageAnalysisStatus;
  analysisError?: string | null;
  analysisSuggestion?: ImageAnalysisSuggestion | null;
  manualOverrideFields?: string[];
  status?: ImageAssetStatus;
};

type UpdateImageAssetInput = Partial<{
  assetType: ImageAssetType;
  sourceType: ImageSourceType;
  fileName: string;
  sourcePath: string | null;
  storagePath: string;
  thumbnailPath: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  aspectRatio: ImageAspectRatio;
  platformScope: ImagePlatformScope;
  usageScope: ImageUsageScope;
  hasText: boolean;
  ocrText: string | null;
  anchorKeyword: string | { label: string; confidence?: number } | ImageAnchorKeyword | null;
  captionShort: string | null;
  captionLong: string | null;
  autoCaption: string | null;
  manualCaption: string | null;
  entityTags: Array<string | { name: string; category?: ImageEntityTag["category"]; confidence?: number }>;
  topicTags: Array<string | { label: string; confidence?: number; importance?: number }>;
  emotionTags: Array<string | { label: string; confidence?: number; intensity?: number }>;
  sceneTags: Array<string | { label: string; confidence?: number; importance?: number }>;
  styleTags: Array<string | { label: string; confidence?: number; importance?: number }>;
  riskLevel: ImageRiskLevel;
  riskNotes: string | null;
  copyrightSource: string | null;
  analysisStatus: ImageAnalysisStatus;
  analysisError: string | null;
  analysisSuggestion: ImageAnalysisSuggestion | null;
  manualOverrideFields: string[];
  status: ImageAssetStatus;
  useCount: number;
  lastUsedAt: string | Date | null;
}>;

type UpdateImportJobInput = Partial<{
  status: ImageImportJobSummary["status"];
  totalCount: number;
  importedCount: number;
  duplicatedCount: number;
  skippedCount: number;
  failedCount: number;
  errorMessage: string | null;
  completedAt: string | Date | null;
}>;

type UsageRecordFilter = {
  assetId?: string;
  taskId?: string;
  platform?: "zhihu" | "x";
  limit?: number;
};

export class ImageAssetRepository {
  constructor(private readonly pool: Pool) {}

  async createAsset(input: CreateImageAssetInput) {
    await this.pool.query<ResultSetHeader>(
      `INSERT INTO image_assets (
         id,
         asset_type,
         source_type,
         file_name,
         source_path,
         storage_path,
         thumbnail_path,
         file_hash,
         mime_type,
         file_size,
         width,
         height,
         aspect_ratio,
         platform_scope,
         usage_scope,
         has_text,
         ocr_text,
         anchor_keyword,
         caption_short,
         caption_long,
         auto_caption,
         manual_caption,
         entity_tags,
         topic_tags,
         emotion_tags,
         scene_tags,
         style_tags,
         risk_level,
         risk_notes,
         copyright_source,
         analysis_status,
         analysis_error,
         analysis_payload_json,
         manual_override_fields_json,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        input.id,
        input.assetType ?? "other",
        input.sourceType,
        input.fileName,
        normalizeNullableString(input.sourcePath),
        input.storagePath,
        normalizeNullableString(input.thumbnailPath),
        input.fileHash,
        input.mimeType,
        input.fileSize,
        input.width ?? null,
        input.height ?? null,
        input.aspectRatio,
        input.platformScope ?? "unknown",
        input.usageScope ?? "general",
        input.hasText ? 1 : 0,
        normalizeNullableString(input.ocrText),
        normalizeNullableString(input.anchorKeyword),
        normalizeNullableString(input.captionShort),
        normalizeNullableString(input.captionLong),
        normalizeNullableString(input.autoCaption),
        normalizeNullableString(input.manualCaption),
        serializeJson(normalizeEntityTagInputArray(input.entityTags ?? [], "stored")),
        serializeJson(normalizeWeightedTagInputArray(input.topicTags ?? [], "importance", "stored")),
        serializeJson(normalizeEmotionTagInputArray(input.emotionTags ?? [], "stored")),
        serializeJson(normalizeWeightedTagInputArray(input.sceneTags ?? [], "importance", "stored")),
        serializeJson(normalizeWeightedTagInputArray(input.styleTags ?? [], "importance", "stored")),
        input.riskLevel ?? "unknown",
        normalizeNullableString(input.riskNotes),
        normalizeNullableString(input.copyrightSource),
        input.analysisStatus ?? "pending",
        normalizeNullableString(input.analysisError),
        serializeJson(input.analysisSuggestion ?? null),
        serializeJson(input.manualOverrideFields ?? []),
        input.status ?? "pending_review"
      ]
    );

    return this.getAssetById(input.id);
  }

  async updateAsset(id: string, patch: UpdateImageAssetInput) {
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [field, payload] of buildImageAssetAssignments(patch)) {
      assignments.push(`${field} = ?`);
      values.push(payload);
    }

    if (assignments.length > 0) {
      await this.pool.query(
        `UPDATE image_assets
         SET ${assignments.join(", ")}
         WHERE id = ?`,
        [...values, id]
      );
    }

    return this.getAssetById(id);
  }

  async getAssetById(id: string): Promise<ImageAssetDetail | null> {
    const [rows] = await this.pool.query<ImageAssetRow[]>(
      `SELECT *
       FROM image_assets
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    const row = rows[0];
    return row ? mapImageAssetRow(row) : null;
  }

  async getAssetByHash(fileHash: string): Promise<ImageAssetDetail | null> {
    const [rows] = await this.pool.query<ImageAssetRow[]>(
      `SELECT *
       FROM image_assets
       WHERE file_hash = ?
       LIMIT 1`,
      [fileHash]
    );

    const row = rows[0];
    return row ? mapImageAssetRow(row) : null;
  }

  async listAssets(filters: ImageSearchFilters): Promise<ImageAssetSummary[]> {
    const { where, params } = buildImageAssetWhere(filters);
    const limit = clampLimit(filters.limit, 5000);
    const [rows] = await this.pool.query<ImageAssetRow[]>(
      `SELECT *
       FROM image_assets
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [...params, limit]
    );

    return rows.map((row) => mapImageAssetRow(row));
  }

  async listAllSearchableAssets(filters: Omit<ImageSearchFilters, "query" | "limit">): Promise<ImageAssetSummary[]> {
    const { where, params } = buildImageAssetWhere({
      ...filters,
      query: "",
      limit: 5000
    });
    const [rows] = await this.pool.query<ImageAssetRow[]>(
      `SELECT *
       FROM image_assets
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT 5000`,
      params
    );

    return rows.map((row) => mapImageAssetRow(row));
  }

  async createImportJob(input: { id: string; sourceType: "upload" | "directory"; sourcePath: string }) {
    await this.pool.query<ResultSetHeader>(
      `INSERT INTO image_import_jobs (id, source_type, source_path, status)
       VALUES (?, ?, ?, 'pending')`,
      [input.id, input.sourceType, input.sourcePath]
    );

    return this.getImportJobById(input.id);
  }

  async updateImportJob(id: string, patch: UpdateImportJobInput) {
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [field, value] of buildImportJobAssignments(patch)) {
      assignments.push(`${field} = ?`);
      values.push(value);
    }

    if (assignments.length > 0) {
      await this.pool.query(
        `UPDATE image_import_jobs
         SET ${assignments.join(", ")}
         WHERE id = ?`,
        [...values, id]
      );
    }

    return this.getImportJobById(id);
  }

  async getImportJobById(id: string): Promise<ImageImportJobSummary | null> {
    const [rows] = await this.pool.query<ImageImportJobRow[]>(
      `SELECT *
       FROM image_import_jobs
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    const row = rows[0];
    return row ? mapImportJobRow(row) : null;
  }

  async listImportJobs(limit = 50): Promise<ImageImportJobSummary[]> {
    const [rows] = await this.pool.query<ImageImportJobRow[]>(
      `SELECT *
       FROM image_import_jobs
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [clampLimit(limit, 200)]
    );

    return rows.map((row) => mapImportJobRow(row));
  }

  async createUsageRecord(input: {
    id: string;
    assetId: string;
    platform: "zhihu" | "x";
    accountId?: string | null;
    taskId?: string | null;
    contentId?: string | null;
    usageType: ImageUsageType;
    selectedBy: ImageSelectedBy;
    note?: string | null;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query<ResultSetHeader>(
        `INSERT INTO image_asset_usage_records (
           id,
           asset_id,
           platform,
           account_id,
           task_id,
           content_id,
           usage_type,
           selected_by,
           note
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.assetId,
          input.platform,
          normalizeNullableString(input.accountId),
          normalizeNullableString(input.taskId),
          normalizeNullableString(input.contentId),
          input.usageType,
          input.selectedBy,
          normalizeNullableString(input.note)
        ]
      );

      await connection.query(
        `UPDATE image_assets
         SET use_count = use_count + 1,
             last_used_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [input.assetId]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return this.getUsageRecordById(input.id);
  }

  async listUsageRecords(filter: UsageRecordFilter = {}): Promise<ImageAssetUsageRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.assetId) {
      clauses.push("ur.asset_id = ?");
      params.push(filter.assetId);
    }

    if (filter.taskId) {
      clauses.push("ur.task_id = ?");
      params.push(filter.taskId);
    }

    if (filter.platform) {
      clauses.push("ur.platform = ?");
      params.push(filter.platform);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await this.pool.query<ImageUsageRecordRow[]>(
      `SELECT
         ur.*,
         ia.file_name,
         ia.asset_type,
         ia.platform_scope,
         ia.status,
         ia.risk_level,
         ia.thumbnail_path,
         ia.manual_caption,
         ia.auto_caption
       FROM image_asset_usage_records ur
       LEFT JOIN image_assets ia ON ia.id = ur.asset_id
       ${where}
       ORDER BY ur.created_at DESC, ur.id DESC
       LIMIT ?`,
      [...params, clampLimit(filter.limit, 200)]
    );

    return rows.map((row) => mapUsageRecordRow(row));
  }

  async getUsageRecordById(id: string): Promise<ImageAssetUsageRecord | null> {
    const [rows] = await this.pool.query<ImageUsageRecordRow[]>(
      `SELECT
         ur.*,
         ia.file_name,
         ia.asset_type,
         ia.platform_scope,
         ia.status,
         ia.risk_level,
         ia.thumbnail_path,
         ia.manual_caption,
         ia.auto_caption
       FROM image_asset_usage_records ur
       LEFT JOIN image_assets ia ON ia.id = ur.asset_id
       WHERE ur.id = ?
       LIMIT 1`,
      [id]
    );

    const row = rows[0];
    return row ? mapUsageRecordRow(row) : null;
  }
}

function buildImageAssetAssignments(patch: UpdateImageAssetInput) {
  const entries: Array<[string, unknown]> = [];

  if (Object.prototype.hasOwnProperty.call(patch, "assetType")) {
    entries.push(["asset_type", patch.assetType ?? "other"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "sourceType")) {
    entries.push(["source_type", patch.sourceType ?? "local_import"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "fileName")) {
    entries.push(["file_name", patch.fileName ?? ""]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "sourcePath")) {
    entries.push(["source_path", normalizeNullableString(patch.sourcePath)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "storagePath")) {
    entries.push(["storage_path", patch.storagePath ?? ""]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "thumbnailPath")) {
    entries.push(["thumbnail_path", normalizeNullableString(patch.thumbnailPath)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "mimeType")) {
    entries.push(["mime_type", patch.mimeType ?? "application/octet-stream"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "fileSize")) {
    entries.push(["file_size", patch.fileSize ?? 0]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "width")) {
    entries.push(["width", patch.width ?? null]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "height")) {
    entries.push(["height", patch.height ?? null]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "aspectRatio")) {
    entries.push(["aspect_ratio", patch.aspectRatio ?? "square"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "platformScope")) {
    entries.push(["platform_scope", patch.platformScope ?? "unknown"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "usageScope")) {
    entries.push(["usage_scope", patch.usageScope ?? "general"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "hasText")) {
    entries.push(["has_text", patch.hasText ? 1 : 0]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "ocrText")) {
    entries.push(["ocr_text", normalizeNullableString(patch.ocrText)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "anchorKeyword")) {
    const anchorKeyword = normalizeAnchorKeywordInput(patch.anchorKeyword);
    entries.push(["anchor_keyword", normalizeNullableString(anchorKeyword?.label ?? null)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "captionShort")) {
    entries.push(["caption_short", normalizeNullableString(patch.captionShort)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "captionLong")) {
    entries.push(["caption_long", normalizeNullableString(patch.captionLong)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "autoCaption")) {
    entries.push(["auto_caption", normalizeNullableString(patch.autoCaption)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "manualCaption")) {
    entries.push(["manual_caption", normalizeNullableString(patch.manualCaption)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "entityTags")) {
    entries.push(["entity_tags", serializeJson(normalizeEntityTagInputArray(patch.entityTags ?? [], "manual"))]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "topicTags")) {
    entries.push([
      "topic_tags",
      serializeJson(normalizeWeightedTagInputArray(patch.topicTags ?? [], "importance", "manual"))
    ]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "emotionTags")) {
    entries.push(["emotion_tags", serializeJson(normalizeEmotionTagInputArray(patch.emotionTags ?? [], "manual"))]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "sceneTags")) {
    entries.push([
      "scene_tags",
      serializeJson(normalizeWeightedTagInputArray(patch.sceneTags ?? [], "importance", "manual"))
    ]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "styleTags")) {
    entries.push([
      "style_tags",
      serializeJson(normalizeWeightedTagInputArray(patch.styleTags ?? [], "importance", "manual"))
    ]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "riskLevel")) {
    entries.push(["risk_level", patch.riskLevel ?? "unknown"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "riskNotes")) {
    entries.push(["risk_notes", normalizeNullableString(patch.riskNotes)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "copyrightSource")) {
    entries.push(["copyright_source", normalizeNullableString(patch.copyrightSource)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "analysisStatus")) {
    entries.push(["analysis_status", patch.analysisStatus ?? "pending"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "analysisError")) {
    entries.push(["analysis_error", normalizeNullableString(patch.analysisError)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "analysisSuggestion")) {
    entries.push(["analysis_payload_json", serializeJson(patch.analysisSuggestion ?? null)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "manualOverrideFields")) {
    entries.push(["manual_override_fields_json", serializeJson(patch.manualOverrideFields ?? [])]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "status")) {
    entries.push(["status", patch.status ?? "pending_review"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "useCount")) {
    entries.push(["use_count", patch.useCount ?? 0]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "lastUsedAt")) {
    entries.push(["last_used_at", normalizeDateTime(patch.lastUsedAt)]);
  }

  return entries;
}

function buildImportJobAssignments(patch: UpdateImportJobInput) {
  const entries: Array<[string, unknown]> = [];

  if (Object.prototype.hasOwnProperty.call(patch, "status")) {
    entries.push(["status", patch.status ?? "pending"]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "totalCount")) {
    entries.push(["total_count", patch.totalCount ?? 0]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "importedCount")) {
    entries.push(["imported_count", patch.importedCount ?? 0]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "duplicatedCount")) {
    entries.push(["duplicated_count", patch.duplicatedCount ?? 0]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "skippedCount")) {
    entries.push(["skipped_count", patch.skippedCount ?? 0]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "failedCount")) {
    entries.push(["failed_count", patch.failedCount ?? 0]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "errorMessage")) {
    entries.push(["error_message", normalizeNullableString(patch.errorMessage)]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "completedAt")) {
    entries.push(["completed_at", normalizeDateTime(patch.completedAt)]);
  }

  return entries;
}

function buildImageAssetWhere(filters: ImageSearchFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status && filters.status !== "all") {
    clauses.push("status = ?");
    params.push(filters.status);
  }

  if (filters.assetType && filters.assetType !== "all") {
    clauses.push("asset_type = ?");
    params.push(filters.assetType);
  }

  if (filters.usageScope && filters.usageScope !== "all") {
    clauses.push("usage_scope = ?");
    params.push(filters.usageScope);
  }

  if (filters.aspectRatio && filters.aspectRatio !== "all") {
    clauses.push("aspect_ratio = ?");
    params.push(filters.aspectRatio);
  }

  if (filters.riskLevel && filters.riskLevel !== "all") {
    clauses.push("risk_level = ?");
    params.push(filters.riskLevel);
  }

  if (filters.hasText === "yes") {
    clauses.push("has_text = 1");
  }

  if (filters.hasText === "no") {
    clauses.push("has_text = 0");
  }

  if (filters.platformScope && filters.platformScope !== "all") {
    if (filters.platformScope === "zhihu" || filters.platformScope === "x") {
      clauses.push("(platform_scope = ? OR platform_scope = 'both')");
      params.push(filters.platformScope);
    } else {
      clauses.push("platform_scope = ?");
      params.push(filters.platformScope);
    }
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function mapImageAssetRow(row: ImageAssetRow): ImageAssetDetail {
  const analysisSuggestion = parseSuggestion(row.analysis_payload_json);
  const entityTags = parseEntityTagArray(row.entity_tags, "stored", analysisSuggestion?.entityTags);
  const topicTags = parseWeightedTagArray(row.topic_tags, "importance", "stored", analysisSuggestion?.topicTags);
  const emotionTags = parseEmotionTagArray(row.emotion_tags, "stored", analysisSuggestion?.emotionTags);
  const sceneTags = parseWeightedTagArray(row.scene_tags, "importance", "stored", analysisSuggestion?.sceneTags);
  const styleTags = parseWeightedTagArray(row.style_tags, "importance", "stored", analysisSuggestion?.styleTags);

  return {
    id: row.id,
    assetType: row.asset_type,
    sourceType: row.source_type,
    fileName: row.file_name,
    sourcePath: row.source_path ?? null,
    storagePath: row.storage_path,
    storageUrl: `${imageApiBaseUrl}/image-assets/${row.id}/original`,
    thumbnailPath: row.thumbnail_path ?? null,
    thumbnailUrl: row.thumbnail_path ? `${imageApiBaseUrl}/image-assets/${row.id}/thumbnail` : null,
    fileHash: row.file_hash,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size ?? 0),
    width: row.width ?? null,
    height: row.height ?? null,
    aspectRatio: row.aspect_ratio,
    platformScope: row.platform_scope,
    usageScope: row.usage_scope,
    hasText: Boolean(row.has_text),
    ocrText: row.ocr_text ?? null,
    anchorKeyword: row.anchor_keyword ?? analysisSuggestion?.anchorKeyword?.label ?? null,
    captionShort: row.caption_short ?? analysisSuggestion?.captionShort ?? row.auto_caption ?? null,
    captionLong: row.caption_long ?? analysisSuggestion?.captionLong ?? null,
    autoCaption: row.auto_caption ?? row.caption_short ?? analysisSuggestion?.captionShort ?? null,
    manualCaption: row.manual_caption ?? null,
    entityTags,
    primaryTopic: analysisSuggestion?.primaryTopic ?? topicTags[0] ?? null,
    primaryEmotion: analysisSuggestion?.primaryEmotion ?? emotionTags[0] ?? null,
    topicTags,
    emotionTags,
    sceneTags,
    styleTags,
    riskLevel: row.risk_level,
    riskNotes: row.risk_notes ?? null,
    copyrightSource: row.copyright_source ?? null,
    analysisStatus: row.analysis_status,
    analysisError: row.analysis_error ?? null,
    analysisSuggestion,
    manualOverrideFields: parseStringArray(row.manual_override_fields_json),
    status: row.status,
    useCount: Number(row.use_count ?? 0),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapImportJobRow(row: ImageImportJobRow): ImageImportJobSummary {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourcePath: row.source_path,
    status: row.status,
    totalCount: Number(row.total_count ?? 0),
    importedCount: Number(row.imported_count ?? 0),
    duplicatedCount: Number(row.duplicated_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null
  };
}

function mapUsageRecordRow(row: ImageUsageRecordRow): ImageAssetUsageRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    platform: row.platform,
    accountId: row.account_id ?? null,
    taskId: row.task_id ?? null,
    contentId: row.content_id ?? null,
    usageType: row.usage_type,
    selectedBy: row.selected_by,
    note: row.note ?? null,
    createdAt: row.created_at.toISOString(),
    asset: row.file_name
      ? {
          id: row.asset_id,
          fileName: row.file_name,
          assetType: row.asset_type ?? "other",
          platformScope: row.platform_scope ?? "unknown",
          status: row.status ?? "pending_review",
          riskLevel: row.risk_level ?? "unknown",
          thumbnailPath: row.thumbnail_path ?? null,
          thumbnailUrl: row.thumbnail_path ? `${imageApiBaseUrl}/image-assets/${row.asset_id}/thumbnail` : null,
          manualCaption: row.manual_caption ?? null,
          autoCaption: row.auto_caption ?? null
        }
      : null
  };
}

function serializeJson(value: unknown) {
  return JSON.stringify(value);
}

function parseStringArray(value: unknown) {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseSuggestion(value: unknown): ImageAnalysisSuggestion | null {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const data = parsed as Record<string, unknown>;
  const captionShort = normalizeText(data.captionShort ?? data.caption_short ?? data.caption);
  const topicTags = normalizeWeightedTagInputArray(data.topicTags ?? data.topic_tags, "importance", "stored");
  const emotionTags = normalizeEmotionTagInputArray(data.emotionTags ?? data.emotion_tags, "stored");
  return {
    ocrText: normalizeText(data.ocrText ?? data.ocr_text),
    caption: captionShort,
    captionShort,
    captionLong: normalizeText(data.captionLong ?? data.caption_long),
    anchorKeyword: normalizeAnchorKeywordInput(data.anchorKeyword ?? data.anchor_keyword),
    assetType: normalizeImageAssetType(data.assetType ?? data.asset_type),
    platformScope: normalizePlatformScope(data.platformScope ?? data.platform_scope),
    usageScope: normalizeUsageScope(data.usageScope ?? data.usage_scope),
    hasText: Boolean(data.hasText ?? data.has_text),
    entityTags: normalizeEntityTagInputArray(data.entityTags ?? data.entity_tags, "stored"),
    primaryTopic: normalizeWeightedTagInput(data.primaryTopic ?? data.primary_topic, "importance"),
    topicTags,
    primaryEmotion: normalizeEmotionTagInput(data.primaryEmotion ?? data.primary_emotion),
    emotionTags,
    sceneTags: normalizeWeightedTagInputArray(data.sceneTags ?? data.scene_tags, "importance", "stored"),
    styleTags: normalizeWeightedTagInputArray(data.styleTags ?? data.style_tags, "importance", "stored"),
    riskLevel: normalizeRiskLevel(data.riskLevel ?? data.risk_level),
    riskNotes: normalizeText(data.riskNotes ?? data.risk_notes)
  };
}

function parseJsonValue(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  return value;
}

function parseEntityTagArray(
  value: unknown,
  source: "stored" | "manual",
  fallback: ImageEntityTag[] = []
) {
  const parsed = normalizeEntityTagInputArray(value, source);
  return parsed.length ? parsed : fallback;
}

function parseWeightedTagArray(
  value: unknown,
  scoreKey: "importance",
  source: "stored" | "manual",
  fallback: ImageWeightedTag[] = []
) {
  const parsed = normalizeWeightedTagInputArray(value, scoreKey, source);
  return parsed.length ? parsed : fallback;
}

function parseEmotionTagArray(value: unknown, source: "stored" | "manual", fallback: ImageEmotionTag[] = []) {
  const parsed = normalizeEmotionTagInputArray(value, source);
  return parsed.length ? parsed : fallback;
}

function normalizeImageAssetType(value: unknown): ImageAssetType {
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

function normalizeAnchorKeywordInput(value: unknown) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const label = normalizeText(value);
    return label ? { label, confidence: 100 } : null;
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

function normalizeWeightedTagInput(value: unknown, scoreKey: "importance") {
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
    importance: normalizeScore(record[scoreKey], 70)
  };
}

function normalizeEmotionTagInput(value: unknown) {
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

function normalizeEntityTagInputArray(value: unknown, source: "stored" | "manual") {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const defaultConfidence = source === "manual" ? 100 : 70;
  const normalized = parsed.flatMap((item) => {
    if (typeof item === "string") {
      const name = normalizeText(item);
      return name
        ? [
            {
              name,
              category: "other" as const,
              confidence: defaultConfidence
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
        confidence: normalizeScore(record.confidence, defaultConfidence)
      }
    ];
  });

  return dedupeEntityTags(normalized).slice(0, 3);
}

function normalizeWeightedTagInputArray(
  value: unknown,
  scoreKey: "importance",
  source: "stored" | "manual"
) {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const defaultConfidence = source === "manual" ? 100 : 70;
  const defaultScore = source === "manual" ? 100 : 68;
  const normalized = parsed.flatMap((item, index) => {
    if (typeof item === "string") {
      const label = normalizeText(item);
      return label
        ? [
            {
              label,
              confidence: defaultConfidence,
              importance: Math.max(40, defaultScore - index * 6)
            }
          ]
        : [];
    }

    const tag = normalizeWeightedTagInput(item, scoreKey);
    if (!tag) {
      return [];
    }

    return [
      {
        ...tag,
        confidence: normalizeScore(tag.confidence, defaultConfidence),
        importance: normalizeScore(tag.importance, defaultScore)
      }
    ];
  });

  return dedupeWeightedTags(normalized).slice(0, 6);
}

function normalizeEmotionTagInputArray(value: unknown, source: "stored" | "manual") {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const defaultConfidence = source === "manual" ? 100 : 72;
  const defaultIntensity = source === "manual" ? 100 : 70;
  const normalized = parsed.flatMap((item, index) => {
    if (typeof item === "string") {
      const label = normalizeText(item);
      return label
        ? [
            {
              label,
              confidence: defaultConfidence,
              intensity: Math.max(40, defaultIntensity - index * 8)
            }
          ]
        : [];
    }

    const tag = normalizeEmotionTagInput(item);
    if (!tag) {
      return [];
    }

    return [
      {
        ...tag,
        confidence: normalizeScore(tag.confidence, defaultConfidence),
        intensity: normalizeScore(tag.intensity, defaultIntensity)
      }
    ];
  });

  return dedupeEmotionTags(normalized).slice(0, 6);
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

function dedupeWeightedTags(tags: ImageWeightedTag[]) {
  const map = new Map<string, ImageWeightedTag>();

  for (const tag of tags) {
    const key = tag.label.toLowerCase();
    const existing = map.get(key);
    if (!existing || compareWeightedTagPriority(tag, existing) > 0) {
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
    if (!existing || compareEmotionTagPriority(tag, existing) > 0) {
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

function compareWeightedTagPriority(left: ImageWeightedTag, right: ImageWeightedTag) {
  const leftScore = left.confidence * 0.6 + left.importance * 0.4;
  const rightScore = right.confidence * 0.6 + right.importance * 0.4;
  return leftScore - rightScore;
}

function compareEmotionTagPriority(left: ImageEmotionTag, right: ImageEmotionTag) {
  const leftScore = left.confidence * 0.6 + left.intensity * 0.4;
  const rightScore = right.confidence * 0.6 + right.intensity * 0.4;
  return leftScore - rightScore;
}

function normalizeNullableString(value: unknown) {
  if (typeof value !== "string") {
    return value == null ? null : String(value);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function clampLimit(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Number(value), fallback));
}

export function tokenizeImageQuery(query: string) {
  return query
    .trim()
    .toLowerCase()
    .split(/[\s,，;；、|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function scoreImageAsset(asset: ImageAssetSummary, query: string): ImageAssetCandidate {
  const tokens = tokenizeImageQuery(query);
  const hitReasons: string[] = [];
  let score = 0;

  for (const token of tokens) {
    score += scoreMatch(asset.fileName, token, 6, "文件名", hitReasons);
    score += scoreMatch(asset.sourcePath, token, 3, "原始路径", hitReasons);
    score += scoreMatch(asset.anchorKeyword, token, 14, "主关键词", hitReasons);
    score += scoreEntityMatch(asset.entityTags, token, 11, "实体标签", hitReasons);
    score += scoreWeightedPrimaryTagMatch(asset.primaryTopic, token, 10, "主主题", hitReasons);
    score += scoreEmotionPrimaryTagMatch(asset.primaryEmotion, token, 10, "主情绪", hitReasons);
    score += scoreMatch(asset.manualCaption, token, 9, "人工描述", hitReasons);
    score += scoreMatch(asset.captionShort, token, 8, "短描述", hitReasons);
    score += scoreMatch(asset.captionLong, token, 7, "长描述", hitReasons);
    score += scoreMatch(asset.autoCaption, token, 5, "自动描述", hitReasons);
    score += scoreMatch(asset.ocrText, token, 8, "OCR", hitReasons);
    score += scoreWeightedTagArrayMatch(asset.topicTags, token, 6, "主题标签", hitReasons);
    score += scoreEmotionTagArrayMatch(asset.emotionTags, token, 5.5, "情绪标签", hitReasons);
    score += scoreWeightedTagArrayMatch(asset.sceneTags, token, 5, "场景标签", hitReasons);
    score += scoreWeightedTagArrayMatch(asset.styleTags, token, 4.5, "风格标签", hitReasons);
  }

  if (!tokens.length) {
    score = 1;
  }

  if (asset.platformScope === "both") {
    score += 1.5;
  }

  if (asset.manualCaption) {
    score += 1;
  }

  if (asset.anchorKeyword) {
    score += 0.8;
  }

  if (asset.captionShort) {
    score += 0.6;
  }

  if (asset.ocrText) {
    score += 0.5;
  }

  if (asset.useCount > 5) {
    score -= Math.min(asset.useCount / 10, 4);
  }

  return {
    asset,
    score,
    hitReasons: Array.from(new Set(hitReasons))
  };
}

function scoreMatch(value: string | null | undefined, token: string, baseScore: number, reason: string, hitReasons: string[]) {
  if (!value) {
    return 0;
  }

  const normalized = value.toLowerCase();
  if (!normalized.includes(token)) {
    return 0;
  }

  hitReasons.push(reason);
  return normalized === token ? baseScore + 1 : baseScore;
}

function scoreWeightedPrimaryTagMatch(
  tag: Pick<ImageWeightedTag, "label" | "confidence" | "importance"> | null,
  token: string,
  baseScore: number,
  reason: string,
  hitReasons: string[]
) {
  if (!tag) {
    return 0;
  }

  return scoreWeightedTagArrayMatch([tag], token, baseScore, reason, hitReasons);
}

function scoreEmotionPrimaryTagMatch(
  tag: Pick<ImageEmotionTag, "label" | "confidence" | "intensity"> | null,
  token: string,
  baseScore: number,
  reason: string,
  hitReasons: string[]
) {
  if (!tag) {
    return 0;
  }

  return scoreEmotionTagArrayMatch([tag], token, baseScore, reason, hitReasons);
}

function scoreEntityMatch(
  tags: Array<Pick<ImageEntityTag, "name" | "confidence">>,
  token: string,
  baseScore: number,
  reason: string,
  hitReasons: string[]
) {
  let best = 0;

  for (const tag of tags) {
    const normalized = tag.name.toLowerCase();
    if (!normalized.includes(token)) {
      continue;
    }

    hitReasons.push(reason);
    const exactBonus = normalized === token ? 1 : 0;
    const confidenceFactor = 0.55 + normalizeScore(tag.confidence, 70) / 200;
    best = Math.max(best, (baseScore + exactBonus) * confidenceFactor);
  }

  return best;
}

function scoreWeightedTagArrayMatch(
  tags: Array<Pick<ImageWeightedTag, "label" | "confidence" | "importance">>,
  token: string,
  baseScore: number,
  reason: string,
  hitReasons: string[]
) {
  let best = 0;

  for (const tag of tags) {
    const normalized = tag.label.toLowerCase();
    if (!normalized.includes(token)) {
      continue;
    }

    hitReasons.push(reason);
    const exactBonus = normalized === token ? 1 : 0;
    const confidence = normalizeScore(tag.confidence, 70);
    const importance = normalizeScore(tag.importance, 68);
    let weighted = (baseScore + exactBonus) * (0.45 + confidence / 250 + importance / 350);
    if (confidence < 45) {
      weighted *= 0.45;
    }

    best = Math.max(best, weighted);
  }

  return best;
}

function scoreEmotionTagArrayMatch(
  tags: Array<Pick<ImageEmotionTag, "label" | "confidence" | "intensity">>,
  token: string,
  baseScore: number,
  reason: string,
  hitReasons: string[]
) {
  let best = 0;

  for (const tag of tags) {
    const normalized = tag.label.toLowerCase();
    if (!normalized.includes(token)) {
      continue;
    }

    hitReasons.push(reason);
    const exactBonus = normalized === token ? 1 : 0;
    const confidence = normalizeScore(tag.confidence, 72);
    const intensity = normalizeScore(tag.intensity, 70);
    let weighted = (baseScore + exactBonus) * (0.45 + confidence / 250 + intensity / 350);
    if (confidence < 45) {
      weighted *= 0.45;
    }

    best = Math.max(best, weighted);
  }

  return best;
}
