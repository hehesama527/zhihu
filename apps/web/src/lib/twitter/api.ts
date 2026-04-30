import { postImageJson } from "../api";
import { fetchHotspotClientResponse } from "../hotspots/http";
import { fetchTwitterClientResponse } from "./http";

export type TwitterAccount = {
  id: string;
  name: string;
  handle: string;
  persona: string;
  targetAudience: string;
  styleGuide: string;
  learningTargets: string[];
  manualNotes: string;
  profileDir: string;
  proxyUrl: string | null;
  status: "active" | "paused";
  authStatus: "ready" | "login_required" | "session_expired" | "blocked" | null;
  authStatusReason: string | null;
  authCheckedAt: string | null;
  mainPromptVersionId: number | null;
  writerPromptVersionId: number | null;
  reviewPromptVersionId: number | null;
  publishPromptVersionId: number | null;
  writerPromptSource: "main_agent" | "database";
  publishStyleRatios: TwitterPublishStyleRatios;
  lastPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TwitterPublishStyleRatios = {
  casualNote: number;
  smallInsight: number;
  pitfallLog: number;
  toolMention: number;
  industryTalk: number;
  interactiveQa: number;
  quoteRepost: number;
};

export type TwitterHotspotPriority = "P0" | "P1" | "P2" | "DROP";
export type TwitterHotspotStatus = "active" | "ignored" | "tasked" | "expired";
export type TwitterHotspotResearchStatus = "pending" | "running" | "completed" | "failed" | "not_needed";
export type TwitterHotspotSourceType = "news" | "market" | "watchlist";
export type TwitterHotspotWatchlistItemType = "x_account" | "symbol" | "keyword" | "source";

export type TwitterHotspot = {
  id: number;
  hotspotKey: string;
  title: string;
  summaryText: string;
  sourceType: TwitterHotspotSourceType;
  topicType: string;
  symbols: string[];
  keywords: string[];
  matchedWatchlistValues: string[];
  canonicalUrl: string | null;
  score: number;
  priority: TwitterHotspotPriority;
  status: TwitterHotspotStatus;
  researchStatus: TwitterHotspotResearchStatus;
  sourceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  eventTime: string | null;
  expiresAt: string;
  taskLinkedAt: string | null;
  researchSummaryText: string | null;
  researchUpdatedAt: string | null;
  suggestedTaskTitle: string | null;
  suggestedTaskBrief: string | null;
  angles: string[];
  risks: string[];
  createdAt: string;
  updatedAt: string;
};

export type TwitterHotspotSource = {
  id: number;
  hotspotId: number;
  sourceHash: string;
  sourceType: TwitterHotspotSourceType;
  sourceLabel: string;
  sourceUrl: string | null;
  title: string;
  summaryText: string;
  rawPayloadJson: string | null;
  eventTime: string | null;
  detectedAt: string;
  scoreDelta: number;
  createdAt: string;
};

export type TwitterHotspotResearchRun = {
  id: number;
  hotspotId: number;
  status: "completed" | "failed";
  summary: string;
  whyNow: string;
  recommendedAction: "create_task" | "watch" | "ignore";
  suggestedTaskTitle: string;
  suggestedTaskBrief: string;
  angles: string[];
  risks: string[];
  operatorHints: string[];
  rawOutputJson: string | null;
  errorText: string | null;
  createdAt: string;
};

export type TwitterHotspotTaskLink = {
  id: number;
  hotspotId: number | null;
  taskId: string;
  accountId: string;
  accountHandle: string;
  snapshotJson: string;
  createdAt: string;
};

export type TwitterHotspotDetail = TwitterHotspot & {
  sources: TwitterHotspotSource[];
  latestResearchRun: TwitterHotspotResearchRun | null;
  taskLinks: TwitterHotspotTaskLink[];
};

export type TwitterHotspotWatchlistItem = {
  id: number;
  watchlistId: number;
  type: TwitterHotspotWatchlistItemType;
  value: string;
  label: string;
  enabled: boolean;
  priority: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type TwitterHotspotWatchlist = {
  id: number;
  name: string;
  description: string;
  scope: "global";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  items: TwitterHotspotWatchlistItem[];
};

export type TwitterHotspotScanRun = {
  id: number;
  sourceType: TwitterHotspotSourceType;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  summaryText: string | null;
  createdCount: number;
  updatedCount: number;
  researchCount: number;
  errorText: string | null;
};

export type TwitterHotspotScanSummary = {
  triggeredSources: TwitterHotspotSourceType[];
  skippedSources: TwitterHotspotSourceType[];
  createdCount: number;
  updatedCount: number;
  researchCount: number;
  ignoredCount: number;
  runs: TwitterHotspotScanRun[];
};

export type TwitterAccountSoulDocument = {
  accountId: string;
  version: number;
  coreIdentity: string;
  targetReader: string;
  voiceTraits: string[];
  worldview: string[];
  proofAnchors: string[];
  signatureMoves: string[];
  productMentionPolicy: string[];
  hardBoundaries: string[];
  tabooLexicon: string[];
  exemplarLines: string[];
  markdown: string;
  lastUpdatedAt: string;
  updatedBy: "llm" | "user";
  updateReason: string;
  userEditedAt: string | null;
};

export type TwitterDraftPack = {
  summary: string;
  posts: string[];
  notes: string[];
};

export type TwitterReviewAgentVerdict = "pass" | "minor_issue" | "major_issue" | "block";

export type TwitterReviewAgentResult = {
  verdict: TwitterReviewAgentVerdict;
  summary: string;
  strengths: string[];
  issues: string[];
  riskFlags: string[];
  suggestedFixes: string[];
};

export type TwitterReviewResult = {
  decision: "approve" | "revise" | "block";
  reason: string;
  revisionInstructions: string[];
  qualityNotes: string[];
};

export type TwitterMainAgentDecision = {
  decision: "write" | "revise" | "approve_publish" | "defer" | "block";
  reason: string;
  shouldWrite: boolean;
  shouldPublish: boolean;
  preferredMode: "single" | "thread";
  publishAction: "post" | "reply" | "quote";
  contentStyle:
    | "casual_note"
    | "small_insight"
    | "pitfall_log"
    | "tool_mention"
    | "industry_talk"
    | "interactive_qa"
    | "quote_repost";
  useHotspot: boolean;
  selectedHotspotIds: number[];
  targetTweetUrl: string | null;
  targetTweetReason: string;
  runtimeWriterPrompt: string;
  cadence: "single_now" | "thread_continuous_now" | "defer";
  deferMinutes: number;
  writerBrief: {
    angle: string;
    goal: string;
    mustInclude: string[];
    mustAvoid: string[];
    openingDirection: string;
    threadPlan: string;
  };
  revisionInstructions: string[];
  qualityNotes: string[];
  publishNotes: string[];
};

export type TwitterPublishPlan = {
  shouldPublish: boolean;
  mode: "single" | "thread";
  action: "post" | "reply" | "quote";
  contentStyle:
    | "casual_note"
    | "small_insight"
    | "pitfall_log"
    | "tool_mention"
    | "industry_talk"
    | "interactive_qa"
    | "quote_repost";
  cadence: "single_now" | "thread_continuous_now" | "defer";
  deferMinutes: number;
  targetTweetUrl: string | null;
  selectedHotspotIds: number[];
  reason: string;
};

export type TwitterPublishResult = {
  transport: "dry_run" | "browser";
  tweetIds: string[];
  urls: string[];
  publishedAt: string;
  note: string;
};

export type TwitterTask = {
  id: string;
  accountId: string;
  imageAssetId: string | null;
  title: string;
  brief: string;
  goal: string;
  preferredMode: "auto" | "single" | "thread";
  status: string;
  currentStage: string;
  soulVersion: number | null;
  soulMarkdownSnapshot: string | null;
  draftPack: TwitterDraftPack | null;
  mainAgentPlan: TwitterMainAgentDecision | null;
  reviewAgentResult: TwitterReviewAgentResult | null;
  reviewResult: TwitterReviewResult | null;
  publishPlan: TwitterPublishPlan | null;
  publishResult: TwitterPublishResult | null;
  revisionCount: number;
  scheduledAt: string | null;
  failureStage: "writing" | "review" | "publish" | "unknown" | null;
  failureType:
    | "llm_error"
    | "invalid_output"
    | "proxy_error"
    | "browser_error"
    | "publish_error"
    | "unknown_error"
    | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TwitterWorkerTickSummary = {
  processedTaskIds: string[];
  publishedTaskIds: string[];
  blockedTaskIds: string[];
};

export type TwitterPrompt = {
  id: string;
  name: string;
  description: string;
  category: "main" | "writing" | "review" | "publish";
  template: string;
  variables: string[];
  isActive: boolean;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TwitterPromptVersion = {
  id: number;
  setName: string;
  version: number;
  status: "draft" | "active" | "archived";
  label: string;
  notes: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type TwitterPromptTestRun = {
  id: number;
  promptVersionId: number;
  createdAt: string;
  inputJson: string;
  outputJson: string | null;
  errorText: string | null;
};

export type TwitterPromptDetail = TwitterPrompt & {
  setName: string;
  variables: string[];
  activeVersionId: number | null;
  activeVersion: number | null;
  activeLabel: string | null;
  versionCount: number;
  versions: TwitterPromptVersion[];
  testRuns: TwitterPromptTestRun[];
};

export type TwitterAccountPromptPanel = {
  category: "main" | "writing";
  prompt: TwitterPromptDetail;
  boundVersionId: number | null;
  boundVersion: TwitterPromptVersion | null;
  accountVersions: TwitterPromptVersion[];
};

export type CreateTwitterAccountInput = {
  name: string;
  handle: string;
  persona: string;
  targetAudience: string;
  styleGuide: string;
  learningTargets: string[];
  manualNotes: string;
  profileDir?: string;
  proxyUrl?: string | null;
  status: "active" | "paused";
  writerPromptSource?: "main_agent" | "database";
  publishStyleRatios?: TwitterPublishStyleRatios;
};

export type UpdateTwitterAccountInput = Partial<{
  name: string;
  handle: string;
  persona: string;
  targetAudience: string;
  styleGuide: string;
  learningTargets: string[];
  manualNotes: string;
  profileDir: string;
  proxyUrl: string | null;
  status: "active" | "paused";
  mainPromptVersionId: number | null;
  writerPromptVersionId: number | null;
  reviewPromptVersionId: number | null;
  publishPromptVersionId: number | null;
  writerPromptSource: "main_agent" | "database";
  publishStyleRatios: TwitterPublishStyleRatios;
}>;

export type SaveTwitterAccountSoulInput = {
  coreIdentity: string;
  targetReader: string;
  voiceTraits: string[];
  worldview: string[];
  proofAnchors: string[];
  signatureMoves: string[];
  productMentionPolicy: string[];
  hardBoundaries: string[];
  tabooLexicon: string[];
  exemplarLines: string[];
  updateReason?: string;
};

export type CreateTwitterTaskInput = {
  accountId: string;
  title: string;
  brief: string;
  goal: string;
  preferredMode: "auto" | "single" | "thread";
};

export type CreateTwitterTaskFromHotspotInput = {
  accountId: string;
  preferredMode: "auto" | "single" | "thread";
  forceResearch: boolean;
  title?: string;
  brief?: string;
  goal?: string;
};

export class TwitterApiError<TDetails = unknown> extends Error {
  code?: string;
  details?: TDetails;

  constructor(message: string, options?: { code?: string; details?: TDetails }) {
    super(message);
    this.name = "TwitterApiError";
    this.code = options?.code;
    this.details = options?.details;
  }
}

async function twitterApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { response, text, payload } = await fetchTwitterClientResponse(path, init);

  if (!response.ok) {
    const errorMessage =
      typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message ?? "")
        : text || `Twitter / X 接口请求失败：${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

async function twitterHotspotApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { response, text, payload } = await fetchHotspotClientResponse(path, init);

  if (!response.ok) {
    const errorMessage =
      typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message ?? "")
        : text || `Hotspot center request failed: ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

export async function getTwitterAccounts() {
  const data = await twitterApiFetch<{ accounts: TwitterAccount[] }>("/accounts");
  return data.accounts;
}

export async function createTwitterAccount(input: CreateTwitterAccountInput) {
  const data = await twitterApiFetch<{ ok: boolean; account: TwitterAccount }>("/accounts", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data.account;
}

export async function updateTwitterAccount(accountId: string, patch: UpdateTwitterAccountInput) {
  const data = await twitterApiFetch<{ ok: boolean; account: TwitterAccount }>(`/accounts/${accountId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  return data.account;
}

export async function getTwitterAccountSoul(accountId: string) {
  const data = await twitterApiFetch<{
    account: TwitterAccount;
    soulDocument: TwitterAccountSoulDocument;
  }>(`/accounts/${accountId}/soul`);

  return data.soulDocument;
}

export async function saveTwitterAccountSoul(accountId: string, input: SaveTwitterAccountSoulInput) {
  const data = await twitterApiFetch<{ ok: boolean; soulDocument: TwitterAccountSoulDocument }>(`/accounts/${accountId}/soul`, {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data.soulDocument;
}

export async function getTwitterTasks(accountId?: string | null) {
  const path = accountId ? `/tasks?${new URLSearchParams({ accountId }).toString()}` : "/tasks";
  const data = await twitterApiFetch<{ tasks: TwitterTask[] }>(path);
  return data.tasks;
}

export async function createTwitterTask(input: CreateTwitterTaskInput) {
  const data = await twitterApiFetch<{ ok: boolean; task: TwitterTask }>("/tasks", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data.task;
}

export async function runTwitterTaskNow(taskId: string) {
  const data = await twitterApiFetch<{ ok: boolean; result: { task: TwitterTask } }>(`/tasks/${taskId}/run-now`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    }
  });

  return data.result;
}

export async function runTwitterWorkerTick(limit = 5) {
  const data = await twitterApiFetch<{ summary: TwitterWorkerTickSummary }>("/worker/tick", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      limit
    })
  });

  return data.summary;
}

export async function getTwitterHotspots(filters?: {
  priority?: TwitterHotspotPriority | null;
  status?: TwitterHotspotStatus | null;
  sourceType?: TwitterHotspotSourceType | null;
  includeExpired?: boolean;
}) {
  const params = new URLSearchParams();
  if (filters?.priority) {
    params.set("priority", filters.priority);
  }
  if (filters?.status) {
    params.set("status", filters.status);
  }
  if (filters?.sourceType) {
    params.set("sourceType", filters.sourceType);
  }
  if (filters?.includeExpired) {
    params.set("includeExpired", "true");
  }

  const path = params.toString() ? `/hotspots?${params.toString()}` : "/hotspots";
  const data = await twitterHotspotApiFetch<{ hotspots: TwitterHotspot[] }>(path);
  return data.hotspots;
}

export async function getTwitterHotspot(hotspotId: number) {
  const data = await twitterHotspotApiFetch<{ hotspot: TwitterHotspotDetail }>(`/hotspots/${hotspotId}`);
  return data.hotspot;
}

export async function scanTwitterHotspots(input?: {
  sourceTypes?: TwitterHotspotSourceType[];
  force?: boolean;
  includeResearch?: boolean;
}) {
  const data = await twitterHotspotApiFetch<{ ok: boolean; summary: TwitterHotspotScanSummary }>("/hotspots/scan", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sourceTypes: input?.sourceTypes ?? [],
      force: input?.force ?? false,
      includeResearch: input?.includeResearch ?? true
    })
  });

  return data.summary;
}

export async function runTwitterHotspotResearch(hotspotId: number) {
  const data = await twitterHotspotApiFetch<{ ok: boolean; hotspot: TwitterHotspotDetail }>(`/hotspots/${hotspotId}/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    }
  });

  return data.hotspot;
}

export async function updateTwitterHotspot(hotspotId: number, patch: { status: TwitterHotspotStatus }) {
  const data = await twitterHotspotApiFetch<{ ok: boolean; hotspot: TwitterHotspot }>(`/hotspots/${hotspotId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  return data.hotspot;
}

export async function createTwitterTaskFromHotspot(hotspotId: number, input: CreateTwitterTaskFromHotspotInput) {
  const data = await twitterHotspotApiFetch<{ ok: boolean; task: TwitterTask; hotspot: TwitterHotspotDetail }>(
    `/hotspots/${hotspotId}/create-task`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    }
  );

  return data;
}

export async function getTwitterWatchlists() {
  const data = await twitterHotspotApiFetch<{ watchlists: TwitterHotspotWatchlist[] }>("/watchlists");
  return data.watchlists;
}

export async function createTwitterWatchlist(input: { name: string; description: string; enabled: boolean }) {
  const data = await twitterHotspotApiFetch<{ ok: boolean; watchlist: TwitterHotspotWatchlist }>("/watchlists", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data.watchlist;
}

export async function updateTwitterWatchlist(
  watchlistId: number,
  patch: Partial<Pick<TwitterHotspotWatchlist, "name" | "description" | "enabled">>
) {
  const data = await twitterHotspotApiFetch<{ ok: boolean; watchlist: TwitterHotspotWatchlist }>(`/watchlists/${watchlistId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  return data.watchlist;
}

export async function deleteTwitterWatchlist(watchlistId: number) {
  await twitterHotspotApiFetch<{ ok: boolean }>(`/watchlists/${watchlistId}`, {
    method: "DELETE"
  });
}

export async function createTwitterWatchlistItem(
  watchlistId: number,
  input: {
    type: TwitterHotspotWatchlistItemType;
    value: string;
    label?: string;
    enabled: boolean;
    priority: number;
    notes: string;
  }
) {
  const data = await twitterHotspotApiFetch<{ ok: boolean; watchlist: TwitterHotspotWatchlist }>(`/watchlists/${watchlistId}/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data.watchlist;
}

export async function updateTwitterWatchlistItem(
  watchlistId: number,
  itemId: number,
  patch: Partial<Pick<TwitterHotspotWatchlistItem, "label" | "enabled" | "priority" | "notes">>
) {
  const data = await twitterHotspotApiFetch<{ ok: boolean; item: TwitterHotspotWatchlistItem }>(
    `/watchlists/${watchlistId}/items/${itemId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(patch)
    }
  );

  return data.item;
}

export async function deleteTwitterWatchlistItem(watchlistId: number, itemId: number) {
  await twitterHotspotApiFetch<{ ok: boolean }>(`/watchlists/${watchlistId}/items/${itemId}`, {
    method: "DELETE"
  });
}

// ============ Prompt 管理接口 ============
export async function getTwitterPrompts() {
  const data = await twitterApiFetch<{ prompts: TwitterPrompt[] }>("/prompts");
  return data.prompts;
}

export async function getTwitterPrompt(id: string) {
  const data = await twitterApiFetch<{ prompt: TwitterPromptDetail }>(`/prompts/${id}`);
  return data.prompt;
}

export async function createTwitterPrompt(input: Omit<TwitterPrompt, "id" | "variables" | "lastTestedAt" | "createdAt" | "updatedAt"> & {
  variables?: string[];
}) {
  const data = await twitterApiFetch<{ ok: boolean; prompt: TwitterPrompt }>("/prompts", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data.prompt;
}

export async function updateTwitterPrompt(id: string, patch: Partial<TwitterPrompt>) {
  const data = await twitterApiFetch<{ ok: boolean; prompt: TwitterPrompt }>(`/prompts/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  return data.prompt;
}

export async function testTwitterPrompt(id: string, input: Record<string, string>) {
  const data = await twitterApiFetch<{ ok: boolean; result: string }>(`/prompts/${id}/test`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ input })
  });

  return data.result;
}

export async function activateTwitterPromptVersion(versionId: number) {
  const data = await twitterApiFetch<{ ok: boolean; prompt: TwitterPromptDetail }>(
    `/prompts/versions/${versionId}/activate`,
    {
      method: "POST"
    }
  );

  return data.prompt;
}

export async function getTwitterAccountPromptPanel(accountId: string, category: "main" | "writing") {
  const data = await twitterApiFetch<{ account: TwitterAccount; panel: TwitterAccountPromptPanel }>(
    `/accounts/${accountId}/account-prompts/${category}`
  );
  return data;
}

export async function createTwitterAccountPromptDraft(
  accountId: string,
  category: "main" | "writing",
  input: {
    label: string;
    content: string;
    notes?: string;
    bind?: boolean;
    sourceVersionId?: number | null;
  }
) {
  const data = await twitterApiFetch<{
    ok: boolean;
    promptVersionId: number;
    account: TwitterAccount;
    panel: TwitterAccountPromptPanel;
  }>(`/accounts/${accountId}/account-prompts/${category}/drafts`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data;
}

export async function updateTwitterAccountPromptDraft(
  accountId: string,
  category: "main" | "writing",
  versionId: number,
  patch: {
    label?: string;
    content?: string;
    notes?: string;
  }
) {
  const data = await twitterApiFetch<{
    ok: boolean;
    panel: TwitterAccountPromptPanel;
  }>(`/accounts/${accountId}/account-prompts/${category}/drafts/${versionId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  return data.panel;
}

export async function bindTwitterAccountPromptVersion(
  accountId: string,
  category: "main" | "writing",
  versionId: number
) {
  const data = await twitterApiFetch<{
    ok: boolean;
    account: TwitterAccount;
    panel: TwitterAccountPromptPanel;
  }>(`/accounts/${accountId}/account-prompts/${category}/bind`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      versionId
    })
  });

  return data;
}

// ============ 账号登录接口 ============
export async function loginTwitterAccount(accountId: string, options?: { profileDir?: string; proxyUrl?: string | null }) {
  const data = await twitterApiFetch<{ 
    ok: boolean; 
    account: TwitterAccount;
    sessionToken?: string;
    error?: { code: string; message: string };
  }>(`/accounts/${accountId}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      profileDir: options?.profileDir,
      proxyUrl: options?.proxyUrl
    })
  });

  return data;
}

// ============ 任务审核接口 ============
export async function reviewTwitterTask(
  taskId: string,
  decision: "approve" | "revise" | "block",
  options?: { reason?: string; revisionInstructions?: string[] }
) {
  const data = await twitterApiFetch<{
    ok: boolean;
    task: TwitterTask;
    error?: {
      code?: string;
      message?: string;
    };
  }>(`/tasks/${taskId}/review`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      decision,
      reason: options?.reason || "",
      revisionInstructions: options?.revisionInstructions || []
    })
  });

  if (!data.ok) {
    const reviewReason = data.task.reviewResult?.reason?.trim();
    const message =
      reviewReason && data.error?.code === "main_agent_not_approved"
        ? `MainAgent 未批准该草稿：${reviewReason}`
        : data.error?.message || "草稿审核未通过。";

    throw new TwitterApiError(message, {
      code: data.error?.code,
      details: data.task
    });
  }

  return data.task;
}

// ============ 发布控制接口 ============
export async function runTwitterTask(taskId: string, action: "run_now" | "reschedule" | "retry", options?: { scheduledAt?: string }) {
  const data = await twitterApiFetch<{ ok: boolean; task: TwitterTask }>(`/tasks/${taskId}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action,
      scheduledAt: options?.scheduledAt
    })
  });

  if (!data.ok || !data.task) {
    throw new TwitterApiError("发布任务操作失败。", {
      details: data
    });
  }

  return data.task;
}

export async function bindTwitterTaskImage(
  taskId: string,
  input: {
    assetId: string | null;
    usageType?: "cover" | "body_image" | "reaction" | "preview";
    note?: string | null;
  }
) {
  const data = await postImageJson<{
    ok: boolean;
    task: TwitterTask;
    asset: {
      id: string;
    } | null;
    usageRecord: {
      id: string;
    } | null;
  }>(`/bindings/x-tasks/${taskId}/image`, input);

  if (!data.ok || !data.task) {
    throw new TwitterApiError("Twitter / X 任务绑定配图失败。", {
      details: data
    });
  }

  return data;
}
