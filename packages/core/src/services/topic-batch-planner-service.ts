import type { PromptSnapshotMap, TopicBatchPlan, TopicBatchPlanItem, TopicPriority } from "@zhihu-mvp/shared";
import { TopicRepository } from "../repositories/topic-repository.js";
import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { safeParseJson } from "../utils/json.js";
import {
  type AccountPromptContext,
  buildTopicPromptSuffix,
  buildTopicSoulPromptSuffix,
  buildTopicTargetProductPromptSuffix,
  joinPromptSuffixes
} from "./account-prompt-context.js";
import { LlmService } from "./llm-service.js";
import { ZhihuAgentContextService } from "./zhihu-agent-context-service.js";

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
  private readonly agentContextService = new ZhihuAgentContextService();

  constructor(
    private readonly llmService: LlmService,
    private readonly topicRepository: TopicRepository
  ) {}

  async getCurrentBatchPlan(
    promptSnapshot?: PromptSnapshotMap | null,
    options?: {
      accountId?: number | null;
      accountContext?: AccountPromptContext | null;
      accountSoulMarkdown?: string | null;
    }
  ): Promise<TopicBatchPlan> {
    const candidatePool = await this.topicRepository.listOpenCandidates(10, options?.accountId);
    return this.buildPlan(candidatePool, promptSnapshot, options?.accountContext, options?.accountSoulMarkdown);
  }

  async rankCandidatePool(
    candidatePool: CandidatePoolItem[],
    promptSnapshot?: PromptSnapshotMap | null,
    accountContext?: AccountPromptContext | null,
    accountSoulMarkdown?: string | null
  ): Promise<Array<CandidatePoolItem & { batchPlan: TopicBatchPlanItem }>> {
    const plan = await this.buildPlan(candidatePool, promptSnapshot, accountContext, accountSoulMarkdown);
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
    accountContext?: AccountPromptContext | null,
    accountSoulMarkdown?: string | null
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
      const agentContextDocuments = await this.agentContextService.ensureDocuments();
      const topicPrompt = await this.llmService.resolvePrompt("topic_agent", {
        promptSnapshot,
        promptSuffix: joinPromptSuffixes(
          buildTopicPromptSuffix(accountContext),
          buildTopicSoulPromptSuffix(accountSoulMarkdown),
          buildTopicTargetProductPromptSuffix(agentContextDocuments)
        )
      });

      rawResult = await this.llmService.runJsonWithSystemPrompt<TopicBatchSelectorOutput>(
        `${topicPrompt}

补充说明：
你现在执行的是 Topic Agent 的“批次排序任务”。

任务目标：
1. 对当前这一批已经通过预筛的候选题排序。
2. 选出现在最值得先处理的 1 个题。

排序时请综合判断：
1. 题目和 product.md / target.md / Account Soul 的综合贴合度，优先看是否服务币圈交易者。
2. 用户痛点是否清晰，是否能自然写出币圈交易、合约杠杆、交易心态、形态判断、形态教学、AI 辅助交易判断、风控复盘或踩坑经验。
3. 流量潜力是否足够：标题是否大众、痛点是否强、讨论空间是否大、长期搜索需求是否稳定、是否像真实用户会点的问题。
4. 是否容易写出真实经验感，而不是泛泛的量化工作流概念。
5. 是否适合自然承接 CryptoPathX。
6. source_type 和 discovered_sources 带来的来源强弱。
7. priority 和 fit_score，但它们只是候选题元数据，不是最终排序的唯一依据。
8. 当前批次的内容类型是否过度集中；Topic Agent 需要把题池从纯量化工作流拉回币圈与交易经验，不要让量化工程题占优。

额外规则：
1. invite_answer 通常比 recommended_answer 更强，keyword_search 稍弱，但都不是硬规则。
2. 如果某题来源强但很空、很泛、很难落地，不要排太前。
3. 如果某题来源一般但痛点更清晰、产品承接更自然，可以排到前面。
4. 纯量化工作流题不要进入优先排序。题目如果主要讨论策略上线、深度优化、参数调优、研发流程或团队效率，而不是币圈交易者真实痛点，应排到末位或给出不优先理由。
5. 在质量接近时，优先高流量题，不要为了产品承接选择冷门小题。高流量信号包括：新手常问、强情绪、高争议、亏损痛点、合约/山寨币/AI/技术形态等大众关注点。
6. 币圈原生题优先；合约、杠杆、行情结构、K 线形态、形态识别教学、AI 辅助交易判断、交易心态、风控和复盘类题，通常应排在纯量化流程题前面。
7. 形态识别/技术形态教学题可排在前列并可软广，因为 CryptoPathX 有 Pattern Analysis 能力；reason 应说明承接点是形态识别、误判边界、历史验证或量价结构教育。
8. AI 和交易联动题可排在前列并可软广，因为 CryptoPathX 有 AI Strategy Assistant 能力；reason 应说明承接点是 AI 解释指标、生成策略条件、解读回测结果或发现风险点，不要写成 AI 预测行情。
9. 泛交易心态题可以排在中前段作为纯分享题，例如外汇交易者亏损、韭菜路径、人性纪律等；这类题不要因为不能软广就被排除，但 reason 里要注明“更适合作为经验分享，不强制产品植入”。
10. 排序时考虑账号内容节奏：不要让候选池长期变成每篇都软广。大约 10 条里 7 条带软广、3 条纯分享即可。
11. 当一个题更适合做人设信任、交易心态、踩坑经验、币圈常识或观点判断时，可以排到前面，即使它不适合软广；reason 里说明这是留白内容。
12. 也不要为了平衡而强行把明显不合适的币圈题排到前面，一切仍以真实可写性、账号 Soul、内容节奏、流量潜力和产品承接为主。
13. 只输出当前 candidates 里的排序，不要虚构新题。
14. selected_candidate_id 必须来自 ranking 第一名。
15. 只输出 JSON，不要解释，不要 Markdown。

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
