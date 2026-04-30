import fs from "node:fs/promises";
import path from "node:path";
import type {
  AccountListItem,
  ZhihuAccountLibraryDocumentManifest,
  ZhihuAccountLibraryMap,
  ZhihuAccountLibraryManifest
} from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";

type AccountLibraryLookupAccount = Pick<AccountListItem, "id" | "name" | "zhihuUserName">;

export type ZhihuAccountLibraryExampleRecord = {
  id: string;
  text: string;
  notes: string;
  questionTitle: string;
  questionUrl: string | null;
  answerUrl: string | null;
};

export type ZhihuAccountLibraryPromptContext = {
  accountKey: string;
  matchedBy: "accountId" | "zhihuUserName" | "accountName" | null;
  styleRulesMarkdown: string;
  answerStructureRulesMarkdown: string;
  evidenceRulesMarkdown: string;
  reviewRubricMarkdown: string;
  sampleFilterMarkdown: string;
  goodAnswers: ZhihuAccountLibraryExampleRecord[];
  badAnswers: ZhihuAccountLibraryExampleRecord[];
};

export class ZhihuAccountLibraryRepository {
  private readonly config = getAppConfig();
  private readonly librariesRootPath = path.join(this.config.dataDir, "zhihu-account-libraries");
  private readonly accountsRootPath = path.join(this.librariesRootPath, "accounts");
  private readonly accountMapPath = path.join(this.librariesRootPath, "account-library-map.json");

  async ensureReady() {
    await fs.mkdir(this.accountsRootPath, { recursive: true });

    try {
      await fs.access(this.accountMapPath);
    } catch {
      await fs.writeFile(this.accountMapPath, JSON.stringify(buildDefaultAccountMap(), null, 2), "utf8");
    }
  }

  async readAccountMap(): Promise<ZhihuAccountLibraryMap> {
    await this.ensureReady();

    try {
      const raw = await fs.readFile(this.accountMapPath, "utf8");
      return normalizeAccountMap(JSON.parse(raw));
    } catch {
      return buildDefaultAccountMap();
    }
  }

  async resolveAccountLibrary(account: AccountLibraryLookupAccount) {
    const accountMap = await this.readAccountMap();

    const byId = accountMap.mappings.find(
      (item) => item.enabled && item.accountIds.includes(account.id)
    );
    if (byId) {
      return {
        accountKey: byId.accountKey,
        matchedBy: "accountId" as const
      };
    }

    const normalizedUserName = normalizeMatchValue(account.zhihuUserName);
    if (normalizedUserName) {
      const byZhihuUserName = accountMap.mappings.find(
        (item) => item.enabled && item.zhihuUserNames.map(normalizeMatchValue).includes(normalizedUserName)
      );
      if (byZhihuUserName) {
        return {
          accountKey: byZhihuUserName.accountKey,
          matchedBy: "zhihuUserName" as const
        };
      }
    }

    const normalizedAccountName = normalizeMatchValue(account.name);
    if (normalizedAccountName) {
      const byAccountName = accountMap.mappings.find(
        (item) => item.enabled && item.accountNames.map(normalizeMatchValue).includes(normalizedAccountName)
      );
      if (byAccountName) {
        return {
          accountKey: byAccountName.accountKey,
          matchedBy: "accountName" as const
        };
      }
    }

    return {
      accountKey: null,
      matchedBy: null
    };
  }

  async ensureAccountLibraryForAccount(account: AccountLibraryLookupAccount) {
    await this.ensureReady();

    const resolved = await this.resolveAccountLibrary(account);
    const accountMap = await this.readAccountMap();
    let accountKey = resolved.accountKey;
    let matchedBy: "accountId" | "zhihuUserName" | "accountName" | "bootstrapped" | null = resolved.matchedBy;

    if (!accountKey) {
      accountKey = buildDefaultAccountKey(account);
      matchedBy = "bootstrapped";
      accountMap.mappings.push({
        accountKey,
        enabled: true,
        accountIds: [account.id],
        zhihuUserNames: account.zhihuUserName?.trim() ? [account.zhihuUserName.trim()] : [],
        accountNames: account.name.trim() ? [account.name.trim()] : []
      });
      await fs.writeFile(this.accountMapPath, JSON.stringify(normalizeAccountMap(accountMap), null, 2), "utf8");
    }

    await this.ensureAccountLibrary(accountKey, account);

    return {
      accountKey,
      matchedBy
    };
  }

