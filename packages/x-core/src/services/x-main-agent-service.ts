import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import type {
  XAccount,
  XContentStyle,
  XDraftPack,
  XHotspot,
  XMainAgentDecision,
  XPublishAction,
  XPublishPlan,
  XReviewAgentResult,
  XReviewResult,
  XTask
} from "../types.js";
import { XLlmService } from "./x-llm-service.js";
import {
  deriveTaskPlanningHints,
  isConfidenceAtLeast,
  normalizeTargetTweetUrl,
  type CandidateTweetTarget,
  type TaskPlanningHints
} from "./x-planning-utils.js";

type RecentPublishedSignal = {
  title: string;
  publishedAt: string | null;
  mode: XPublishPlan["mode"] | null;
  action: XPublishAction | null;
  contentStyle: XContentStyle | null;
  targetTweetUrl: string | null;
};

export class XMainAgentService {
  constructor(private readonly llmService: XLlmService) {}

  async planTask(input: {
    account: XAccount;
    task: XTask;
    accountSoulMarkdown: string | null;
    hotspotCandidates: XHotspot[];
    candidateTweetTargets: CandidateTweetTarget[];
    recentPublishedSignals: RecentPublishedSignal[];
    promptSnapshot?: PromptSnapshotMap | null;
  }) {
    const writerPromptReference = buildWriterPromptReferenceContext(input.account, input.promptSnapshot ?? null);
    const planningHints = deriveTaskPlanningHints({
      task: input.task,
      candidateTweetTargets: input.candidateTweetTargets,
      hotspotCandidates: input.hotspotCandidates
    });
    const fallback = buildFallbackDecision({
      fallbackStage: "plan",
      preferredMode: planningHints.preferredModeHint.value ?? resolveFallbackMode(input.task.preferredMode),
      publishAction: planningHints.actionHint?.value ?? "post",
      contentStyle: planningHints.contentStyleHint?.value ?? "casual_note",
      targetTweetUrl: planningHints.actionHint?.targetTweetUrl ?? null,
      targetTweetReason: planningHints.actionHint?.reason ?? "",
      useHotspot: planningHints.hotspotHint.shouldUseHotspot,
      selectedHotspotIds: planningHints.hotspotHint.selectedHotspotIds
    });

    const output = await this.llmService.runJson<XMainAgentDecision>(
      "x_main_agent",
      {
        stage: "plan",
        account: buildMainAgentAccountContext(input.account),
        accountSoulMarkdown: input.accountSoulMarkdown,
        localeContext: buildChineseLocaleContext(),
        task: buildMainAgentTaskContext(input.task),
        writerPromptReference,
        hotspotCandidates: input.hotspotCandidates.map((hotspot) => ({
          id: hotspot.id,
          title: hotspot.title,
          summaryText: hotspot.summaryText,
          sourceType: hotspot.sourceType,
          topicType: hotspot.topicType,
          priority: hotspot.priority,
          score: hotspot.score,
          canonicalUrl: hotspot.canonicalUrl,
          matchedWatchlistValues: hotspot.matchedWatchlistValues,
          symbols: hotspot.symbols,
          keywords: hotspot.keywords,
          lastSeenAt: hotspot.lastSeenAt,
          researchSummaryText: hotspot.researchSummaryText
        })),
        candidateTweetTargets: input.candidateTweetTargets,
        planningHints: {
          preferredMode: planningHints.preferredModeHint,
          action: planningHints.actionHint,
          contentStyle: planningHints.contentStyleHint,
          hotspot: planningHints.hotspotHint
        },
        recentPublishedSignals: input.recentPublishedSignals,
        operatorNotes: input.account.manualNotes || null
      },
      fallback,
      {
        promptSnapshot: input.promptSnapshot ?? null,
        promptSuffix: MAIN_AGENT_RUNTIME_BOUNDARY_SUFFIX
      }
    );

    const sanitizedDecision = sanitizeMainDecision(output, {
      fallback,
      allowedHotspotIds: input.hotspotCandidates.map((item) => item.id),
      allowedTargetUrls: input.candidateTweetTargets.map((item) => item.url)
    });
    const hintedDecision = applyTaskPlanningHints(sanitizedDecision, planningHints);

    return ensureRuntimeWriterPrompt(
      injectConcreteEvidenceRequirement(
        injectProductMentionStyleGuard(
          injectSoulVoiceAnchors(
            disableStandaloneResearchFlow(hintedDecision, "plan"),
            {
              task: input.task,
              accountSoulMarkdown: input.accountSoulMarkdown
            }
          ),
          {
            task: input.task,
            accountSoulMarkdown: input.accountSoulMarkdown
          }
        ),
        {
          task: input.task,
          hotspotCandidates: input.hotspotCandidates,
          planningHints
        }
      ),
      {
        writerPromptSource: input.account.writerPromptSource,
        writerPromptReference
      }
    );
  }

