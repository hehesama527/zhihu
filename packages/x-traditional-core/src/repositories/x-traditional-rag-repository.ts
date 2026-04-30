import fs from "node:fs/promises";
import path from "node:path";
import { getXTraditionalAppConfig } from "../config.js";
import type {
  XTraditionalRagAccountMap,
  XTraditionalRagDocumentManifest,
  XTraditionalRagExampleRecord,
  XTraditionalRagLibraryManifest
} from "../types.js";

export class XTraditionalRagRepository {
  private readonly config = getXTraditionalAppConfig();
  private readonly accountConfigsRootPath = path.join(this.config.dataDir, "account-configs", "accounts");
  private readonly ragRootPath = path.join(this.config.dataDir, "rag");
  private readonly ragAccountsRootPath = path.join(this.ragRootPath, "accounts");
  private readonly accountMapFilePath = path.join(this.ragRootPath, "account-library-map.json");
  private readonly readmeFilePath = path.join(this.ragRootPath, "README.md");

  async ensureReady() {
    await fs.mkdir(this.ragAccountsRootPath, { recursive: true });

    const accountKeys = await this.listConfiguredAccountKeys();
    for (const accountKey of accountKeys) {
      await this.ensureAccountLibrary(accountKey);
    }

    await this.ensureAccountMap(accountKeys);
  }

  async readAccountMap(): Promise<XTraditionalRagAccountMap> {
    await this.ensureReady();

    try {
      const raw = await fs.readFile(this.accountMapFilePath, "utf8");
      return normalizeAccountMap(JSON.parse(raw));
    } catch {
      const accountKeys = await this.listConfiguredAccountKeys();
      return normalizeAccountMap(buildDefaultAccountMap(accountKeys));
    }
  }

  async resolveAccountLibrary(account: { id: string; handle: string; name: string }) {
    const accountMap = await this.readAccountMap();
    const normalizedId = account.id.trim();
    const normalizedHandle = normalizeMatchValue(account.handle);
    const normalizedName = normalizeMatchValue(account.name);

    const byId = accountMap.mappings.find(
      (item) => item.enabled && item.accountIds.map(normalizeMatchValue).includes(normalizedId)
    );
    if (byId) {
      return {
        accountKey: byId.accountKey,
        matchedBy: "accountId" as const
      };
    }

    const byHandle = accountMap.mappings.find(
      (item) => item.enabled && item.handles.map(normalizeMatchValue).includes(normalizedHandle)
    );
    if (byHandle) {
      return {
        accountKey: byHandle.accountKey,
        matchedBy: "handle" as const
      };
    }

    const byName = accountMap.mappings.find(
      (item) => item.enabled && item.names.map(normalizeMatchValue).includes(normalizedName)
    );
    if (byName) {
      return {
        accountKey: byName.accountKey,
        matchedBy: "name" as const
      };
    }

    return {
      accountKey: null,
      matchedBy: null
    };
  }

  async readRootReadme() {
    await this.ensureReady();

    try {
      return await fs.readFile(this.readmeFilePath, "utf8");
    } catch {
      return "";
    }
  }

  async readAccountConfigBundle(accountKey: string) {
    await this.ensureReady();
    const accountConfigDir = this.getAccountConfigDirPath(accountKey);

    return {
      accountConfigDir,
      soulMarkdown: await this.readOptionalFile(path.join(accountConfigDir, "soul.md")),
      strategyYaml: await this.readOptionalFile(path.join(accountConfigDir, "strategy.yaml")),
      goalsYaml: await this.readOptionalFile(path.join(accountConfigDir, "goals.yaml")),
      sampleFilterMarkdown: await this.readOptionalFile(path.join(accountConfigDir, "sample_filter.md")),
      boundariesMarkdown: await this.readOptionalFile(path.join(accountConfigDir, "boundaries.yaml"))
    };
  }

  async readSoulCandidate(accountKey: string) {
    await this.ensureReady();
    return this.readOptionalFile(this.getSoulCandidatePath(accountKey));
  }

