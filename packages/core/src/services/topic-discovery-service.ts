import type { PromptSnapshotMap, TopicPriority, TopicValidityStatus } from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";
import { TopicRepository } from "../repositories/topic-repository.js";
import { normalizeZhihuQuestionUrl } from "../utils/zhihu-url.js";
import { type AccountPromptContext, buildTopicPromptSuffix } from "./account-prompt-context.js";
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
  validity_status: TopicValidityStatus;
  validity_reason: string;
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
    accountContext?: AccountPromptContext | null;
  }) {
    await this.topicRepository.reconcileAcceptedCandidateStatuses();
    await this.topicRepository.markAnsweredHistoryCandidates(input.accountId);
    const activeCandidates = await this.topicRepository.countActiveCandidates(input.accountId);
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
        url: `${getAppConfig().zhihuBaseUrl}/`,
        fallbackUrls: [`${getAppConfig().zhihuBaseUrl}/notifications`],
        promptSnapshot: input.promptSnapshot,
        expectedZhihuUserName: input.accountContext?.zhihuUserName ?? null,
        accountName: input.accountContext?.accountName ?? null
      });

      let remaining = TOPIC_BATCH_SIZE;
      const pastTopicFingerprints = await this.topicRepository.getRecentPublishedTopicFingerprints(10, input.accountId);
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
        input.accountId,
        discoveredCandidateIds,
        remaining,
        input.promptSnapshot,
        pastTopicFingerprints,
        input.accountContext
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
          input.accountId,
          discoveredCandidateIds,
          remaining,
          input.promptSnapshot,
          pastTopicFingerprints,
          input.accountContext
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
          input.accountId,
          discoveredCandidateIds,
          remaining,
          input.promptSnapshot,
          pastTopicFingerprints,
          input.accountContext
        );
      }

      return this.topicRepository.countActiveCandidates(input.accountId);
    } finally {
      await this.browserSkillService.closeSession(sessionKey);
    }
  }

  private async captureQuestionLinks(
    links: Array<{ text: string; href: string }>,
    sourceType: string,
    sourceMetadata: Record<string, unknown>,
    accountId: number,
    discoveredCandidateIds: Set<number>,
    remaining: number,
    promptSnapshot: PromptSnapshotMap | null | undefined,
    pastTopicFingerprints: unknown[],
    accountContext?: AccountPromptContext | null
  ) {
    const pending: DiscoveryCandidate[] = [];

    for (const link of links.slice(0, DISCOVERY_LINK_LIMIT)) {
      const questionUrl = normalizeQuestionUrl(link.href);
      if (!questionUrl) {
        continue;
      }

      const candidate = await this.topicRepository.createOrGetCandidate({
        accountId,
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

      const answeredTopic = await this.topicRepository.findAnsweredTopicByQuestionUrl(questionUrl);
      if (answeredTopic) {
        if (candidate.status !== "published") {
          await this.topicRepository.markCandidateDuplicate(candidate.id, answeredTopic.duplicateReason);
        }
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

    const batchPrefilterResults = await this.runTopicPrefilterBatch(
      pending,
      promptSnapshot,
      pastTopicFingerprints,
      accountContext
    );
    let added = 0;

    for (const candidate of pending) {
      const topicCard =
        batchPrefilterResults.get(candidate.candidateId) ??
        this.buildFallbackTopicCard(candidate, "topic_agent 批量预筛缺少结果，已走兜底。");

      await this.topicRepository.markCandidateValidity(
        candidate.candidateId,
        topicCard.validity_status,
        topicCard.validity_reason || null
      );

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

      if (topicCard.validity_status !== "valid") {
        await this.topicRepository.markCandidateBlocked(
          candidate.candidateId,
          topicCard.validity_reason || "topic_agent 预筛判定为无效，不进入当前批次。"
        );
        continue;
      }

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
    pastTopicFingerprints: unknown[],
    accountContext?: AccountPromptContext | null
  ) {
    const basePrompt = await this.llmService.resolvePrompt("topic_agent", {
      promptSnapshot,
      promptSuffix: buildTopicPromptSuffix(accountContext)
    });
    const batchPrompt = `${basePrompt}

补充说明：
1. 你现在执行的是 Topic Agent 的“批量标题预筛模式”，不是单题最终定稿模式。
2. 你只根据标题、URL、来源类型和 sourceContext 做预筛，不要假装看过详情页。
3. 这一轮需要你直接判断每个候选题对当前业务和当前账号来说是否有效。
4. validity_status 只能输出 "valid" 或 "invalid"。只有你明确认为该题应该进入后续选题流程时，才能输出 valid。
5. validity_reason 必须具体说明原因，不能只写“相关”或“不相关”。
6. priority 只对 validity_status = "valid" 的题目有实际意义；如果你认为该题无效，priority 统一输出 SKIP。
7. 如果信息不足，但标题并不明显无效，你也可以保守输出 valid，并给较低 fit_score 与 P2。
8. recommended_answer、invite_answer、keyword_search 都只是信号，不是硬规则。
9. 选题覆盖要兼顾三类：币圈、交易、量化。默认倾向是币圈 ≈ 交易 > 量化，但不要拉开太大。
10. 币圈类和交易类标题，只要能自然承接到市场判断、风险管理、策略验证、历史相似走势、交易复盘，就不要因为不够“量化”而轻易打低。
11. 纯量化题不再天然优先，只有当用户痛点更清晰、产品承接更自然时，才给更高 priority 或 fit_score。
12. 你必须为每个 candidate_id 输出且只输出一次结果。
13. 只输出 JSON，不要解释，不要 Markdown。

输出格式：
{
  "results": [
    {
      "candidate_id": 101,
      "validity_status": "valid | invalid",
      "validity_reason": "为什么有效或无效",
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

    const normalizedValidityStatus = normalizeValidityStatus(output.validity_status, fallback.validity_status);
    const normalizedValidityReason = normalizeString(output.validity_reason, fallback.validity_reason);
    const normalizedPriority =
      normalizedValidityStatus === "invalid"
        ? "SKIP"
        : normalizePriority(output.priority, fallback.priority);
    const normalizedFitScore =
      normalizedValidityStatus === "invalid"
        ? 0
        : normalizeFitScore(output.fit_score, fallback.fit_score);

    return {
      validity_status: normalizedValidityStatus,
      validity_reason: normalizedValidityReason,
      title: normalizeString(output.title, candidate.questionTitle),
      summary: normalizeString(output.summary, candidate.questionTitle),
      priority: normalizedPriority,
      fit_score: normalizedFitScore,
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

    return {
      validity_status: "invalid",
      validity_reason: fallbackReason ?? "topic_agent 预筛未正常返回，当前候选题已按保守策略拦截。",
      title: candidate.questionTitle,
      summary: candidate.questionTitle,
      priority: "SKIP",
      fit_score: 0,
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
      reason: "基础字段校验通过，进入 topic_agent 预筛判断。"
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

function normalizeValidityStatus(value: unknown, fallback: TopicValidityStatus): TopicValidityStatus {
  return value === "valid" || value === "invalid" || value === "unchecked" ? value : fallback;
}

function mergeUniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