  async ensureAccountNoteAgentStorageForAccount(account: AccountLibraryLookupAccount) {
    await this.ensureReady();

    const resolved = await this.resolveAccountLibrary(account);
    const accountMap = await this.readAccountMap();
    let accountKey = resolved.accountKey;
    let matchedBy: "accountId" | "zhihuUserName" | "accountName" | "bootstrapped" | null = resolved.matchedBy;

    if (!accountKey) {
      accountKey = buildDefaultAccountKey(account);
      matchedBy = "bootstrapped";
      accountMap.mappings.push({
        accountKey,
        enabled: true,
        accountIds: [account.id],
        zhihuUserNames: account.zhihuUserName?.trim() ? [account.zhihuUserName.trim()] : [],
        accountNames: account.name.trim() ? [account.name.trim()] : []
      });
      await fs.writeFile(this.accountMapPath, JSON.stringify(normalizeAccountMap(accountMap), null, 2), "utf8");
    }

    await fs.mkdir(this.getAccountNoteAgentDirPath(accountKey), { recursive: true });

    return {
      accountKey,
      matchedBy
    };
  }

  async readLibraryManifest(accountKey: string): Promise<ZhihuAccountLibraryManifest | null> {
    await this.ensureReady();
    const manifestPath = this.getAccountLibraryDocumentPath(accountKey, "manifest.json");

    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      return normalizeLibraryManifest(JSON.parse(raw), accountKey);
    } catch {
      return null;
    }
  }

  async readMarkdownDocument(accountKey: string, relativePath: string) {
    await this.ensureReady();

    try {
      return await fs.readFile(this.getAccountLibraryDocumentPath(accountKey, relativePath), "utf8");
    } catch {
      return "";
    }
  }

  async readNoteAgentAsset(accountKey: string, relativePath: string) {
    await this.ensureReady();

    try {
      return await fs.readFile(this.getAccountNoteAgentAssetPath(accountKey, relativePath), "utf8");
    } catch {
      return "";
    }
  }

  async readExampleRecords(accountKey: string, relativePath: string): Promise<ZhihuAccountLibraryExampleRecord[]> {
    await this.ensureReady();

    try {
      const raw = await fs.readFile(this.getAccountLibraryDocumentPath(accountKey, relativePath), "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [normalizeExampleRecord(JSON.parse(line))];
          } catch {
            return [];
          }
        })
        .filter((item) => item.text);
    } catch {
      return [];
    }
  }

  async readPromptContextForAccount(account: AccountLibraryLookupAccount): Promise<ZhihuAccountLibraryPromptContext | null> {
    const resolved = await this.resolveAccountLibrary(account);
    if (!resolved.accountKey) {
      return null;
    }

    await this.ensureAccountLibrary(resolved.accountKey, account);

    return {
      accountKey: resolved.accountKey,
      matchedBy: resolved.matchedBy,
      styleRulesMarkdown: await this.readMarkdownDocument(resolved.accountKey, "style_rules.md"),
      answerStructureRulesMarkdown: await this.readMarkdownDocument(resolved.accountKey, "answer_structure_rules.md"),
      evidenceRulesMarkdown: await this.readMarkdownDocument(resolved.accountKey, "evidence_rules.md"),
      reviewRubricMarkdown: await this.readMarkdownDocument(resolved.accountKey, "review_rubric.md"),
      sampleFilterMarkdown: await this.readMarkdownDocument(resolved.accountKey, "sample_filter.md"),
      goodAnswers: await this.readExampleRecords(resolved.accountKey, "good_answers.jsonl"),
      badAnswers: await this.readExampleRecords(resolved.accountKey, "bad_answers.jsonl")
    };
  }

  async writeLibraryDocument(accountKey: string, relativePath: string, content: string) {
    await this.ensureReady();
    const filePath = this.getAccountLibraryDocumentPath(accountKey, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, normalizeTextDocument(content), "utf8");
    return filePath;
  }

  async writeNoteAgentAsset(accountKey: string, relativePath: string, content: string) {
    await this.ensureReady();
    const filePath = this.getAccountNoteAgentAssetPath(accountKey, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, normalizeTextDocument(content), "utf8");
    return filePath;
  }

  getAccountMapPath() {
    return this.accountMapPath;
  }

  getAccountLibraryPath(accountKey: string) {
    return path.join(this.accountsRootPath, accountKey);
  }

  getAccountLibraryDocumentPath(accountKey: string, relativePath: string) {
    const libraryPath = this.getAccountLibraryPath(accountKey);
    const resolvedPath = path.resolve(libraryPath, relativePath);
    const normalizedLibraryPath = `${path.resolve(libraryPath)}${path.sep}`;

    if (resolvedPath !== path.resolve(libraryPath) && !resolvedPath.startsWith(normalizedLibraryPath)) {
      throw new Error(`Invalid Zhihu account library path: ${relativePath}`);
    }

    return resolvedPath;
  }

  getAccountNoteAgentDirPath(accountKey: string) {
    return this.getAccountLibraryDocumentPath(accountKey, "note-agent");
  }

  getAccountNoteAgentAssetPath(accountKey: string, relativePath: string) {
    const noteAgentDir = this.getAccountNoteAgentDirPath(accountKey);
    const resolvedPath = path.resolve(noteAgentDir, relativePath);
    const normalizedNoteAgentDir = `${path.resolve(noteAgentDir)}${path.sep}`;

    if (resolvedPath !== path.resolve(noteAgentDir) && !resolvedPath.startsWith(normalizedNoteAgentDir)) {
      throw new Error(`Invalid Zhihu note-agent asset path: ${relativePath}`);
    }

    return resolvedPath;
  }

  private async ensureAccountLibrary(accountKey: string, account?: AccountLibraryLookupAccount) {
    const libraryPath = this.getAccountLibraryPath(accountKey);
    await fs.mkdir(libraryPath, { recursive: true });
    await fs.mkdir(this.getAccountNoteAgentDirPath(accountKey), { recursive: true });

    const manifest = buildDefaultLibraryManifest(accountKey, account);
    const manifestPath = this.getAccountLibraryDocumentPath(accountKey, "manifest.json");
    try {
      await fs.access(manifestPath);
    } catch {
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }

    for (const doc of manifest.docs) {
      const filePath = this.getAccountLibraryDocumentPath(accountKey, doc.path);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, buildBootstrapDocumentContent(accountKey, doc, account), "utf8");
      }
    }

    for (const asset of NOTE_AGENT_ASSETS) {
      const filePath = this.getAccountNoteAgentAssetPath(accountKey, asset.path);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, asset.defaultContent, "utf8");
      }
    }
  }
}

