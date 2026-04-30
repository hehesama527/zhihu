import type { XAccount, XDraftPack, XRetrievalContext, XRetrievalContextDocument, XTask } from "@zhihu-mvp/x-core";
import { XTraditionalRagRepository } from "../repositories/x-traditional-rag-repository.js";
import type {
  XTraditionalRagAccountMapping,
  XTraditionalRagDocumentManifest,
  XTraditionalRagExampleRecord,
  XTraditionalRagStage
} from "../types.js";

export class XTraditionalRagService {
  constructor(private readonly repository = new XTraditionalRagRepository()) {}

  async ensureReady() {
    await this.repository.ensureReady();
  }

  async buildWriterContext(input: {
    account: Pick<XAccount, "id" | "handle" | "name">;
    task: Pick<XTask, "title" | "brief" | "goal" | "preferredMode">;
    hotspotTitles?: string[];
  }): Promise<XRetrievalContext | null> {
    return this.buildContext({
      stage: "writer",
      account: input.account,
      preferredMode: resolveConcreteMode(input.task.preferredMode),
      queryText: [input.task.title, input.task.brief, input.task.goal, ...(input.hotspotTitles ?? [])].join("\n")
    });
  }

  async buildReviewContext(input: {
    account: Pick<XAccount, "id" | "handle" | "name">;
    task: Pick<XTask, "title" | "brief" | "goal" | "preferredMode">;
    draftPack: Pick<XDraftPack, "posts">;
  }): Promise<XRetrievalContext | null> {
    return this.buildContext({
      stage: "review",
      account: input.account,
      preferredMode: resolveConcreteMode(input.task.preferredMode),
      queryText: [input.task.title, input.task.brief, input.task.goal, ...(input.draftPack.posts ?? [])].join("\n")
    });
  }

  private async buildContext(input: {
    stage: XTraditionalRagStage;
    account: Pick<XAccount, "id" | "handle" | "name">;
    preferredMode: "single" | "thread";
    queryText: string;
  }): Promise<XRetrievalContext | null> {
    await this.repository.ensureReady();

    const accountMap = await this.repository.readAccountMap();
    const resolution = resolveAccountLibraryKey(accountMap.mappings, input.account);
    if (!resolution.accountKey) {
      return null;
    }

    const manifest = await this.repository.readLibraryManifest(resolution.accountKey);
    if (!manifest) {
      return null;
    }

    const documents: XRetrievalContextDocument[] = [];
    for (const document of manifest.docs) {
      if (!shouldUseDocument(document, input.stage, input.preferredMode)) {
        continue;
      }

      const nextDocument = await this.buildDocument({
        accountKey: manifest.accountKey,
        stage: input.stage,
        document,
        queryText: input.queryText
      });
      if (nextDocument) {
        documents.push(nextDocument);
      }
    }

    if (!documents.length) {
      return null;
    }

    return {
      accountKey: manifest.accountKey,
      stage: input.stage,
      notes: [
        `Traditional isolated RAG library: ${manifest.accountKey}`,
        resolution.matchedBy ? `Library resolved by ${resolution.matchedBy}.` : "Library resolved by fallback."
      ],
      documents
    };
  }

  private async buildDocument(input: {
    accountKey: string;
    stage: XTraditionalRagStage;
    document: XTraditionalRagDocumentManifest;
    queryText: string;
  }): Promise<XRetrievalContextDocument | null> {
    if (input.document.format === "markdown") {
      const content = compactMarkdown(await this.repository.readMarkdownDocument(input.accountKey, input.document.path));
      if (!content) {
        return null;
      }

      return {
        id: input.document.id,
        type: input.document.type,
        title: input.document.title,
        description: input.document.description,
        instruction: buildDocumentInstruction(input.document, input.stage),
        snippets: [content],
        sourcePath: `rag/accounts/${input.accountKey}/${input.document.path}`
      };
    }

    const records = await this.repository.readExampleRecords(input.accountKey, input.document.path);
    const selectedRecords = selectExampleRecords(records, input.document, input.queryText);
    if (!selectedRecords.length) {
      return null;
    }

    return {
      id: input.document.id,
      type: input.document.type,
      title: input.document.title,
      description: input.document.description,
      instruction: buildDocumentInstruction(input.document, input.stage),
      snippets: selectedRecords.map((record) => formatExampleSnippet(input.document.type, record)),
      sourcePath: `rag/accounts/${input.accountKey}/${input.document.path}`
    };
  }
}

