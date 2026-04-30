import { z } from "zod";
import {
  createXAccountSchema,
  saveXAccountSoulSchema,
  updateXAccountSchema,
  workerTickSchema
} from "@zhihu-mvp/x-core";

export const createXTraditionalAccountSchema = createXAccountSchema.extend({
  writerPromptSource: z.enum(["main_agent", "database"]).default("database")
});

export const updateXTraditionalAccountSchema = updateXAccountSchema.extend({
  writerPromptSource: z.enum(["main_agent", "database"]).optional()
});

export const createXTraditionalTaskSchema = z.object({
  accountId: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  brief: z.string().trim().min(1).optional(),
  goal: z.string().trim().default(""),
  preferredMode: z.enum(["auto", "single", "thread"]).default("auto"),
  scheduledAt: z.string().datetime().nullable().optional()
});

export const xTraditionalNoteAgentGenerateSchema = z.object({
  mode: z.literal("style_learning"),
  sourceAccount: z.object({
    platform: z.literal("x"),
    handleOrUrl: z.string().trim().min(1)
  }),
  collection: z.object({
    sampleSize: z.number().int().min(1).max(120).default(40),
    lookbackDays: z.number().int().min(1).max(365).default(90),
    includeReplies: z.boolean().default(false)
  }),
  manualSeedTexts: z.array(z.string()).optional()
});

const xTraditionalNoteAgentDocumentReadSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1),
  exists: z.boolean()
});

const xTraditionalNoteAgentValidationCheckSchema = z.object({
  label: z.string().min(1),
  passed: z.boolean(),
  severity: z.enum(["error", "warning", "info"]),
  details: z.string()
});

const xTraditionalNoteAgentPhaseReportSchema = z.object({
  phase: z.enum(["collect_source_samples", "distill_style_profile", "draft_account_assets", "apply_account_assets"]),
  status: z.enum(["passed", "warning", "failed"]),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  inputsRead: z.array(xTraditionalNoteAgentDocumentReadSchema),
  validationChecks: z.array(xTraditionalNoteAgentValidationCheckSchema),
  diagnostics: z.array(z.string())
});

const xTraditionalNoteAgentDraftSchema = z.object({
  accountId: z.string().min(1),
  accountKey: z.string().min(1),
  matchedBy: z.string().nullable(),
  mode: z.literal("style_learning"),
  sourceAccount: z.object({
    platform: z.literal("x"),
    handleOrUrl: z.string().min(1),
    normalizedHandle: z.string().nullable(),
    profileUrl: z.string().nullable()
  }),
  summary: z.string(),
  diagnostics: z.array(z.string()),
  operatorNotes: z.array(z.string()),
  collectionSummary: z.object({
    requestedSampleSize: z.number().int().min(1),
    lookbackDays: z.number().int().min(1),
    includeReplies: z.boolean(),
    timelineRequestedCount: z.number().int().min(1),
    timelineRawSampleCount: z.number().int().min(0),
    timelineSampleCount: z.number().int().min(0),
    focusFilteredCount: z.number().int().min(0),
    manualSeedCount: z.number().int().min(0),
    collectedSampleCount: z.number().int().min(0),
    browserCollectionSucceeded: z.boolean(),
    sourceHandle: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    browserDiagnostics: z.array(z.string())
  }),
  phaseReports: z.array(xTraditionalNoteAgentPhaseReportSchema),
  learnedStyleProfileMarkdown: z.string(),
  soulCandidateMarkdown: z.string(),
  styleRulesMarkdown: z.string(),
  numberExpressionRulesMarkdown: z.string(),
  reviewRubricMarkdown: z.string(),
  learnedSamplesJsonl: z.string(),
  sourceMapYaml: z.string(),
  samplePreview: z.array(
    z.object({
      source: z.enum(["timeline", "manual_seed"]),
      text: z.string(),
      publishedAt: z.string().nullable(),
      tweetUrl: z.string().nullable()
    })
  ),
  generatedAt: z.string().min(1),
  sourcePaths: z.object({
    readme: z.string().min(1),
    accountConfigDir: z.string().min(1),
    ragLibraryDir: z.string().min(1),
    soulCandidatePath: z.string().min(1),
    noteAgentAssetDir: z.string().min(1)
  })
});

export const xTraditionalNoteAgentApplySchema = z.object({
  draft: xTraditionalNoteAgentDraftSchema,
  actions: z
    .object({
      writeRagDocs: z.boolean().optional(),
      saveSoulCandidate: z.boolean().optional(),
      saveLearnedAssets: z.boolean().optional()
    })
    .optional()
});

export {
  saveXAccountSoulSchema,
  workerTickSchema
};
