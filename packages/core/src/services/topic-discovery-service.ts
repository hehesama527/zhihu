import type { PromptSnapshotMap, TopicPriority } from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";
import { TopicRepository } from "../repositories/topic-repository.js";
import { normalizeZhihuQuestionUrl } from "../utils/zhihu-url.js";
import { BrowserSkillService } from "./browser-skill-service.js";
import { LlmService } from "./llm-service.js";
import { SessionService } from "./session-service.js";

const TOPIC_BATCH_SIZE = 10;
const DISCOVERY_LINK_LIMIT = 10;
const TOPIC_PREFILTER_BATCH_TIMEOUT_MS = 60_000;

type DiscoveryCandidate = {
  candidateId: number;
  questionUrl: string;
  questionTitle: string;
  sourceType: string;
  sourceMetadata: Record<string, unknown>;
};

type TopicAgentPrefilterOutput = {
  title: string;
  summary: string;
  priority: TopicPriority;
  fit_score: number;
  question_type: string;
  persona_mode: string;
  target_audience: string[];
  pain_points: string[];
  recommended_angle: string;
  persona_hooks: string[];
  soft_promo_mode: string;
  soft_promo_reason: string;
  must_avoid: string[];
  risk_notes: string[];
  topic_fingerprint: {
    problem_core: string;
    answer_angle: string;
    target_pain: string;
    promo_entry: string;
  };
};

type TopicAgentPrefilterBatchOutput = {
  results: Array<
    {
      candidate_id: number;
    } & Partial<TopicAgentPrefilterOutput>
  >;
};

export class TopicDiscoveryService {
  constructor(
    private readonly topicRepository: TopicRepository,
    private readonly browserSkillService: BrowserSkillService,
    private readonly sessionService: SessionService,
    private readonly llmService: LlmService
  ) {}

  async harvestCandidates(input: {
    accountId: number;
    profileDir: string;
    promptSnapshot?: PromptSnapshotMap | null;
  }) {
    await this.topicRepository.reconcileAcceptedCandidateStatuses();
    const activeCandidates = await this.topicRepository.countActiveCandidates();
    if (activeCandidates > 0) {
      return 0;
    }

    const traceGroupId = `topic-discovery-${Date.now()}`;
    const sessionKey = `topic-discovery-${input.accountId}-${Date.now()}`;
    const traceContext = {
      sessionKey,
      profileDir: input.profileDir,
      stage: "topic_discovery" as const,
      traceGroupId,
      agentName: "topic_discovery" as const
    };

    try {
      await this.sessionService.ensureLoggedIn({
        sessionKey,
        profileDir: input.profileDir,
        traceGroupId,
        stage: "login_checking",
        url: `${getAppConfig().zhihuBaseUrl}/notifications`,
        promptSnapshot: input.promptSnapshot
      });

      let remaining = TOPIC_BATCH_SIZE;
      const pastTopicFingerprints = await this.topicRepository.getRecentPublishedTopicFingerprints(10);
      const discoveredCandidateIds = new Set<number>();

      await this.browserSkillService.open(traceContext, {
        url: `${getAppConfig().zhihuBaseUrl}/`
      });
      await this.browserSkillService.wait(traceContext, { ms: 1_500 });
      const recommendedSnapshot = await this.browserSkillService.snapshot(traceContext);
      remaining -= await this.captureQuestionLinks(
        recommendedSnapshot.questionLinks,
        "recommended_answer",
        { page: "home_recommend", titleOnlySelection: true },
        discoveredCandidateIds,
        remaining,
        input.promptSnapshot,
        pastTopicFingerprints
      );

      if (remaining > 0) {
        await this.browserSkillService.open(traceContext, {
          url: `${getAppConfig().zhihuBaseUrl}/notifications`
        });
        await this.browserSkillService.wait(traceContext, { ms: 1_200 });
        const inviteSnapshot = await this.browserSkillService.snapshot(traceContext);
        remaining -= await this.captureQuestionLinks(
          inviteSnapshot.questionLinks,
          "invite_answer",
          { page: "notifications", titleOnlySelection: true },
          discoveredCandidateIds,
          remaining,
          input.promptSnapshot,
          pastTopicFingerprints
        );
      }

      for (const keyword of getAppConfig().topicKeywords) {
        if (remaining <= 0) {
          break;
        }

        await this.browserSkillService.open(traceContext, {
          url: `${getAppConfig().zhihuBaseUrl}/search?type=content&q=${encodeURIComponent(keyword)}`
        });
        await this.browserSkillService.wait(traceContext, { ms: 1_500 });
        const snapshot = await this.browserSkillService.snapshot(traceContext);
        remaining -= await this.captureQuestionLinks(
          snapshot.questionLinks,
          "keyword_search",
          { keyword, titleOnlySelection: true },
          discoveredCandidateIds,
          remaining,
          input.promptSnapshot,
          pastTopicFingerprints
        );
      }

      return this.topicRepository.countActiveCandidates();
    } finally {
      await this.browserSkillService.closeSession(sessionKey);
    }
  }