  async reviewTask(input: {
    account: XAccount;
    task: XTask;
    accountSoulMarkdown: string | null;
    draftPack: XDraftPack;
    reviewAgentResult: XReviewAgentResult;
    recentPublishedSignals: RecentPublishedSignal[];
    promptSnapshot?: PromptSnapshotMap | null;
  }) {
    const plannedDecision = input.task.mainAgentPlan;
    const fallback = buildFallbackDecision({
      fallbackStage: "draft_gate",
      preferredMode: plannedDecision?.preferredMode ?? (input.draftPack.posts.length > 1 ? "thread" : "single"),
      publishAction: plannedDecision?.publishAction ?? "post",
      contentStyle: plannedDecision?.contentStyle ?? "casual_note",
      targetTweetUrl: plannedDecision?.targetTweetUrl ?? null
    });
    fallback.decision = "revise";
    fallback.reason = "Main agent fallback requested a revision because structured output was invalid.";
    fallback.shouldWrite = true;
    fallback.shouldPublish = false;
    fallback.cadence = "defer";
    fallback.deferMinutes = 30;
    fallback.revisionInstructions = ["Tighten the angle, sharpen the hook, and make the sequence more publishable."];
    fallback.qualityNotes = ["Fallback decision was used because the model did not return valid JSON."];
    fallback.publishNotes = [];

    const output = await this.llmService.runJson<XMainAgentDecision>(
      "x_main_agent",
      {
        stage: "draft_gate",
        account: buildMainAgentAccountContext(input.account),
        accountSoulMarkdown: input.accountSoulMarkdown,
        localeContext: buildChineseLocaleContext(),
        task: buildMainAgentTaskContext(input.task),
        planningDecision: plannedDecision,
        draftPack: input.draftPack,
        reviewAgentResult: input.reviewAgentResult,
        recentPublishedSignals: input.recentPublishedSignals,
        operatorNotes: input.account.manualNotes || null
      },
      fallback,
      {
        promptSnapshot: input.promptSnapshot ?? null,
        promptSuffix: MAIN_AGENT_RUNTIME_BOUNDARY_SUFFIX
      }
    );

    if (output.usedFallback && output.fallbackStage === "draft_gate") {
      return buildDraftGateFallbackReview({
        plannedDecision,
        reviewAgentResult: input.reviewAgentResult,
        fallbackReason: fallback.reason
      });
    }

    const sanitizedOutput = sanitizeMainDecision(output, {
      fallback,
      allowedHotspotIds: plannedDecision?.selectedHotspotIds ?? [],
      allowedTargetUrls: collectAllowedTargetUrls(plannedDecision)
    });
    const normalizedOutput = preservePlannedTagPlan(
      preservePlannedPublishAction(disableStandaloneResearchFlow(sanitizedOutput, "draft_gate"), plannedDecision),
      plannedDecision
    );
    const mappedDecision = mapMainDecisionToReviewDecision(normalizedOutput.decision);
    const shouldPublish = normalizedOutput.decision === "approve_publish" || normalizedOutput.decision === "defer";
    const reviewEvidence = buildReviewEvidence(input.reviewAgentResult);

    return {
      reviewResult: {
        decision: mappedDecision,
        reason: normalizedOutput.reason.trim() || input.reviewAgentResult.summary,
        revisionInstructions: normalizeStringArray([
          ...input.reviewAgentResult.suggestedFixes,
          ...normalizedOutput.revisionInstructions
        ]),
        qualityNotes: normalizeStringArray([
          ...reviewEvidence,
          ...normalizedOutput.qualityNotes,
          ...normalizedOutput.publishNotes
        ])
      } satisfies XReviewResult,
      publishPlan: {
        shouldPublish,
        mode: normalizedOutput.preferredMode === "thread" ? "thread" : "single",
        action: normalizedOutput.publishAction,
        contentStyle: normalizedOutput.contentStyle,
        cadence: normalizeCadence(normalizedOutput.cadence),
        deferMinutes: normalizeDeferMinutes(normalizedOutput.deferMinutes),
        targetTweetUrl: normalizedOutput.targetTweetUrl,
        selectedHotspotIds: normalizedOutput.selectedHotspotIds,
        tagPlan: normalizedOutput.tagPlan,
        reason: normalizedOutput.reason
      } satisfies XPublishPlan
    };
  }
}

function buildMainAgentAccountContext(account: XAccount) {
  return {
    id: account.id,
    handle: account.handle,
    persona: account.persona,
    targetAudience: account.targetAudience,
    styleGuide: account.styleGuide,
    manualNotes: account.manualNotes,
    status: account.status,
    authStatus: account.authStatus,
    lastPublishedAt: account.lastPublishedAt,
    writerPromptSource: account.writerPromptSource,
    publishStyleRatios: account.publishStyleRatios,
    defaultLanguage: "zh-CN",
    marketFocus: "Chinese-speaking crypto market"
  };
}

function buildChineseLocaleContext() {
  return {
    outputLanguage: "zh-CN",
    writingLanguage: "Simplified Chinese",
    marketFocus: "Chinese-speaking crypto market",
    audienceScope: "Chinese-speaking crypto readers and communities only"
  };
}

function buildWriterPromptReferenceContext(
  account: Pick<XAccount, "writerPromptSource">,
  promptSnapshot: PromptSnapshotMap | null | undefined
) {
  if (account.writerPromptSource !== "main_agent") {
    return null;
  }

  const writerPromptSnapshot = promptSnapshot?.x_writer_agent;
  const content = writerPromptSnapshot?.content?.trim();
  if (!content) {
    return null;
  }

  const label = writerPromptSnapshot?.label ?? null;
  const version = writerPromptSnapshot?.version ?? null;

  return {
    label,
    version,
    content,
    usage: "reference_only_for_main_agent_runtime_writer_prompt"
  };
}

function buildMainAgentTaskContext(task: XTask) {
  return {
    title: task.title,
    brief: task.brief,
    goal: task.goal,
    preferredMode: task.preferredMode,
    currentStatus: task.status,
    scheduledAt: task.scheduledAt,
    revisionCount: task.revisionCount
  };
}

function buildFallbackDecision(input: {
  fallbackStage: "plan" | "draft_gate";
  preferredMode: XMainAgentDecision["preferredMode"];
  publishAction: XPublishAction;
  contentStyle: XContentStyle;
  targetTweetUrl: string | null;
  targetTweetReason?: string;
  useHotspot?: boolean;
  selectedHotspotIds?: number[];
}): XMainAgentDecision {
  return {
    usedFallback: true,
    fallbackStage: input.fallbackStage,
    decision: "write",
    reason: "Fallback planning decision was used because the model did not return valid JSON.",
    shouldWrite: true,
    shouldPublish: false,
    preferredMode: input.preferredMode,
    publishAction: input.publishAction,
    contentStyle: input.contentStyle,
    useHotspot: Boolean(input.useHotspot) && (input.selectedHotspotIds?.length ?? 0) > 0,
    selectedHotspotIds: input.useHotspot ? [...(input.selectedHotspotIds ?? [])] : [],
    targetTweetUrl: input.targetTweetUrl,
    targetTweetReason: input.targetTweetReason?.trim() || (input.targetTweetUrl ? "Target inferred from available tweet candidates." : ""),
    runtimeWriterPrompt: "",
    cadence: "defer",
    deferMinutes: 0,
    tagPlan: buildEmptyTagPlan(input.preferredMode),
    writerBrief: {
      angle: "",
      goal: "",
      mustInclude: [],
      mustAvoid: [],
      openingDirection: "",
      threadPlan: ""
    },
    revisionInstructions: [],
    qualityNotes: [],
    publishNotes: []
  };
}

