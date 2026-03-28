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
  accountId: z.number().int().positive()
});

export const createAccountSchema = z.object({
  name: z.string().trim().min(1),
  zhihuUserName: z.union([z.string().trim().min(1), z.null()]).optional()
});

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    zhihuUserName: z.union([z.string().trim().min(1), z.null()]).optional(),
    writerPromptVersionId: z.union([z.number().int().positive(), z.null()]).optional()
  })
  .refine(
    (value) =>
      value.name !== undefined || value.zhihuUserName !== undefined || value.writerPromptVersionId !== undefined,
    {
    message: "At least one account field must be provided."
    }
  );

export const retryJobSchema = z.object({
  force: z.boolean().default(false)
});

export const reselectTopicSchema = z.object({
  reason: z.string().optional()
});

export const rescheduleJobSchema = z.object({
  scheduledAt: z.string().trim().min(1)
});

export type CreatePromptDraftInput = z.infer<typeof createPromptDraftSchema>;
export type UpdatePromptDraftInput = z.infer<typeof updatePromptDraftSchema>;
export type PromptTestRunInput = z.infer<typeof promptTestRunSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type RetryJobInput = z.infer<typeof retryJobSchema>;
export type ReselectTopicInput = z.infer<typeof reselectTopicSchema>;
export type RescheduleJobInput = z.infer<typeof rescheduleJobSchema>;