  private async captureQuestionLinks(
    links: Array<{ text: string; href: string }>,
    sourceType: string,
    sourceMetadata: Record<string, unknown>,
    discoveredCandidateIds: Set<number>,
    remaining: number,
    promptSnapshot: PromptSnapshotMap | null | undefined,
    pastTopicFingerprints: unknown[]
  ) {
    const pending: DiscoveryCandidate[] = [];

    for (const link of links.slice(0, DISCOVERY_LINK_LIMIT)) {
      const questionUrl = normalizeQuestionUrl(link.href);
      if (!questionUrl) {
        continue;
      }

      const candidate = await this.topicRepository.createOrGetCandidate({
        questionUrl,
        questionTitle: link.text,
        sourceType,
        sourceMetadata
      });

      if (discoveredCandidateIds.has(candidate.id)) {
        continue;
      }

      const validity = this.checkCandidateByTitle(link.text, questionUrl);
      await this.topicRepository.markCandidateValidity(candidate.id, validity.status, validity.reason);
      if (validity.status !== "valid") {
        continue;
      }

      pending.push({
        candidateId: candidate.id,
        questionUrl,
        questionTitle: link.text,
        sourceType,
        sourceMetadata
      });
    }

    if (pending.length === 0) {
      return 0;
    }

    const batchPrefilterResults = await this.runTopicPrefilterBatch(pending, promptSnapshot, pastTopicFingerprints);
    let added = 0;

    for (const candidate of pending) {
      const topicCard =
        batchPrefilterResults.get(candidate.candidateId) ??
        this.buildFallbackTopicCard(candidate, "topic_agent 批量预筛缺少结果，已走兜底。");

      await this.topicRepository.updateCandidateTopicMeta({
        candidateId: candidate.candidateId,
        priority: topicCard.priority,
        fitScore: topicCard.fit_score,
        questionType: topicCard.question_type,
        personaMode: topicCard.persona_mode,
        mustAvoid: topicCard.must_avoid,
        riskNotes: topicCard.risk_notes
      });
      await this.topicRepository.cacheCandidatePrefilter(candidate.candidateId, topicCard);

      if (topicCard.priority === "SKIP") {
        await this.topicRepository.markCandidateBlocked(candidate.candidateId, "LLM 预筛判定为不相关，不进入当前批次。");
        continue;
      }

      if (added >= remaining) {
        await this.topicRepository.markCandidateBlocked(candidate.candidateId, "当前批次已满，本轮不纳入。");
        continue;
      }

      discoveredCandidateIds.add(candidate.candidateId);
      added += 1;
    }

    return added;
  }