function sanitizeMainDecision(
  value: XMainAgentDecision,
  input: {
    fallback: XMainAgentDecision;
    allowedHotspotIds: number[];
    allowedTargetUrls: string[];
  }
): XMainAgentDecision {
  const targetTweetUrl = normalizeTargetTweetUrl(value.targetTweetUrl);
  const allowedTargetSet = new Set(input.allowedTargetUrls.map((item) => item.trim()).filter(Boolean));
  const normalizedTargetTweetUrl =
    targetTweetUrl && (allowedTargetSet.size === 0 || allowedTargetSet.has(targetTweetUrl)) ? targetTweetUrl : null;
  const preferredMode = value.preferredMode === "thread" ? "thread" : "single";
  const publishAction = normalizePublishAction(value.publishAction, normalizedTargetTweetUrl, input.fallback.publishAction);
  const selectedHotspotIds = sanitizeHotspotIds(value.selectedHotspotIds, input.allowedHotspotIds);
  const useHotspot = Boolean(value.useHotspot) && selectedHotspotIds.length > 0;

  return {
    usedFallback: Boolean(value.usedFallback),
    fallbackStage:
      value.usedFallback && (value.fallbackStage === "plan" || value.fallbackStage === "draft_gate") ? value.fallbackStage : null,
    decision: normalizeMainDecisionType(value.decision),
    reason: value.reason?.trim() || input.fallback.reason,
    shouldWrite: Boolean(value.shouldWrite),
    shouldPublish: Boolean(value.shouldPublish),
    preferredMode,
    publishAction,
    contentStyle: normalizeContentStyle(value.contentStyle, input.fallback.contentStyle),
    useHotspot,
    selectedHotspotIds: useHotspot ? selectedHotspotIds : [],
    targetTweetUrl: normalizedTargetTweetUrl,
    targetTweetReason: value.targetTweetReason?.trim() ?? "",
    runtimeWriterPrompt: value.runtimeWriterPrompt?.trim() ?? "",
    cadence: normalizeCadence(value.cadence),
    deferMinutes: normalizeDeferMinutes(value.deferMinutes),
    tagPlan: sanitizeTagPlan(value.tagPlan, preferredMode),
    writerBrief: {
      angle: value.writerBrief?.angle?.trim() ?? "",
      goal: value.writerBrief?.goal?.trim() ?? "",
      mustInclude: normalizeStringArray(value.writerBrief?.mustInclude),
      mustAvoid: normalizeStringArray(value.writerBrief?.mustAvoid),
      openingDirection: value.writerBrief?.openingDirection?.trim() ?? "",
      threadPlan: value.writerBrief?.threadPlan?.trim() ?? ""
    },
    revisionInstructions: normalizeStringArray(value.revisionInstructions),
    qualityNotes: normalizeStringArray(value.qualityNotes),
    publishNotes: normalizeStringArray(value.publishNotes)
  };
}

function ensureRuntimeWriterPrompt(
  value: XMainAgentDecision,
  input: {
    writerPromptSource: XAccount["writerPromptSource"];
    writerPromptReference: ReturnType<typeof buildWriterPromptReferenceContext>;
  }
) {
  if (input.writerPromptSource !== "main_agent") {
    return value;
  }

  if (value.runtimeWriterPrompt.trim()) {
    return value;
  }

  return {
    ...value,
    qualityNotes: normalizeStringArray([
      "Runtime writer prompt was intentionally left empty in main_agent mode. The service no longer auto-injects a generic fallback writer template; Writer must execute directly from task, writerBrief, Soul, and research context.",
      /*
      "Runtime writer prompt 已由服务端根据 writerBrief 自动补齐，因为 MainAgent 在 main_agent 模式下返回了空 runtimeWriterPrompt。",
      */
      ...value.qualityNotes
    ])
  };
}

function synthesizeRuntimeWriterPrompt(
  value: XMainAgentDecision,
  writerPromptReference: ReturnType<typeof buildWriterPromptReferenceContext>
) {
  const lines = [
    "按本轮任务级指令写作，不要复述新闻，不要退回成泛化安全文案。",
    `本轮发布动作：${value.publishAction}。内容风格：${value.contentStyle}。输出模式：${value.preferredMode}。`,
    value.publishAction === "quote"
      ? "这是 quote 场景。首屏先给判断，再借目标推文提供上下文，不要把正文写成独立长文开头。"
      : value.publishAction === "reply"
        ? "这是 reply 场景。首句必须像在回某条具体推文，不要写成独立发帖。"
        : "这是独立发帖场景。直接落观点，不要假装在回应外部上下文。",
    value.targetTweetUrl ? `目标推文 URL：${value.targetTweetUrl}` : null,
    value.writerBrief.angle ? `写作角度：${value.writerBrief.angle}` : null,
    value.writerBrief.goal ? `写作目标：${value.writerBrief.goal}` : null,
    value.writerBrief.openingDirection ? `开头方向：${value.writerBrief.openingDirection}` : null,
    value.writerBrief.threadPlan && value.preferredMode === "thread"
      ? `线程推进：${value.writerBrief.threadPlan}`
      : null,
    value.tagPlan.hashtags.length
      ? `标签方案：${value.tagPlan.applyTo === "all_posts" ? "每条都可带标签" : value.tagPlan.applyTo === "first_post" ? "首条带标签" : value.tagPlan.applyTo === "last_post" ? "末条带标签" : "单条带标签"}；位置=${value.tagPlan.placement}；标签=${value.tagPlan.hashtags.join(" ")}`
      : "标签方案：默认不主动加 hashtag，除非 tagPlan 明确要求。",
    value.writerBrief.mustInclude.length ? `必须覆盖：${value.writerBrief.mustInclude.join("；")}` : null,
    value.writerBrief.mustAvoid.length ? `必须避免：${value.writerBrief.mustAvoid.join("；")}` : null,
    writerPromptReference
      ? "同时参考当前固定 Writer Prompt 的稳定偏好：优先短句、高换行率、第一人称判断、对比结构、诚实的约束式表达；但不要照搬原文或模板。"
      : null,
    "默认写成中文 X 原生表达：先给立场，保持呼吸感，像真人交易手记，不要教育用户。",
    "如果证据不完整，用“我更倾向于”“更像是”这类约束式判断，不要装成绝对确定。"
  ];

  return lines.filter(Boolean).join("\n");
}

