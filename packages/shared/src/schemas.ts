import { z } from "zod";

export const promptSetNameSchema = z.enum([
  "topic_agent",
  "writer_agent",
  "review_agent",
  "publish_agent"
]);

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
  accountId: z.number().int().positive().default(1)
});

export const retryJobSchema = z.object({
  force: z.boolean().default(false)
});

export const reselectTopicSchema = z.object({
  reason: z.string().optional()
});

export type CreatePromptDraftInput = z.infer<typeof createPromptDraftSchema>;
export type UpdatePromptDraftInput = z.infer<typeof updatePromptDraftSchema>;
export type PromptTestRunInput = z.infer<typeof promptTestRunSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type RetryJobInput = z.infer<typeof retryJobSchema>;
export type ReselectTopicInput = z.infer<typeof reselectTopicSchema>;
