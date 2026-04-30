import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import {
  buildCandidateTweetTargets,
  normalizeTargetTweetUrl,
  type CandidateTweetTarget,
  type XAccount,
  type XContentStyle,
  type XHotspot,
  type XMainAgentDecision,
  type XPublishAction,
  type XPublishCadence,
  type XPublishMode,
  type XTagApplyTo,
  type XTagPlacement,
  type XTagPlan,
  type XTask
} from "@zhihu-mvp/x-core";
import type { XTraditionalTopicSelection } from "../types.js";
import { XTraditionalLlmService } from "./x-traditional-llm-service.js";

type RecentPublishedSignal = {
  title: string;
  publishedAt: string | null;
  mode: XPublishMode | null;
  action: XPublishAction | null;
  contentStyle: XContentStyle | null;
  targetTweetUrl: string | null;
};

export class XTraditionalMainAgentService {
  constructor(private readonly llmService: XTraditionalLlmService) {}

  async selectTopic(input: {
    account: XAccount;
    task: XTask;
    accountSoulMarkdown: string | null;
    hotspotCandidates: XHotspot[];
    recentPublishedSignals: RecentPublishedSignal[];
    promptSnapshot?: PromptSnapshotMap | null;
  }) {
    const candidateTweetTargets = buildCandidateTweetTargets(input.task, input.hotspotCandidates);
    const fallback = buildFallbackTopicSelection(input.task, input.hotspotCandidates, candidateTweetTargets);
    const output = await this.llmService.runJson<XTraditionalTopicSelection>(
      "x_traditional_main_agent",
      {
        stage: "topic_selection",
        account: buildMainAccountContext(input.account),
        accountSoulMarkdown: input.accountSoulMarkdown,
        taskGoal: input.task.goal,
        operatorTopicSeed: {
          title: isPlaceholderTopic(input.task.title) ? "" : input.task.title,
          brief: isPlaceholderTopic(input.task.brief) ? "" : input.task.brief,
          preferredMode: input.task.preferredMode
        },
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
          researchSummaryText: hotspot.researchSummaryText,
          suggestedTaskTitle: hotspot.suggestedTaskTitle,
          suggestedTaskBrief: hotspot.suggestedTaskBrief,
          angles: hotspot.angles,
          risks: hotspot.risks
        })),
        candidateTweetTargets,
        recentPublishedSignals: input.recentPublishedSignals,
        operatorNotes: input.account.manualNotes || null
      },
      fallback,
      {
        promptSnapshot: input.promptSnapshot ?? null,
        promptSuffix: TRADITIONAL_MAIN_TOPIC_SELECTION_SUFFIX
      }
    );

    const sanitizedSelection = sanitizeTopicSelection(output, {
      fallback,
      task: input.task,
      allowedHotspotIds: input.hotspotCandidates.map((item) => item.id),
      allowedTargetUrls: candidateTweetTargets.map((item) => item.url)
    });

    return {
      selection: sanitizedSelection,
      mainAgentPlan: mapTopicSelectionToMainAgentPlan(sanitizedSelection)
    };
  }
}

function buildMainAccountContext(account: XAccount) {
  return {
    id: account.id,
    handle: account.handle,
    persona: account.persona,
    targetAudience: account.targetAudience,
    styleGuide: account.styleGuide,
    manualNotes: account.manualNotes,
    learningTargets: account.learningTargets,
    status: account.status,
    lastPublishedAt: account.lastPublishedAt,
    defaultLanguage: "zh-CN",
    workflow: "traditional_topic_selection"
  };
}

