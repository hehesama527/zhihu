import { fetchTwitterTraditionalClientResponse } from "./http";
import type {
  CreateTwitterAccountInput,
  SaveTwitterAccountSoulInput,
  TwitterAccount,
  TwitterAccountSoulDocument,
  TwitterPromptDetail,
  TwitterTask,
  TwitterWorkerTickSummary,
  UpdateTwitterAccountInput
} from "./api";

export type TwitterTraditionalHealth = {
  ok: boolean;
  service: "x-traditional-api";
  module: "x-traditional";
  publishMode: "dry_run" | "browser" | string;
  dataDir: string;
};

export type TwitterTraditionalPromptCategory = "main" | "writing" | "review" | "publish" | "note";

export type TwitterTraditionalPrompt = Omit<TwitterPromptDetail, "category" | "versions" | "testRuns"> & {
  category: TwitterTraditionalPromptCategory;
};

export type TwitterTraditionalPromptDetail = Omit<TwitterPromptDetail, "category"> & {
  category: TwitterTraditionalPromptCategory;
};

export type CreateTwitterTraditionalTaskInput = {
  accountId: string;
  title?: string;
  brief?: string;
  goal?: string;
  preferredMode?: "auto" | "single" | "thread";
  scheduledAt?: string | null;
};

export type CreateTwitterTraditionalPromptInput = {
  name: string;
  description?: string;
  category: TwitterTraditionalPromptCategory;
  template: string;
  isActive?: boolean;
};

export type UpdateTwitterTraditionalPromptInput = Partial<{
  name: string;
  description: string;
  template: string;
  isActive: boolean;
}>;

export type RunTwitterTraditionalTaskAction = "run_now" | "reschedule" | "retry";

export type TwitterTraditionalNoteAgentMode = "style_learning";
export type TwitterTraditionalNoteAgentPhase =
  | "collect_source_samples"
  | "distill_style_profile"
  | "draft_account_assets"
  | "apply_account_assets";
export type TwitterTraditionalNoteAgentPhaseStatus = "passed" | "warning" | "failed";

export type TwitterTraditionalNoteAgentSourceAccountInput = {
  platform: "x";
  handleOrUrl: string;
};

export type TwitterTraditionalNoteAgentSourceAccount = TwitterTraditionalNoteAgentSourceAccountInput & {
  normalizedHandle: string | null;
  profileUrl: string | null;
};

export type TwitterTraditionalNoteAgentCollectionInput = {
  sampleSize: number;
  lookbackDays: number;
  includeReplies: boolean;
};

export type TwitterTraditionalNoteAgentDocumentRead = {
  path: string;
  label: string;
  exists: boolean;
};

export type TwitterTraditionalNoteAgentValidationCheck = {
  label: string;
  passed: boolean;
  severity: "error" | "warning" | "info";
  details: string;
};

export type TwitterTraditionalNoteAgentPhaseReport = {
  phase: TwitterTraditionalNoteAgentPhase;
  status: TwitterTraditionalNoteAgentPhaseStatus;
  startedAt: string;
  finishedAt: string;
  inputsRead: TwitterTraditionalNoteAgentDocumentRead[];
  validationChecks: TwitterTraditionalNoteAgentValidationCheck[];
  diagnostics: string[];
};

export type TwitterTraditionalNoteAgentCollectionSummary = {
  requestedSampleSize: number;
  lookbackDays: number;
  includeReplies: boolean;
  timelineRequestedCount: number;
  timelineRawSampleCount: number;
  timelineSampleCount: number;
  focusFilteredCount: number;
  manualSeedCount: number;
  collectedSampleCount: number;
  browserCollectionSucceeded: boolean;
  sourceHandle: string | null;
  sourceUrl: string | null;
  browserDiagnostics: string[];
};

export type TwitterTraditionalNoteAgentSamplePreviewItem = {
  source: "timeline" | "manual_seed";
  text: string;
  publishedAt: string | null;
  tweetUrl: string | null;
};

export type TwitterTraditionalNoteAgentGenerateInput = {
  mode: TwitterTraditionalNoteAgentMode;
  sourceAccount: TwitterTraditionalNoteAgentSourceAccountInput;
  collection: TwitterTraditionalNoteAgentCollectionInput;
  manualSeedTexts?: string[];
};