function buildDefaultAccountMap(): ZhihuAccountLibraryMap {
  return {
    version: 1,
    mappings: []
  };
}

function buildDefaultAccountKey(account: AccountLibraryLookupAccount) {
  return `account_${account.id}`;
}

function buildDefaultLibraryManifest(
  accountKey: string,
  account?: AccountLibraryLookupAccount
): ZhihuAccountLibraryManifest {
  return {
    accountKey,
    displayName: account?.name?.trim() || accountKey,
    version: 1,
    docs: [
      {
        id: "style_rules",
        type: "style_rules",
        title: "Style Rules",
        description: "Stable account-specific writing constraints used by Writer and Review.",
        format: "markdown",
        path: "style_rules.md",
        enabled: true,
        stages: ["writer", "review"],
        maxItems: 1
      },
      {
        id: "answer_structure_rules",
        type: "answer_structure_rules",
        title: "Answer Structure Rules",
        description: "Controls answer pacing, paragraph density, and section transitions.",
        format: "markdown",
        path: "answer_structure_rules.md",
        enabled: true,
        stages: ["writer", "review"],
        maxItems: 1
      },
      {
        id: "evidence_rules",
        type: "evidence_rules",
        title: "Evidence Rules",
        description: "Controls examples, numbers, proof anchors, and caveat density.",
        format: "markdown",
        path: "evidence_rules.md",
        enabled: true,
        stages: ["writer", "review"],
        maxItems: 1
      },
      {
        id: "review_rubric",
        type: "review_rubric",
        title: "Review Rubric",
        description: "Account-specific review checklist for voice fit, structure, and naturalness.",
        format: "markdown",
        path: "review_rubric.md",
        enabled: true,
        stages: ["review"],
        maxItems: 1
      },
      {
        id: "good_answers",
        type: "good_answers",
        title: "Good Answers",
        description: "Curated positive answer examples for this account.",
        format: "jsonl",
        path: "good_answers.jsonl",
        enabled: true,
        stages: ["writer", "review"],
        maxItems: 3
      },
      {
        id: "bad_answers",
        type: "bad_answers",
        title: "Bad Answers",
        description: "Curated anti-pattern examples used by Review.",
        format: "jsonl",
        path: "bad_answers.jsonl",
        enabled: true,
        stages: ["review"],
        maxItems: 3
      },
      {
        id: "sample_filter",
        type: "sample_filter",
        title: "Sample Filter",
        description: "Account-positioning-based filtering rules for note-agent sampling.",
        format: "markdown",
        path: "sample_filter.md",
        enabled: true,
        stages: ["writer", "review"],
        maxItems: 1
      }
    ]
  };
}

