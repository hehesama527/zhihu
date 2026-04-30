import { z } from "zod";
import { llmReasoningEfforts, llmWireApis, modelCenterAgentNames } from "./types.js";

export const promptSetNameSchema = z.enum([
  "topic_agent",
  "writer_agent",
  "review_agent",
  "publish_agent",
  "zhihu_note_agent",
  "x_main_agent",
  "x_hotspot_scout_agent",
  "x_writer_agent",
  "x_review_agent",
  "x_publish_agent",
  "x_traditional_main_agent",
  "x_traditional_writer_agent",
  "x_traditional_review_agent",
  "x_traditional_publish_agent",
  "x_traditional_note_agent"
]);

export const llmReasoningEffortSchema = z.enum(llmReasoningEfforts);
export const llmWireApiSchema = z.enum(llmWireApis);
export const modelCenterAgentNameSchema = z.enum(modelCenterAgentNames);

export const modelCenterAgentOverrideFieldsSchema = z.object({
  model: z.union([z.string().trim().min(1), z.null()]),
  baseUrl: z.union([z.string().trim().min(1), z.null()]),
  apiKey: z.union([z.string().trim().min(1), z.null()]),
  reasoningEffort: z.union([llmReasoningEffortSchema, z.null()]),
  wireApi: z.union([llmWireApiSchema, z.null()]),
  requestTimeoutMs: z.union([z.number().int().positive(), z.null()])
});

export const modelCenterAgentOverrideSchema = modelCenterAgentOverrideFieldsSchema.extend({
  agentName: modelCenterAgentNameSchema
});

export const modelCenterSavedModelSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  providerLabel: z.union([z.string().trim(), z.null()]).default(null),
  notes: z.union([z.string().trim(), z.null()]).default(null),
  overrides: modelCenterAgentOverrideFieldsSchema.default({
    model: null,
    baseUrl: null,
    apiKey: null,
    reasoningEffort: null,
    wireApi: null,
    requestTimeoutMs: null
  })
});

export const modelCenterAgentBindingSchema = z.object({
  agentName: modelCenterAgentNameSchema,
  modelId: z.union([z.string().trim().min(1), z.null()]).default(null)
});

export const imageModelCenterOverrideSchema = z.object({
  imageAnalysisModel: z.union([z.string().trim().min(1), z.null()]).default(null),
  imageOcrModel: z.union([z.string().trim().min(1), z.null()]).default(null),
  imageOcrJudgeModel: z.union([z.string().trim().min(1), z.null()]).default(null),
  ollamaBaseUrl: z.union([z.string().trim().min(1), z.null()]).default(null),
  imageAnalysisTimeoutMs: z.union([z.number().int().positive(), z.null()]).default(null)
});

export const updateModelCenterSchema = z
  .object({
    agents: z.array(modelCenterAgentOverrideSchema).default([]),
    models: z.array(modelCenterSavedModelSchema).default([]),
    agentBindings: z.array(modelCenterAgentBindingSchema).default([]),
    imageRuntime: imageModelCenterOverrideSchema.default({})
  })
  .refine(
    (value) => new Set(value.agents.map((item) => item.agentName)).size === value.agents.length,
    "Agent overrides must be unique."
  )
  .refine(
    (value) => new Set(value.models.map((item) => item.id)).size === value.models.length,
    "Saved model ids must be unique."
  )
  .refine(
    (value) => new Set(value.agentBindings.map((item) => item.agentName)).size === value.agentBindings.length,
    "Agent bindings must be unique."
  );

export const modelCenterStoredConfigSchema = z.object({
  version: z.number().int().positive().default(2),
  updatedAt: z.union([z.string().trim().min(1), z.null()]).default(null),
  imageRuntime: imageModelCenterOverrideSchema.default({}),
  models: z.array(modelCenterSavedModelSchema).default([]),
  agentBindings: z.array(modelCenterAgentBindingSchema).default([]),
  agents: z.array(modelCenterAgentOverrideSchema).default([])
});

export const createPromptDraftSchema = z.object({
  label: z.string().min(1),
  content: z.string().min(1),
  notes: z.string().default("")
});

