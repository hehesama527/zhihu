import fs from "node:fs/promises";
import path from "node:path";
import type { AccountListItem, AccountSoulDocument, SoulUpdatedBy } from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";

type SoulSeedAccount = Pick<AccountListItem, "id" | "name" | "zhihuUserName">;

type EditableSoulFields = {
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
};

type SaveSoulInput = EditableSoulFields & {
  updateReason?: string;
};

export class AccountSoulService {
  async ensureSoulDocument(account: SoulSeedAccount) {
    const existing = await this.readSoulDocument(account.id);
    if (!existing) {
      return this.writeSoulDocument(buildInitialSoulDocument(account));
    }

    const markdown = renderSoulMarkdown(existing);
    if (existing.markdown.trim() === markdown.trim()) {
      return existing;
    }

    return this.writeSoulDocument({
      ...existing,
      markdown
    });
  }

  async saveSoulDocument(
    account: SoulSeedAccount,
    input: SaveSoulInput,
    options?: {
      updatedBy?: SoulUpdatedBy;
      userEditedAt?: string | null;
    }
  ) {
    const current = await this.ensureSoulDocument(account);
    const now = new Date().toISOString();
    const updatedBy = options?.updatedBy ?? "user";
    const next = buildSoulDocument({
      accountId: account.id,
      version: current.version + 1,
      coreIdentity: input.coreIdentity,
      targetReader: input.targetReader,
      voiceTraits: input.voiceTraits,
      worldview: input.worldview,
      proofAnchors: input.proofAnchors,
      signatureMoves: input.signatureMoves,
      productMentionPolicy: input.productMentionPolicy,
      hardBoundaries: input.hardBoundaries,
      tabooLexicon: input.tabooLexicon,
      exemplarLines: input.exemplarLines,
      markdown: "",
      lastUpdatedAt: now,
      updatedBy,
      updateReason: input.updateReason?.trim() || "manual_edit",
      userEditedAt: updatedBy === "user" ? options?.userEditedAt ?? now : current.userEditedAt
    });

    return this.writeSoulDocument({
      ...next,
      markdown: renderSoulMarkdown(next)
    });
  }

  async deleteSoulDocument(accountId: number) {
    try {
      await fs.rm(this.getSoulFilePath(accountId), {
        force: true
      });
    } catch {
      return;
    }
  }

  private async readSoulDocument(accountId: number) {
    try {
      const raw = await fs.readFile(this.getSoulFilePath(accountId), "utf8");
      return normalizeSoulDocumentRecord(JSON.parse(raw) as Partial<AccountSoulDocument>, accountId);
    } catch {
      return null;
    }
  }

  private async writeSoulDocument(document: AccountSoulDocument) {
    await fs.mkdir(this.getSoulDirectory(), { recursive: true });
    await fs.writeFile(this.getSoulFilePath(document.accountId), JSON.stringify(document, null, 2), "utf8");
    return document;
  }

  private getSoulDirectory() {
    return path.join(getAppConfig().dataDir, "account-souls");
  }

  private getSoulFilePath(accountId: number) {
    return path.join(this.getSoulDirectory(), `account-${accountId}.json`);
  }
}

function buildInitialSoulDocument(account: SoulSeedAccount): AccountSoulDocument {
  const now = new Date().toISOString();
  const baseDocument = buildSoulDocument({
    accountId: account.id,
    version: 1,
    coreIdentity: account.name,
    targetReader: account.zhihuUserName ? `会关注 ${account.zhihuUserName} 这类答主的知乎读者。` : "",
    voiceTraits: ["像真人答主，不像公关稿", "先给判断，再补理由", "克制，不装全知专家"],
    worldview: ["只写自己能承担的判断", "优先分享经验、观察和取舍，不堆空话"],
    proofAnchors: [
      `账号人设名：${account.name}`,
      ...(account.zhihuUserName ? [`知乎账号名：${account.zhihuUserName}`] : [])
    ],
    signatureMoves: [],
    productMentionPolicy: [],
    hardBoundaries: ["不写明显不像真人会说的话", "不把回答写成统一模板口径"],
    tabooLexicon: [],
    exemplarLines: [],
    markdown: "",
    lastUpdatedAt: now,
    updatedBy: "user",
    updateReason: "init",
    userEditedAt: null
  });

  return {
    ...baseDocument,
    markdown: renderSoulMarkdown(baseDocument)
  };
}