function applyTaskPlanningHints(value: XMainAgentDecision, planningHints: TaskPlanningHints): XMainAgentDecision {
  let preferredMode = value.preferredMode;
  let publishAction = value.publishAction;
  let contentStyle = value.contentStyle;
  let targetTweetUrl = value.targetTweetUrl;
  let targetTweetReason = value.targetTweetReason;
  let useHotspot = value.useHotspot;
  let selectedHotspotIds = value.selectedHotspotIds;
  const qualityNotes = [...value.qualityNotes];

  if (
    planningHints.actionHint &&
    isConfidenceAtLeast(planningHints.actionHint.confidence, "medium") &&
    planningHints.actionHint.targetTweetUrl
  ) {
    if (publishAction !== planningHints.actionHint.value || targetTweetUrl !== planningHints.actionHint.targetTweetUrl) {
      publishAction = planningHints.actionHint.value;
      targetTweetUrl = planningHints.actionHint.targetTweetUrl;
      targetTweetReason = planningHints.actionHint.reason;
      qualityNotes.unshift(
        `Rule override: publishAction => ${planningHints.actionHint.value}. ${planningHints.actionHint.reason}`
      );
    }
  }

  if (
    planningHints.contentStyleHint &&
    isConfidenceAtLeast(planningHints.contentStyleHint.confidence, "medium") &&
    contentStyle !== planningHints.contentStyleHint.value
  ) {
    contentStyle = planningHints.contentStyleHint.value;
    qualityNotes.unshift(
      `Rule override: contentStyle => ${planningHints.contentStyleHint.value}. ${planningHints.contentStyleHint.reason}`
    );
  }

  if (
    planningHints.preferredModeHint &&
    isConfidenceAtLeast(planningHints.preferredModeHint.confidence, "medium") &&
    preferredMode !== planningHints.preferredModeHint.value
  ) {
    preferredMode = planningHints.preferredModeHint.value;
    qualityNotes.unshift(
      `Rule override: preferredMode => ${planningHints.preferredModeHint.value}. ${planningHints.preferredModeHint.reason}`
    );
  }

  if (
    planningHints.hotspotHint.shouldUseHotspot &&
    isConfidenceAtLeast(planningHints.hotspotHint.confidence, "medium") &&
    planningHints.hotspotHint.selectedHotspotIds.length > 0 &&
    (!useHotspot || !sameNumberArray(selectedHotspotIds, planningHints.hotspotHint.selectedHotspotIds))
  ) {
    useHotspot = true;
    selectedHotspotIds = [...planningHints.hotspotHint.selectedHotspotIds];
    qualityNotes.unshift(
      `Rule override: useHotspot => true. ${planningHints.hotspotHint.reason || "The task strongly matches an existing hotspot."}`
    );
  }

  return {
    ...value,
    preferredMode,
    publishAction,
    contentStyle,
    useHotspot,
    selectedHotspotIds,
    targetTweetUrl,
    targetTweetReason,
    qualityNotes: normalizeStringArray(qualityNotes)
  };
}

function injectConcreteEvidenceRequirement(
  value: XMainAgentDecision,
  input: {
    task: Pick<XTask, "title" | "brief" | "goal">;
    hotspotCandidates: XHotspot[];
    planningHints: TaskPlanningHints;
  }
) {
  const taskText = `${input.task.title} ${input.task.brief} ${input.task.goal}`.toLowerCase();
  const needsConcreteEvidence =
    value.useHotspot ||
    input.planningHints.hotspotHint.shouldUseHotspot ||
    input.hotspotCandidates.some((item) => item.topicType === "price_move" || item.topicType === "market_event") ||
    /(点位|数据|支撑|阻力|资金费率|滑点|手续费|训练集|验证集|回测|仓位结构|量价|放量|缩量|杠杆|20x|price|funding|backtest|support|resistance)/.test(
      taskText
    );

  if (!needsConcreteEvidence) {
    return value;
  }

  return {
    ...value,
    runtimeWriterPrompt: appendConcreteEvidenceRuntimePrompt(value.runtimeWriterPrompt),
    writerBrief: {
      ...value.writerBrief,
      mustInclude: normalizeStringArray([
        ...value.writerBrief.mustInclude,
        "Concrete evidence requirement: if hotspotContext, target tweet facts, or task facts provide meaningful levels, leverage, fees, funding, train/validation split, or volume clues, keep 1-2 exact details and explain what they imply.",
        "Do not write this task as vibe-only commentary. Concrete facts should support the judgment, not replace it."
      ])
    },
    qualityNotes: normalizeStringArray([
      "Concrete evidence requirement: prefer one or two real datapoints or levels from hotspot or research context so the post has analysis, not just atmosphere.",
      ...value.qualityNotes
    ])
  };
}

function appendConcreteEvidenceRuntimePrompt(runtimeWriterPrompt: string) {
  const block = [
    "Concrete evidence guard:",
    "1. If hotspotContext, target tweet facts, or task facts contain real numbers or levels, keep one or two of the most meaningful ones.",
    "2. Use the numbers only when you can explain what they mean for structure, execution, funding, liquidity, risk, or verification quality.",
    "3. Do not dump a spreadsheet. One or two real datapoints with interpretation is enough.",
    "4. Never invent numbers, levels, timestamps, or market facts that are not present in the provided context."
  ].join("\n");

  return runtimeWriterPrompt.trim() ? `${runtimeWriterPrompt}\n\n${block}` : block;
}

function injectSoulVoiceAnchors(
  value: XMainAgentDecision,
  input: {
    task: Pick<XTask, "title" | "brief" | "goal">;
    accountSoulMarkdown: string | null;
  }
) {
  const markdown = input.accountSoulMarkdown?.trim();
  if (!markdown) {
    return value;
  }

  const worldviewAnchors = extractMarkdownBulletSection(markdown, "Worldview");
  const exemplarAnchors = extractMarkdownBulletSection(markdown, "Exemplar Lines");
  if (!worldviewAnchors.length && !exemplarAnchors.length) {
    return value;
  }

  const selectedReferences = selectTaskMatchedSoulReferences({
    task: input.task,
    worldviewAnchors,
    exemplarAnchors
  });
  if (!selectedReferences.worldview.length && !selectedReferences.exemplars.length) {
    return value;
  }

  const emotionalRequirement =
    "Emotion anchor: at least one sentence should sound like a real trader reacting to the tape or the position, with visible annoyance, caution, impatience, relief, or self-mockery when appropriate.";
  const worldviewRequirements = selectedReferences.worldview.map(
    (anchor, index) => `Soul worldview ${index + 1}: ${anchor}`
  );
  const styleReferences = selectedReferences.exemplars.map(describeSoulExemplarMechanism).filter(Boolean);
  const styleRequirements = styleReferences.map((anchor, index) => `Style reference ${index + 1}: ${anchor}`);
  const openingDirectionHint =
    "Open like a trader reacting to the tape, the level, or the fill first; do not open with abstract principle talk.";
  const directReuseAvoid = selectedReferences.exemplars.map(
    (anchor, index) => `Do not directly reuse Soul exemplar ${index + 1} wording, metaphor, sentence skeleton, or punchline: ${anchor}`
  );
  const openingDirectionAddition = "首句优先像真人交易员对位置、盘口或势头的直接反应，不要一上来先讲抽象概念。";

  return {
    ...value,
    runtimeWriterPrompt: appendSoulStyleReferenceRuntimePrompt(value.runtimeWriterPrompt, {
      worldviewAnchors: selectedReferences.worldview,
      styleReferences,
      exemplarAnchors: selectedReferences.exemplars
    }),
    writerBrief: {
      ...value.writerBrief,
      mustInclude: normalizeStringArray([
        ...value.writerBrief.mustInclude,
        emotionalRequirement,
        ...worldviewRequirements,
        ...styleRequirements
      ]),
      mustAvoid: normalizeStringArray([
        ...value.writerBrief.mustAvoid,
        ...directReuseAvoid
      ]),
      openingDirection: value.writerBrief.openingDirection
        ? `${value.writerBrief.openingDirection} ${openingDirectionHint}`
        : openingDirectionHint
    },
    qualityNotes: normalizeStringArray([
      `Soul style-reference injection: keep the trader emotion and execution feel, but learn mechanisms instead of reusing exemplar wording. Worldview=${selectedReferences.worldview.join(" / ") || "none"}; StyleReferences=${styleReferences.join(" / ") || "none"}.`,
      ...value.qualityNotes
    ])
  };
}

