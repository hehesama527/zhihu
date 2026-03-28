import type { PromptSnapshotMap, TopicBatchPlan, TopicBatchPlanItem, TopicPriority } from "@zhihu-mvp/shared";
import { TopicRepository } from "../repositories/topic-repository.js";
import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { safeParseJson } from "../utils/json.js";
import { type AccountPromptContext, buildTopicPromptSuffix } from "./account-prompt-context.js";
import { LlmService } from "./llm-service.js";

type CandidatePoolItem = Awaited<ReturnType<TopicRepository["listOpenCandidates"]>>[number];

type TopicBatchSelectorOutput = {
  summary: string;
  selected_candidate_id: number | null;
  ranking: Array<{
    candidate_id: number;
    rank: number;
    selection_score: number;
    reason: string;
  }>;
};

export class TopicBatchPlannerService {
  constructor(
    private readonly llmService: LlmService,
    private readonly topicRepository: TopicRepository
  ) {}

  async getCurrentBatchPlan(
    promptSnapshot?: PromptSnapshotMap | null,
    options?: {
      accountId?: number | null;
      accountContext?: AccountPromptContext | null;
    }
  ): Promise<TopicBatchPlan> {
    const candidatePool = await this.topicRepository.listOpenCandidates(10, options?.accountId);
    return this.buildPlan(candidatePool, promptSnapshot, options?.accountContext);
  }

  async rankCandidatePool(
    candidatePool: CandidatePoolItem[],
    promptSnapshot?: PromptSnapshotMap | null,
    accountContext?: AccountPromptContext | null
  ): Promise<Array<CandidatePoolItem & { batchPlan: TopicBatchPlanItem }>> {
    const plan = await this.buildPlan(candidatePool, promptSnapshot, accountContext);
    const candidateMap = new Map(candidatePool.map((candidate) => [candidate.id, candidate]));

    return plan.ranking
      .map((item) => {
        const candidate = candidateMap.get(item.candidateId);
        if (!candidate) {
          return null;
        }

        return {
          ...candidate,
          batchPlan: item
        };
      })
      .filter((item): item is CandidatePoolItem & { batchPlan: TopicBatchPlanItem } => item !== null);
  }

  private async buildPlan(
    candidatePool: CandidatePoolItem[],
    promptSnapshot?: PromptSnapshotMap | null,
    accountContext?: AccountPromptContext | null
  ): Promise<TopicBatchPlan> {
    const startedAt = Date.now();
    if (candidatePool.length === 0) {
      logDebugTiming("topicBatchPlanner.buildPlan", "empty_pool", {
        accountId: accountContext?.accountId ?? null
      });
      return {
        batchSize: 0,
        availableCount: 0,
        selectedCandidateId: null,
        selectedTitle: null,
        summary: "当前批次没有可排序的候选题。",
        ranking: []
      };
    }

    const fallback = buildFallbackSelectorOutput(candidatePool);
    let rawResult = fallback;

    try {
      logDebugTiming("topicBatchPlanner.buildPlan", "start", {
        accountId: accountContext?.accountId ?? null,
        candidatePoolSize: candidatePool.length
      });
      const topicPrompt = await this.llmService.resolvePrompt("topic_agent", {
        promptSnapshot,
        promptSuffix: buildTopicPromptSuffix(accountContext)
      });

      rawResult = await this.llmService.runJsonWithSystemPrompt<TopicBatchSelectorOutput>(
        `${topicPrompt}

补充说明：
你现在执行的是 Topic Agent 的“批次排序任务”。

任务目标：
1. 对当前这一批已经通过预筛的候选题排序。
2. 选出现在最值得先处理的 1 个题。

排序时请综合判断：
1. 题目和产品逻辑的贴合度。
2. 用户痛点是否清晰。
3. 是否容易写出真实经验感。
4. 是否适合自然承接 CryptoPathX。
5. source_type 和 discovered_sources 带来的来源强弱。
6. priority 和 fit_score。
7. 当前批次里“币圈、交易、量化”三类题目的平衡。

额外规则：
1. invite_answer 通常比 recommended_answer 更强，keyword_search 稍弱，但都不是硬规则。
2. 如果某题来源强但很空、很泛、很难落地，不要排太前。
3. 如果某题来源一般但痛点更清晰、产品承接更自然，可以排到前面。
4. 不要让纯量化工具题机械霸榜；在价值相近时，可以优先币圈类或交易类题目。
5. 也不要为了平衡而强行把明显不合适的币圈题排到前面，一切仍以真实可写性为主。
6. 只输出当前 candidates 里的排序，不要虚构新题。
7. selected_candidate_id 必须来自 ranking 第一名。
8. 只输出 JSON，不要解释，不要 Markdown。

输出格式：
{
  "summary": "一句话概括这一批题的排序逻辑",
  "selected_candidate_id": 101,
  "ranking": [
    {
      "candidate_id": 101,
      "rank": 1,
      "selection_score": 92,
      "reason": "产品契合度高，用户痛点清晰，适合先写。"
    }
  ]
}`,
        {
          candidates: candidatePool.map((candidate) => {
            const sourceContext = safeParseJson<Record<string, unknown>>(candidate.sourceMetadataText ?? "{}", {});

            return {
              id: candidate.id,
              questionTitle: candidate.questionTitle,
              questionUrl: candidate.questionUrl,
              sourceType: candidate.sourceType,
              priority: candidate.priority,
              fitScore: candidate.fitScore,
              questionType: candidate.questionType,
              personaMode: candidate.personaMode,
              validityStatus: candidate.validityStatus,
              status: candidate.status,
              mustAvoid: candidate.mustAvoid,
              riskNotes: candidate.riskNotes,
              sourceContext: {
                latestSourceType:
                  typeof sourceContext.latestSourceType === "string" ? sourceContext.latestSourceType : candidate.sourceType,
                discoveredSources: Array.isArray(sourceContext.discoveredSources)
                  ? sourceContext.discoveredSources.map((item) => String(item)).filter(Boolean)
                  : [candidate.sourceType],
                titleOnlySelection: true
              }
            };
          })
        },
        fallback
      );
    } catch {
      rawResult = fallback;
      logDebugTiming("topicBatchPlanner.buildPlan", "fallback", {
        accountId: accountContext?.accountId ?? null,
        candidatePoolSize: candidatePool.length,
        elapsedMs: getElapsedMs(startedAt)
      });
    }

    logDebugTiming("topicBatchPlanner.buildPlan", "done", {
      accountId: accountContext?.accountId ?? null,
      candidatePoolSize: candidatePool.length,
      elapsedMs: getElapsedMs(startedAt),
      selectedCandidateId: rawResult.selected_candidate_id ?? null
    });
    return normalizeTopicBatchPlan(candidatePool, rawResult, fallback);
  }
}