export const updatePromptDraftSchema = z
  .object({
    label: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    notes: z.string().optional()
  })
  .refine((value) => value.label !== undefined || value.content !== undefined || value.notes !== undefined, {
    message: "At least one draft field must be provided."
  });

export const promptTestRunSchema = z.object({
  promptSetName: promptSetNameSchema.optional(),
  promptVersionId: z.number().int().positive().optional(),
  input: z.record(z.any())
});

export const accountRecoveryActionSchema = z.object({
  accountId: z.number().int().positive(),
  publishJobId: z.number().int().positive().optional()
});

export const manualLoginContinueSchema = z.object({
  accountId: z.number().int().positive(),
  publishJobId: z.number().int().positive().optional()
});

export const createJobSchema = z.object({
  accountId: z.number().int().positive()
});

export const createAccountSchema = z.object({
  name: z.string().trim().min(1),
  zhihuUserName: z.union([z.string().trim().min(1), z.null()]).optional(),
  riskDomain: z.union([z.string().trim().min(1), z.null()]).optional()
});

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    zhihuUserName: z.union([z.string().trim().min(1), z.null()]).optional(),
    writerPromptVersionId: z.union([z.number().int().positive(), z.null()]).optional(),
    riskDomain: z.union([z.string().trim().min(1), z.null()]).optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.zhihuUserName !== undefined ||
      value.writerPromptVersionId !== undefined ||
      value.riskDomain !== undefined,
    {
      message: "At least one account field must be provided."
    }
  );

export const saveAccountSoulSchema = z.object({
  coreIdentity: z.string().default(""),
  targetReader: z.string().default(""),
  voiceTraits: z.array(z.string()).default([]),
  worldview: z.array(z.string()).default([]),
  proofAnchors: z.array(z.string()).default([]),
  signatureMoves: z.array(z.string()).default([]),
  productMentionPolicy: z.array(z.string()).default([]),
  hardBoundaries: z.array(z.string()).default([]),
  tabooLexicon: z.array(z.string()).default([]),
  exemplarLines: z.array(z.string()).default([]),
  updateReason: z.string().min(1).default("manual_edit")
});

export const zhihuNoteAgentGenerateSchema = z.object({
  mode: z.literal("zhihu_answer_style_learning"),
  sourceAccount: z.object({
    platform: z.literal("zhihu"),
    handleOrUrl: z.string().trim().min(1)
  }),
  sampleLimit: z.number().int().min(1).max(60).default(35),
  filterConfigVersion: z.string().trim().min(1).default("v1"),
  manualSeedTexts: z.array(z.string().trim().min(1)).optional()
});

const zhihuNoteAgentDocumentReadSchema = z.object({
  path: z.string().trim().min(1),
  label: z.string().trim().min(1),
  exists: z.boolean()
});

const zhihuNoteAgentValidationCheckSchema = z.object({
  label: z.string().trim().min(1),
  passed: z.boolean(),
  severity: z.enum(["error", "warning", "info"]),
  details: z.string()
});

const zhihuNoteAgentPhaseReportSchema = z.object({
  phase: z.enum([
    "collect_source_samples",
    "draft_soul_candidate",
    "apply_soul_candidate"
  ]),
  status: z.enum(["passed", "warning", "failed"]),
  startedAt: z.string().trim().min(1),
  finishedAt: z.string().trim().min(1),
  inputsRead: z.array(zhihuNoteAgentDocumentReadSchema),
  validationChecks: z.array(zhihuNoteAgentValidationCheckSchema),
  diagnostics: z.array(z.string())
});