function buildFallbackTopicSelection(
  task: XTask,
  hotspots: XHotspot[],
  candidateTweetTargets: CandidateTweetTarget[]
): XTraditionalTopicSelection {
  const hotspot = hotspots[0] ?? null;
  const preferredMode = task.preferredMode === "thread" ? "thread" : "single";
  const title =
    task.title.trim() && !isPlaceholderTopic(task.title)
      ? task.title.trim()
      : hotspot?.suggestedTaskTitle?.trim() || hotspot?.title?.trim() || "围绕当前市场节奏做一条 X 观察";
  const brief =
    task.brief.trim() && !isPlaceholderTopic(task.brief)
      ? task.brief.trim()
      : hotspot
        ? [
            hotspot.researchSummaryText?.trim() || hotspot.summaryText.trim() || hotspot.title,
            hotspot.angles.length ? `可用角度：${hotspot.angles.join("；")}` : null,
            hotspot.risks.length ? `风险边界：${hotspot.risks.join("；")}` : null,
            hotspot.canonicalUrl ? `参考链接：${hotspot.canonicalUrl}` : null
          ]
            .filter(Boolean)
            .join("\n")
        : "没有足够强的热点时，围绕账号目标做一条短判断，不写泛化口号。";
  const targetTweetUrl = candidateTweetTargets[0]?.url ?? null;

  return {
    decision: "write",
    reason: hotspot
      ? `Fallback selected the top planning hotspot #${hotspot.id}.`
      : "Fallback created a non-hotspot topic from the operator goal.",
    title,
    brief,
    goal: task.goal.trim() || "结合当前热点和账号 Soul 选择一个适合发布的 X 选题。",
    preferredMode,
    publishAction: "post",
    contentStyle: "casual_note",
    useHotspot: Boolean(hotspot),
    selectedHotspotIds: hotspot ? [hotspot.id] : [],
    targetTweetUrl,
    targetTweetReason: targetTweetUrl ? "Fallback target inferred from available tweet candidates." : "",
    cadence: "defer",
    deferMinutes: 0,
    tagPlan: buildEmptyTagPlan(preferredMode),
    writerBrief: {
      angle: title,
      goal: task.goal.trim(),
      mustInclude: hotspot ? [hotspot.title] : [],
      mustAvoid: ["不要写成泛化安全提示或账号自我介绍。"],
      openingDirection: "先给判断，再用一两个具体点支撑。",
      threadPlan: preferredMode === "thread" ? "用 2-4 条递进：判断、证据、风险、结论。" : ""
    },
    qualityNotes: []
  };
}

function sanitizeTopicSelection(
  value: XTraditionalTopicSelection,
  input: {
    fallback: XTraditionalTopicSelection;
    task: XTask;
    allowedHotspotIds: number[];
    allowedTargetUrls: string[];
  }
): XTraditionalTopicSelection {
  const preferredMode = value.preferredMode === "thread" ? "thread" : "single";
  const allowedTargetSet = new Set(input.allowedTargetUrls.map((item) => item.trim()).filter(Boolean));
  const targetTweetUrl = normalizeTargetTweetUrl(value.targetTweetUrl);
  const normalizedTargetTweetUrl =
    targetTweetUrl && (allowedTargetSet.size === 0 || allowedTargetSet.has(targetTweetUrl)) ? targetTweetUrl : null;
  const selectedHotspotIds = sanitizeHotspotIds(value.selectedHotspotIds, input.allowedHotspotIds);
  const useHotspot = Boolean(value.useHotspot) && selectedHotspotIds.length > 0;
  const title = value.title?.trim() || input.fallback.title;
  const brief = value.brief?.trim() || input.fallback.brief;

  return {
    decision: normalizeTopicDecision(value.decision),
    reason: value.reason?.trim() || input.fallback.reason,
    title,
    brief,
    goal: value.goal?.trim() || input.task.goal || input.fallback.goal,
    preferredMode,
    publishAction: normalizePublishAction(value.publishAction, normalizedTargetTweetUrl),
    contentStyle: normalizeContentStyle(value.contentStyle, input.fallback.contentStyle),
    useHotspot,
    selectedHotspotIds: useHotspot ? selectedHotspotIds : [],
    targetTweetUrl: normalizedTargetTweetUrl,
    targetTweetReason: value.targetTweetReason?.trim() ?? "",
    cadence: normalizeCadence(value.cadence),
    deferMinutes: normalizeDeferMinutes(value.deferMinutes),
    tagPlan: sanitizeTagPlan(value.tagPlan, preferredMode),
    writerBrief: {
      angle: value.writerBrief?.angle?.trim() || title,
      goal: value.writerBrief?.goal?.trim() || value.goal?.trim() || input.task.goal,
      mustInclude: normalizeStringArray(value.writerBrief?.mustInclude ?? []),
      mustAvoid: normalizeStringArray(value.writerBrief?.mustAvoid ?? []),
      openingDirection: value.writerBrief?.openingDirection?.trim() ?? "",
      threadPlan: value.writerBrief?.threadPlan?.trim() ?? ""
    },
    qualityNotes: normalizeStringArray(value.qualityNotes ?? [])
  };
}

