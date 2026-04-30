import type { XContentStyle, XHotspot, XPublishAction, XTask } from "../types.js";

export type CandidateTweetTarget = {
  url: string;
  source: string;
  hotspotId?: number | null;
};

export type PlanningHintConfidence = "hard" | "medium" | "soft";

export type TaskPlanningActionHint = {
  value: XPublishAction;
  confidence: PlanningHintConfidence;
  reason: string;
  targetTweetUrl: string | null;
};

export type TaskPlanningStyleHint = {
  value: XContentStyle;
  confidence: PlanningHintConfidence;
  reason: string;
};

export type TaskPlanningModeHint = {
  value: "single" | "thread";
  confidence: PlanningHintConfidence;
  reason: string;
};

export type TaskPlanningHotspotHint = {
  shouldUseHotspot: boolean;
  confidence: PlanningHintConfidence | null;
  reason: string;
  selectedHotspotIds: number[];
  topPlanningScore: number;
};

export type TaskPlanningHints = {
  actionHint: TaskPlanningActionHint | null;
  contentStyleHint: TaskPlanningStyleHint | null;
  preferredModeHint: TaskPlanningModeHint;
  hotspotHint: TaskPlanningHotspotHint;
};

export type RankedTaskHotspot = {
  hotspot: XHotspot;
  planningScore: number;
};

const TWEET_URL_REGEX = /https?:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/gi;
const REPLY_INTENT_REGEX = /(?:回复|回覆|回这条|回這條|回帖|回应|回應|\breply\b|\brespond\b)/i;
const QUOTE_INTENT_REGEX = /(?:引用转发|引用轉發|引用|转推|轉推|转发|轉發|借这条|借這條|\bquote\b|\bretweet\b|\bqt\b)/i;
const SPECIFIC_TWEET_REFERENCE_REGEX =
  /(?:这条|這條|那条|那條|该条|該條|推文|tweet|参考链接|參考鏈接|参考推文|參考推文|围绕|圍繞|看\s*@|lookonchain|targetTweetUrl)/i;
const HOTSPOT_INTENT_REGEX =
  /(?:热点|熱點|借热点|借熱點|蹭热点|蹭熱點|结合热点|結合熱點|参考链接|參考鏈接|参考推文|參考推文|引用|回复|轉發|转发|quote|reply)/i;
const THREAD_INTENT_REGEX = /(?:\bthread\b|线程|線程|串起来|串起來|拆开讲|拆開講|分几条|分幾條|多条|多條)/i;
const INTERACTIVE_QA_REGEX =
  /(?:interactive_qa|互动问答|互動問答|问答|問答|提问|提問|你会|你會|你怎么看|你怎麼看|会选|會選|聊聊|讨论|討論)/i;
const INDUSTRY_TALK_REGEX =
  /(?:industry_talk|行业吐槽|行業吐槽|吐槽|不喜欢那种|不喜歡那種|看不惯|看不慣|受不了|批评|批評)/i;
const PITFALL_LOG_REGEX = /(?:pitfall_log|踩坑|失败|失敗|教训|教訓|复盘|復盤|亏过|虧過|犯错|犯錯)/i;
const TOOL_MENTION_REGEX = /(?:tool_mention|工具提及|工具|产品|產品|CryptoPathX)/i;
const CASUAL_NOTE_REGEX = /(?:casual_note|碎碎念|随口一说|隨口一說|朋友圈|手记|手記)/i;
const SMALL_INSIGHT_REGEX =
  /(?:small_insight|小感悟|小观察|小觀察|情景分析|場景分析|双情景|雙情景|判断|判斷|观察|觀察|逻辑|邏輯|观点|觀點)/i;

const ENGLISH_STOP_WORDS = new Set([
  "about",
  "again",
  "above",
  "after",
  "agent",
  "against",
  "along",
  "also",
  "around",
  "back",
  "been",
  "being",
  "below",
  "between",
  "blockbeats",
  "cointelegraph",
  "crypto",
  "decrypt",
  "flash",
  "from",
  "have",
  "into",
  "just",
  "market",
  "news",
  "only",
  "over",
  "report",
  "said",
  "says",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "tweet",
  "under",
  "wallet",
  "what",
  "when",
  "with",
  "would"
]);

