import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import { HumanizerService } from "@zhihu-mvp/core";
import type {
  XAccount,
  XDraftPack,
  XHotspotDetail,
  XMainAgentDecision,
  XRetrievalContext,
  XTask
} from "../types.js";
import type { XJsonLlmService } from "./x-llm-service.js";

export class XWriterService {
  private readonly writerPromptSetName: string;
  private readonly writerRuntimeTarget: string;
  private readonly humanizerAgentName: string;

  constructor(
    private readonly llmService: XJsonLlmService,
    private readonly humanizerService = new HumanizerService(),
    options: {
      writerPromptSetName?: string;
      writerRuntimeTarget?: string;
      humanizerAgentName?: string;
    } = {}
  ) {
    this.writerPromptSetName = options.writerPromptSetName ?? "x_writer_agent";
    this.writerRuntimeTarget = options.writerRuntimeTarget ?? this.writerPromptSetName;
    this.humanizerAgentName = options.humanizerAgentName ?? this.writerPromptSetName;
  }

  async writeDraft(input: {
    account: XAccount;
    task: XTask;
    accountSoulMarkdown?: string | null;
    revisionInstructions?: string[];
    mainAgentPlan: XMainAgentDecision | null;
    selectedHotspots: XHotspotDetail[];
    retrievalContext?: XRetrievalContext | null;
    promptSnapshot?: PromptSnapshotMap | null;
    debugTimings?: XWriterDebugTimings;
  }) {
    const fallback: XDraftPack = {
      summary: "",
      posts: [],
      notes: []
    };

    const payload = {
      account: input.account,
      accountSoulMarkdown: input.accountSoulMarkdown ?? null,
      localeContext: {
        outputLanguage: "zh-CN",
        writingLanguage: "简体中文",
        marketFocus: "中文加密市场",
        audienceScope: "只面向中文读者与中文社区"
      },
      task: {
        title: input.task.title,
        brief: input.task.brief,
        goal: input.task.goal,
        preferredMode: resolveWriterPreferredMode(input.task, input.mainAgentPlan),
        publishAction: input.mainAgentPlan?.publishAction ?? "post",
        contentStyle: input.mainAgentPlan?.contentStyle ?? "casual_note",
        targetTweetUrl: input.mainAgentPlan?.targetTweetUrl ?? null
      },
      mainAgentPlan:
        input.mainAgentPlan == null
          ? null
          : {
              decision: input.mainAgentPlan.decision,
              reason: input.mainAgentPlan.reason,
              preferredMode: input.mainAgentPlan.preferredMode,
              publishAction: input.mainAgentPlan.publishAction,
              contentStyle: input.mainAgentPlan.contentStyle,
              useHotspot: input.mainAgentPlan.useHotspot,
              selectedHotspotIds: input.mainAgentPlan.selectedHotspotIds,
              targetTweetUrl: input.mainAgentPlan.targetTweetUrl,
              targetTweetReason: input.mainAgentPlan.targetTweetReason,
              tagPlan: input.mainAgentPlan.tagPlan,
              writerBrief: input.mainAgentPlan.writerBrief,
              qualityNotes: input.mainAgentPlan.qualityNotes
            },
      hotspotContext: input.selectedHotspots.map((hotspot) => ({
        id: hotspot.id,
        title: hotspot.title,
        summaryText: hotspot.summaryText,
        sourceType: hotspot.sourceType,
        priority: hotspot.priority,
        canonicalUrl: hotspot.canonicalUrl,
        matchedWatchlistValues: hotspot.matchedWatchlistValues,
        angles: hotspot.angles,
        risks: hotspot.risks,
        researchSummaryText: hotspot.researchSummaryText,
        latestResearchRun: hotspot.latestResearchRun
          ? {
              summary: hotspot.latestResearchRun.summary,
              whyNow: hotspot.latestResearchRun.whyNow,
              suggestedTaskBrief: hotspot.latestResearchRun.suggestedTaskBrief,
              angles: hotspot.latestResearchRun.angles,
              risks: hotspot.latestResearchRun.risks,
              operatorHints: hotspot.latestResearchRun.operatorHints
            }
          : null
      })),
      retrievalContext: input.retrievalContext ?? null,
      revisionInstructions: input.revisionInstructions ?? []
    };

    const promptSuffix = joinPromptSuffixes(
      buildAccountSoulRuntimeSuffix(input.accountSoulMarkdown),
      WRITER_RUNTIME_FIELD_SUFFIX,
      buildHotspotEvidenceWriterSuffix(input.selectedHotspots, input.task, input.mainAgentPlan),
      X_POST_CHARACTER_LIMIT_SUFFIX,
      X_RHETORICAL_QUESTION_GUARD_SUFFIX,
      buildTagPlanWriterSuffix(input.mainAgentPlan),
      buildRetrievalWriterSuffix(input.retrievalContext ?? null),
      buildWriterVoiceIntentSuffixV2(input),
      buildWriterDeterministicConstraintSuffixV2(input)
    );

    const writerLlmStartedAt = Date.now();
    const rawDraft =
      input.account.writerPromptSource === "database"
        ? await this.llmService.runJson<XDraftPack>(this.writerPromptSetName, payload, fallback, {
            promptSnapshot: input.promptSnapshot ?? null,
            promptSuffix
          })
        : await this.llmService.runJson<XDraftPack>(buildMainAgentRuntimeWriterPrompt(input.mainAgentPlan), payload, fallback, {
            promptSuffix,
            runtimeTarget: this.writerRuntimeTarget
          });
    if (input.debugTimings) {
      input.debugTimings.writerLlmMs = Date.now() - writerLlmStartedAt;
    }

    const humanizerStartedAt = Date.now();
    const humanizedDraftPack = await this.humanizeDraftPack(rawDraft, input);
    if (input.debugTimings) {
      input.debugTimings.humanizerMs = Date.now() - humanizerStartedAt;
      input.debugTimings.totalWriteMs = (input.debugTimings.writerLlmMs ?? 0) + (input.debugTimings.humanizerMs ?? 0);
    }

    return applyTagPlanToDraftPack(humanizedDraftPack, input.mainAgentPlan);
  }