  async readLibraryManifest(accountKey: string): Promise<XTraditionalRagLibraryManifest | null> {
    await this.ensureReady();
    const filePath = path.join(this.getAccountLibraryPath(accountKey), "manifest.json");

    try {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeLibraryManifest(JSON.parse(raw), accountKey);
    } catch {
      return null;
    }
  }

  async readMarkdownDocument(accountKey: string, relativePath: string) {
    await this.ensureReady();

    try {
      return await fs.readFile(this.resolveLibraryDocumentPath(accountKey, relativePath), "utf8");
    } catch {
      return "";
    }
  }

  async readNoteAgentAsset(accountKey: string, relativePath: string) {
    await this.ensureReady();
    return this.readOptionalFile(this.resolveNoteAgentAssetPath(accountKey, relativePath));
  }

  async readExampleRecords(accountKey: string, relativePath: string): Promise<XTraditionalRagExampleRecord[]> {
    await this.ensureReady();

    try {
      const raw = await fs.readFile(this.resolveLibraryDocumentPath(accountKey, relativePath), "utf8");
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

  async writeMarkdownDocument(accountKey: string, relativePath: string, content: string) {
    await this.ensureReady();
    const filePath = this.resolveLibraryDocumentPath(accountKey, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return filePath;
  }

  async writeSoulCandidate(accountKey: string, content: string) {
    await this.ensureReady();
    const filePath = this.getSoulCandidatePath(accountKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return filePath;
  }

  async writeNoteAgentAsset(accountKey: string, relativePath: string, content: string) {
    await this.ensureReady();
    const filePath = this.resolveNoteAgentAssetPath(accountKey, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return filePath;
  }

  getRootReadmePath() {
    return this.readmeFilePath;
  }

  getAccountConfigDirPath(accountKey: string) {
    return path.join(this.accountConfigsRootPath, accountKey);
  }

  getAccountConfigFilePath(accountKey: string, relativePath: string) {
    const accountConfigDir = this.getAccountConfigDirPath(accountKey);
    const resolvedPath = path.resolve(accountConfigDir, relativePath);
    const normalizedAccountConfigDir = `${path.resolve(accountConfigDir)}${path.sep}`;

    if (resolvedPath !== path.resolve(accountConfigDir) && !resolvedPath.startsWith(normalizedAccountConfigDir)) {
      throw new Error(`Invalid traditional account config path: ${relativePath}`);
    }

    return resolvedPath;
  }

  getSoulCandidatePath(accountKey: string) {
    return this.getAccountConfigFilePath(accountKey, "soul_candidate.md");
  }

  getAccountLibraryDocumentPath(accountKey: string, relativePath: string) {
    return this.resolveLibraryDocumentPath(accountKey, relativePath);
  }

  getAccountNoteAgentDirPath(accountKey: string) {
    return this.resolveLibraryDocumentPath(accountKey, "note-agent");
  }

  getAccountNoteAgentAssetPath(accountKey: string, relativePath: string) {
    return this.resolveNoteAgentAssetPath(accountKey, relativePath);
  }

  private async ensureAccountMap(accountKeys: string[]) {
    try {
      await fs.access(this.accountMapFilePath);
    } catch {
      await fs.writeFile(this.accountMapFilePath, JSON.stringify(buildDefaultAccountMap(accountKeys), null, 2), "utf8");
    }
  }

  private async ensureAccountLibrary(accountKey: string) {
    const libraryPath = this.getAccountLibraryPath(accountKey);
    await fs.mkdir(libraryPath, { recursive: true });

    const manifest = buildDefaultLibraryManifest(accountKey);
    const manifestPath = path.join(libraryPath, "manifest.json");

    try {
      await fs.access(manifestPath);
    } catch {
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }

    for (const doc of manifest.docs) {
      const filePath = path.join(libraryPath, doc.path);

      try {
        await fs.access(filePath);
      } catch {
        const content = buildBootstrapDocumentContent(accountKey, doc);
        await fs.writeFile(filePath, content, "utf8");
      }
    }
  }

  private async listConfiguredAccountKeys() {
    try {
      const entries = await fs.readdir(this.accountConfigsRootPath, { withFileTypes: true });
      const accountKeys = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name.trim())
        .filter(Boolean)
        .sort();

      if (accountKeys.length) {
        return accountKeys;
      }
    } catch {
      // ignore and fallback
    }

    return ["account_a", "account_b"];
  }

  getAccountLibraryPath(accountKey: string) {
    return path.join(this.ragAccountsRootPath, accountKey);
  }

  private resolveLibraryDocumentPath(accountKey: string, relativePath: string) {
    const libraryPath = this.getAccountLibraryPath(accountKey);
    const resolvedPath = path.resolve(libraryPath, relativePath);
    const normalizedLibraryPath = `${path.resolve(libraryPath)}${path.sep}`;

    if (resolvedPath !== path.resolve(libraryPath) && !resolvedPath.startsWith(normalizedLibraryPath)) {
      throw new Error(`Invalid traditional RAG document path: ${relativePath}`);
    }

    return resolvedPath;
  }

  private resolveNoteAgentAssetPath(accountKey: string, relativePath: string) {
    const noteAgentDir = this.getAccountNoteAgentDirPath(accountKey);
    const resolvedPath = path.resolve(noteAgentDir, relativePath);
    const normalizedNoteAgentDir = `${path.resolve(noteAgentDir)}${path.sep}`;

    if (resolvedPath !== path.resolve(noteAgentDir) && !resolvedPath.startsWith(normalizedNoteAgentDir)) {
      throw new Error(`Invalid note-agent asset path: ${relativePath}`);
    }

    return resolvedPath;
  }

  private async readOptionalFile(filePath: string) {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return "";
    }
  }
}

function buildDefaultAccountMap(accountKeys: string[]): XTraditionalRagAccountMap {
  return {
    version: 1,
    mappings: accountKeys.map((accountKey) => ({
      accountKey,
      enabled: true,
      accountIds: [],
      handles: [accountKey],
      names: [accountKey.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())]
    }))
  };
}

function buildDefaultLibraryManifest(accountKey: string): XTraditionalRagLibraryManifest {
  return {
    accountKey,
    displayName: accountKey,
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
        modes: ["single", "thread"],
        maxItems: 1
      },
      {
        id: "number_expression_rules",
        type: "number_expression_rules",
        title: "Number Expression Rules",
        description: "Controls when to use exact numbers, ranges, or natural virtual reference.",
        format: "markdown",
        path: "number_expression_rules.md",
        enabled: true,
        stages: ["writer", "review"],
        modes: ["single", "thread"],
        maxItems: 1
      },
      {
        id: "review_rubric",
        type: "review_rubric",
        title: "Review Rubric",
        description: "Account-specific review checklist for AI smell, topic fit, and naturalness.",
        format: "markdown",
        path: "review_rubric.md",
        enabled: true,
        stages: ["review"],
        modes: ["single", "thread"],
        maxItems: 1
      },
      {
        id: "good_single_posts",
        type: "good_single_posts",
        title: "Good Single Posts",
        description: "Curated single-post examples for this account.",
        format: "jsonl",
        path: "good_single_posts.jsonl",
        enabled: true,
        stages: ["writer", "review"],
        modes: ["single"],
        maxItems: 3
      },
      {
        id: "good_threads",
        type: "good_threads",
        title: "Good Threads",
        description: "Curated thread examples for this account.",
        format: "jsonl",
        path: "good_threads.jsonl",
        enabled: true,
        stages: ["writer", "review"],
        modes: ["thread"],
        maxItems: 2
      },
      {
        id: "bad_posts",
        type: "bad_posts",
        title: "Bad Posts",
        description: "Rejected anti-patterns used by Review to catch AI smell and data overexposure.",
        format: "jsonl",
        path: "bad_posts.jsonl",
        enabled: true,
        stages: ["review"],
        modes: ["single", "thread"],
        maxItems: 3
      }
    ]
  };
}