function normalizeTopicBatchPlan(
  candidatePool: CandidatePoolItem[],
  rawResult: TopicBatchSelectorOutput,
  fallback: TopicBatchSelectorOutput
): TopicBatchPlan {
  const candidateMap = new Map(candidatePool.map((candidate) => [candidate.id, candidate]));
  const normalizedRanking: TopicBatchPlanItem[] = [];
  const seenCandidateIds = new Set<number>();

  for (const item of Array.isArray(rawResult.ranking) ? rawResult.ranking : []) {
    const candidateId = Number(item?.candidate_id);
    if (!Number.isInteger(candidateId) || seenCandidateIds.has(candidateId)) {
      continue;
    }

    const candidate = candidateMap.get(candidateId);
    if (!candidate) {
      continue;
    }

    seenCandidateIds.add(candidateId);
    normalizedRanking.push(toPlanItem(candidate, normalizedRanking.length + 1, item?.selection_score, item?.reason, false));
  }

  for (const fallbackItem of fallback.ranking) {
    const candidateId = Number(fallbackItem.candidate_id);
    if (!Number.isInteger(candidateId) || seenCandidateIds.has(candidateId)) {
      continue;
    }

    const candidate = candidateMap.get(candidateId);
    if (!candidate) {
      continue;
    }

    seenCandidateIds.add(candidateId);
    normalizedRanking.push(
      toPlanItem(candidate, normalizedRanking.length + 1, fallbackItem.selection_score, fallbackItem.reason, false)
    );
  }

  const preferredSelectedId = Number(rawResult.selected_candidate_id);
  const defaultSelectedCandidateId =
    Number.isInteger(preferredSelectedId) && normalizedRanking.some((item) => item.candidateId === preferredSelectedId)
      ? preferredSelectedId
      : normalizedRanking[0]?.candidateId ?? null;

  const ranking = [...normalizedRanking]
    .sort(comparePlanItems)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      selected: false
    }));

  const finalSelectedCandidateId = ranking[0]?.candidateId ?? defaultSelectedCandidateId;
  for (const item of ranking) {
    item.selected = item.candidateId === finalSelectedCandidateId;
  }

  const selectedTitle = finalSelectedCandidateId ? candidateMap.get(finalSelectedCandidateId)?.questionTitle ?? null : null;
  const summary =
    typeof rawResult.summary === "string" && rawResult.summary.trim()
      ? rawResult.summary.trim()
      : selectedTitle
        ? `当前优先处理《${selectedTitle}》，其余候选题按产品契合度、来源信号和可写性顺延。`
        : "当前批次已完成排序。";

  return {
    batchSize: candidatePool.length,
    availableCount: candidatePool.length,
    selectedCandidateId: finalSelectedCandidateId,
    selectedTitle,
    summary,
    ranking
  };
}