  private async humanizeDraftPack(
    draftPack: XDraftPack,
    input: {
      account: XAccount;
      task: XTask;
      accountSoulMarkdown?: string | null;
      revisionInstructions?: string[];
      mainAgentPlan: XMainAgentDecision | null;
      selectedHotspots: XHotspotDetail[];
      retrievalContext?: XRetrievalContext | null;
      debugTimings?: XWriterDebugTimings;
    }
  ) {
    if (!draftPack.posts.length) {
      return draftPack;
    }

    const extraSystemPrompt = buildXHumanizerExtraPromptV2(input);
    const humanizedPosts: string[] = [];
    const humanizerNotes: string[] = [];
    const humanizerPerPostMs: number[] = [];

    for (const [index, post] of draftPack.posts.entries()) {
      const humanizeStartedAt = Date.now();
      try {
        const humanized = await this.humanizerService.humanize(post, {
          stage: "x_humanizing",
          agentName: this.humanizerAgentName,
          extraSystemPrompt
        });
        humanizedPosts.push(humanized.content.trim() || post);
        humanizerNotes.push(...humanized.notes.map((note) => `humanizer[${index + 1}]: ${note}`));
      } catch (error) {
        humanizedPosts.push(post);
        humanizerNotes.push(
          `humanizer[${index + 1}] fallback: ${error instanceof Error ? error.message : "unknown humanizer error"}`
        );
      } finally {
        humanizerPerPostMs.push(Date.now() - humanizeStartedAt);
      }
    }

    if (input.debugTimings) {
      input.debugTimings.humanizerPerPostMs = humanizerPerPostMs;
    }

    return {
      ...draftPack,
      posts: humanizedPosts,
      notes: normalizeStringArray([...draftPack.notes, ...humanizerNotes])
    } satisfies XDraftPack;
  }
}

type XWriterDebugTimings = {
  writerLlmMs?: number;
  humanizerMs?: number;
  humanizerPerPostMs?: number[];
  totalWriteMs?: number;
};

function resolveWriterPreferredMode(task: XTask, mainAgentPlan: XMainAgentDecision | null) {
  if (mainAgentPlan?.preferredMode) {
    return mainAgentPlan.preferredMode;
  }

  return task.preferredMode;
}

function joinPromptSuffixes(...parts: Array<string | null | undefined>) {
  const normalized = parts.map((item) => item?.trim()).filter(Boolean);
  return normalized.length ? normalized.join("\n\n") : null;
}

function buildAccountSoulRuntimeSuffix(accountSoulMarkdown?: string | null) {
  const markdown = accountSoulMarkdown?.trim();
  if (!markdown) {
    return [
      "Account Soul runtime rule:",
      "1. accountSoulMarkdown is currently empty. Use account.persona, account.targetAudience, and account.styleGuide as the fallback identity anchor.",
      "2. If a later payload provides accountSoulMarkdown, it must become the stable identity and voice layer for this account."
    ].join("\n");
  }

  return [
    "Account Soul runtime rule:",
    "1. accountSoulMarkdown is the stable account identity anchor for this draft.",
    "2. task.title, task.brief, task.goal, publishAction, contentStyle, targetTweetUrl, hotspotContext, and revisionInstructions decide what this draft is about and what concrete frame it must keep.",
    "3. Soul decides who is speaking, how this account naturally sounds, what it will not say, and what product mentions are acceptable. Soul does not choose the topic and must not replace the task frame with a safer generic one.",
    "4. researchMarkdown and MainAgent runtime prompt may refine phrasing only inside the Soul boundary. They must not overwrite the Soul core identity, worldview, hard boundaries, taboo lexicon, or product policy.",
    "5. Exemplar Lines inside Soul are style references only. Learn cadence, reaction pattern, and execution language, but do not reuse their exact wording, metaphor object, sentence skeleton, or punchline.",
    "6. Do not quote or expose accountSoulMarkdown in the final post.",
    `accountSoulMarkdown:\n${markdown}`
  ].join("\n\n");
}