function buildBootstrapDocumentContent(accountKey: string, document: XTraditionalRagDocumentManifest) {
  if (document.format === "jsonl") {
    return "";
  }

  if (document.type === "style_rules") {
    return accountKey === "account_b" ? ACCOUNT_B_STYLE_RULES : ACCOUNT_A_STYLE_RULES;
  }

  if (document.type === "number_expression_rules") {
    return accountKey === "account_b" ? ACCOUNT_B_NUMBER_RULES : ACCOUNT_A_NUMBER_RULES;
  }

  if (document.type === "review_rubric") {
    return accountKey === "account_b" ? ACCOUNT_B_REVIEW_RUBRIC : ACCOUNT_A_REVIEW_RUBRIC;
  }

  return "";
}

function normalizeAccountMap(value: unknown): XTraditionalRagAccountMap {
  const raw = (value ?? {}) as Partial<XTraditionalRagAccountMap>;
  return {
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? Math.max(1, Math.round(raw.version)) : 1,
    mappings: Array.isArray(raw.mappings)
      ? raw.mappings
          .map((item) => ({
            accountKey: String(item.accountKey ?? "").trim(),
            enabled: item.enabled !== false,
            accountIds: normalizeStringArray(item.accountIds),
            handles: normalizeStringArray(item.handles),
            names: normalizeStringArray(item.names)
          }))
          .filter((item) => item.accountKey)
      : []
  };
}