const zhihuNoteAgentDraftSchema = z.object({
  accountId: z.number().int().positive(),
  accountKey: z.string().trim().min(1),
  matchedBy: z.enum(["accountId", "zhihuUserName", "accountName", "bootstrapped"]).nullable(),
  mode: z.literal("zhihu_answer_style_learning"),
  sourceAccount: z.object({
    platform: z.literal("zhihu"),
    handleOrUrl: z.string().trim().min(1),
    normalizedUserName: z.string().nullable(),
    profileUrl: z.string().nullable()
  }),
  summary: z.string(),
  diagnostics: z.array(z.string()),
  operatorNotes: z.array(z.string()),
  sampleQuality: z.enum(["strong", "ok", "weak", "insufficient"]),
  collectionSummary: z.object({
    requestedSampleSize: z.number().int().min(1),
    fetchedSampleCount: z.number().int().min(0),
    filteredOutCount: z.number().int().min(0),
    keptSampleCount: z.number().int().min(0),
    sampleQuality: z.enum(["strong", "ok", "weak", "insufficient"]),
    sourceHandle: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    collectionSucceeded: z.boolean(),
    browserDiagnostics: z.array(z.string()),
    filterReasonCounts: z.record(z.number().int().min(0))
  }),
  phaseReports: z.array(zhihuNoteAgentPhaseReportSchema),
  soulCandidateMarkdown: z.string(),
  samplePreview: z.array(
    z.object({
      answerUrl: z.string().nullable(),
      questionTitle: z.string(),
      createdAt: z.string().nullable(),
      excerpt: z.string(),
      text: z.string()
    })
  ),
  generatedAt: z.string().trim().min(1),
  sourcePaths: z.object({
    accountMapPath: z.string().trim().min(1),
    noteAgentAssetDir: z.string().trim().min(1),
    soulCandidatePath: z.string().trim().min(1)
  })
});

export const zhihuNoteAgentApplySchema = z.object({
  draft: zhihuNoteAgentDraftSchema,
  actions: z
    .object({
      saveSoulCandidate: z.boolean().optional()
    })
    .optional()
});

export const retryJobSchema = z.object({
  force: z.boolean().default(false)
});

export const reselectTopicSchema = z.object({
  reason: z.string().optional()
});

export const rescheduleJobSchema = z.object({
  scheduledAt: z.string().trim().min(1)
});

const imageAssetTypeSchema = z.enum(["meme", "illustration", "cover", "screenshot", "other"]);
const imagePlatformScopeSchema = z.enum(["zhihu", "x", "both", "unknown"]);
const imageUsageScopeSchema = z.enum(["zhihu_answer", "x_post", "cover", "reaction", "general"]);
const imageRiskLevelSchema = z.enum(["low", "medium", "high", "unknown"]);
const imageAssetStatusSchema = z.enum(["pending_review", "active", "disabled", "rejected"]);
const imageUsageTypeSchema = z.enum(["cover", "body_image", "reaction", "preview"]);
const imageSelectedBySchema = z.enum(["manual", "system"]);
const imageEntityCategorySchema = z.enum(["ip_character", "meme_archetype", "brand_mascot", "public_figure", "other"]);

const imageAnchorKeywordSchema = z.object({
  label: z.string().trim().min(1),
  confidence: z.number().int().min(0).max(100).optional()
});

const imageWeightedTagSchema = z.object({
  label: z.string().trim().min(1),
  confidence: z.number().int().min(0).max(100).optional(),
  importance: z.number().int().min(0).max(100).optional()
});

const imageEmotionTagSchema = z.object({
  label: z.string().trim().min(1),
  confidence: z.number().int().min(0).max(100).optional(),
  intensity: z.number().int().min(0).max(100).optional()
});

const imageEntityTagSchema = z.object({
  name: z.string().trim().min(1),
  category: imageEntityCategorySchema.optional(),
  confidence: z.number().int().min(0).max(100).optional()
});

export const createImageImportJobSchema = z.object({
  sourcePath: z.string().trim().min(1),
  sourceType: z.enum(["directory", "upload"]).default("directory")
});