function buildHotspotEvidenceWriterSuffix(
  selectedHotspots: XHotspotDetail[],
  task: XTask,
  mainAgentPlan: XMainAgentDecision | null
) {
  const evidenceCandidates = collectHotspotEvidenceCandidates(selectedHotspots);
  const taskText = `${task.title} ${task.brief} ${task.goal}`.toLowerCase();
  const needsConcreteEvidence =
    Boolean(mainAgentPlan?.useHotspot) ||
    selectedHotspots.length > 0 ||
    /(点位|数据|支撑|阻力|资金费率|滑点|手续费|训练集|验证集|回测|仓位结构|流动性|成交量|放量|缩量|杠杆|盘口|位置|price|funding|fees|slippage|backtest|support|resistance|liquidity|volume)/.test(
      taskText
    );

  if (!needsConcreteEvidence && !evidenceCandidates.length) {
    return null;
  }

  const lines = [
    "Hotspot evidence guard:",
    "1. When hotspotContext contains usable structure, levels, funding, fees, leverage, liquidity, volume, or verification clues, pick the sharpest 1-2 details and explain what they mean.",
    "2. Lead with the judgment, but keep concrete evidence visible. Do not turn the draft into generic emotion-only commentary.",
    "3. Do not dump every field. One or two real datapoints or structure clues are enough if they materially support the view.",
    "4. If the hotspot evidence is weak or incomplete, keep the opinion honest and do not invent numbers."
  ];

  if (evidenceCandidates.length) {
    lines.push(`Evidence candidates:\n${evidenceCandidates.map((line, index) => `${index + 1}. ${line}`).join("\n")}`);
  }

  return lines.join("\n\n");
}

