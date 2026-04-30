import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import type {
  XAccount,
  XDraftPack,
  XRetrievalContext,
  XReviewAgentResult,
  XTask
} from "../types.js";
import type { XJsonLlmService } from "./x-llm-service.js";

export class XReviewAgentService {
  private readonly reviewPromptSetName: string;

  constructor(
    private readonly llmService: XJsonLlmService,
    options: {
      reviewPromptSetName?: string;
    } = {}
  ) {
    this.reviewPromptSetName = options.reviewPromptSetName ?? "x_review_agent";
  }

  async reviewDraft(input: {
    account: XAccount;
    task: XTask;
    accountSoulMarkdown?: string | null;
    draftPack: XDraftPack;
    retrievalContext?: XRetrievalContext | null;
    recentPublishedTitles: string[];
    promptSnapshot?: PromptSnapshotMap | null;
  }) {
    const fallback: XReviewAgentResult = {
      verdict: "major_issue",
      summary: "Review agent fallback marked this draft as having major issues because structured output was invalid.",
      strengths: [],
      issues: ["The review output was invalid, so the draft needs another pass before release."],
      riskFlags: [],
      suggestedFixes: ["Tighten the draft, verify account fit, and rerun review."]
    };

    const output = await this.llmService.runJson<XReviewAgentResult>(
      this.reviewPromptSetName,
      {
        account: input.account,
        accountSoulMarkdown: input.accountSoulMarkdown ?? null,
        task: {
          title: input.task.title,
          brief: input.task.brief,
          goal: input.task.goal,
          preferredMode: input.task.preferredMode
        },
        planningContext: input.task.mainAgentPlan
          ? {
              usedFallback: input.task.mainAgentPlan.usedFallback,
              fallbackStage: input.task.mainAgentPlan.fallbackStage,
              preferredMode: input.task.mainAgentPlan.preferredMode,
              publishAction: input.task.mainAgentPlan.publishAction,
              contentStyle: input.task.mainAgentPlan.contentStyle,
              useHotspot: input.task.mainAgentPlan.useHotspot,
              selectedHotspotIds: input.task.mainAgentPlan.selectedHotspotIds,
              targetTweetUrl: input.task.mainAgentPlan.targetTweetUrl,
              tagPlan: input.task.mainAgentPlan.tagPlan,
              writerBrief: input.task.mainAgentPlan.writerBrief
            }
          : null,
        retrievalContext: input.retrievalContext ?? null,
        draftPack: input.draftPack,
        recentPublishedTitles: input.recentPublishedTitles,
        operatorNotes: input.account.manualNotes || null
      },
      fallback,
      {
        promptSnapshot: input.promptSnapshot ?? null,
        promptSuffix: joinPromptSuffixes(REVIEW_AGENT_ACCOUNT_SOUL_SUFFIX, buildRetrievalReviewSuffix(input.retrievalContext ?? null))
      }
    );

    return applyConcreteEvidenceReviewChecks(
      applySoulExemplarReuseChecks(
        applyTagPlanReviewChecks(
          {
            verdict: normalizeVerdict(output.verdict),
            summary: output.summary?.trim() || fallback.summary,
            strengths: normalizeStringArray(output.strengths),
            issues: normalizeStringArray(output.issues),
            riskFlags: normalizeStringArray(output.riskFlags),
            suggestedFixes: normalizeStringArray(output.suggestedFixes)
          } satisfies XReviewAgentResult,
          input.task.mainAgentPlan?.tagPlan ?? null,
          input.draftPack
        ),
        input.accountSoulMarkdown ?? null,
        input.draftPack
      ),
      input.task,
      input.draftPack
    );
  }
}