export function buildCandidateTweetTargets(
  task: Pick<XTask, "title" | "brief" | "goal"> & {
    mainAgentPlan?: { targetTweetUrl?: string | null } | null;
  },
  hotspotCandidates: XHotspot[]
): CandidateTweetTarget[] {
  const targets = new Map<string, CandidateTweetTarget>();

  const pushTarget = (url: string | null | undefined, source: string, hotspotId?: number | null) => {
    const normalizedUrl = normalizeTargetTweetUrl(url);
    if (!normalizedUrl || targets.has(normalizedUrl)) {
      return;
    }

    targets.set(normalizedUrl, {
      url: normalizedUrl,
      source,
      hotspotId: hotspotId ?? null
    });
  };

  for (const value of [task.title, task.brief, task.goal, task.mainAgentPlan?.targetTweetUrl ?? ""]) {
    for (const url of extractTweetUrls(value)) {
      pushTarget(url, "task_text");
    }
  }

  for (const hotspot of hotspotCandidates) {
    pushTarget(hotspot.canonicalUrl, `hotspot:${hotspot.id}`, hotspot.id);
  }

  return [...targets.values()];
}

export function extractTweetUrls(value: string | null | undefined) {
  return String(value ?? "").match(TWEET_URL_REGEX) ?? [];
}

export function normalizeTargetTweetUrl(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  return /^https?:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(trimmed) ? trimmed : null;
}

export function sortPlanningHotspots(hotspots: XHotspot[]) {
  const priorityOrder: Record<XHotspot["priority"], number> = {
    P0: 4,
    P1: 3,
    P2: 2,
    DROP: 1
  };

  return [...hotspots].sort((left, right) => {
    if (priorityOrder[left.priority] !== priorityOrder[right.priority]) {
      return priorityOrder[right.priority] - priorityOrder[left.priority];
    }

    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return right.lastSeenAt.localeCompare(left.lastSeenAt);
  });
}

export function rankHotspotsForTask(task: Pick<XTask, "title" | "brief" | "goal">, hotspots: XHotspot[]): RankedTaskHotspot[] {
  const fallbackOrdered = sortPlanningHotspots(hotspots);
  const fallbackIndexMap = new Map(fallbackOrdered.map((item, index) => [item.id, index]));

  return hotspots
    .map((hotspot) => ({
      hotspot,
      planningScore: scoreHotspotForTask(task, hotspot)
    }))
    .sort((left, right) => {
      if (right.planningScore !== left.planningScore) {
        return right.planningScore - left.planningScore;
      }

      return (fallbackIndexMap.get(left.hotspot.id) ?? Number.MAX_SAFE_INTEGER) - (fallbackIndexMap.get(right.hotspot.id) ?? Number.MAX_SAFE_INTEGER);
    });
}

export function deriveTaskPlanningHints(input: {
  task: Pick<XTask, "title" | "brief" | "goal" | "preferredMode">;
  candidateTweetTargets: CandidateTweetTarget[];
  hotspotCandidates: XHotspot[];
}): TaskPlanningHints {
  const rawTaskText = buildTaskPlanningText(input.task);
  const normalizedTaskText = normalizePlanningText(rawTaskText);
  const explicitTaskTweetUrls = extractTweetUrls(rawTaskText)
    .map((item) => normalizeTargetTweetUrl(item))
    .filter((item): item is string => Boolean(item));
  const rankedHotspots = rankHotspotsForTask(input.task, input.hotspotCandidates);
  const topRankedHotspot = rankedHotspots[0] ?? null;
  const explicitTaskTargetTweetUrl =
    explicitTaskTweetUrls[0] ?? input.candidateTweetTargets.find((item) => item.source === "task_text")?.url ?? null;
  const fallbackActionTargetTweetUrl =
    explicitTaskTargetTweetUrl ?? (input.candidateTweetTargets.length === 1 ? input.candidateTweetTargets[0]?.url ?? null : null);

  let actionHint: TaskPlanningActionHint | null = null;
  if (fallbackActionTargetTweetUrl && REPLY_INTENT_REGEX.test(rawTaskText)) {
    actionHint = {
      value: "reply",
      confidence: "hard",
      reason: "The task explicitly asks for a reply to a specific tweet.",
      targetTweetUrl: fallbackActionTargetTweetUrl
    };
  } else if (fallbackActionTargetTweetUrl && QUOTE_INTENT_REGEX.test(rawTaskText)) {
    actionHint = {
      value: "quote",
      confidence: "hard",
      reason: "The task explicitly asks for a quote-style response around a specific tweet.",
      targetTweetUrl: fallbackActionTargetTweetUrl
    };
  } else if (explicitTaskTargetTweetUrl && SPECIFIC_TWEET_REFERENCE_REGEX.test(rawTaskText)) {
    actionHint = {
      value: "quote",
      confidence: "medium",
      reason: "The task centers on a specific external tweet and is better framed as a quote than a standalone post.",
      targetTweetUrl: explicitTaskTargetTweetUrl
    };
  }

  const contentStyleHint = deriveContentStyleHint(rawTaskText, normalizedTaskText, actionHint);
  const preferredModeHint = derivePreferredModeHint(rawTaskText, input.task.preferredMode);
  const hotspotHint = deriveHotspotHint(rawTaskText, explicitTaskTweetUrls, topRankedHotspot);

  return {
    actionHint,
    contentStyleHint,
    preferredModeHint,
    hotspotHint
  };
}