function injectProductMentionStyleGuard(
  value: XMainAgentDecision,
  input: {
    task: Pick<XTask, "title" | "brief" | "goal">;
    accountSoulMarkdown: string | null;
  }
) {
  const markdown = input.accountSoulMarkdown?.trim();
  if (!markdown || !markdown.toLowerCase().includes("cryptopathx")) {
    return value;
  }

  const taskText = `${input.task.title} ${input.task.brief} ${input.task.goal}`.toLowerCase();
  const isExplicitToolTask =
    value.contentStyle === "tool_mention" || /(cryptopathx|工具|回测工具|回测链路|方法论|workflow|工具评测)/.test(taskText);

  const mustAvoid = isExplicitToolTask
    ? [
        "把 cryptopathx 写成功能清单、卖点说明或产品介绍页口吻",
        "让产品名压过交易情绪、痛点和执行判断",
        "把产品名写成结尾 punchline"
      ]
    : [
        "非产品任务里把 cryptopathx 写成独立说明句或验证流程主句",
        "为了带产品而硬插一句 cryptopathx",
        "把产品名写成结尾 punchline"
      ];

  const note = isExplicitToolTask
    ? "Product mention style guard: even in tool tasks, the product must be framed through trader pain, annoyance, uncertainty, or execution need first. Product is still a prop, not the emotional center."
    : "Product mention style guard: in non-tool tasks, product naming is optional and should stay behind a stronger emotional trader sentence. If the sentence works without the brand, prefer a generic expression like 先回测一下 or 先验一下路径.";

  return {
    ...value,
    runtimeWriterPrompt: appendProductMentionStylePrompt(value.runtimeWriterPrompt, isExplicitToolTask),
    writerBrief: {
      ...value.writerBrief,
      mustAvoid: normalizeStringArray([...value.writerBrief.mustAvoid, ...mustAvoid])
    },
    qualityNotes: normalizeStringArray([note, ...value.qualityNotes])
  };
}

function appendProductMentionStylePrompt(runtimeWriterPrompt: string, isExplicitToolTask: boolean) {
  const lines = isExplicitToolTask
    ? [
        "Product mention style guard:",
        "1. If cryptopathx is mentioned, write the trader's pain, annoyance, doubt, or execution need first, then let the product appear as a background action.",
        "2. Do not describe the product like a feature demo, product brochure, or neutral explanation block.",
        "3. The emotional center must stay on the trader's reaction and judgment, not on the product name.",
        "4. Do not end the post on the product mention. Land on the market, the position, or the decision."
      ]
    : [
        "Product mention style guard:",
        "1. This is not a product task. cryptopathx is optional, not required.",
        "2. If it appears, it must be embedded inside a more emotional trader sentence and read like a passing action, not a standalone verification statement.",
        "3. Prefer wording like 先过一遍回测, 先验一下路径, or 拿工具扫一眼 when the brand name is not essential.",
        "4. Do not make the brand name the punchline, the main clause, or the final landing sentence."
      ];

  const block = lines.join("\n");
  return runtimeWriterPrompt.trim() ? `${runtimeWriterPrompt}\n\n${block}` : block;
}

function appendSoulAnchorRuntimePrompt(runtimeWriterPrompt: string, anchors: string[]) {
  const block = [
    "Soul voice-anchor injection:",
    `1. 本轮至少吸收 1-2 个账号原生表达锚点，不要只保留抽象意思：${anchors.join("；")}`,
    "2. 可以改写，不要生硬照抄，但要保留同样的情绪纹理和盘面质感。",
    "3. 至少写出一句像真人交易员会脱口而出的句子，允许出现嫌恶、警惕、自嘲、烦躁或庆幸。",
    "4. 多写位置、盘口、势头、反馈、骗线、接盘这类执行语言，少写抽象鸡汤。"
  ].join("\n");

  return runtimeWriterPrompt.trim() ? `${runtimeWriterPrompt}\n\n${block}` : block;
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMarkdownBulletSection(markdown: string, heading: string) {
  return extractMarkdownSection(markdown, heading)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-+\s*/, "").trim())
    .filter(Boolean);
}

function selectTaskMatchedSoulAnchors(input: {
  task: Pick<XTask, "title" | "brief" | "goal">;
  worldviewAnchors: string[];
  exemplarAnchors: string[];
}) {
  const taskText = `${input.task.title} ${input.task.brief} ${input.task.goal}`.toLowerCase();
  const worldviewRanked = input.worldviewAnchors
    .map((text) => ({ text, score: scoreSoulAnchor(text, taskText, "worldview") }))
    .sort((left, right) => right.score - left.score);
  const exemplarRanked = input.exemplarAnchors
    .map((text) => ({ text, score: scoreSoulAnchor(text, taskText, "exemplar") }))
    .sort((left, right) => right.score - left.score);

  const selected: string[] = [];
  const worldviewTop = worldviewRanked[0]?.text;
  const exemplarTop = exemplarRanked[0]?.text;

  if (worldviewTop) {
    selected.push(worldviewTop);
  }

  if (exemplarTop && !selected.includes(exemplarTop)) {
    selected.push(exemplarTop);
  }

  const rest = [...worldviewRanked.slice(1), ...exemplarRanked.slice(1)]
    .sort((left, right) => right.score - left.score)
    .map((item) => item.text);

  for (const item of rest) {
    if (selected.length >= 3) {
      break;
    }
    if (!selected.includes(item)) {
      selected.push(item);
    }
  }

  return selected.slice(0, 3);
}

function appendSoulStyleReferenceRuntimePrompt(
  runtimeWriterPrompt: string,
  input: {
    worldviewAnchors: string[];
    styleReferences: string[];
    exemplarAnchors: string[];
  }
) {
  const block = [
    "Soul voice-reference injection:",
    "1. Exemplar lines are style references only. Learn the reaction pattern, pacing, metaphor type, and execution language, but do not reuse the original wording.",
    input.worldviewAnchors.length
      ? `2. Keep the draft compatible with these Soul worldview anchors: ${input.worldviewAnchors.join(" / ")}`
      : "2. No worldview anchor was selected for this task; keep overall Soul compatibility anyway.",
    input.styleReferences.length
      ? `3. Use 1-2 of these style references as mechanisms, not quotes: ${input.styleReferences.join(" / ")}`
      : "3. Keep the trader tone alive with fresh phrasing instead of generic commentary.",
    "4. Keep at least one clear trader reaction sentence with annoyance, caution, impatience, relief, or self-mockery when appropriate.",
    "5. Favor execution language such as levels, tape, fills, funding, liquidity, support/resistance, position handling, and risk response over abstract inspiration.",
    input.exemplarAnchors.length
      ? `6. Do not directly reuse these Soul exemplars or their punchlines: ${input.exemplarAnchors.join(" / ")}`
      : "6. Do not turn Soul into a catchphrase generator."
  ].join("\n");

  return runtimeWriterPrompt.trim() ? `${runtimeWriterPrompt}\n\n${block}` : block;
}