const REVIEW_AGENT_ACCOUNT_SOUL_SUFFIX = [
  "Account Soul review rule:",
  "1. accountSoulMarkdown is the stable account identity and voice anchor when present.",
  "2. Review whether the draft sounds like something this exact account would publish, not just whether it is generally good.",
  "3. Flag persona mismatch, boundary mismatch, taboo lexicon violations, unnatural product mentions, or voice drift in issues/riskFlags.",
  "4. Priority order: platform safety and global policy constraints first; accountSoulMarkdown second; task facts, research, hotspot context, and reference supplement must stay compatible with Soul.",
  "5. A draft is not a Soul mismatch merely because it covers a newer or sharper task frame than previous posts. Judge fit on voice, identity, boundaries, and product policy, not on topic familiarity alone.",
  "6. Do not ask Writer to rewrite a concrete task back into generic discipline copy, generic safety slogans, or generic account-intro material just to make it feel safer.",
  "7. Compact formatting is acceptable. Do not treat reduced line breaks or a single compact paragraph as a quality problem if the draft is still readable and native to X.",
  "8. If a non-tool task mentions a product, flag it when the brand name reads like a feature explanation, a standalone verification statement, or a closing punchline instead of a passing trader action.",
  "9. planningContext.tagPlan is the structured hashtag plan when present. Check whether the draft follows it without becoming spammy or SEO-like.",
  "10. If tagPlan says no hashtags, flag unnecessary discoverability hashtags. If tagPlan provides hashtags, check that the chosen hashtags are placed and scoped naturally.",
  "11. Soul Exemplar Lines are style references only. If the draft directly reuses exemplar wording, metaphors, or punchlines, flag it as drift into template-like copying.",
  "12. If this task or planningContext implies hotspot/data/point analysis, flag drafts that stay too abstract and fail to use any concrete evidence.",
  "13. Do not rewrite Soul and do not invent new Soul constraints. Only judge fit and propose draft-level fixes."
].join("\n");

function joinPromptSuffixes(...parts: Array<string | null | undefined>) {
  const normalized = parts.map((item) => item?.trim()).filter(Boolean);
  return normalized.length ? normalized.join("\n\n") : null;
}

