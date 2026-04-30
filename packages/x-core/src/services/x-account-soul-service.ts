import { XWorkspaceRepository } from "../repositories/x-workspace-repository.js";
import type { XAccount, XAccountSoulDocument, XSoulUpdatedBy } from "../types.js";

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

export class XAccountSoulService {
  constructor(private readonly repository = new XWorkspaceRepository()) {}

  async ensureSoulDocument(account: XAccount) {
    const existing = await this.repository.getSoulDocument(account.id);
    if (!existing) {
      return this.repository.saveSoulDocument(buildInitialSoulDocument(account));
    }

    const markdown = renderSoulMarkdown(existing);
    if (existing.markdown.trim() === markdown.trim()) {
      return existing;
    }

    return this.repository.saveSoulDocument({
      ...existing,
      markdown
    });
  }

  async saveSoulDocument(
    account: XAccount,
    input: SaveSoulInput,
    options?: {
      updatedBy?: XSoulUpdatedBy;
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

    return this.repository.saveSoulDocument({
      ...next,
      markdown: renderSoulMarkdown(next)
    });
  }
}

function buildInitialSoulDocument(account: XAccount): XAccountSoulDocument {
  const now = new Date().toISOString();
  const baseDocument = buildSoulDocument({
    accountId: account.id,
    version: 1,
    coreIdentity: account.persona,
    targetReader: account.targetAudience,
    voiceTraits: splitSeedText(account.styleGuide, { allowComma: true }),
    worldview: splitSeedText(account.manualNotes),
    proofAnchors: normalizeStringArray(account.learningTargets),
    signatureMoves: [],
    productMentionPolicy: [],
    hardBoundaries: [],
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

function buildSoulDocument(input: XAccountSoulDocument): XAccountSoulDocument {
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

function renderSoulMarkdown(document: EditableSoulFields & Pick<XAccountSoulDocument, "accountId" | "version" | "lastUpdatedAt" | "updatedBy" | "updateReason" | "userEditedAt">) {
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

function splitSeedText(value: string, options?: { allowComma?: boolean }) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const delimiters = options?.allowComma ? /[\r\n;,]+/ : /[\r\n;]+/;
  const parts = trimmed
    .split(delimiters)
    .map((item) => item.trim())
    .filter(Boolean);

  return parts.length > 1 ? normalizeStringArray(parts) : [trimmed];
}

function normalizeStringArray(values: string[]) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}