function toPlanItem(
  candidate: CandidatePoolItem,
  rank: number,
  selectionScore: unknown,
  reason: unknown,
  selected: boolean
): TopicBatchPlanItem {
  return {
    candidateId: candidate.id,
    rank,
    selectionScore: normalizeSelectionScore(selectionScore, deriveSelectionScore(candidate, rank)),
    selected,
    reason: typeof reason === "string" && reason.trim() ? reason.trim() : buildFallbackReason(candidate),
    questionTitle: candidate.questionTitle,
    questionUrl: candidate.questionUrl,
    sourceType: candidate.sourceType,
    priority: candidate.priority,
    fitScore: candidate.fitScore,
    questionType: candidate.questionType,
    personaMode: candidate.personaMode
  };
}

function buildFallbackSelectorOutput(candidatePool: CandidatePoolItem[]): TopicBatchSelectorOutput {
  const ordered = [...candidatePool].sort(compareCandidates);

  return {
    summary: "优先看产品契合度和可写性，再参考来源强度与已有优先级。",
    selected_candidate_id: ordered[0]?.id ?? null,
    ranking: ordered.map((candidate, index) => ({
      candidate_id: candidate.id,
      rank: index + 1,
      selection_score: deriveSelectionScore(candidate, index + 1),
      reason: buildFallbackReason(candidate)
    }))
  };
}

function compareCandidates(left: CandidatePoolItem, right: CandidatePoolItem) {
  const priorityDelta = getPriorityWeight(right.priority) - getPriorityWeight(left.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const fitScoreDelta = (right.fitScore ?? 0) - (left.fitScore ?? 0);
  if (fitScoreDelta !== 0) {
    return fitScoreDelta;
  }

  const sourceDelta = getSourceWeight(right.sourceType) - getSourceWeight(left.sourceType);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function getPriorityWeight(priority: TopicPriority | null) {
  switch (priority) {
    case "P0":
      return 3;
    case "P1":
      return 2;
    case "P2":
      return 1;
    default:
      return 0;
  }
}

function getSourceWeight(sourceType: string) {
  switch (sourceType) {
    case "invite_answer":
      return 3;
    case "recommended_answer":
      return 1;
    case "keyword_search":
      return 0;
    default:
      return 0;
  }
}

function deriveSelectionScore(candidate: CandidatePoolItem, rank: number) {
  const priorityWeight = getPriorityWeight(candidate.priority) * 12;
  const fitScore = Math.max(0, Math.min(100, Number(candidate.fitScore ?? 0)));
  const sourceWeight = getSourceWeight(candidate.sourceType) * 4;
  const rankAdjustment = Math.max(0, 10 - rank);

  return Math.max(0, Math.min(100, Math.round(fitScore * 0.65 + priorityWeight + sourceWeight + rankAdjustment)));
}

function normalizeSelectionScore(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function buildFallbackReason(candidate: CandidatePoolItem) {
  const parts = [
    candidate.priority ? `${candidate.priority} 优先级` : null,
    typeof candidate.fitScore === "number" ? `适配分 ${candidate.fitScore}` : null,
    candidate.sourceType === "recommended_answer"
      ? "推荐页来源已降权，仅作参考"
      : candidate.sourceType === "invite_answer"
        ? "邀请回答来源更强"
        : candidate.sourceType === "keyword_search"
          ? "搜索命中较准"
          : null
  ].filter(Boolean);

  return parts.length > 0 ? `${parts.join("；")}。` : "当前候选题可进入本批次排序。";
}

function comparePlanItems(left: TopicBatchPlanItem, right: TopicBatchPlanItem) {
  const runtimeScoreDelta = deriveRuntimePlanScore(right) - deriveRuntimePlanScore(left);
  if (runtimeScoreDelta !== 0) {
    return runtimeScoreDelta;
  }

  const fitScoreDelta = (right.fitScore ?? 0) - (left.fitScore ?? 0);
  if (fitScoreDelta !== 0) {
    return fitScoreDelta;
  }

  return left.rank - right.rank;
}

function deriveRuntimePlanScore(item: TopicBatchPlanItem) {
  return item.selectionScore + getRuntimeSourceAdjustment(item.sourceType);
}

function getRuntimeSourceAdjustment(sourceType: string) {
  switch (sourceType) {
    case "invite_answer":
      return 4;
    case "recommended_answer":
      return -4;
    default:
      return 0;
  }
}