function mapTopicSelectionToMainAgentPlan(selection: XTraditionalTopicSelection): XMainAgentDecision {
  return {
    usedFallback: false,
    fallbackStage: null,
    decision:
      selection.decision === "block"
        ? "block"
        : selection.decision === "defer"
          ? "defer"
          : "write",
    reason: selection.reason,
    shouldWrite: selection.decision === "write",
    shouldPublish: false,
    preferredMode: selection.preferredMode,
    publishAction: selection.publishAction,
    contentStyle: selection.contentStyle,
    useHotspot: selection.useHotspot,
    selectedHotspotIds: selection.selectedHotspotIds,
    targetTweetUrl: selection.targetTweetUrl,
    targetTweetReason: selection.targetTweetReason,
    runtimeWriterPrompt: "",
    cadence: selection.cadence,
    deferMinutes: selection.deferMinutes,
    tagPlan: selection.tagPlan,
    writerBrief: selection.writerBrief,
    revisionInstructions: [],
    qualityNotes: [
      "Traditional chain: MainAgent selected topic only. Writer used its own stable prompt.",
      ...selection.qualityNotes
    ],
    publishNotes: []
  };
}

function normalizeTopicDecision(value: XTraditionalTopicSelection["decision"]): XTraditionalTopicSelection["decision"] {
  return value === "defer" || value === "block" ? value : "write";
}

function normalizePublishAction(value: string | undefined, targetTweetUrl: string | null): XPublishAction {
  if ((value === "reply" || value === "quote") && targetTweetUrl) {
    return value;
  }

  return "post";
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

function normalizeCadence(value: string | undefined): XPublishCadence {
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

function sanitizeTagPlan(value: XTagPlan | undefined, preferredMode: XPublishMode): XTagPlan {
  const hashtags = normalizeHashtagArray(value?.hashtags ?? []);
  const placement: XTagPlacement = value?.placement === "tail" || value?.placement === "inline" ? value.placement : "none";
  const applyTo: XTagApplyTo =
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

function buildEmptyTagPlan(preferredMode: XPublishMode, reason = ""): XTagPlan {
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

function normalizeStringArray(value: string[]) {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : [];
}

function isPlaceholderTopic(value: string) {
  return /待选题|自动选题|topic_selection|MainAgent 根据热点/.test(value);
}

const TRADITIONAL_MAIN_TOPIC_SELECTION_SUFFIX = [
  "Traditional chain runtime boundary:",
  "1. You are a topic selector, not a writer-prompt author.",
  "2. Keep runtimeWriterPrompt out of the workflow. Writer has its own prompt.",
  "3. The selected topic must explicitly fit accountSoulMarkdown and taskGoal.",
  "4. If you select a hotspot, selectedHotspotIds must be present and brief must explain the usable angle.",
  "5. If you choose reply or quote, targetTweetUrl must come from candidateTweetTargets.",
  "6. Do not create a generic safe post when a sharper account-fit topic is available."
].join("\n");