function selectTaskMatchedSoulReferences(input: {
  task: Pick<XTask, "title" | "brief" | "goal">;
  worldviewAnchors: string[];
  exemplarAnchors: string[];
}) {
  const taskText = `${input.task.title} ${input.task.brief} ${input.task.goal}`.toLowerCase();
  const worldviewRanked = input.worldviewAnchors
    .map((text) => ({ text, score: scoreSoulAnchor(text, taskText, "worldview") }))
    .sort((left, right) => right.score - left.score);
  const exemplarRanked = input.exemplarAnchors
    .map((text) => ({ text, score: scoreSoulAnchor(text, taskText, "exemplar") }))
    .sort((left, right) => right.score - left.score);

  return {
    worldview: worldviewRanked
      .map((item) => item.text)
      .filter((item, index, array) => Boolean(item) && array.indexOf(item) === index)
      .slice(0, 1),
    exemplars: exemplarRanked
      .map((item) => item.text)
      .filter((item, index, array) => Boolean(item) && array.indexOf(item) === index)
      .slice(0, 2)
  };
}

function describeSoulExemplarMechanism(anchor: string) {
  const normalizedAnchor = anchor.toLowerCase();
  const hints: string[] = [];

  if (/(要饭|盆|讨饭|beg)/.test(normalizedAnchor)) {
    hints.push("可以用生活化或市井隐喻映射交易执行，但必须换掉原来的隐喻对象和 punchline。");
  }

  if (/(插针|恶心|mmp|骂人|撕逼|骗线|负成这个样子|资金费率)/.test(normalizedAnchor)) {
    hints.push("允许先给盘面情绪反应，再迅速落到结构、仓位或执行判断。");
  }

  if (/(脸面|仓位|止损|跑|势头不对)/.test(normalizedAnchor)) {
    hints.push("把面子、对错和情绪让位给仓位与风控处理，语气可以硬一点。");
  }

  if (/(回测|验一下|路径|训练集|验证集|滑点|手续费)/.test(normalizedAnchor)) {
    hints.push("遇到不确定性时先验证路径、拆数据质量或做回测，不要空讲信仰。");
  }

  if (/(位置|盘口|势头|接盘|流动性|支撑|阻力|三卖)/.test(normalizedAnchor)) {
    hints.push("多用位置、盘口、流动性、支撑阻力、接盘、止损这类执行语言，不要只讲抽象心法。");
  }

  if (/(bro|是不是)/.test(normalizedAnchor)) {
    hints.push("口头禅只能轻点一下，最多一次，要像顺手带出来，不要反复刷存在感。");
  }

  if (!hints.length) {
    hints.push("保留真人交易员的情绪起手和执行语言，但换一套新的句式与隐喻。");
  }

  return Array.from(new Set(hints)).join(" ");
}

function scoreSoulAnchor(anchor: string, taskText: string, source: "worldview" | "exemplar") {
  const normalizedAnchor = anchor.toLowerCase();
  let score = source === "exemplar" ? 2 : 1;

  if (/(新项目|项目|流动性|叙事|认知)/.test(taskText) && /(新项目|项目|流动性|叙事|认知|接盘)/.test(normalizedAnchor)) {
    score += 4;
  }

  if (/(位置|反馈|脸面|仓位|骗线|要饭|接盘|势头|跑|盘口)/.test(normalizedAnchor)) {
    score += 3;
  }

  if (/(脸面|仓位)/.test(normalizedAnchor)) {
    score += 2;
  }

  if (/(先找位置，再等市场给反馈|脸面没有仓位重要|骗线|要饭|插针|恶心)/.test(anchor)) {
    score += 4;
  }

  if (/(不是|bro|mmp|恶心|骗线|要饭|🤬|😂|\?)/.test(anchor)) {
    score += 1;
  }

  return score;
}

function preservePlannedPublishAction(
  value: XMainAgentDecision,
  plannedDecision: XMainAgentDecision | null
) {
  if (!plannedDecision?.targetTweetUrl) {
    return value;
  }

  if (plannedDecision.publishAction !== "quote" && plannedDecision.publishAction !== "reply") {
    return value;
  }

  if (value.publishAction === plannedDecision.publishAction && value.targetTweetUrl === plannedDecision.targetTweetUrl) {
    return value;
  }

  return {
    ...value,
    publishAction: plannedDecision.publishAction,
    targetTweetUrl: plannedDecision.targetTweetUrl,
    targetTweetReason: plannedDecision.targetTweetReason,
    qualityNotes: normalizeStringArray([
      `Rule override: keep publishAction => ${plannedDecision.publishAction}. draft_gate must preserve the plan-stage target tweet binding for this task.`,
      ...value.qualityNotes
    ])
  };
}

function preservePlannedTagPlan(value: XMainAgentDecision, plannedDecision: XMainAgentDecision | null) {
  if (!plannedDecision) {
    return value;
  }

  if (sameTagPlan(value.tagPlan, plannedDecision.tagPlan)) {
    return value;
  }

  return {
    ...value,
    tagPlan: plannedDecision.tagPlan,
    qualityNotes: normalizeStringArray([
      `Rule override: keep tagPlan => ${describeTagPlan(plannedDecision.tagPlan)}. draft_gate should preserve the plan-stage hashtag decision for this task.`,
      ...value.qualityNotes
    ])
  };
}

function normalizeStringArray(value: string[] | undefined) {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : [];
}

function sanitizeTagPlan(
  value: XMainAgentDecision["tagPlan"] | undefined,
  preferredMode: XMainAgentDecision["preferredMode"]
): XMainAgentDecision["tagPlan"] {
  const hashtags = normalizeHashtagArray(value?.hashtags ?? []);
  const placement = value?.placement === "tail" || value?.placement === "inline" ? value.placement : "none";
  const applyTo =
    preferredMode === "single"
      ? "single"
      : value?.applyTo === "first_post" || value?.applyTo === "last_post" || value?.applyTo === "all_posts"
        ? value.applyTo
        : "last_post";
  const maxTags =
    typeof value?.maxTags === "number" && Number.isFinite(value.maxTags) ? Math.max(0, Math.min(4, Math.round(value.maxTags))) : 0;

  if (!hashtags.length || placement === "none" || maxTags === 0) {
    return buildEmptyTagPlan(preferredMode, value?.reason?.trim() ?? "");
  }

  return {
    hashtags: hashtags.slice(0, maxTags),
    placement,
    applyTo,
    maxTags,
    reason: value?.reason?.trim() ?? ""
  };
}