export const updateImageAssetSchema = z
  .object({
    assetType: imageAssetTypeSchema.optional(),
    platformScope: imagePlatformScopeSchema.optional(),
    usageScope: imageUsageScopeSchema.optional(),
    ocrText: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    anchorKeyword: z.union([z.string().trim(), z.literal(""), z.null(), imageAnchorKeywordSchema]).optional(),
    captionShort: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    captionLong: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    manualCaption: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional(),
    entityTags: z.array(z.union([z.string().trim().min(1), imageEntityTagSchema])).optional(),
    topicTags: z.array(z.union([z.string().trim().min(1), imageWeightedTagSchema])).optional(),
    emotionTags: z.array(z.union([z.string().trim().min(1), imageEmotionTagSchema])).optional(),
    sceneTags: z.array(z.union([z.string().trim().min(1), imageWeightedTagSchema])).optional(),
    styleTags: z.array(z.union([z.string().trim().min(1), imageWeightedTagSchema])).optional(),
    riskLevel: imageRiskLevelSchema.optional(),
    riskNotes: z.union([z.string(), z.null()]).optional(),
    status: imageAssetStatusSchema.optional(),
    copyrightSource: z.union([z.string(), z.null()]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one image asset field must be provided."
  });

export const suggestImageAssetsSchema = z.object({
  query: z.string().default(""),
  platform: z.enum(["zhihu", "x"]).optional(),
  assetType: imageAssetTypeSchema.optional(),
  hasText: z.boolean().optional(),
  aspectRatio: z.enum(["landscape", "portrait", "square"]).optional(),
  riskLevel: imageRiskLevelSchema.optional(),
  usageType: imageUsageTypeSchema.optional(),
  contentTitle: z.string().optional(),
  contentText: z.string().optional(),
  preferredTags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).default(12)
});

export const createImageAssetUsageRecordSchema = z.object({
  assetId: z.string().trim().min(1),
  platform: z.enum(["zhihu", "x"]),
  accountId: z.union([z.string().trim().min(1), z.number().int().positive().transform(String), z.null()]).optional(),
  taskId: z.union([z.string().trim().min(1), z.number().int().positive().transform(String), z.null()]).optional(),
  contentId: z.union([z.string().trim().min(1), z.null()]).optional(),
  usageType: imageUsageTypeSchema.default("preview"),
  selectedBy: imageSelectedBySchema.default("manual"),
  note: z.union([z.string(), z.null()]).optional()
});

export const bindJobImageSchema = z.object({
  assetId: z.union([z.string().trim().min(1), z.null()]),
  usageType: imageUsageTypeSchema.default("cover"),
  note: z.union([z.string(), z.null()]).optional()
});

export type CreatePromptDraftInput = z.infer<typeof createPromptDraftSchema>;
export type UpdatePromptDraftInput = z.infer<typeof updatePromptDraftSchema>;
export type PromptTestRunInput = z.infer<typeof promptTestRunSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type ZhihuNoteAgentGenerateSchemaInput = z.infer<typeof zhihuNoteAgentGenerateSchema>;
export type ZhihuNoteAgentApplySchemaInput = z.infer<typeof zhihuNoteAgentApplySchema>;
export type RetryJobInput = z.infer<typeof retryJobSchema>;
export type ReselectTopicInput = z.infer<typeof reselectTopicSchema>;
export type RescheduleJobInput = z.infer<typeof rescheduleJobSchema>;
export type CreateImageImportJobInput = z.infer<typeof createImageImportJobSchema>;
export type UpdateImageAssetInput = z.infer<typeof updateImageAssetSchema>;
export type SuggestImageAssetsInput = z.infer<typeof suggestImageAssetsSchema>;
export type CreateImageAssetUsageRecordInput = z.infer<typeof createImageAssetUsageRecordSchema>;
export type BindJobImageInput = z.infer<typeof bindJobImageSchema>;
export type ImageModelCenterOverrideInput = z.infer<typeof imageModelCenterOverrideSchema>;
export type ModelCenterAgentOverrideFieldsInput = z.infer<typeof modelCenterAgentOverrideFieldsSchema>;
export type ModelCenterAgentOverrideInput = z.infer<typeof modelCenterAgentOverrideSchema>;
export type ModelCenterSavedModelInput = z.infer<typeof modelCenterSavedModelSchema>;
export type ModelCenterAgentBindingInput = z.infer<typeof modelCenterAgentBindingSchema>;
export type UpdateModelCenterSchemaInput = z.infer<typeof updateModelCenterSchema>;
export type ModelCenterStoredConfigInput = z.infer<typeof modelCenterStoredConfigSchema>;