const NOTE_AGENT_ASSETS = [
  {
    path: "learned_style_profile.md",
    defaultContent: ""
  },
  {
    path: "learned_samples.jsonl",
    defaultContent: ""
  },
  {
    path: "source_map.yaml",
    defaultContent: ""
  },
  {
    path: "last_run.json",
    defaultContent: ""
  },
  {
    path: "soul_candidate.md",
    defaultContent: ""
  }
] as const;

function buildBootstrapDocumentContent(
  accountKey: string,
  document: ZhihuAccountLibraryDocumentManifest,
  account?: AccountLibraryLookupAccount
) {
  if (document.format === "jsonl") {
    return "";
  }

  if (document.type === "style_rules") {
    return [
      `# ${account?.name?.trim() || accountKey} Style Rules`,
      "",
      "## Purpose",
      "",
      "- Fill this file with stable voice rules after note-agent apply.",
      "- Writer and Review read this file as the first account-specific style layer."
    ].join("\n");
  }

  if (document.type === "answer_structure_rules") {
    return [
      `# ${account?.name?.trim() || accountKey} Answer Structure Rules`,
      "",
      "## Purpose",
      "",
      "- Define opening pace, paragraph density, and section transitions for this account.",
      "- Keep rules stable and account-specific, not topic-specific."
    ].join("\n");
  }

  if (document.type === "evidence_rules") {
    return [
      `# ${account?.name?.trim() || accountKey} Evidence Rules`,
      "",
      "## Purpose",
      "",
      "- Define how this account uses numbers, examples, proof anchors, and caveats.",
      "- Keep guidance specific enough for writer and review to reuse."
    ].join("\n");
  }

  if (document.type === "review_rubric") {
    return [
      `# ${account?.name?.trim() || accountKey} Review Rubric`,
      "",
      "## Purpose",
      "",
      "- Review voice fit, structure fit, AI smell, and naturalness for this account.",
      "- Reject copied-source writing and generic slogan-heavy answers."
    ].join("\n");
  }

  if (document.type === "sample_filter") {
    return buildDefaultSampleFilterMarkdown(accountKey, account);
  }

  return "";
}

function buildDefaultSampleFilterMarkdown(accountKey: string, account?: AccountLibraryLookupAccount) {
  const accountName = account?.name?.trim() || accountKey;
  const zhihuUserName = account?.zhihuUserName?.trim() || "";

  return [
    "# Sample Filter",
    "",
    "## Target Positioning",
    "",
    `- Target account name: ${accountName}`,
    ...(zhihuUserName ? [`- Target Zhihu username: ${zhihuUserName}`] : []),
    "- Filter by what this target account can realistically learn from, not by generic growth goals.",
    "",
    "## Keep",
    "",
    "- Keep answer-like samples with clear viewpoint, concrete explanation, and stable phrasing rhythm.",
    "- Prefer samples that show how the source account opens, transitions, gives caveats, and closes.",
    "",
    "## Remove",
    "",
    "- Remove brand slogans, repeated closing lines, repeated self-intros, and high-duplication phrases.",
    "- Remove pure announcement, activity, recruitment, subscription, or profile-intro answers.",
    "- Remove near-duplicate answers, extremely short low-information answers, and samples that read like templates.",
    "",
    "## Notes",
    "",
    "- This file is account-scoped and may be refined later, but it should remain lightweight in v1."
  ].join("\n");
}