  private async runTopicPrefilterBatch(
    candidates: DiscoveryCandidate[],
    promptSnapshot: PromptSnapshotMap | null | undefined,
    pastTopicFingerprints: unknown[]
  ) {
    const basePrompt = await this.llmService.resolvePrompt("topic_agent", {
      promptSnapshot
    });
    const batchPrompt = `${basePrompt}

补充说明：
1. 你现在执行的是 Topic Agent 的“批量标题预筛模式”，不是单题最终定稿模式。
2. 你只根据标题、URL、来源类型和 sourceContext 做预筛，不要假装看过详情页。
3. 这一轮的目标是尽快筛掉明显无关的问题，同时尽量保留和产品逻辑能自然挂上的题。
4. 如果信息不足，但标题并不明显无关，不要轻易输出 SKIP，可以保守给 P2 或较低 fit_score。
5. recommended_answer、invite_answer、keyword_search 都只是信号，不是硬规则。
6. 选题覆盖要兼顾三类：币圈、交易、量化。默认倾向是币圈 ≈ 交易 > 量化，但不要拉开太大。
7. 币圈类和交易类标题，只要能自然承接到市场判断、风险管理、策略验证、历史相似走势、交易复盘，就不要因为不够“量化”而轻易打低。
8. 纯量化题不再天然优先，只有当用户痛点更清晰、产品承接更自然时，才给更高 priority 或 fit_score。
9. 你必须为每个 candidate_id 输出且只输出一次结果。
10. 只输出 JSON，不要解释，不要 Markdown。

输出格式：
{
  "results": [
    {
      "candidate_id": 101,
      "title": "建议使用的回答标题",
      "summary": "100-180字选题摘要",
      "priority": "P0 | P1 | P2 | SKIP",
      "fit_score": 0,
      "question_type": "工具推荐 | 方法验证 | 入门认知 | 行情判断 | 风险管理 | 策略构建 | 纯干货 | 其他",
      "persona_mode": "二牛实测型 | 二牛踩坑型 | 二牛对比型 | 二牛经验型",
      "target_audience": ["目标读者1"],
      "pain_points": ["痛点1"],
      "recommended_angle": "最适合切入的写法",
      "persona_hooks": ["适合强化人设的细节"],
      "soft_promo_mode": "none | light | natural",
      "soft_promo_reason": "为什么适合或不适合自然植入",
      "must_avoid": ["绝对不能写的点"],
      "risk_notes": ["平台风险或理解风险"],
      "topic_fingerprint": {
        "problem_core": "问题本质",
        "answer_angle": "回答角度",
        "target_pain": "目标用户痛点",
        "promo_entry": "软广切入口，没有就写 none"
      }
    }
  ]
}`;

    const fallback: TopicAgentPrefilterBatchOutput = {
      results: candidates.map((candidate) => ({
        candidate_id: candidate.candidateId,
        ...this.buildFallbackTopicCard(candidate, "topic_agent 批量预筛超时或异常，已走兜底。")
      }))
    };

    let response: TopicAgentPrefilterBatchOutput;
    try {
      response = await this.llmService.runJsonWithSystemPrompt<TopicAgentPrefilterBatchOutput>(
        batchPrompt,
        {
          candidates: candidates.map((candidate) => ({
            candidate_id: candidate.candidateId,
            questionUrl: candidate.questionUrl,
            questionTitle: candidate.questionTitle,
            sourceType: candidate.sourceType,
            sourceContext: {
              primarySource: candidate.sourceType,
              latestSourceType: candidate.sourceType,
              discoveredSources: [candidate.sourceType],
              sourceEvents: [
                {
                  sourceType: candidate.sourceType,
                  metadata: candidate.sourceMetadata
                }
              ],
              titleOnlySelection: true
            }
          })),
          pastTopicFingerprints
        },
        fallback,
        TOPIC_PREFILTER_BATCH_TIMEOUT_MS
      );
    } catch {
      response = fallback;
    }

    const results = Array.isArray(response.results) ? response.results : [];
    const byCandidateId = new Map<number, TopicAgentPrefilterOutput>();

    for (const candidate of candidates) {
      const matched = results.find((item) => Number(item?.candidate_id) === candidate.candidateId);
      byCandidateId.set(
        candidate.candidateId,
        this.normalizePrefilterOutput(
          candidate,
          matched,
          matched ? null : "topic_agent 批量预筛未返回该候选题，已走兜底。"
        )
      );
    }

    return byCandidateId;
  }