export type TwitterTraditionalNoteAgentDraft = {
  accountId: string;
  accountKey: string;
  matchedBy: string | null;
  mode: TwitterTraditionalNoteAgentMode;
  sourceAccount: TwitterTraditionalNoteAgentSourceAccount;
  summary: string;
  diagnostics: string[];
  operatorNotes: string[];
  collectionSummary: TwitterTraditionalNoteAgentCollectionSummary;
  phaseReports: TwitterTraditionalNoteAgentPhaseReport[];
  learnedStyleProfileMarkdown: string;
  soulCandidateMarkdown: string;
  styleRulesMarkdown: string;
  numberExpressionRulesMarkdown: string;
  reviewRubricMarkdown: string;
  learnedSamplesJsonl: string;
  sourceMapYaml: string;
  samplePreview: TwitterTraditionalNoteAgentSamplePreviewItem[];
  generatedAt: string;
  sourcePaths: {
    readme: string;
    accountConfigDir: string;
    ragLibraryDir: string;
    soulCandidatePath: string;
    noteAgentAssetDir: string;
  };
};

export type TwitterTraditionalNoteAgentApplyActions = {
  writeRagDocs: boolean;
  saveSoulCandidate: boolean;
  saveLearnedAssets: boolean;
};

export type ApplyTwitterTraditionalNoteAgentInput = {
  draft: TwitterTraditionalNoteAgentDraft;
  actions?: Partial<TwitterTraditionalNoteAgentApplyActions>;
};

export type ApplyTwitterTraditionalNoteAgentResult = {
  accountId: string;
  accountKey: string;
  appliedAt: string;
  writtenPaths: string[];
  actionsApplied: TwitterTraditionalNoteAgentApplyActions;
  phaseReport: TwitterTraditionalNoteAgentPhaseReport;
};

export class TwitterTraditionalApiError<TDetails = unknown> extends Error {
  code?: string;
  details?: TDetails;

  constructor(message: string, options?: { code?: string; details?: TDetails }) {
    super(message);
    this.name = "TwitterTraditionalApiError";
    this.code = options?.code;
    this.details = options?.details;
  }
}

async function twitterTraditionalApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { response, text, payload } = await fetchTwitterTraditionalClientResponse(path, init);

  if (!response.ok) {
    const errorMessage =
      typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message ?? "")
        : text || `X traditional API request failed: ${response.status}`;
    throw new TwitterTraditionalApiError(errorMessage, {
      details: payload
    });
  }

  return payload as T;
}

function jsonRequest(method: "POST" | "PATCH" | "PUT", body?: unknown): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body ?? {})
  };
}

export async function getTwitterTraditionalHealth() {
  return twitterTraditionalApiFetch<TwitterTraditionalHealth>("/health");
}

export async function getTwitterTraditionalAccounts() {
  const data = await twitterTraditionalApiFetch<{ accounts: TwitterAccount[] }>("/accounts");
  return data.accounts;
}

export async function createTwitterTraditionalAccount(input: CreateTwitterAccountInput) {
  const data = await twitterTraditionalApiFetch<{ ok: boolean; account: TwitterAccount }>(
    "/accounts",
    jsonRequest("POST", {
      ...input,
      writerPromptSource: "database"
    })
  );

  return data.account;
}

export async function updateTwitterTraditionalAccount(accountId: string, patch: UpdateTwitterAccountInput) {
  const data = await twitterTraditionalApiFetch<{ ok: boolean; account: TwitterAccount }>(
    `/accounts/${accountId}`,
    jsonRequest("PATCH", {
      ...patch,
      writerPromptSource: "database"
    })
  );

  return data.account;
}

export async function getTwitterTraditionalAccountSoul(accountId: string) {
  const data = await twitterTraditionalApiFetch<{
    account: TwitterAccount;
    soulDocument: TwitterAccountSoulDocument;
  }>(`/accounts/${accountId}/soul`);

  return data.soulDocument;
}

export async function saveTwitterTraditionalAccountSoul(accountId: string, input: SaveTwitterAccountSoulInput) {
  const data = await twitterTraditionalApiFetch<{
    ok: boolean;
    soulDocument: TwitterAccountSoulDocument;
  }>(`/accounts/${accountId}/soul`, jsonRequest("PUT", input));

  return data.soulDocument;
}