function normalizeAccountMap(value: unknown): ZhihuAccountLibraryMap {
  const raw = (value ?? {}) as Partial<ZhihuAccountLibraryMap>;

  return {
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? Math.max(1, Math.round(raw.version)) : 1,
    mappings: Array.isArray(raw.mappings)
      ? raw.mappings
          .map((item) => ({
            accountKey: String(item.accountKey ?? "").trim(),
            enabled: item.enabled !== false,
            accountIds: normalizePositiveIntegers(item.accountIds),
            zhihuUserNames: normalizeStringArray(item.zhihuUserNames),
            accountNames: normalizeStringArray(item.accountNames)
          }))
          .filter((item) => item.accountKey)
      : []
  };
}

function normalizeLibraryManifest(value: unknown, fallbackAccountKey: string): ZhihuAccountLibraryManifest {
  const raw = (value ?? {}) as Partial<ZhihuAccountLibraryManifest>;
  const docs = Array.isArray(raw.docs)
    ? raw.docs
        .map((item) => normalizeDocumentManifest(item))
        .filter((item): item is ZhihuAccountLibraryDocumentManifest => Boolean(item))
    : [];

  return {
    accountKey: String(raw.accountKey ?? fallbackAccountKey).trim() || fallbackAccountKey,
    displayName: String(raw.displayName ?? fallbackAccountKey).trim() || fallbackAccountKey,
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? Math.max(1, Math.round(raw.version)) : 1,
    docs
  };
}

function normalizeDocumentManifest(value: unknown): ZhihuAccountLibraryDocumentManifest | null {
  const raw = (value ?? {}) as Partial<ZhihuAccountLibraryDocumentManifest>;
  if (!raw.id || !raw.type || !raw.path || !raw.format) {
    return null;
  }

  const stages = Array.isArray(raw.stages) ? raw.stages.filter((item) => item === "writer" || item === "review") : [];

  return {
    id: String(raw.id).trim(),
    type: normalizeDocType(raw.type),
    title: String(raw.title ?? raw.id).trim() || String(raw.id).trim(),
    description: String(raw.description ?? "").trim(),
    format: raw.format === "jsonl" ? "jsonl" : "markdown",
    path: String(raw.path).trim(),
    enabled: raw.enabled !== false,
    stages: stages.length ? stages : ["writer", "review"],
    maxItems: typeof raw.maxItems === "number" && Number.isFinite(raw.maxItems) ? Math.max(1, Math.round(raw.maxItems)) : 3
  };
}

function normalizeDocType(value: unknown): ZhihuAccountLibraryDocumentManifest["type"] {
  switch (value) {
    case "style_rules":
    case "answer_structure_rules":
    case "evidence_rules":
    case "review_rubric":
    case "good_answers":
    case "bad_answers":
    case "sample_filter":
      return value;
    default:
      return "style_rules";
  }
}

function normalizeExampleRecord(value: unknown): ZhihuAccountLibraryExampleRecord {
  const raw = (value ?? {}) as Partial<ZhihuAccountLibraryExampleRecord>;

  return {
    id: String(raw.id ?? "").trim(),
    text: String(raw.text ?? "").trim(),
    notes: String(raw.notes ?? "").trim(),
    questionTitle: String(raw.questionTitle ?? "").trim(),
    questionUrl: normalizeOptionalString(raw.questionUrl),
    answerUrl: normalizeOptionalString(raw.answerUrl)
  };
}

function normalizePositiveIntegers(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "number" ? item : Number(item)))
        .filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function normalizeOptionalString(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function normalizeMatchValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/^@+/, "").toLowerCase() : "";
}

function normalizeTextDocument(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized ? `${normalized}\n` : "";
}