  private normalizePrefilterOutput(
    candidate: DiscoveryCandidate,
    output: ({ candidate_id?: number } & Partial<TopicAgentPrefilterOutput>) | undefined,
    fallbackReason?: string | null
  ): TopicAgentPrefilterOutput {
    const fallback = this.buildFallbackTopicCard(candidate, fallbackReason);
    if (!output) {
      return fallback;
    }

    return {
      title: normalizeString(output.title, candidate.questionTitle),
      summary: normalizeString(output.summary, candidate.questionTitle),
      priority: normalizePriority(output.priority, fallback.priority),
      fit_score: normalizeFitScore(output.fit_score, fallback.fit_score),
      question_type: normalizeString(output.question_type, fallback.question_type),
      persona_mode: normalizeString(output.persona_mode, fallback.persona_mode),
      target_audience: normalizeStringArray(output.target_audience),
      pain_points: normalizeStringArray(output.pain_points),
      recommended_angle: normalizeString(output.recommended_angle, fallback.recommended_angle),
      persona_hooks: normalizeStringArray(output.persona_hooks),
      soft_promo_mode: normalizeSoftPromoMode(output.soft_promo_mode, fallback.soft_promo_mode),
      soft_promo_reason: normalizeString(output.soft_promo_reason, fallback.soft_promo_reason),
      must_avoid: normalizeStringArray(output.must_avoid),
      risk_notes: mergeUniqueStrings([
        ...normalizeStringArray(output.risk_notes),
        ...((fallbackReason ? [fallbackReason] : []).filter(Boolean) as string[])
      ]),
      topic_fingerprint: {
        problem_core: normalizeString(output.topic_fingerprint?.problem_core, candidate.questionTitle),
        answer_angle: normalizeString(output.topic_fingerprint?.answer_angle, ""),
        target_pain: normalizeString(output.topic_fingerprint?.target_pain, ""),
        promo_entry: normalizeString(output.topic_fingerprint?.promo_entry, "none")
      }
    };
  }

  private buildFallbackTopicCard(candidate: DiscoveryCandidate, fallbackReason?: string | null): TopicAgentPrefilterOutput {
    const normalizedTitle = normalizeSnapshotText(candidate.questionTitle);
    const titleLower = candidate.questionTitle.toLowerCase();
    const broadSignals = [
      "回测",
      "量化",
      "策略",
      "交易",
      "币圈",
      "加密",
      "行情",
      "k线",
      "K线",
      "趋势",
      "震荡",
      "风险",
      "止盈",
      "止损",
      "信号",
      "回撤"
    ];
    const strongSignals = ["回测", "量化", "策略验证", "策略", "回撤"];
    const isBroadlyRelevant =
      broadSignals.some((signal) => candidate.questionTitle.includes(signal)) || titleLower.includes("backtest");
    const isStronglyRelevant =
      strongSignals.some((signal) => candidate.questionTitle.includes(signal)) || titleLower.includes("backtest");

    let priority: TopicPriority = "SKIP";
    let fitScore = 0;
    if (isBroadlyRelevant) {
      priority = isStronglyRelevant ? "P1" : "P2";
      fitScore = isStronglyRelevant ? 70 : 58;
      if (candidate.sourceType === "invite_answer") {
        fitScore += 8;
      } else if (candidate.sourceType === "recommended_answer") {
        fitScore += 3;
      }
    }

    return {
      title: candidate.questionTitle,
      summary: candidate.questionTitle,
      priority,
      fit_score: fitScore,
      question_type: "其他",
      persona_mode: "二牛经验型",
      target_audience: [],
      pain_points: [],
      recommended_angle: "",
      persona_hooks: [],
      soft_promo_mode: "none",
      soft_promo_reason: "",
      must_avoid: [],
      risk_notes: fallbackReason ? [fallbackReason] : [],
      topic_fingerprint: {
        problem_core: normalizedTitle || candidate.questionTitle,
        answer_angle: "",
        target_pain: "",
        promo_entry: "none"
      }
    };
  }

  private checkCandidateByTitle(questionTitle: string, questionUrl: string) {
    const normalizedTitle = normalizeSnapshotText(questionTitle);
    const normalizedUrl = normalizeSnapshotText(questionUrl);

    if (!normalizedUrl) {
      return {
        status: "invalid" as const,
        reason: "候选题缺少有效问题链接。"
      };
    }

    const meaningfulTitle = normalizedTitle.replaceAll("?", "").replaceAll("？", "");
    if (!meaningfulTitle) {
      return {
        status: "invalid" as const,
        reason: "候选题标题为空或无有效文本。"
      };
    }

    return {
      status: "valid" as const,
      reason: "标题预筛通过，本轮选题不打开问题详情页。"
    };
  }
}

function normalizeQuestionUrl(href: string) {
  return normalizeZhihuQuestionUrl(href);
}

function normalizeSnapshotText(value: string) {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, "").trim();
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
}

function normalizePriority(value: unknown, fallback: TopicPriority): TopicPriority {
  return value === "P0" || value === "P1" || value === "P2" || value === "SKIP" ? value : fallback;
}

function normalizeFitScore(value: unknown, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSoftPromoMode(value: unknown, fallback: string) {
  return value === "none" || value === "light" || value === "natural" ? value : fallback;
}

function mergeUniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