function buildEmptyTagPlan(
  preferredMode: XMainAgentDecision["preferredMode"],
  reason = ""
): XMainAgentDecision["tagPlan"] {
  return {
    hashtags: [],
    placement: "none",
    applyTo: preferredMode === "thread" ? "last_post" : "single",
    maxTags: 0,
    reason
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

function sameTagPlan(left: XMainAgentDecision["tagPlan"], right: XMainAgentDecision["tagPlan"]) {
  return (
    left.placement === right.placement &&
    left.applyTo === right.applyTo &&
    left.maxTags === right.maxTags &&
    left.reason === right.reason &&
    left.hashtags.length === right.hashtags.length &&
    left.hashtags.every((item, index) => item === right.hashtags[index])
  );
}

function describeTagPlan(value: XMainAgentDecision["tagPlan"]) {
  if (!value.hashtags.length || value.placement === "none") {
    return "no hashtags";
  }

  return `${value.placement}/${value.applyTo}/${value.hashtags.join(" ")}`;
}

function normalizeCadence(value: string | undefined) {
  if (value === "single_now" || value === "thread_continuous_now" || value === "defer") {
    return value;
  }

  return "defer";
}

function normalizeDeferMinutes(value: number | undefined) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  return 0;
}

function normalizeMainDecisionType(value: XMainAgentDecision["decision"]) {
  if (value === "write" || value === "revise" || value === "approve_publish" || value === "defer" || value === "block") {
    return value;
  }

  return "write";
}

function normalizePublishAction(
  value: string | undefined,
  targetTweetUrl: string | null,
  fallback: XPublishAction
): XPublishAction {
  if ((value === "reply" || value === "quote") && targetTweetUrl) {
    return value;
  }

  if (value === "post") {
    return "post";
  }

  return fallback === "reply" || fallback === "quote" ? (targetTweetUrl ? fallback : "post") : "post";
}

function normalizeContentStyle(value: string | undefined, fallback: XContentStyle): XContentStyle {
  switch (value) {
    case "small_insight":
    case "pitfall_log":
    case "tool_mention":
    case "industry_talk":
    case "interactive_qa":
    case "quote_repost":
    case "casual_note":
      return value;
    default:
      return fallback;
  }
}

function sanitizeHotspotIds(values: number[] | undefined, allowedHotspotIds: number[]) {
  const allowed = new Set(allowedHotspotIds);
  if (!Array.isArray(values)) {
    return [];
  }

  const deduped: number[] = [];
  for (const item of values) {
    if (typeof item !== "number" || !Number.isInteger(item) || item <= 0 || !allowed.has(item) || deduped.includes(item)) {
      continue;
    }

    deduped.push(item);
  }

  return deduped;
}

function sameNumberArray(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveFallbackMode(value: XTask["preferredMode"]): XMainAgentDecision["preferredMode"] {
  return value === "thread" ? "thread" : "single";
}

function mapMainDecisionToReviewDecision(value: XMainAgentDecision["decision"]): XReviewResult["decision"] {
  if (value === "approve_publish" || value === "defer") {
    return "approve";
  }

  if (value === "block") {
    return "block";
  }

  return "revise";
}

function disableStandaloneResearchFlow(
  value: XMainAgentDecision,
  stage: "plan" | "draft_gate"
): XMainAgentDecision {
  if (value.decision !== "write" && value.decision !== "revise" && value.decision !== "approve_publish" && value.decision !== "defer" && value.decision !== "block") {
    return {
      ...value,
      decision: stage === "plan" ? "write" : "revise",
      reason:
        stage === "plan"
          ? "规划阶段只允许直接进入写作、延期或拦截，不再进入独立 research 阶段。"
          : "draft_gate 只允许修改、批准、延期或拦截，不再进入独立 research 阶段。",
      shouldWrite: true,
      shouldPublish: false,
      qualityNotes: normalizeStringArray([
        "Rule override: standalone research flow was removed. Reuse task facts, hotspot context, and Soul directly.",
        ...value.qualityNotes
      ])
    };
  }

  return value;
}

function mapReviewAgentVerdictToReviewDecision(verdict: XReviewAgentResult["verdict"]): XReviewResult["decision"] {
  if (verdict === "block") {
    return "block";
  }

  if (verdict === "major_issue") {
    return "revise";
  }

  return "approve";
}

function buildDraftGateFallbackReview(input: {
  plannedDecision: XMainAgentDecision | null;
  reviewAgentResult: XReviewAgentResult;
  fallbackReason: string;
}) {
  const reviewDecision = mapReviewAgentVerdictToReviewDecision(input.reviewAgentResult.verdict);
  const fallbackReason = buildDraftGateFallbackReason(input.reviewAgentResult, input.fallbackReason);

  return {
    reviewResult: {
      decision: reviewDecision,
      reason: fallbackReason,
      revisionInstructions: reviewDecision === "revise" ? normalizeStringArray(input.reviewAgentResult.suggestedFixes) : [],
      qualityNotes: normalizeStringArray([
        "MainAgent draft_gate fallback was used because the model did not return valid JSON.",
        ...buildReviewEvidence(input.reviewAgentResult)
      ])
    } satisfies XReviewResult,
    publishPlan: {
      shouldPublish: false,
      mode: input.plannedDecision?.preferredMode === "thread" ? "thread" : "single",
      action: input.plannedDecision?.publishAction ?? "post",
      contentStyle: input.plannedDecision?.contentStyle ?? "casual_note",
      cadence: "defer",
      deferMinutes: 30,
      targetTweetUrl: input.plannedDecision?.targetTweetUrl ?? null,
      selectedHotspotIds: input.plannedDecision?.selectedHotspotIds ?? [],
      tagPlan: input.plannedDecision?.tagPlan ?? buildEmptyTagPlan(input.plannedDecision?.preferredMode ?? "single"),
      reason: fallbackReason
    } satisfies XPublishPlan
  };
}

function buildDraftGateFallbackReason(reviewAgentResult: XReviewAgentResult, fallbackReason: string) {
  if (reviewAgentResult.verdict === "block") {
    return `${fallbackReason} ReviewAgent also marked the draft as blocked.`;
  }

  if (reviewAgentResult.verdict === "major_issue") {
    return `${fallbackReason} ReviewAgent found major issues, so another rewrite is still required.`;
  }

  if (reviewAgentResult.verdict === "minor_issue") {
    return `${fallbackReason} ReviewAgent only found minor issues, so the system avoided another blind rewrite.`;
  }

  return `${fallbackReason} ReviewAgent passed the draft, so the system kept the current version instead of forcing another blind rewrite.`;
}

function buildReviewEvidence(reviewAgentResult: XReviewAgentResult) {
  return normalizeStringArray([
    `ReviewAgent verdict: ${reviewAgentResult.verdict}. ${reviewAgentResult.summary}`,
    ...reviewAgentResult.issues.map((item) => `Review issue: ${item}`),
    ...reviewAgentResult.riskFlags.map((item) => `Review risk: ${item}`)
  ]);
}

function collectAllowedTargetUrls(plannedDecision: XMainAgentDecision | null) {
  return plannedDecision?.targetTweetUrl ? [plannedDecision.targetTweetUrl] : [];
}

const MAIN_AGENT_RUNTIME_BOUNDARY_SUFFIX = [
  "Runtime role-boundary update:",
  "1. You now run at both stage=\"plan\" and stage=\"draft_gate\". At plan stage, you must decide publishing action, content style, hotspot usage, and whether Writer should be driven by a runtime prompt.",
  "2. account now includes writerPromptSource and publishStyleRatios. Use them to simulate a more human posting rhythm instead of repeating one tone.",
  "3. publishAction must be one of: post, reply, quote.",
  "4. contentStyle must be one of: casual_note, small_insight, pitfall_log, tool_mention, industry_talk, interactive_qa, quote_repost.",
  "5. If publishAction is reply or quote, targetTweetUrl must point to a real candidate tweet URL. If there is no valid target, fall back to post.",
  "6. If useHotspot=true, selectedHotspotIds must come from hotspotCandidates. Only choose hotspot ids that materially help the topic.",
  "6.1 planningHints contains deterministic action, style, mode, and hotspot suggestions derived from task semantics. Treat medium and hard hints as your default baseline unless the task itself clearly conflicts.",
  "6.2 tagPlan is now a first-class planning field. Use it to decide whether this task should carry hashtags at all, instead of leaving that choice vague for Writer.",
  "6.3 Keep hashtag usage conservative. Most tasks should use 0-3 hashtags. Prefer placement=tail and applyTo=single or last_post unless the task clearly benefits from inline tags.",
  "6.4 If tagPlan.placement = none, Writer should not invent generic tail hashtags. If you do choose hashtags, they must be topic-fit, compact, and non-spammy.",
  "6.5 Your JSON must include tagPlan with exactly these fields: hashtags(string[]), placement(none|tail|inline), applyTo(single|first_post|last_post|all_posts), maxTags(number), reason(string).",
  "7. If account.writerPromptSource = main_agent, fill runtimeWriterPrompt with a concrete, task-level writer instruction block. If account.writerPromptSource = database, runtimeWriterPrompt can be empty.",
  "7.1 If writerPromptReference is present, treat it as the account's current fixed Writer Prompt baseline. Use it as reference material when authoring runtimeWriterPrompt and writerBrief.",
  "7.2 Do not copy writerPromptReference raw into runtimeWriterPrompt. Distill its stable useful constraints, then rewrite them into task-specific guidance for the current brief.",
  "8. recentPublishedSignals is a real anti-pattern guard. Avoid repetitive action, repetitive contentStyle, and repetitive topic timing.",
  "9. draft_gate still receives reviewAgentResult first. Build on it instead of ignoring it.",
  "10. You still own the final publish cadence decision.",
  "11. Default operating market is the Chinese-speaking crypto market only. Do not plan for English-speaking or global-general audiences.",
  "12. All free-text fields inside your JSON must be written in Simplified Chinese, unless you are preserving a URL, ticker, handle, or quoted proper noun.",
  "13. Do not invent a separate research phase just because the task is complex. If task facts, hotspot context, and target tweet context are enough for a first draft, go write directly.",
  "14. Hotspot context and task facts are supportive context, not decoration. They may refine evidence, framing, and phrasing, but they are downstream of accountSoulMarkdown.",
  "15. Do not pass hotspot summaries or task facts through raw to Writer as a substitute for planning. Distill only the task-compatible parts into runtimeWriterPrompt, writerBrief, mustInclude, mustAvoid, and qualityNotes.",
  "16. When hotspot context conflicts with accountSoulMarkdown or the current task, Soul and task facts win. Use hotspot context only for compatible evidence and phrasing guidance, not generic style worship.",
  "17. The final post should feel like a native Twitter/X post for the Chinese market: strong first-screen hook, compact readable blocks, and natural post rhythm. For a normal single post, prefer one compact paragraph or at most one to two intentional line breaks unless the task clearly benefits from more.",
  "18. Push the content to be more opinionated and more daring than bland safe copy, but never by inventing claims. A strong point of view must be anchored in task context, hotspot context, existing research, or clearly labeled personal inference.",
  "19. If the evidence is direct, let Writer speak firmly. If the evidence is incomplete, tell Writer to phrase it as constrained judgment such as '我更倾向于' or '更像是', not as fake certainty.",
  "20. Avoid overfitting to reference-account surface traits. Do not force every draft into ultra-short lines, repeated contrast slogans, or template-like emotional cadence just because the reference account sometimes does that.",
  "21. accountSoulMarkdown is the stable account identity anchor. After platform safety and global policy constraints, it is the highest-priority voice layer for this task.",
  "22. accountSoulMarkdown decides who this account is, what tone it naturally uses, and what boundaries it should keep. It does not decide the topic and it must not replace the requested task frame with a safer generic one.",
  "23. Hotspot context may sharpen evidence or phrasing, but it may only refine within the accountSoulMarkdown boundary.",
  "24. task, hotspotCandidates, candidateTweetTargets, publishAction, contentStyle, and preferredMode decide what this post is about and what frame it must keep. accountSoulMarkdown only decides how that same topic should sound from this account.",
  "25. Do not turn a specific task into a generic discipline post, generic empty-risk slogan, generic account-intro monologue, or generic safety note just because those are easier to write safely.",
  "26. If the task asks for a concrete frame such as new-project observation, tool workflow, trader note, reply, quote, or industry critique, keep that frame central all the way into writerBrief and runtimeWriterPrompt.",
  "27. Treat tagPlan as part of the planning contract. It should express whether hashtags are needed, which hashtags to use, where to place them, and whether they belong on the single post, first post, last post, or all posts.",
  "28. Hashtags are not a decoration layer. Use them only when they improve discoverability or framing. Do not dump generic crypto hashtags.",
  "29. If the task is a normal opinion post, trader note, or reply, one compact tail hashtag line is usually enough when tags are needed at all.",
  "30. Do not overload Writer with vague hashtag hints inside mustInclude. Put the structured decision into tagPlan first, then use writerBrief only for any extra phrasing nuance."
].join("\n");