export function isConfidenceAtLeast(value: PlanningHintConfidence | null | undefined, baseline: PlanningHintConfidence) {
  const order: Record<PlanningHintConfidence, number> = {
    soft: 1,
    medium: 2,
    hard: 3
  };

  return (value ? order[value] : 0) >= order[baseline];
}

function scoreHotspotForTask(task: Pick<XTask, "title" | "brief" | "goal">, hotspot: XHotspot) {
  const rawTaskText = buildTaskPlanningText(task);
  const normalizedTaskText = normalizePlanningText(rawTaskText);
  const taskTweetUrls = new Set(
    extractTweetUrls(rawTaskText)
      .map((item) => normalizeTargetTweetUrl(item))
      .filter((item): item is string => Boolean(item))
  );
  const hotspotTweetUrl = normalizeTargetTweetUrl(hotspot.canonicalUrl);
  let score = 0;

  if (hotspotTweetUrl && taskTweetUrls.has(hotspotTweetUrl)) {
    score += 200;
  }

  for (const handle of collectHotspotHandles(hotspot)) {
    if (containsSemanticToken(normalizedTaskText, handle) || containsSemanticToken(normalizedTaskText, `@${handle}`)) {
      score += 40;
      break;
    }
  }

  score += countMatches(normalizedTaskText, hotspot.symbols, 35, 3);
  score += countMatches(normalizedTaskText, hotspot.matchedWatchlistValues, 26, 3);
  score += countMatches(normalizedTaskText, hotspot.keywords, 18, 4);
  score += countMatches(normalizedTaskText, collectMeaningfulHotspotTextTokens(hotspot), 10, 4);

  if (hotspot.sourceType === "watchlist" && taskTweetUrls.size > 0 && hotspotTweetUrl) {
    score += 8;
  }

  return score;
}

function deriveContentStyleHint(
  rawTaskText: string,
  normalizedTaskText: string,
  actionHint: TaskPlanningActionHint | null
): TaskPlanningStyleHint | null {
  if (INTERACTIVE_QA_REGEX.test(rawTaskText)) {
    return {
      value: "interactive_qa",
      confidence: "hard",
      reason: "The task explicitly asks for an interaction-first Q&A format."
    };
  }

  if (INDUSTRY_TALK_REGEX.test(rawTaskText)) {
    return {
      value: "industry_talk",
      confidence: "hard",
      reason: "The task explicitly asks for an industry take or critique."
    };
  }

  if (PITFALL_LOG_REGEX.test(rawTaskText)) {
    return {
      value: "pitfall_log",
      confidence: "hard",
      reason: "The task explicitly asks for a pitfall, lesson, or mistake log."
    };
  }

  if (TOOL_MENTION_REGEX.test(rawTaskText)) {
    return {
      value: "tool_mention",
      confidence: "hard",
      reason: "The task explicitly asks for a natural tool mention."
    };
  }

  if (CASUAL_NOTE_REGEX.test(rawTaskText)) {
    return {
      value: "casual_note",
      confidence: "hard",
      reason: "The task explicitly asks for a casual朋友圈-style note."
    };
  }

  if (actionHint?.value === "reply") {
    return {
      value: "casual_note",
      confidence: "medium",
      reason: "Reply tasks should default to a casual native tone instead of a formal post."
    };
  }

  if (QUOTE_INTENT_REGEX.test(rawTaskText) || actionHint?.value === "quote") {
    return {
      value: "quote_repost",
      confidence: "medium",
      reason: "Quote-driven tasks should default to a quote-repost writing style."
    };
  }

  if (SMALL_INSIGHT_REGEX.test(rawTaskText) || /\bthread\b/i.test(normalizedTaskText)) {
    return {
      value: "small_insight",
      confidence: "medium",
      reason: "The task is framed as an observation, scenario analysis, or compact insight."
    };
  }

  return null;
}