function resolveAccountLibraryKey(
  mappings: XTraditionalRagAccountMapping[],
  account: Pick<XAccount, "id" | "handle" | "name">
) {
  const normalizedId = account.id.trim();
  const normalizedHandle = normalizeMatchValue(account.handle);
  const normalizedName = normalizeMatchValue(account.name);

  const byId = mappings.find((item) => item.enabled && item.accountIds.map(normalizeMatchValue).includes(normalizedId));
  if (byId) {
    return { accountKey: byId.accountKey, matchedBy: "accountId" };
  }

  const byHandle = mappings.find(
    (item) => item.enabled && item.handles.map(normalizeMatchValue).includes(normalizedHandle)
  );
  if (byHandle) {
    return { accountKey: byHandle.accountKey, matchedBy: "handle" };
  }

  const byName = mappings.find((item) => item.enabled && item.names.map(normalizeMatchValue).includes(normalizedName));
  if (byName) {
    return { accountKey: byName.accountKey, matchedBy: "name" };
  }

  return { accountKey: null, matchedBy: null };
}

function shouldUseDocument(
  document: XTraditionalRagDocumentManifest,
  stage: XTraditionalRagStage,
  preferredMode: "single" | "thread"
) {
  return document.enabled && document.stages.includes(stage) && document.modes.includes(preferredMode);
}

function buildDocumentInstruction(document: XTraditionalRagDocumentManifest, stage: XTraditionalRagStage) {
  switch (document.type) {
    case "style_rules":
      return stage === "writer"
        ? "Apply these as stable account-level phrasing and structure constraints."
        : "Use these to judge whether the draft sounds like this exact account.";
    case "number_expression_rules":
      return stage === "writer"
        ? "Use these rules to decide exact numbers, ranges, and natural virtual reference."
        : "Use these rules to flag table-reciting, over-dense, or unnatural number expression.";
    case "review_rubric":
      return "Use this rubric as account-specific review criteria for AI smell, topic fit, and naturalness.";
    case "good_single_posts":
    case "good_threads":
      return "Treat these as mechanism references only. Learn rhythm and compression, but do not copy wording.";
    case "bad_posts":
      return "Treat these as anti-patterns. Flag drafts that feel structurally similar.";
    default:
      return "Use this retrieved guidance only when it clearly improves account fit.";
  }
}

function selectExampleRecords(
  records: XTraditionalRagExampleRecord[],
  document: XTraditionalRagDocumentManifest,
  queryText: string
) {
  const normalizedQuery = normalizeMatchValue(queryText);
  return records
    .map((record) => ({
      record,
      score: scoreExampleRecord(record, normalizedQuery)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, document.maxItems)
    .map((item) => item.record);
}

function scoreExampleRecord(record: XTraditionalRagExampleRecord, normalizedQuery: string) {
  const topicScore = record.topicTags.reduce(
    (score, tag) => (normalizedQuery.includes(normalizeMatchValue(tag)) ? score + 3 : score),
    0
  );
  const voiceScore = record.voiceTags.reduce(
    (score, tag) => (normalizedQuery.includes(normalizeMatchValue(tag)) ? score + 2 : score),
    0
  );
  const textScore = normalizeMatchValue(record.text)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 20)
    .reduce((score, token) => (token && normalizedQuery.includes(token) ? score + 1 : score), 0);

  return topicScore + voiceScore + textScore;
}

function formatExampleSnippet(type: XTraditionalRagDocumentManifest["type"], record: XTraditionalRagExampleRecord) {
  return [
    type === "bad_posts" ? `Anti-pattern: ${record.text}` : `Example: ${record.text}`,
    record.notes ? `Notes: ${record.notes}` : null,
    record.topicTags.length ? `Topic tags: ${record.topicTags.join(", ")}` : null,
    record.voiceTags.length ? `Voice tags: ${record.voiceTags.join(", ")}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function compactMarkdown(markdown: string) {
  const normalized = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return normalized.length > 2200 ? `${normalized.slice(0, 2200).trim()}...` : normalized;
}

function resolveConcreteMode(value: XTask["preferredMode"]) {
  return value === "thread" ? "thread" : "single";
}

function normalizeMatchValue(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}