function normalizeLibraryManifest(value: unknown, fallbackAccountKey: string): XTraditionalRagLibraryManifest {
  const raw = (value ?? {}) as Partial<XTraditionalRagLibraryManifest>;
  const docs = Array.isArray(raw.docs)
    ? raw.docs
        .map((item) => normalizeDocumentManifest(item))
        .filter((item): item is XTraditionalRagDocumentManifest => Boolean(item))
    : [];

  return {
    accountKey: String(raw.accountKey ?? fallbackAccountKey).trim() || fallbackAccountKey,
    displayName: String(raw.displayName ?? fallbackAccountKey).trim() || fallbackAccountKey,
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? Math.max(1, Math.round(raw.version)) : 1,
    docs
  };
}

function normalizeDocumentManifest(value: unknown): XTraditionalRagDocumentManifest | null {
  const raw = (value ?? {}) as Partial<XTraditionalRagDocumentManifest>;
  if (!raw.id || !raw.type || !raw.path || !raw.format) {
    return null;
  }

  const stages = Array.isArray(raw.stages) ? raw.stages.filter((item) => item === "writer" || item === "review") : [];
  const modes = Array.isArray(raw.modes) ? raw.modes.filter((item) => item === "single" || item === "thread") : [];
  const type = normalizeDocType(raw.type);
  const format = raw.format === "jsonl" ? "jsonl" : "markdown";

  return {
    id: String(raw.id).trim(),
    type,
    title: String(raw.title ?? raw.id).trim() || String(raw.id).trim(),
    description: String(raw.description ?? "").trim(),
    format,
    path: String(raw.path).trim(),
    enabled: raw.enabled !== false,
    stages: stages.length ? stages : ["writer", "review"],
    modes: modes.length ? modes : ["single", "thread"],
    maxItems: typeof raw.maxItems === "number" && Number.isFinite(raw.maxItems) ? Math.max(1, Math.round(raw.maxItems)) : 3
  };
}

function normalizeDocType(value: unknown): XTraditionalRagDocumentManifest["type"] {
  switch (value) {
    case "style_rules":
    case "number_expression_rules":
    case "review_rubric":
    case "good_single_posts":
    case "good_threads":
    case "bad_posts":
      return value;
    default:
      return "style_rules";
  }
}