function derivePreferredModeHint(rawTaskText: string, preferredMode: XTask["preferredMode"]): TaskPlanningModeHint {
  if (preferredMode === "thread") {
    return {
      value: "thread",
      confidence: "hard",
      reason: "The task explicitly prefers thread mode."
    };
  }

  if (preferredMode === "single") {
    return {
      value: "single",
      confidence: "hard",
      reason: "The task explicitly prefers single-post mode."
    };
  }

  if (THREAD_INTENT_REGEX.test(rawTaskText)) {
    return {
      value: "thread",
      confidence: "medium",
      reason: "The task language asks for multi-post expansion."
    };
  }

  return {
    value: "single",
    confidence: "soft",
    reason: "Default to single-post mode unless the task explicitly asks for a thread."
  };
}

function deriveHotspotHint(rawTaskText: string, explicitTaskTweetUrls: string[], topRankedHotspot: RankedTaskHotspot | null): TaskPlanningHotspotHint {
  if (!topRankedHotspot) {
    return {
      shouldUseHotspot: false,
      confidence: null,
      reason: "",
      selectedHotspotIds: [],
      topPlanningScore: 0
    };
  }

  const topHotspotUrl = normalizeTargetTweetUrl(topRankedHotspot.hotspot.canonicalUrl);
  if (topHotspotUrl && explicitTaskTweetUrls.includes(topHotspotUrl)) {
    return {
      shouldUseHotspot: true,
      confidence: "hard",
      reason: "The task directly references a hotspot source that already exists in the hotspot pool.",
      selectedHotspotIds: [topRankedHotspot.hotspot.id],
      topPlanningScore: topRankedHotspot.planningScore
    };
  }

  if (HOTSPOT_INTENT_REGEX.test(rawTaskText) && topRankedHotspot.planningScore >= 60) {
    return {
      shouldUseHotspot: true,
      confidence: "medium",
      reason: "The task explicitly asks to use a hotspot and this candidate is strongly relevant.",
      selectedHotspotIds: [topRankedHotspot.hotspot.id],
      topPlanningScore: topRankedHotspot.planningScore
    };
  }

  return {
    shouldUseHotspot: false,
    confidence: topRankedHotspot.planningScore >= 60 ? "soft" : null,
    reason: "",
    selectedHotspotIds: [],
    topPlanningScore: topRankedHotspot.planningScore
  };
}

function buildTaskPlanningText(task: Pick<XTask, "title" | "brief" | "goal">) {
  return [task.title, task.brief, task.goal].filter(Boolean).join("\n");
}

function normalizePlanningText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function collectHotspotHandles(hotspot: XHotspot) {
  const handles = new Set<string>();
  const urlHandle = hotspot.canonicalUrl?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i)?.[1];
  if (urlHandle) {
    handles.add(urlHandle.toLowerCase());
  }

  for (const item of hotspot.matchedWatchlistValues) {
    const handle = item.trim().replace(/^@+/, "");
    if (/^[A-Za-z0-9_]{2,20}$/.test(handle)) {
      handles.add(handle.toLowerCase());
    }
  }

  return [...handles];
}

function collectMeaningfulHotspotTextTokens(hotspot: XHotspot) {
  const tokens = new Set<string>();
  const text = [hotspot.title, hotspot.summaryText, hotspot.researchSummaryText ?? ""].join(" ");
  const englishTokens = text.match(/[A-Za-z][A-Za-z0-9_$./-]{2,24}/g) ?? [];

  for (const rawToken of englishTokens) {
    const normalized = rawToken.toLowerCase();
    if (ENGLISH_STOP_WORDS.has(normalized) || normalized.startsWith("http")) {
      continue;
    }

    tokens.add(normalized);
  }

  return [...tokens];
}

function countMatches(text: string, rawTokens: string[], weight: number, maxMatches: number) {
  let matches = 0;
  for (const rawToken of rawTokens) {
    if (matches >= maxMatches) {
      break;
    }

    if (containsSemanticToken(text, rawToken)) {
      matches += 1;
    }
  }

  return matches * weight;
}

function containsSemanticToken(text: string, rawToken: string | null | undefined) {
  const normalizedToken = normalizeSemanticToken(rawToken);
  if (!normalizedToken) {
    return false;
  }

  return text.includes(normalizedToken);
}

function normalizeSemanticToken(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withoutPrefix = trimmed.replace(/^[@#$]+/, "");
  if (withoutPrefix.length < 2) {
    return null;
  }

  return withoutPrefix;
}