export async function getTwitterTraditionalTasks(accountId?: string | null) {
  const path = accountId ? `/tasks?${new URLSearchParams({ accountId }).toString()}` : "/tasks";
  const data = await twitterTraditionalApiFetch<{ tasks: TwitterTask[] }>(path);
  return data.tasks;
}

export async function getTwitterTraditionalTask(taskId: string) {
  const data = await twitterTraditionalApiFetch<{ task: TwitterTask | null }>(`/tasks/${taskId}`);
  return data.task;
}

export async function createTwitterTraditionalTask(input: CreateTwitterTraditionalTaskInput) {
  const data = await twitterTraditionalApiFetch<{ ok: boolean; task: TwitterTask }>(
    "/tasks",
    jsonRequest("POST", input)
  );

  return data.task;
}

export async function runTwitterTraditionalTaskNow(taskId: string) {
  const data = await twitterTraditionalApiFetch<{
    ok: boolean;
    result: {
      task: TwitterTask;
      published: boolean;
      blocked: boolean;
      skipped: boolean;
    };
  }>(`/tasks/${taskId}/run-now`, jsonRequest("POST"));

  return data.result;
}

export async function runTwitterTraditionalWorkerTick(limit = 5) {
  const data = await twitterTraditionalApiFetch<{ summary: TwitterWorkerTickSummary }>(
    "/worker/tick",
    jsonRequest("POST", { limit })
  );

  return data.summary;
}

export async function getTwitterTraditionalPrompts() {
  const data = await twitterTraditionalApiFetch<{ prompts: TwitterTraditionalPrompt[] }>("/prompts");
  return data.prompts;
}

export async function getTwitterTraditionalPrompt(id: string) {
  const data = await twitterTraditionalApiFetch<{ prompt: TwitterTraditionalPromptDetail }>(`/prompts/${id}`);
  return data.prompt;
}

export async function createTwitterTraditionalPrompt(input: CreateTwitterTraditionalPromptInput) {
  const data = await twitterTraditionalApiFetch<{
    ok: boolean;
    prompt: TwitterTraditionalPromptDetail;
  }>("/prompts", jsonRequest("POST", input));

  return data.prompt;
}

export async function updateTwitterTraditionalPrompt(id: string, patch: UpdateTwitterTraditionalPromptInput) {
  const data = await twitterTraditionalApiFetch<{
    ok: boolean;
    prompt: TwitterTraditionalPromptDetail;
  }>(`/prompts/${id}`, jsonRequest("PATCH", patch));

  return data.prompt;
}

export async function testTwitterTraditionalPrompt(id: string, input: Record<string, unknown>) {
  const data = await twitterTraditionalApiFetch<{ ok: boolean; result: string }>(
    `/prompts/${id}/test`,
    jsonRequest("POST", { input })
  );

  return data.result;
}

export async function activateTwitterTraditionalPromptVersion(versionId: number) {
  const data = await twitterTraditionalApiFetch<{
    ok: boolean;
    prompt: TwitterTraditionalPromptDetail;
  }>(`/prompts/versions/${versionId}/activate`, jsonRequest("POST"));

  return data.prompt;
}

export async function generateTwitterTraditionalNoteAgentDraft(
  accountId: string,
  input: TwitterTraditionalNoteAgentGenerateInput
) {
  const data = await twitterTraditionalApiFetch<{
    ok: boolean;
    draft: TwitterTraditionalNoteAgentDraft;
  }>(`/accounts/${accountId}/note-agent/generate`, jsonRequest("POST", input));

  return data.draft;
}

export async function applyTwitterTraditionalNoteAgentDraft(
  accountId: string,
  input: ApplyTwitterTraditionalNoteAgentInput
) {
  const data = await twitterTraditionalApiFetch<{
    ok: true;
    result: ApplyTwitterTraditionalNoteAgentResult;
  }>(`/accounts/${accountId}/note-agent/apply`, jsonRequest("POST", input));

  return data.result;
}

export async function runTwitterTraditionalTask(
  taskId: string,
  action: RunTwitterTraditionalTaskAction,
  options?: { scheduledAt?: string }
) {
  const data = await twitterTraditionalApiFetch<{ ok: boolean; task: TwitterTask | null }>(
    `/tasks/${taskId}/run`,
    jsonRequest("POST", {
      action,
      scheduledAt: options?.scheduledAt
    })
  );

  if (!data.task) {
    throw new TwitterTraditionalApiError("X traditional task action failed.", {
      details: data
    });
  }

  return data.task;
}