function normalizeExampleRecord(value: unknown): XTraditionalRagExampleRecord {
  const raw = (value ?? {}) as Partial<XTraditionalRagExampleRecord>;
  return {
    id: String(raw.id ?? "").trim(),
    text: String(raw.text ?? "").trim(),
    notes: String(raw.notes ?? "").trim(),
    mode: raw.mode === "thread" ? "thread" : "single",
    topicTags: normalizeStringArray(raw.topicTags),
    voiceTags: normalizeStringArray(raw.voiceTags)
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function normalizeMatchValue(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

const ACCOUNT_A_STYLE_RULES = `# Account A Style Rules

## Positioning

- 这是一个讲指标、策略、执行的账号，不是老师口吻，也不是心灵鸡汤口吻。
- 优先输出“我怎么判断”和“我怎么处理”，不要写成长篇教学文。

## Preferred Moves

- 开头直接点出一个具体误区、参数或过滤条件。
- 允许出现参数，但参数要服务于执行，不要堆成教程。
- 结尾收在一句个人判断或执行边界，不要上价值。

## Avoid

- 不要写成“学会这个就够了”。
- 不要把内容写得像课程目录。
- 不要为了完整把定义、优点、缺点、总结全写齐。`;

const ACCOUNT_A_NUMBER_RULES = `# Account A Number Expression Rules

## Default Rule

- 单条优先只保留 1 到 2 个真正有用的参数。
- 如果数字只是辅助理解，不必全报，可以直接说“短周期”“大一级周期”“最近结构低点”。

## Keep Exact Numbers When

- 这个数字会直接影响执行，比如 20EMA、60EMA、2R。
- 不说这个数，观点就会变空。

## Prefer Natural Reference When

- 数字只是证明“盘得够久”“量明显放大”“止损太大”。
- 这时可以写成“盘了一段”“量明显高过均量”“这笔止损已经偏大”。

## Hard Avoid

- 不要把一套策略参数表完整搬进一条推文。
- 不要为了显得专业，把并不关键的数字报满。`;

const ACCOUNT_A_REVIEW_RUBRIC = `# Account A Review Rubric

## Pass Only If

- 读起来像一个在做交易记录和方法总结的人，而不是在上课。
- 有至少一个具体抓手，比如参数、结构、过滤条件、止损边界。
- 结尾没有鸡汤、没有口号、没有泛泛风险提示。

## Mark As AI-like If

- 定义、解释、边界、总结写得过于齐整。
- 像教程提纲，像课程宣传，像为了完整而完整。
- 数字很多，但没有一个数字真正决定判断。

## Fix Direction

- 删掉不影响结论的解释。
- 保留真正能指导执行的 1 到 2 个点。
- 把“教别人”改成“我会怎么处理”。`;

const ACCOUNT_B_STYLE_RULES = `# Account B Style Rules

## Positioning

- 这是一个做热点交易翻译的账号，不是新闻播报器。
- 重点是把热点变成判断，再把判断变成交易影响。

## Preferred Moves

- 开头先给结论，再补一个最关键的支撑点。
- 允许出现数据，但应该像真人提一个关键数字，不像把表格翻成中文。
- 更像盯盘笔记，不像行业周报。

## Avoid

- 不要完整复述新闻。
- 不要把同一组数据整齐报完。
- 不要出现“热点库”“样本”“编号”“系统”这种痕迹。`;

const ACCOUNT_B_NUMBER_RULES = `# Account B Number Expression Rules

## Default Rule

- 单条推文优先只保留 1 到 2 个硬数字。
- 多条 thread 全串优先不超过 3 到 4 个硬数字。

## Keep Exact Numbers When

- 这个数字本身就是观点支点，比如 funding 已经吃掉 200 万美元。
- 数字的变化顺序本身就是判断依据，比如前一天流出、第二天转正。

## Prefer Range Or Natural Reference When

- 数字只是为了证明强弱，可以写成“20 万枚级别”“几百万美元”“连续两天转正”。
- 同一张表里，不要把 BTC、ETH、SOL 的单日和 7 日全顺着念出来。

## Hard Avoid

- 不要把结构化数据整齐平铺成推文。
- 不要为了显得有依据，把表里每一列都搬过来。
- 不要出现像研究报告一样的完整表述。`;

const ACCOUNT_B_REVIEW_RUBRIC = `# Account B Review Rubric

## Pass Only If

- 读起来像一个真人在消化热点，不像资讯搬运。
- 判断先出来，数字和事实只是支撑，不是主角。
- 没有系统感、编号感、表格感。

## Mark As AI-like If

- 像在念表，数字密度太高，节奏过整。
- 开头像摘要，中间像数据栏，结尾像标准总结。
- 把热点写成“完整分析报告”，而不是一个人会发出来的推文。

## Fix Direction

- 先删掉不影响结论的数字。
- 保留 1 到 2 个最能支撑判断的数。
- 能用方向、区间、自然虚指表达的地方，不要强行精确。`;