function buildRetrievalReviewSuffix(retrievalContext: XRetrievalContext | null | undefined) {
  if (!retrievalContext?.documents.length) {
    return null;
  }

  const blocks = retrievalContext.documents.map((document, index) => {
    const snippets = document.snippets
      .map((snippet, snippetIndex) => `- snippet ${snippetIndex + 1}: ${snippet}`)
      .join("\n");

    return [
      `RAG doc ${index + 1}: ${document.title} (${document.type})`,
      `Description: ${document.description}`,
      `Instruction: ${document.instruction}`,
      snippets ? `Snippets:\n${snippets}` : null
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "Account retrieval context for review:",
    "1. The following guidance comes from this account's isolated traditional RAG library.",
    "2. Use rules docs as draft-level judgment criteria. Use examples and anti-examples only as pattern references, not as wording templates.",
    "3. If retrieved guidance conflicts with accountSoulMarkdown or current task facts, Soul and task facts win.",
    "4. When account-specific review rules ask for looser number expression, natural virtual reference, or lower table-like density, enforce that in issues and suggestedFixes.",
    retrievalContext.notes.length ? `Notes:\n${retrievalContext.notes.map((item) => `- ${item}`).join("\n")}` : null,
    ...blocks
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeVerdict(value: XReviewAgentResult["verdict"] | undefined): XReviewAgentResult["verdict"] {
  if (value === "pass" || value === "minor_issue" || value === "major_issue" || value === "block") {
    return value;
  }

  return "major_issue";
}

function normalizeStringArray(value: string[] | undefined) {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : [];
}

function applyTagPlanReviewChecks(
  result: XReviewAgentResult,
  tagPlan: NonNullable<XTask["mainAgentPlan"]>["tagPlan"] | null,
  draftPack: XDraftPack
) {
  if (!tagPlan || !draftPack.posts.length) {
    return result;
  }

  const issues = [...result.issues];
  const riskFlags = [...result.riskFlags];
  const suggestedFixes = [...result.suggestedFixes];
  const hashtagsPerPost = draftPack.posts.map((post) => extractHashtags(post));
  const allHashtags = Array.from(new Set(hashtagsPerPost.flat()));

  if (!tagPlan.hashtags.length || tagPlan.placement === "none" || tagPlan.maxTags <= 0) {
    if (allHashtags.length > 0) {
      issues.push("当前规划没有要求 hashtag，但草稿里出现了额外标签，容易显得像模板化分发。");
      suggestedFixes.push("删除未规划的 hashtag，保持正文原生感。");
    }
    return {
      ...result,
      issues: normalizeStringArray(issues),
      riskFlags: normalizeStringArray(riskFlags),
      suggestedFixes: normalizeStringArray(suggestedFixes)
    };
  }

  const targetIndexes = resolveTagTargetIndexes(tagPlan.applyTo, draftPack.posts.length);
  const expectedHashtags = tagPlan.hashtags.slice(0, Math.max(0, tagPlan.maxTags));

  if (tagPlan.placement === "tail") {
    for (const index of targetIndexes) {
      const post = draftPack.posts[index] ?? "";
      const trailingHashtags = extractTrailingHashtags(post);
      const missing = expectedHashtags.filter((item) => !trailingHashtags.includes(item));
      if (missing.length > 0) {
        issues.push(`第 ${index + 1} 条没有按规划把 hashtag 放到结尾：缺少 ${missing.join(" ")}。`);
        suggestedFixes.push(`按 tagPlan 把 ${missing.join(" ")} 放到指定帖子的结尾，别散落到正文里。`);
        break;
      }
    }
  }

  if (hashtagsPerPost.some((item) => item.length > tagPlan.maxTags)) {
    riskFlags.push("某条草稿的 hashtag 数量超过规划上限，读感会偏 SEO。");
    suggestedFixes.push(`把 hashtag 数量控制在 ${tagPlan.maxTags} 个以内。`);
  }

  const unexpectedTags = allHashtags.filter((item) => !expectedHashtags.includes(item));
  if (unexpectedTags.length > 0) {
    riskFlags.push(`草稿出现了规划外的 hashtag：${unexpectedTags.join(" ")}。`);
  }

  return {
    ...result,
    issues: normalizeStringArray(issues),
    riskFlags: normalizeStringArray(riskFlags),
    suggestedFixes: normalizeStringArray(suggestedFixes)
  };
}

function applySoulExemplarReuseChecks(
  result: XReviewAgentResult,
  accountSoulMarkdown: string | null,
  draftPack: XDraftPack
) {
  const exemplars = extractMarkdownBulletSection(accountSoulMarkdown ?? "", "Exemplar Lines");
  if (!exemplars.length || !draftPack.posts.length) {
    return result;
  }

  const normalizedDraft = normalizeComparableText(draftPack.posts.join("\n"));
  const reusedExemplars = exemplars.filter((line) => getComparableFragments(line).some((fragment) => normalizedDraft.includes(fragment)));
  if (!reusedExemplars.length) {
    return result;
  }

  return {
    ...result,
    verdict: escalateReviewVerdict(result.verdict, "minor_issue"),
    issues: normalizeStringArray([
      ...result.issues,
      `Soul 例句复用过直，草稿里出现了接近原样的表达：${reusedExemplars.slice(0, 2).join(" / ")}`
    ]),
    riskFlags: normalizeStringArray([...result.riskFlags, "当前草稿更像在搬运 Soul 样例，而不是自然生成该账号的说话方式。"]),
    suggestedFixes: normalizeStringArray([
      ...result.suggestedFixes,
      "保留情绪与执行语言，但换掉原例句的隐喻对象、句式骨架和 punchline。"
    ])
  };
}

function applyConcreteEvidenceReviewChecks(result: XReviewAgentResult, task: XTask, draftPack: XDraftPack) {
  const planningEvidence = [
    task.title,
    task.brief,
    task.goal,
    task.mainAgentPlan?.runtimeWriterPrompt ?? "",
    task.mainAgentPlan?.writerBrief?.angle ?? "",
    task.mainAgentPlan?.writerBrief?.goal ?? "",
    ...(task.mainAgentPlan?.writerBrief?.mustInclude ?? []),
    ...(task.mainAgentPlan?.qualityNotes ?? [])
  ]
    .join("\n")
    .toLowerCase();
  const needsConcreteEvidence =
    Boolean(task.mainAgentPlan?.useHotspot) ||
    Boolean(task.mainAgentPlan?.selectedHotspotIds.length) ||
    /(点位|数据|支撑|阻力|资金费率|滑点|手续费|训练集|验证集|回测|仓位结构|流动性|成交量|放量|缩量|杠杆|盘口|位置|price|funding|fees|slippage|backtest|support|resistance|liquidity|volume|concrete evidence requirement)/.test(
      planningEvidence
    );

  if (!needsConcreteEvidence || !draftPack.posts.length) {
    return result;
  }

  const draftText = draftPack.posts.join("\n");
  const numericSignal = /(?:\d+(?:\.\d+)?(?:%|x|X)?|\$\d+)/.test(draftText);
  const evidenceKeywordCount = countEvidenceKeywords(draftText);
  if (numericSignal || evidenceKeywordCount >= 2) {
    return result;
  }

  return {
    ...result,
    verdict: escalateReviewVerdict(result.verdict, "minor_issue"),
    issues: normalizeStringArray([...result.issues, "任务需要点位或数据支撑，但草稿过于抽象，缺少真实证据。"]),
    riskFlags: normalizeStringArray([...result.riskFlags, "当前版本更像情绪表达，分析支撑不足，容易继续显得鸡汤。"]),
    suggestedFixes: normalizeStringArray([
      ...result.suggestedFixes,
      "从 hotspotContext 或 researchMarkdown 补 1-2 个真实点位、费率、流动性或验证信息，并解释它意味着什么。"
    ])
  };
}

function resolveTagTargetIndexes(applyTo: "single" | "first_post" | "last_post" | "all_posts", postCount: number) {
  if (postCount <= 0) {
    return [];
  }

  if (applyTo === "all_posts") {
    return Array.from({ length: postCount }, (_, index) => index);
  }

  if (applyTo === "first_post") {
    return [0];
  }

  if (applyTo === "last_post") {
    return [postCount - 1];
  }

  return [0];
}

function extractHashtags(post: string) {
  return Array.from(new Set(post.match(/#[\p{L}\p{N}_]+/gu) ?? []));
}

function extractTrailingHashtags(post: string) {
  const match = post.match(/(?:#[\p{L}\p{N}_]+(?:[ \t]+#[\p{L}\p{N}_]+)*)\s*$/u);
  if (!match) {
    return [];
  }

  return extractHashtags(match[0]);
}

function extractMarkdownBulletSection(markdown: string, heading: string) {
  return extractMarkdownSection(markdown, heading)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-+\s*/, "").trim())
    .filter(Boolean);
}

function extractMarkdownSection(markdown: string, heading: string) {
  const pattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "m");
  const match = pattern.exec(markdown);
  if (!match) {
    return "";
  }

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextHeadingMatch = /^\s*##\s+/m.exec(rest);
  return (nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest).trim();
}

function getComparableFragments(value: string) {
  const normalizedWhole = normalizeComparableText(value);
  const fragments = value
    .split(/[，。,\.！!？?；;：:\n]/)
    .map((item) => normalizeComparableText(item))
    .filter((item) => item.length >= 6);

  if (normalizedWhole.length >= 8) {
    fragments.push(normalizedWhole);
  }

  return Array.from(new Set(fragments));
}

function normalizeComparableText(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function countEvidenceKeywords(value: string) {
  const matches =
    value.match(
      /资金费率|滑点|手续费|支撑|阻力|流动性|仓位结构|成交量|放量|缩量|回测|验证|训练集|止损|杠杆|盘口|位置|结构|承接|support|resistance|liquidity|volume|funding|slippage|backtest/gi
    ) ?? [];
  return new Set(matches.map((item) => item.toLowerCase())).size;
}

function escalateReviewVerdict(
  current: XReviewAgentResult["verdict"],
  next: XReviewAgentResult["verdict"]
): XReviewAgentResult["verdict"] {
  const order: XReviewAgentResult["verdict"][] = ["pass", "minor_issue", "major_issue", "block"];
  return order[Math.max(order.indexOf(current), order.indexOf(next))] ?? current;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