function buildRetrievalWriterSuffix(retrievalContext: XRetrievalContext | null | undefined) {
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
    "Account retrieval context:",
    "1. The following guidance comes from this account's isolated traditional RAG library.",
    "2. Rules docs outrank example snippets. Example snippets are mechanism references only, not copy targets.",
    "3. If any retrieved guidance conflicts with accountSoulMarkdown, hotspot facts, or the current task, obey Soul and task facts first.",
    "4. Do not quote, expose, or directly copy retrieved source text into the final post.",
    retrievalContext.notes.length ? `Notes:\n${retrievalContext.notes.map((item) => `- ${item}`).join("\n")}` : null,
    ...blocks
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildMainAgentRuntimeWriterPrompt(mainAgentPlan: XMainAgentDecision | null) {
  const runtimePrompt = mainAgentPlan?.runtimeWriterPrompt?.trim();

  return [
    "你是 X/Twitter 矩阵系统里的 Writer Agent。",
    "当前账号没有启用数据库里的 writer prompt，本轮写作以 MainAgent 实时生成的 runtime prompt 为准。",
    "你只负责写作，不决定是否发布，不输出审核结论，不暴露系统、prompt、research 流程。",
    "你会收到 account、task、mainAgentPlan、hotspotContext、researchMarkdown、revisionInstructions。",
    "默认只面向中文市场写作，读者是中文加密用户与中文社区。",
    "summary、posts、notes 必须默认使用简体中文输出。只有 URL、ticker、handle、专有名词或极短引用片段可以保留原文。",
    "即使输入热点、目标推文或引用来源是英文，你也必须用中文完成判断、转译和表达。",
    "task 里的 preferredMode、publishAction、contentStyle、targetTweetUrl 都是硬约束。",
    "如果 publishAction=reply，你写出来的首条内容必须像在对某条具体推文做回应，而不是独立长文开场。",
    "如果 publishAction=quote，你写出来的首条内容必须像借一条外部内容表达自己的判断，不能假装那条内容不存在。",
    "如果 hotspotContext 不为空，优先吸收其中可用的事实、风险和角度，但不要机械复述数据库字段。",
    "只输出合法 JSON，结构必须是 {\"summary\":\"...\",\"posts\":[\"...\"],\"notes\":[\"...\"]}。",
    "single 只能输出 1 条，thread 至少 2 条。不要输出 markdown、标题或项目符号。",
    runtimePrompt ? `MainAgent runtime prompt:\n${runtimePrompt}` : "MainAgent runtime prompt:\n围绕 mainAgentPlan.writerBrief 执行，并优先满足 task 与 hotspotContext。"
  ].join("\n\n");
}

const WRITER_RUNTIME_FIELD_SUFFIX = [
  "Runtime payload update:",
  "0. accountSoulMarkdown may be present. When present, it is the stable account identity and voice anchor for Writer.",
  "1. task now includes publishAction, contentStyle, and targetTweetUrl.",
  "2. mainAgentPlan contains the planning-stage decision and writerBrief. Treat it as the execution contract for this draft.",
  "2.1 mainAgentPlan.tagPlan is the structured hashtag plan. Follow it instead of inventing your own generic tail tags.",
  "3. hotspotContext contains selected hotspot records chosen by MainAgent. If it contains meaningful levels, funding, fees, leverage, liquidity, volume, or verification clues, absorb 1-2 concrete details and explain what they imply instead of writing vibe-only commentary.",
  "4. If task.publishAction is reply or quote, the first post must feel native to that action instead of reading like a standalone generic post.",
  "5. contentStyle must influence tone and structure: casual_note, small_insight, pitfall_log, tool_mention, industry_talk, interactive_qa, quote_repost.",
  "6. localeContext requires Simplified Chinese output by default. Do not switch to English prose just because the source hotspot or quoted tweet is in English.",
  "7. This is Twitter/X writing, not article writing. Optimize for mobile reading, first-screen impact, and native post rhythm.",
  "8. The first 1-2 lines should quickly expose the hook or the point of view.",
  "9. Default to compact readable blocks. A single compact paragraph is acceptable; if you break lines, keep it intentional and limited instead of putting every sentence on its own line.",
  "10. The draft must contain a clear opinion. Never hide behind neutral summary language.",
  "11. Strong opinions are allowed only when they are anchored in task context, hotspot context, researchMarkdown, or explicit first-person judgment.",
  "12. Do not swap a specific task frame for a safer generic discipline post. Avoid fallback copy like '空仓' '克制' '活得久' '模式外不做' unless that exact frame is the task.",
  "13. task.title, task.brief, task.goal, publishAction, contentStyle, and targetTweetUrl define the concrete brief. Keep those specifics visible in the final draft.",
  "14. Reduced line breaks are acceptable and often preferable for this workflow. Do not treat sentence-per-line formatting as a default quality signal.",
  "15. Treat mainAgentPlan.writerBrief.mustInclude as hard requirements. If it contains Style reference, Soul worldview, or Emotion anchor items, absorb their sentence energy or phrasing mechanism into the draft without directly copying Soul exemplar wording.",
  "16. If product mention appears in a non-tool task, it should read like a passing trader action under a stronger emotional sentence, not like a feature explanation or a brand-forward line.",
  "17. If tagPlan says no hashtags, do not append discoverability hashtags on your own. If tagPlan provides hashtags, use only those hashtags and keep them compact."
].join("\n");

const X_POST_CHARACTER_LIMIT_SUFFIX = [
  "X character-limit guard:",
  "1. Unless the task explicitly says this account is using X Premium long posts, write for the normal X post limit.",
  "2. Target each post at no more than 260 visible characters when writing Chinese, leaving safety room under the typical 280-character limit and for URL/link counting differences.",
  "3. If a single idea needs more space, prefer a thread with each post under 260 visible characters instead of creating an overlong single post.",
  "4. Do not rely on X Premium 25,000-character long posts in this workflow unless the operator explicitly requests long-post mode.",
  "5. If task.publishAction is quote or reply, keep the added commentary especially tight because the target tweet already provides context."
].join("\n");

const X_RHETORICAL_QUESTION_GUARD_SUFFIX = [
  "Rhetorical-question guard:",
  "1. Avoid rhetorical questions by default. They should not be a habitual hook or ending.",
  "2. Across a thread, use at most one question mark, and only when contentStyle is interactive_qa or the task explicitly asks for interaction.",
  "3. Prefer direct judgment, first-person observation, or a compressed statement over endings like '你怎么看？' or '是不是？'.",
  "4. Do not use consecutive question-based hooks."
].join("\n");

function buildWriterVoiceIntentSuffix(input: {
  account: XAccount;
  task: XTask;
  mainAgentPlan: XMainAgentDecision | null;
}) {
  const evidence = [
    input.task.title,
    input.task.brief,
    input.task.goal,
    input.mainAgentPlan?.runtimeWriterPrompt ?? "",
    input.mainAgentPlan?.writerBrief?.angle ?? "",
    input.mainAgentPlan?.writerBrief?.goal ?? "",
    input.account.manualNotes ?? ""
  ]
    .join("\n")
    .trim();

  return [
    "Writing feel target:",
    "1. The copy should feel interesting, attractive, and alive for Chinese X readers, not flat, not like AI-safe explainer text.",
    "2. Prefer sharp hooks, tension, compression, rhythm, and a little sly personality over generic completeness.",
    "3. Keep it human: a real person speaking with taste, not a generic consultant, not a lesson, not a brand brochure.",
    "4. Avoid obvious AI habits: neat triads, textbook transitions, over-complete explanations, moralizing conclusions, and fake balance in every paragraph.",
    containsConstraintSignal(evidence, ["碎碎念", "casual_note", "朋友圈", "手记", "交易手记"])
      ? "5. Let it feel like a朋友圈式碎碎念，有点机锋，有点呼吸感，但不要油腻。"
      : "5. Let it feel like a confident真人表达，有记忆点，有情绪摩擦，但不要浮夸。"
  ].join("\n");
}

function buildWriterDeterministicConstraintSuffix(input: {
  task: XTask;
  mainAgentPlan: XMainAgentDecision | null;
}) {
  const evidence = [
    input.task.title,
    input.task.brief,
    input.task.goal,
    input.mainAgentPlan?.runtimeWriterPrompt ?? "",
    input.mainAgentPlan?.writerBrief?.angle ?? "",
    input.mainAgentPlan?.writerBrief?.openingDirection ?? "",
    ...(input.mainAgentPlan?.writerBrief?.mustInclude ?? []),
    ...(input.mainAgentPlan?.writerBrief?.mustAvoid ?? []),
    ...(input.mainAgentPlan?.qualityNotes ?? [])
  ]
    .join("\n")
    .trim();

  const lines: string[] = [];

  if (containsConstraintSignal(evidence, ["数据转译", "不要堆数字", "具体数字", "反直觉", "逻辑转译"])) {
    lines.push("Deterministic writing guard for this task:");
    lines.push("1. 首句必须先给观点，不要先复述事实或背景。");
    lines.push(
      "2. 不要重复标题、brief、热点里的具体数字、倍数、次数和时间段数字，包括“5个月”“五个月”“两周”“六次”“20x”这类表达。"
    );
    lines.push("3. 必须把数字改成定性说法，例如“连续一段时间”“明显降温”“高杠杆”“反复试错”。");
  }

  if (containsConstraintSignal(evidence, ["第一人称", "我观察", "我更愿意", "我现在更在意", "手记"])) {
    if (!lines.length) {
      lines.push("Deterministic writing guard for this task:");
    }
    lines.push("4. 正文至少两处明确使用第一人称锚定，例如“我更愿意理解为”“我现在更在意的不是…而是…”。");
  }

  if (containsConstraintSignal(evidence, ["说教", "不要教育用户", "教育用户", "建议感"])) {
    if (!lines.length) {
      lines.push("Deterministic writing guard for this task:");
    }
    lines.push("5. 不要写成给别人上课的建议，优先写成自己的经验、偏好或复盘。");
  }

  return lines.length ? lines.join("\n") : null;
}

function buildXHumanizerExtraPrompt(input: {
  account: XAccount;
  task: XTask;
  revisionInstructions?: string[];
  mainAgentPlan: XMainAgentDecision | null;
}) {
  const revisionInstructions = normalizeStringArray(input.revisionInstructions ?? []);
  const publishAction = input.mainAgentPlan?.publishAction ?? "post";

  return [
    "X humanizer runtime instructions:",
    "1. Preserve facts, core opinion, action type, and risk boundary exactly. Do not add new facts or claims.",
    "2. Make the Chinese copy feel more alive, interesting, and a bit sexy in the writing sense: sharper, more memorable, more human, less AI.",
    "3. Prefer compressed spoken Chinese, subtle wit, tension, and rhythm over polished article prose.",
    "4. Do not turn it into fake street slang, fake sarcasm, oily flirting, motivational soup, or exaggerated hot-take noise.",
    "5. Keep it suitable for the Chinese-speaking crypto market. It should feel like a real X user posting, not a report or tutorial.",
    "6. Keep the current line-break rhythm unless it clearly hurts readability.",
    publishAction === "reply"
      ? "7. The first line must still feel like a reply to a specific tweet, not a standalone monologue."
      : publishAction === "quote"
        ? "7. The first line must still feel like a quote-post reaction, not a standalone monologue."
        : "7. Keep it as a native standalone post.",
    revisionInstructions.length ? `Revision instructions to preserve:\n${revisionInstructions.join("\n")}` : null,
    input.mainAgentPlan?.runtimeWriterPrompt?.trim() ? `MainAgent runtime writer prompt:\n${input.mainAgentPlan.runtimeWriterPrompt.trim()}` : null
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractResearchSection(markdown: string, heading: string) {
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWriterVoiceIntentSuffixV2(input: {
  account: XAccount;
  task: XTask;
  accountSoulMarkdown?: string | null;
  mainAgentPlan: XMainAgentDecision | null;
}) {
  const evidence = [
    input.accountSoulMarkdown ?? "",
    input.task.title,
    input.task.brief,
    input.task.goal,
    input.mainAgentPlan?.runtimeWriterPrompt ?? "",
    input.mainAgentPlan?.writerBrief?.angle ?? "",
    input.mainAgentPlan?.writerBrief?.goal ?? "",
    input.account.manualNotes ?? ""
  ]
    .join("\n")
    .trim();

  const casualSignal = containsConstraintSignal(evidence, [
    "casual_note",
    "small_insight",
    "pitfall_log",
    "interactive_qa",
    "手记",
    "碎碎念",
    "交易手记",
    "朋友圈"
  ]);

  return [
    "Writing feel target v2:",
    "1. This copy is for Chinese Twitter/X readers. It should feel bold, alive, and native to the platform, not like an AI-safe explainer or a blog paragraph.",
    "2. Prefer sharp hooks, tension, compression, rhythm, and slightly more aggressive attitude over generic completeness.",
    "3. Keep the persona consistent with MainAgent's plan. The voice should feel like this account would actually say it.",
    "4. The viewpoint should be obvious within the first screen. Readers should quickly know what you think, not just what happened.",
    "5. Avoid obvious AI habits: neat triads, textbook transitions, over-complete explanations, moralizing conclusions, and fake balance.",
    "6. If the evidence is incomplete, keep the opinion sharp but phrase it as constrained judgment, not fake certainty.",
    casualSignal
      ? "7. Let it feel like a 朋友圈式碎碎念或交易手记: 有性格，有火花，但不要油，不要演。"
      : "7. Let it feel like a confident真人表达: 有记忆点，有态度，有摩擦感，但不要浮夸。"
  ].join("\n");
}

function buildWriterDeterministicConstraintSuffixV2(input: {
  task: XTask;
  accountSoulMarkdown?: string | null;
  mainAgentPlan: XMainAgentDecision | null;
}) {
  const evidence = [
    input.accountSoulMarkdown ?? "",
    input.task.title,
    input.task.brief,
    input.task.goal,
    input.mainAgentPlan?.runtimeWriterPrompt ?? "",
    input.mainAgentPlan?.writerBrief?.angle ?? "",
    input.mainAgentPlan?.writerBrief?.openingDirection ?? "",
    ...(input.mainAgentPlan?.writerBrief?.mustInclude ?? []),
    ...(input.mainAgentPlan?.writerBrief?.mustAvoid ?? []),
    ...(input.mainAgentPlan?.qualityNotes ?? [])
  ]
    .join("\n")
    .trim();

  const deterministicLines = [
    "Deterministic writing guard v2:",
    "1. This is Twitter/X writing, not article writing. The first 1-2 lines must contain a hook and expose the point of view.",
    "2. Optimize formatting for mobile reading with compact readable blocks. Default to one compact paragraph or at most one to two intentional line breaks in a single post; do not split every sentence into its own line.",
    "3. The draft must contain one clear viewpoint. Do not drift into neutral summary mode.",
    "4. Every strong viewpoint must be anchored in task context, hotspot context, researchMarkdown, or explicit first-person judgment.",
    "5. If the basis is incomplete, use constrained-judgment wording so the stance stays visible without pretending it is proven."
  ];
  let nextRuleNumber = 6;

  if (containsConstraintSignal(evidence, ["绗竴浜虹О", "鎴戣瀵?", "鎴戞洿鍊惧悜浜?", "鎴戠幇鍦ㄦ洿鍦ㄦ剰", "鎵嬭"])) {
    deterministicLines.push(
      `${nextRuleNumber++}. Use first-person anchoring at least twice so the content feels like a real account speaking, not an anonymous narrator.`
    );
  }

  if (containsConstraintSignal(evidence, ["涓嶈鏁欒偛鐢ㄦ埛", "鏁欒偛鐢ㄦ埛", "寤鸿鎰?", "璇存暀"])) {
    deterministicLines.push(
      `${nextRuleNumber++}. Do not teach the reader what to do. Keep it as personal judgment, personal record, or observed preference.`
    );
  }

  if (
    containsConstraintSignal(evidence, [
      "鍏蜂綋鏁板瓧",
      "涓嶈鍫嗘暟瀛?",
      "鏁版嵁杞瘧",
      "鍙嶇洿瑙?",
      "閫昏緫杞瘧",
      "Concrete evidence requirement"
    ])
  ) {
    deterministicLines.push(
      `${nextRuleNumber++}. Lead with the judgment, but when hotspotContext, researchMarkdown, or task facts provide meaningful levels, funding, fees, leverage, volume, or verification splits, keep 1-2 exact datapoints and explain why they matter. Do not humanize away real evidence.`
    );
  }

  if (
    containsConstraintSignal(evidence, [
      "Style reference",
      "Soul worldview",
      "Emotion anchor",
      "Do not directly reuse Soul exemplar"
    ])
  ) {
    deterministicLines.push(
      `${nextRuleNumber++}. Soul exemplar lines are style references only. Learn cadence, metaphor type, and emotional turn, but do not reuse the original wording, punchline, or sentence skeleton.`
    );
  }

  if (containsConstraintSignal(evidence, ["bro", "鏄笉鏄?"])) {
    deterministicLines.push(
      `${nextRuleNumber++}. If the Soul includes catchphrases such as 'bro' or '鏄笉鏄?', use at most one light touch in a single post and make it sound incidental, not staged.`
    );
  }

  if (containsConstraintSignal(evidence, ["Product mention style guard", "cryptopathx"])) {
    deterministicLines.push(
      `${nextRuleNumber++}. If cryptopathx appears in a non-tool task, keep it subordinate to a stronger emotion or execution sentence. The line should still feel complete if the brand name were removed.`
    );
  }

  if (input.mainAgentPlan?.tagPlan?.hashtags.length) {
    deterministicLines.push(
      `${nextRuleNumber++}. Follow the hashtag plan exactly. Current hashtags: ${input.mainAgentPlan.tagPlan.hashtags.join(" ")}. Placement=${input.mainAgentPlan.tagPlan.placement}. ApplyTo=${input.mainAgentPlan.tagPlan.applyTo}.`
    );
  } else {
    deterministicLines.push(
      `${nextRuleNumber++}. Do not invent generic discoverability hashtags unless MainAgent explicitly planned them.`
    );
  }

  deterministicLines.push(
    `${nextRuleNumber++}. Anti-generic-template guard: never replace a concrete task with generic discipline, empty-position, survival-slogan, or template safety copy unless that is explicitly the task.`,
    `${nextRuleNumber++}. Task-frame guard: if the task is about new projects, center project filtering, liquidity, and narrative-versus-execution; if it is about tools/backtests, center the verification workflow; if it is a trader note, center the concrete handling logic. Do not flatten these into the same generic discipline post.`
  );

  return deterministicLines.join("\n");

  const lines = [
    "Deterministic writing guard v2:",
    "1. This is Twitter/X writing, not article writing. The first 1-2 lines must contain a hook and expose the point of view.",
    "2. Optimize formatting for mobile reading with compact readable blocks. Default to one compact paragraph or at most one to two intentional line breaks in a single post; do not split every sentence into its own line.",
    "3. The draft must contain one clear viewpoint. Do not drift into neutral summary mode.",
    "4. Every strong viewpoint must be anchored in task context, hotspot context, researchMarkdown, or explicit first-person judgment.",
    "5. If the basis is incomplete, use wording such as '我更倾向于' '更像是' '至少现在看', so the stance stays visible without pretending it is proven."
  ];

  if (containsConstraintSignal(evidence, ["第一人称", "我观察", "我更倾向于", "我现在更在意", "手记"])) {
    lines.push("6. Use first-person anchoring at least twice so the content feels like a real account speaking, not an anonymous narrator.");
  }

  if (containsConstraintSignal(evidence, ["不要教育用户", "教育用户", "建议感", "说教"])) {
    lines.push("7. Do not teach the reader what to do. Keep it as personal judgment, personal record, or observed preference.");
  }

  if (containsConstraintSignal(evidence, ["具体数字", "不要堆数字", "数据转译", "反直觉", "逻辑转译"])) {
    lines.push("8. Do not lean on hard numbers as the center of the argument. Lead with the judgment, then use only minimal evidence.");
  }

  lines.push(
    "Anti-generic-template guard: never replace a concrete task with generic discipline, empty-position, survival-slogan, or '模式外不做' copy unless that is explicitly the task.",
    "Task-frame guard: if the task is about new projects, center project filtering, liquidity, and narrative-versus-execution; if it is about tools/backtests, center the verification workflow; if it is a trader note, center the concrete handling logic. Do not flatten these into the same generic discipline post."
  );

  if (containsConstraintSignal(evidence, ["bro", "是不是"])) {
    lines.push("9. If the Soul includes catchphrases such as 'bro' or '是不是', use at most one light touch in a single post and make it sound incidental, not staged.");
  }

  if (containsConstraintSignal(evidence, ["Voice anchor", "Emotion anchor"])) {
    lines.push("10. If MainAgent provided Voice anchor or Emotion anchor items, keep at least one of them alive in the final draft as concrete trader language. Do not paraphrase all of them into generic concepts.");
  }

  if (containsConstraintSignal(evidence, ["Product mention style guard", "cryptopathx"])) {
    lines.push("11. If cryptopathx appears in a non-tool task, keep it subordinate to a stronger emotion or execution sentence. The line should still feel complete if the brand name were removed.");
  }

  if (input.mainAgentPlan?.tagPlan?.hashtags.length) {
    lines.push(
      `12. Follow the hashtag plan exactly. Current hashtags: ${input.mainAgentPlan?.tagPlan?.hashtags.join(" ") ?? ""}. Placement=${input.mainAgentPlan?.tagPlan?.placement ?? "none"}. ApplyTo=${input.mainAgentPlan?.tagPlan?.applyTo ?? "single"}.`
    );
  } else {
    lines.push("12. Do not invent generic discoverability hashtags unless MainAgent explicitly planned them.");
  }

  return lines.join("\n");
}

function buildXHumanizerExtraPromptV2(input: {
  account: XAccount;
  task: XTask;
  accountSoulMarkdown?: string | null;
  revisionInstructions?: string[];
  mainAgentPlan: XMainAgentDecision | null;
  retrievalContext?: XRetrievalContext | null;
}) {
  const accountSoulPrompt = buildAccountSoulRuntimeSuffix(input.accountSoulMarkdown);
  const retrievalPrompt = buildRetrievalWriterSuffix(input.retrievalContext ?? null);
  const revisionInstructions = normalizeStringArray(input.revisionInstructions ?? []);
  const publishAction = input.mainAgentPlan?.publishAction ?? "post";

  return [
    "X humanizer runtime instructions v2:",
    "1. Preserve facts, core opinion, action type, and risk boundary exactly. Do not add new facts or claims.",
    "2. Keep the text native to Twitter/X: mobile-readable, first-screen friendly, and visibly opinionated.",
    "3. Make the Chinese copy feel sharper, more memorable, more human, and less AI, but do not turn it into fake slang, fake sarcasm, oily flirting, or exaggerated hot-take noise.",
    "4. Do not sand down the viewpoint into neutral mush. Keep the stance visible.",
    "5. Do not make unsupported claims sound verified. If the text is a judgment call, keep the wording honest.",
    "5.1 If the draft already contains concrete levels, funding, fees, leverage, volume, or verification details, keep them. Do not smooth away real evidence during humanization.",
    "5.2 Soul exemplar lines are style references only. Do not rewrite the draft into direct Soul catchphrase reuse just to make it sound more 'in character'.",
    publishAction === "reply"
      ? "6. The first line must still feel like a reply to a specific tweet, not a standalone monologue."
      : publishAction === "quote"
        ? "6. The first line must still feel like a quote-post reaction, not a standalone monologue."
        : "6. Keep it as a native standalone post.",
    "7. Reduce excessive line breaks. For a normal single post, keep it as one compact paragraph or at most one to two intentional breaks unless the current task explicitly benefits from a more fragmented rhythm.",
    "8. If a product is mentioned, keep it soft and backgrounded. The sentence should still read like a trader's emotional reaction or execution note, not a product callout.",
    input.mainAgentPlan?.tagPlan?.hashtags.length
      ? `9. Keep the planned hashtags intact and compact: ${input.mainAgentPlan.tagPlan.hashtags.join(" ")}. Do not add extra generic hashtags.`
      : "9. Do not append generic hashtag tails during humanization.",
    accountSoulPrompt,
    retrievalPrompt,
    revisionInstructions.length ? `Revision instructions to preserve:\n${revisionInstructions.join("\n")}` : null,
    input.mainAgentPlan?.runtimeWriterPrompt?.trim() ? `MainAgent runtime writer prompt:\n${input.mainAgentPlan.runtimeWriterPrompt.trim()}` : null
  ]
    .filter(Boolean)
    .join("\n\n");
}

function collectHotspotEvidenceCandidates(selectedHotspots: XHotspotDetail[]) {
  const candidates = selectedHotspots.flatMap((hotspot) =>
    [
      hotspot.summaryText,
      hotspot.researchSummaryText,
      ...hotspot.angles,
      ...hotspot.risks,
      hotspot.latestResearchRun?.summary ?? null,
      hotspot.latestResearchRun?.whyNow ?? null,
      ...(hotspot.latestResearchRun?.angles ?? []),
      ...(hotspot.latestResearchRun?.risks ?? []),
      ...(hotspot.latestResearchRun?.operatorHints ?? [])
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim())
      .filter(Boolean)
      .filter(isConcreteEvidenceLine)
  );

  return Array.from(new Set(candidates)).slice(0, 6);
}

function isConcreteEvidenceLine(value: string) {
  return /(?:\d+(?:\.\d+)?(?:%|x|X)?|\$\d+)/.test(value) || /资金费率|滑点|手续费|支撑|阻力|流动性|仓位结构|成交量|放量|缩量|回测|验证|训练集|止损|杠杆|盘口|位置|结构|承接|support|resistance|liquidity|volume|funding|slippage|backtest/i.test(value);
}

function normalizeStringArray(value: string[]) {
  return value.map((item) => item.trim()).filter(Boolean);
}

function buildTagPlanWriterSuffix(mainAgentPlan: XMainAgentDecision | null) {
  const tagPlan = mainAgentPlan?.tagPlan;
  if (!tagPlan || !tagPlan.hashtags.length || tagPlan.placement === "none" || tagPlan.maxTags <= 0) {
    return [
      "Hashtag plan:",
      "1. MainAgent did not request hashtags for this task.",
      "2. Do not invent a tail hashtag block just to make the post look complete."
    ].join("\n");
  }

  const applyLabel =
    tagPlan.applyTo === "all_posts"
      ? "all posts"
      : tagPlan.applyTo === "first_post"
        ? "the first post"
        : tagPlan.applyTo === "last_post"
          ? "the last post"
          : "the single post";

  return [
    "Hashtag plan:",
    `1. Use exactly these planned hashtags unless a later revision explicitly removes them: ${tagPlan.hashtags.join(" ")}.`,
    `2. placement=${tagPlan.placement}; applyTo=${tagPlan.applyTo}; this means hashtags belong on ${applyLabel}.`,
    `3. Keep the total hashtag count at or under ${tagPlan.maxTags}.`,
    "4. Do not add extra generic crypto/discoverability hashtags beyond the plan."
  ].join("\n");
}

function applyTagPlanToDraftPack(draftPack: XDraftPack, mainAgentPlan: XMainAgentDecision | null): XDraftPack {
  const tagPlan = mainAgentPlan?.tagPlan;
  if (!draftPack.posts.length || !tagPlan) {
    return draftPack;
  }

  const cleanedPosts = draftPack.posts.map((post) => stripTrailingHashtagBlock(post));
  if (!tagPlan.hashtags.length || tagPlan.placement === "none" || tagPlan.maxTags <= 0) {
    return {
      ...draftPack,
      posts: cleanedPosts
    };
  }

  if (tagPlan.placement !== "tail") {
    return {
      ...draftPack,
      posts: cleanedPosts
    };
  }

  const targetIndexes = new Set(resolveTagTargetIndexes(tagPlan.applyTo, cleanedPosts.length));
  const posts = cleanedPosts.map((post, index) =>
    targetIndexes.has(index) ? appendTailHashtags(post, tagPlan.hashtags, tagPlan.maxTags) : post
  );

  return {
    ...draftPack,
    posts
  };
}

function resolveTagTargetIndexes(applyTo: XMainAgentDecision["tagPlan"]["applyTo"], postCount: number) {
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

function appendTailHashtags(post: string, hashtags: string[], maxTags: number) {
  const base = stripTrailingHashtagBlock(post).trimEnd();
  const filteredTags = hashtags.filter((tag) => !base.includes(tag)).slice(0, Math.max(0, maxTags));
  if (!filteredTags.length) {
    return base;
  }

  const selectedTags: string[] = [];
  for (const tag of filteredTags) {
    const candidateTags = [...selectedTags, tag];
    const candidate = `${base}${base ? "\n" : ""}${candidateTags.join(" ")}`;
    if (visibleLength(candidate) <= 260) {
      selectedTags.push(tag);
    } else {
      break;
    }
  }

  if (!selectedTags.length) {
    return base;
  }

  return `${base}${base ? "\n" : ""}${selectedTags.join(" ")}`;
}

function stripTrailingHashtagBlock(post: string) {
  return post.replace(/(?:\s*\n\s*)?(?:#[\p{L}\p{N}_]+(?:[ \t]+#[\p{L}\p{N}_]+)*)\s*$/u, "").trimEnd();
}

function visibleLength(value: string) {
  return Array.from(value).length;
}

function containsConstraintSignal(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}