function buildSoulDocument(input: AccountSoulDocument): AccountSoulDocument {
  return {
    accountId: input.accountId,
    version: Math.max(1, Math.round(input.version)),
    coreIdentity: input.coreIdentity.trim(),
    targetReader: input.targetReader.trim(),
    voiceTraits: normalizeStringArray(input.voiceTraits),
    worldview: normalizeStringArray(input.worldview),
    proofAnchors: normalizeStringArray(input.proofAnchors),
    signatureMoves: normalizeStringArray(input.signatureMoves),
    productMentionPolicy: normalizeStringArray(input.productMentionPolicy),
    hardBoundaries: normalizeStringArray(input.hardBoundaries),
    tabooLexicon: normalizeStringArray(input.tabooLexicon),
    exemplarLines: normalizeStringArray(input.exemplarLines),
    markdown: input.markdown,
    lastUpdatedAt: input.lastUpdatedAt,
    updatedBy: input.updatedBy,
    updateReason: input.updateReason.trim() || "manual_edit",
    userEditedAt: input.userEditedAt ?? null
  };
}

function normalizeSoulDocumentRecord(record: Partial<AccountSoulDocument>, accountId: number): AccountSoulDocument {
  return buildSoulDocument({
    accountId,
    version: typeof record.version === "number" && Number.isFinite(record.version) ? record.version : 1,
    coreIdentity: typeof record.coreIdentity === "string" ? record.coreIdentity : "",
    targetReader: typeof record.targetReader === "string" ? record.targetReader : "",
    voiceTraits: normalizeUnknownStringArray(record.voiceTraits),
    worldview: normalizeUnknownStringArray(record.worldview),
    proofAnchors: normalizeUnknownStringArray(record.proofAnchors),
    signatureMoves: normalizeUnknownStringArray(record.signatureMoves),
    productMentionPolicy: normalizeUnknownStringArray(record.productMentionPolicy),
    hardBoundaries: normalizeUnknownStringArray(record.hardBoundaries),
    tabooLexicon: normalizeUnknownStringArray(record.tabooLexicon),
    exemplarLines: normalizeUnknownStringArray(record.exemplarLines),
    markdown: typeof record.markdown === "string" ? record.markdown : "",
    lastUpdatedAt: typeof record.lastUpdatedAt === "string" ? record.lastUpdatedAt : new Date().toISOString(),
    updatedBy: record.updatedBy === "llm" ? "llm" : "user",
    updateReason: typeof record.updateReason === "string" ? record.updateReason : "manual_edit",
    userEditedAt: typeof record.userEditedAt === "string" ? record.userEditedAt : null
  });
}

function renderSoulMarkdown(
  document: EditableSoulFields &
    Pick<AccountSoulDocument, "accountId" | "version" | "lastUpdatedAt" | "updatedBy" | "updateReason" | "userEditedAt">
) {
  return [
    "# Account Soul",
    "",
    `- Account ID: ${document.accountId}`,
    `- Version: v${document.version}`,
    `- Last Updated At: ${document.lastUpdatedAt}`,
    `- Updated By: ${document.updatedBy}`,
    `- Update Reason: ${document.updateReason}`,
    `- User Edited At: ${document.userEditedAt ?? "not_set"}`,
    "",
    renderTextSection("Core Identity", document.coreIdentity),
    renderTextSection("Target Reader", document.targetReader),
    renderListSection("Voice Traits", document.voiceTraits),
    renderListSection("Worldview", document.worldview),
    renderListSection("Proof Anchors", document.proofAnchors),
    renderListSection("Signature Moves", document.signatureMoves),
    renderListSection("Product Mention Policy", document.productMentionPolicy),
    renderListSection("Hard Boundaries", document.hardBoundaries),
    renderListSection("Taboo Lexicon", document.tabooLexicon),
    renderListSection("Exemplar Lines", document.exemplarLines)
  ].join("\n");
}

function renderTextSection(title: string, value: string) {
  return [`## ${title}`, "", value.trim() || "Not set.", ""].join("\n");
}

function renderListSection(title: string, values: string[]) {
  const items = normalizeStringArray(values);
  return [`## ${title}`, "", ...(items.length ? items.map((item) => `- ${item}`) : ["- Not set."]), ""].join("\n");
}

function normalizeStringArray(values: string[]) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function normalizeUnknownStringArray(values: unknown) {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}
