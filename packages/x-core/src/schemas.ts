import { z } from "zod";

const xPublishStyleRatiosSchema = z.object({
  casualNote: z.number().int().min(0).max(100).default(30),
  smallInsight: z.number().int().min(0).max(100).default(25),
  pitfallLog: z.number().int().min(0).max(100).default(15),
  toolMention: z.number().int().min(0).max(100).default(15),
  industryTalk: z.number().int().min(0).max(100).default(10),
  interactiveQa: z.number().int().min(0).max(100).default(5),
  quoteRepost: z.number().int().min(0).max(100).default(5)
});

export const createXAccountSchema = z.object({
  name: z.string().optional(),
  handle: z.string().min(1),
  persona: z.string().default(""),
  targetAudience: z.string().default(""),
  styleGuide: z.string().default(""),
  learningTargets: z.array(z.string()).default([]),
  manualNotes: z.string().default(""),
  profileDir: z.string().trim().min(1).optional(),
  proxyUrl: z.string().trim().min(1).nullable().optional(),
  status: z.enum(["active", "paused"]).default("active"),
  accessToken: z.string().trim().min(1).nullable().optional(),
  authStatus: z.enum(["ready", "login_required", "session_expired", "blocked"]).nullable().optional(),
  authStatusReason: z.string().trim().min(1).nullable().optional(),
  authCheckedAt: z.string().datetime().nullable().optional(),
  mainPromptVersionId: z.number().int().positive().nullable().optional(),
  writerPromptVersionId: z.number().int().positive().nullable().optional(),
  reviewPromptVersionId: z.number().int().positive().nullable().optional(),
  publishPromptVersionId: z.number().int().positive().nullable().optional(),
  writerPromptSource: z.enum(["main_agent", "database"]).default("main_agent"),
  publishStyleRatios: xPublishStyleRatiosSchema.default({
    casualNote: 30,
    smallInsight: 25,
    pitfallLog: 15,
    toolMention: 15,
    industryTalk: 10,
    interactiveQa: 5,
    quoteRepost: 5
  })
});

export const updateXAccountSchema = z.object({
  name: z.string().optional(),
  handle: z.string().min(1).optional(),
  persona: z.string().optional(),
  targetAudience: z.string().optional(),
  styleGuide: z.string().optional(),
  learningTargets: z.array(z.string()).optional(),
  manualNotes: z.string().optional(),
  profileDir: z.string().trim().min(1).optional(),
  proxyUrl: z.string().trim().min(1).nullable().optional(),
  status: z.enum(["active", "paused"]).optional(),
  accessToken: z.string().trim().min(1).nullable().optional(),
  authStatus: z.enum(["ready", "login_required", "session_expired", "blocked"]).nullable().optional(),
  authStatusReason: z.string().trim().min(1).nullable().optional(),
  authCheckedAt: z.string().datetime().nullable().optional(),
  mainPromptVersionId: z.number().int().positive().nullable().optional(),
  writerPromptVersionId: z.number().int().positive().nullable().optional(),
  reviewPromptVersionId: z.number().int().positive().nullable().optional(),
  publishPromptVersionId: z.number().int().positive().nullable().optional(),
  writerPromptSource: z.enum(["main_agent", "database"]).optional(),
  publishStyleRatios: xPublishStyleRatiosSchema.optional()
});

export const saveXAccountSoulSchema = z.object({
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

export const createXTaskSchema = z.object({
  accountId: z.string().min(1),
  title: z.string().min(1),
  brief: z.string().min(1),
  goal: z.string().default(""),
  preferredMode: z.enum(["auto", "single", "thread"]).default("auto"),
  scheduledAt: z.string().datetime().nullable().optional()
});

export const workerTickSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5)
});

const xHotspotSourceTypeSchema = z.enum(["news", "market", "watchlist"]);
const xHotspotStatusSchema = z.enum(["active", "ignored", "tasked", "expired"]);
const xHotspotWatchlistItemTypeSchema = z.enum(["x_account", "symbol", "keyword", "source"]);

export const scanXHotspotsSchema = z.object({
  sourceTypes: z.array(xHotspotSourceTypeSchema).default([]),
  force: z.boolean().default(false),
  includeResearch: z.boolean().default(true)
});

export const updateXHotspotSchema = z
  .object({
    status: xHotspotStatusSchema.optional()
  })
  .refine((value) => value.status !== undefined, {
    message: "At least one hotspot field must be provided."
  });

export const createXTaskFromHotspotSchema = z.object({
  accountId: z.string().min(1),
  preferredMode: z.enum(["auto", "single", "thread"]).default("auto"),
  forceResearch: z.boolean().default(false),
  title: z.string().trim().min(1).optional(),
  brief: z.string().trim().min(1).optional(),
  goal: z.string().default("")
});

export const createXHotspotWatchlistSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(""),
  enabled: z.boolean().default(true)
});

export const updateXHotspotWatchlistSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional()
  })
  .refine((value) => value.name !== undefined || value.description !== undefined || value.enabled !== undefined, {
    message: "At least one watchlist field must be provided."
  });

export const createXHotspotWatchlistItemSchema = z.object({
  type: xHotspotWatchlistItemTypeSchema,
  value: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).max(100).default(50),
  notes: z.string().default("")
});

export const updateXHotspotWatchlistItemSchema = z
  .object({
    label: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(1).max(100).optional(),
    notes: z.string().optional()
  })
  .refine(
    (value) => value.label !== undefined || value.enabled !== undefined || value.priority !== undefined || value.notes !== undefined,
    {
      message: "At least one watchlist item field must be provided."
    }
  );
