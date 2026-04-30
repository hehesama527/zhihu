import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getXAppConfig } from "../config.js";
import type {
  XAccount,
  XAccountSoulDocument,
  XMainAgentDecision,
  XReviewAgentResult,
  XTask
} from "../types.js";

export class XWorkspaceRepository {
  private readonly config: ReturnType<typeof getXAppConfig>;
  private readonly accountsFilePath: string;
  private readonly tasksFilePath: string;
  private readonly soulDocsFilePath: string;
  private readonly soulDirPath: string;

  constructor(config = getXAppConfig()) {
    this.config = config;
    this.accountsFilePath = path.join(this.config.dataDir, "accounts.json");
    this.tasksFilePath = path.join(this.config.dataDir, "tasks.json");
    this.soulDocsFilePath = path.join(this.config.dataDir, "soul-docs.json");
    this.soulDirPath = path.join(this.config.dataDir, "soul");
  }

  async ensureReady() {
    await fs.mkdir(this.config.dataDir, { recursive: true });
    await fs.mkdir(this.soulDirPath, { recursive: true });
    await this.ensureJsonFile(this.accountsFilePath, []);
    await this.ensureJsonFile(this.tasksFilePath, []);
    await this.ensureJsonFile(this.soulDocsFilePath, []);
  }

  async listAccounts() {
    const accounts = await this.readAccounts();
    return [...accounts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getAccount(id: string) {
    const accounts = await this.readAccounts();
    return accounts.find((account) => account.id === id) ?? null;
  }

  async createAccount(
    input: Omit<
      XAccount,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "lastPublishedAt"
    >
  ) {
    const accounts = await this.readAccounts();
    const now = new Date().toISOString();
    const accountId = crypto.randomUUID();
    const account: XAccount = {
      id: accountId,
      name: input.name,
      handle: normalizeHandle(input.handle),
      persona: input.persona,
      targetAudience: input.targetAudience,
      styleGuide: input.styleGuide,
      learningTargets: normalizeStringArray(input.learningTargets),
      manualNotes: input.manualNotes,
      accessToken: normalizeNullableString(input.accessToken),
      authStatus: input.authStatus,
      authStatusReason: normalizeNullableString(input.authStatusReason),
      authCheckedAt: input.authCheckedAt,
      mainPromptVersionId: input.mainPromptVersionId ?? null,
      writerPromptVersionId: input.writerPromptVersionId ?? null,
      reviewPromptVersionId: input.reviewPromptVersionId ?? null,
      publishPromptVersionId: input.publishPromptVersionId ?? null,
      writerPromptSource: normalizeWriterPromptSource(input.writerPromptSource),
      publishStyleRatios: normalizePublishStyleRatios(input.publishStyleRatios),
      profileDir: resolveProfileDir(this.config.browserProfileRoot, input.profileDir, input.handle, accountId),
      proxyUrl: normalizeNullableString(input.proxyUrl),
      status: input.status,
      lastPublishedAt: null,
      createdAt: now,
      updatedAt: now
    };

    accounts.push(account);
    await this.writeAccounts(accounts);

    return account;
  }

  async updateAccount(
    id: string,
    patch: Partial<Omit<XAccount, "id" | "createdAt" | "updatedAt" | "lastPublishedAt">> &
      Pick<Partial<XAccount>, "lastPublishedAt" | "authCheckedAt">
  ) {
    const accounts = await this.readAccounts();
    const index = accounts.findIndex((account) => account.id === id);
    if (index < 0) {
      return null;
    }

    const current = accounts[index];
    const nextAccount: XAccount = {
      ...current,
      ...patch,
      handle: patch.handle ? normalizeHandle(patch.handle) : current.handle,
      learningTargets: patch.learningTargets ? normalizeStringArray(patch.learningTargets) : current.learningTargets,
      accessToken:
        patch.accessToken !== undefined ? normalizeNullableString(patch.accessToken) : current.accessToken,
      authStatusReason:
        patch.authStatusReason !== undefined
          ? normalizeNullableString(patch.authStatusReason)
          : current.authStatusReason,
      mainPromptVersionId:
        patch.mainPromptVersionId !== undefined ? patch.mainPromptVersionId ?? null : current.mainPromptVersionId,
      writerPromptVersionId:
        patch.writerPromptVersionId !== undefined ? patch.writerPromptVersionId ?? null : current.writerPromptVersionId,
      reviewPromptVersionId:
        patch.reviewPromptVersionId !== undefined ? patch.reviewPromptVersionId ?? null : current.reviewPromptVersionId,
      publishPromptVersionId:
        patch.publishPromptVersionId !== undefined ? patch.publishPromptVersionId ?? null : current.publishPromptVersionId,
      writerPromptSource:
        patch.writerPromptSource !== undefined
          ? normalizeWriterPromptSource(patch.writerPromptSource)
          : current.writerPromptSource,
      publishStyleRatios:
        patch.publishStyleRatios !== undefined
          ? normalizePublishStyleRatios(patch.publishStyleRatios)
          : current.publishStyleRatios,
      profileDir: patch.profileDir ? patch.profileDir.trim() : current.profileDir,
      proxyUrl: patch.proxyUrl !== undefined ? normalizeNullableString(patch.proxyUrl) : current.proxyUrl,
      updatedAt: new Date().toISOString()
    };

    accounts[index] = nextAccount;
    await this.writeAccounts(accounts);

    return nextAccount;
  }

  async listTasks() {
    const tasks = await this.readTasks();
    return [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getTask(id: string) {
    const tasks = await this.readTasks();
    return tasks.find((task) => task.id === id) ?? null;
  }

  async createTask(
    input: Omit<
      XTask,
      | "id"
      | "imageAssetId"
      | "status"
      | "currentStage"
      | "soulVersion"
      | "soulMarkdownSnapshot"
      | "draftPack"
      | "mainAgentPlan"
      | "reviewAgentResult"
      | "reviewResult"
      | "publishPlan"
      | "publishResult"
      | "promptVersionSnapshotJson"
      | "revisionCount"
      | "failureStage"
      | "failureType"
      | "failureReason"
      | "createdAt"
      | "updatedAt"
      | "startedAt"
      | "finishedAt"
    >
  ) {
    const tasks = await this.readTasks();
    const now = new Date().toISOString();
    const task: XTask = {
      id: crypto.randomUUID(),
      accountId: input.accountId,
      imageAssetId: null,
      title: input.title,
      brief: input.brief,
      goal: input.goal,
      preferredMode: input.preferredMode,
      status: "planned",
      currentStage: "planned",
      soulVersion: null,
      soulMarkdownSnapshot: null,
      draftPack: null,
      mainAgentPlan: null,
      reviewAgentResult: null,
      reviewResult: null,
      publishPlan: null,
      publishResult: null,
      promptVersionSnapshotJson: null,
      revisionCount: 0,
      scheduledAt: input.scheduledAt,
      failureStage: null,
      failureType: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null
    };

    tasks.push(task);
    await this.writeTasks(tasks);

    return task;
  }

  async updateTask(id: string, patch: Partial<XTask>) {
    const tasks = await this.readTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) {
      return null;
    }

    const nextTask: XTask = {
      ...tasks[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString()
    };

    tasks[index] = nextTask;
    await this.writeTasks(tasks);
    return nextTask;
  }

  async listRecentPublishedTasks(accountId: string, limit = 5) {
    const tasks = await this.readTasks();
    return tasks
      .filter((task) => task.accountId === accountId && task.status === "published")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  async updatePromptTestedAt(_id: string) {
    return null;
  }

  async getSoulDocument(accountId: string) {
    const docs = await this.readSoulDocs();
    return docs.find((doc) => doc.accountId === accountId) ?? null;
  }

  async saveSoulDocument(document: XAccountSoulDocument) {
    const docs = await this.readSoulDocs();
    const index = docs.findIndex((doc) => doc.accountId === document.accountId);

    if (index >= 0) {
      docs[index] = document;
    } else {
      docs.push(document);
    }

    await this.writeSoulDocs(docs);
    await fs.writeFile(this.getSoulMarkdownMirrorPath(document.accountId), document.markdown, "utf8");

    return document;
  }

  private async readAccounts() {
    const accounts = await this.readCollection<Partial<XAccount>>(this.accountsFilePath);
    return accounts.map((account) => normalizeAccountRecord(account));
  }

  private async writeAccounts(accounts: XAccount[]) {
    await this.writeCollection(this.accountsFilePath, accounts);
  }

  private async readTasks() {
    const tasks = await this.readCollection<Partial<XTask>>(this.tasksFilePath);
    return tasks.map((task) => normalizeTaskRecord(task));
  }

  private async writeTasks(tasks: XTask[]) {
    await this.writeCollection(this.tasksFilePath, tasks);
  }

  private async readSoulDocs() {
    const docs = await this.readCollection<Partial<XAccountSoulDocument>>(this.soulDocsFilePath);
    return docs.map((doc) => normalizeSoulDocumentRecord(doc));
  }

  private async writeSoulDocs(soulDocs: XAccountSoulDocument[]) {
    await this.writeCollection(this.soulDocsFilePath, soulDocs);
  }

  private async readCollection<T>(filePath: string) {
    await this.ensureReady();
    const raw = await fs.readFile(filePath, "utf8");

    try {
      return JSON.parse(raw) as T[];
    } catch {
      return [];
    }
  }

  private async writeCollection<T>(filePath: string, value: T[]) {
    await this.ensureReady();
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  }

  private async ensureJsonFile(filePath: string, initialValue: unknown) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(initialValue, null, 2), "utf8");
    }
  }

  private getSoulMarkdownMirrorPath(accountId: string) {
    return path.join(this.soulDirPath, `${accountId}.md`);
  }

}

function normalizeHandle(value: string) {
  return value.trim().replace(/^@+/, "");
}

function normalizeStringArray(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeNullableString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveProfileDir(profileRoot: string, profileDir: string | undefined, handle: string, accountId: string) {
  if (profileDir?.trim()) {
    return profileDir.trim();
  }

  const preferredSegment = sanitizePathSegment(handle) || accountId;
  return path.join(profileRoot, preferredSegment);
}

function sanitizePathSegment(value: string) {
  return value.trim().replace(/^@+/, "").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function normalizeAccountRecord(account: Partial<XAccount>): XAccount {
  return {
    id: account.id ?? crypto.randomUUID(),
    name: account.name ?? "",
    handle: normalizeHandle(account.handle ?? ""),
    persona: account.persona ?? "",
    targetAudience: account.targetAudience ?? "",
    styleGuide: account.styleGuide ?? "",
    learningTargets: normalizeStringArray(account.learningTargets ?? []),
    manualNotes: account.manualNotes ?? "",
    profileDir: account.profileDir ?? "",
    proxyUrl: normalizeNullableString(account.proxyUrl),
    status: account.status === "paused" ? "paused" : "active",
    accessToken: normalizeNullableString(account.accessToken),
    authStatus: account.authStatus ?? null,
    authStatusReason: normalizeNullableString(account.authStatusReason),
    authCheckedAt: account.authCheckedAt ?? null,
    mainPromptVersionId: account.mainPromptVersionId ?? null,
    writerPromptVersionId: account.writerPromptVersionId ?? null,
    reviewPromptVersionId: account.reviewPromptVersionId ?? null,
    publishPromptVersionId: account.publishPromptVersionId ?? null,
    writerPromptSource: normalizeWriterPromptSource(account.writerPromptSource),
    publishStyleRatios: normalizePublishStyleRatios(account.publishStyleRatios),
    lastPublishedAt: account.lastPublishedAt ?? null,
    createdAt: account.createdAt ?? new Date(0).toISOString(),
    updatedAt: account.updatedAt ?? new Date(0).toISOString()
  };
}

function normalizeTaskRecord(task: Partial<XTask>): XTask {
  return {
    id: task.id ?? crypto.randomUUID(),
    accountId: task.accountId ?? "",
    title: task.title ?? "",
    brief: task.brief ?? "",
    goal: task.goal ?? "",
    preferredMode: task.preferredMode === "single" || task.preferredMode === "thread" ? task.preferredMode : "auto",
    status: task.status ?? "planned",
    currentStage: task.currentStage ?? String(task.status ?? "planned"),
    imageAssetId: task.imageAssetId ?? null,
    soulVersion:
      typeof task.soulVersion === "number" && Number.isFinite(task.soulVersion) ? Math.max(1, Math.round(task.soulVersion)) : null,
    soulMarkdownSnapshot: typeof task.soulMarkdownSnapshot === "string" ? task.soulMarkdownSnapshot : null,
    draftPack: task.draftPack ?? null,
    mainAgentPlan: normalizeMainAgentDecision(task.mainAgentPlan),
    reviewResult: task.reviewResult ?? null,
    publishPlan: normalizePublishPlan(task.publishPlan),
    publishResult: task.publishResult ?? null,
    reviewAgentResult: normalizeReviewAgentResult(task.reviewAgentResult),
    promptVersionSnapshotJson: typeof task.promptVersionSnapshotJson === "string" ? task.promptVersionSnapshotJson : null,
    revisionCount:
      typeof task.revisionCount === "number" && Number.isFinite(task.revisionCount) ? Math.max(0, Math.round(task.revisionCount)) : 0,
    scheduledAt: task.scheduledAt ?? null,
    failureStage: task.failureStage ?? null,
    failureType: task.failureType ?? null,
    failureReason: normalizeNullableString(task.failureReason),
    createdAt: task.createdAt ?? new Date(0).toISOString(),
    updatedAt: task.updatedAt ?? new Date(0).toISOString(),
    startedAt: task.startedAt ?? null,
    finishedAt: task.finishedAt ?? null
  };
}

function normalizeSoulDocumentRecord(document: Partial<XAccountSoulDocument>): XAccountSoulDocument {
  return {
    accountId: document.accountId ?? crypto.randomUUID(),
    version: typeof document.version === "number" && Number.isFinite(document.version) ? Math.max(1, Math.round(document.version)) : 1,
    coreIdentity: document.coreIdentity?.trim() ?? "",
    targetReader: document.targetReader?.trim() ?? "",
    voiceTraits: normalizeStringArray(document.voiceTraits ?? []),
    worldview: normalizeStringArray(document.worldview ?? []),
    proofAnchors: normalizeStringArray(document.proofAnchors ?? []),
    signatureMoves: normalizeStringArray(document.signatureMoves ?? []),
    productMentionPolicy: normalizeStringArray(document.productMentionPolicy ?? []),
    hardBoundaries: normalizeStringArray(document.hardBoundaries ?? []),
    tabooLexicon: normalizeStringArray(document.tabooLexicon ?? []),
    exemplarLines: normalizeStringArray(document.exemplarLines ?? []),
    markdown: document.markdown?.trim() ?? "",
    lastUpdatedAt: document.lastUpdatedAt ?? new Date(0).toISOString(),
    updatedBy: document.updatedBy === "llm" ? "llm" : "user",
    updateReason: document.updateReason?.trim() || "init",
    userEditedAt: document.userEditedAt ?? null
  };
}

function normalizeReviewAgentResult(value: XReviewAgentResult | null | undefined): XReviewAgentResult | null {
  if (!value) {
    return null;
  }

  const verdict = value.verdict;
  if (verdict !== "pass" && verdict !== "minor_issue" && verdict !== "major_issue" && verdict !== "block") {
    return null;
  }

  return {
    verdict,
    summary: value.summary?.trim() ?? "",
    strengths: normalizeStringArray(value.strengths ?? []),
    issues: normalizeStringArray(value.issues ?? []),
    riskFlags: normalizeStringArray(value.riskFlags ?? []),
    suggestedFixes: normalizeStringArray(value.suggestedFixes ?? [])
  };
}

function normalizeWriterPromptSource(value: XAccount["writerPromptSource"] | null | undefined): XAccount["writerPromptSource"] {
  return value === "database" ? "database" : "main_agent";
}

function normalizePublishStyleRatios(
  value: Partial<XAccount["publishStyleRatios"]> | null | undefined
): XAccount["publishStyleRatios"] {
  return {
    casualNote: normalizeRatioValue(value?.casualNote, 30),
    smallInsight: normalizeRatioValue(value?.smallInsight, 25),
    pitfallLog: normalizeRatioValue(value?.pitfallLog, 15),
    toolMention: normalizeRatioValue(value?.toolMention, 15),
    industryTalk: normalizeRatioValue(value?.industryTalk, 10),
    interactiveQa: normalizeRatioValue(value?.interactiveQa, 5),
    quoteRepost: normalizeRatioValue(value?.quoteRepost, 5)
  };
}

function normalizeRatioValue(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeMainAgentDecision(value: XMainAgentDecision | null | undefined): XMainAgentDecision | null {
  if (!value) {
    return null;
  }

  const preferredMode = value.preferredMode === "thread" ? "thread" : "single";

  return {
    usedFallback: Boolean(value.usedFallback),
    fallbackStage: value.usedFallback && (value.fallbackStage === "plan" || value.fallbackStage === "draft_gate") ? value.fallbackStage : null,
    decision: value.decision,
    reason: value.reason?.trim() ?? "",
    shouldWrite: Boolean(value.shouldWrite),
    shouldPublish: Boolean(value.shouldPublish),
    preferredMode,
    publishAction: value.publishAction === "reply" || value.publishAction === "quote" ? value.publishAction : "post",
    contentStyle: normalizeContentStyle(value.contentStyle),
    useHotspot: Boolean(value.useHotspot),
    selectedHotspotIds: Array.isArray(value.selectedHotspotIds)
      ? value.selectedHotspotIds.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)
      : [],
    targetTweetUrl: normalizeNullableString(value.targetTweetUrl),
    targetTweetReason: value.targetTweetReason?.trim() ?? "",
    runtimeWriterPrompt: value.runtimeWriterPrompt?.trim() ?? "",
    cadence: value.cadence === "single_now" || value.cadence === "thread_continuous_now" ? value.cadence : "defer",
    deferMinutes: typeof value.deferMinutes === "number" && Number.isFinite(value.deferMinutes) ? Math.max(0, Math.round(value.deferMinutes)) : 0,
    tagPlan: normalizeTagPlan(value.tagPlan, preferredMode),
    writerBrief: {
      angle: value.writerBrief?.angle?.trim() ?? "",
      goal: value.writerBrief?.goal?.trim() ?? "",
      mustInclude: normalizeStringArray(value.writerBrief?.mustInclude ?? []),
      mustAvoid: normalizeStringArray(value.writerBrief?.mustAvoid ?? []),
      openingDirection: value.writerBrief?.openingDirection?.trim() ?? "",
      threadPlan: value.writerBrief?.threadPlan?.trim() ?? ""
    },
    revisionInstructions: normalizeStringArray(value.revisionInstructions ?? []),
    qualityNotes: normalizeStringArray(value.qualityNotes ?? []),
    publishNotes: normalizeStringArray(value.publishNotes ?? [])
  };
}

function normalizeContentStyle(value: unknown): XMainAgentDecision["contentStyle"] {
  switch (value) {
    case "small_insight":
    case "pitfall_log":
    case "tool_mention":
    case "industry_talk":
    case "interactive_qa":
    case "quote_repost":
      return value;
    default:
      return "casual_note";
  }
}

function normalizePublishPlan(value: XTask["publishPlan"] | null | undefined): XTask["publishPlan"] {
  if (!value) {
    return null;
  }

  const mode = value.mode === "thread" ? "thread" : "single";

  return {
    shouldPublish: Boolean(value.shouldPublish),
    mode,
    action: value.action === "reply" || value.action === "quote" ? value.action : "post",
    contentStyle: normalizeContentStyle(value.contentStyle),
    cadence: value.cadence === "single_now" || value.cadence === "thread_continuous_now" ? value.cadence : "defer",
    deferMinutes: typeof value.deferMinutes === "number" && Number.isFinite(value.deferMinutes) ? Math.max(0, Math.round(value.deferMinutes)) : 0,
    targetTweetUrl: normalizeNullableString(value.targetTweetUrl),
    selectedHotspotIds: Array.isArray(value.selectedHotspotIds)
      ? value.selectedHotspotIds.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)
      : [],
    tagPlan: normalizeTagPlan(value.tagPlan, mode),
    reason: value.reason?.trim() ?? ""
  };
}

function normalizeTagPlan(
  value: XMainAgentDecision["tagPlan"] | NonNullable<XTask["publishPlan"]>["tagPlan"] | null | undefined,
  mode: "single" | "thread"
): XMainAgentDecision["tagPlan"] {
  const hashtags = normalizeHashtagArray(value?.hashtags ?? []);
  const maxTags =
    typeof value?.maxTags === "number" && Number.isFinite(value.maxTags) ? Math.max(0, Math.min(4, Math.round(value.maxTags))) : 0;
  const placement = value?.placement === "tail" || value?.placement === "inline" ? value.placement : "none";
  const applyTo: XMainAgentDecision["tagPlan"]["applyTo"] =
    mode === "single"
      ? "single"
      : value?.applyTo === "first_post" || value?.applyTo === "last_post" || value?.applyTo === "all_posts"
        ? value.applyTo
        : "last_post";

  if (!hashtags.length || placement === "none" || maxTags === 0) {
    return {
      hashtags: [],
      placement: "none",
      applyTo,
      maxTags: 0,
      reason: value?.reason?.trim() ?? ""
    };
  }

  return {
    hashtags: hashtags.slice(0, maxTags),
    placement,
    applyTo,
    maxTags,
    reason: value?.reason?.trim() ?? ""
  };
}

function normalizeHashtagArray(value: string[]) {
  const deduped: string[] = [];
  for (const item of value) {
    const normalized = normalizeHashtagToken(item);
    if (!normalized || deduped.includes(normalized)) {
      continue;
    }
    deduped.push(normalized);
  }

  return deduped;
}

function normalizeHashtagToken(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const withoutPrefix = raw.replace(/^#+/, "").replace(/\s+/g, "");
  const cleaned = withoutPrefix.replace(/[^\p{L}\p{N}_]/gu, "");
  if (!cleaned) {
    return null;
  }

  return `#${cleaned}`;
}
