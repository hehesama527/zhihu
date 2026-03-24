import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import { LlmService } from "./llm-service.js";

export type TopicReviewScoreBreakdown = {
  problem_core_delta: number;
  answer_angle_delta: number;
  target_pain_delta: number;
  promo_entry_delta: number;
  added_value_delta: number;
};

export type TopicReviewResult = {
  score: number;
  passing_score: number;
  score_breakdown: TopicReviewScoreBreakdown;
  is_duplicate: boolean;
  duplicate_reason: string;
  matched_past_topics: string[];
  prune_candidate_ids: number[];
  next_action: "RESELECT_TOPIC" | "CONTINUE";
};

export class TopicReviewService {
  constructor(private readonly llmService: LlmService) {}

  async reviewDuplication(
    input: {
      candidateId: number;
      candidateTitle: string;
      candidateSummary: string;
      candidatePool: Array<{ id: number; title: string }>;
      pastTopicFingerprints: unknown[];
    },
    promptSnapshot?: PromptSnapshotMap | null
  ) {
    const fallback: TopicReviewResult = {
      score: 25,
      passing_score: 20,
      score_breakdown: {
        problem_core_delta: 5,
        answer_angle_delta: 5,
        target_pain_delta: 5,
        promo_entry_delta: 5,
        added_value_delta: 5
      },
      is_duplicate: false,
      duplicate_reason: "",
      matched_past_topics: [],
      prune_candidate_ids: [],
      next_action: "CONTINUE"
    };

    if (!Array.isArray(input.pastTopicFingerprints) || input.pastTopicFingerprints.length === 0) {
      return fallback;
    }

    const topicPrompt = await this.llmService.resolvePrompt("topic_agent", {
      promptSnapshot
    });

    const rawResult = await this.llmService.runJsonWithSystemPrompt<TopicReviewResult>(
      `${topicPrompt}

补充说明：
你现在执行的是 Topic Agent 的“选题重复性审核任务”。

任务目标：
判断当前题和最近 10 篇已发布题目是否过于接近，但标准不要过严。

必须使用 25 分制打分。分数越高，说明越值得保留、重复性越低。

评分维度，每项 0-5 分：
1. 问题本质差异度
2. 回答角度差异度
3. 目标用户痛点差异度
4. 产品切入方式差异度
5. 新增信息价值差异度

规则：
1. 总分 >= 20：允许继续，不要因为关键词像就直接拦截。
2. 总分 < 20：视为重复，直接换题。
3. 不允许给 REVISE_TOPIC。
4. 只有候选池里那些明显也会低于 20 分的同类题，才放进 prune_candidate_ids。
5. 只输出 JSON，不要解释，不要 Markdown。

输出格式：
{
  "score": 18,
  "passing_score": 20,
  "score_breakdown": {
    "problem_core_delta": 3,
    "answer_angle_delta": 4,
    "target_pain_delta": 4,
    "promo_entry_delta": 3,
    "added_value_delta": 4
  },
  "is_duplicate": true,
  "duplicate_reason": "总分低于 20，和历史题目切入过近",
  "matched_past_topics": ["命中的历史题目"],
  "prune_candidate_ids": [12, 13],
  "next_action": "RESELECT_TOPIC"
}`,
      input,
      fallback
    );

    const score = normalizeScore(rawResult.score, 25);
    const passingScore = normalizeScore(rawResult.passing_score, 20);
    const scoreBreakdown = normalizeScoreBreakdown(rawResult.score_breakdown);
    const matchedPastTopics = Array.isArray(rawResult.matched_past_topics)
      ? rawResult.matched_past_topics.map((item) => String(item)).filter(Boolean)
      : [];
    const pruneCandidateIds = Array.isArray(rawResult.prune_candidate_ids)
      ? [...new Set(rawResult.prune_candidate_ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))]
      : [];

    const shouldReselect =
      rawResult.is_duplicate === true || rawResult.next_action === "RESELECT_TOPIC" || score < passingScore;

    return {
      score,
      passing_score: passingScore,
      score_breakdown: scoreBreakdown,
      is_duplicate: shouldReselect,
      duplicate_reason: shouldReselect
        ? rawResult.duplicate_reason?.trim() || `选题重复性评分 ${score}/25，低于通过线 ${passingScore}。`
        : "",
      matched_past_topics: matchedPastTopics,
      prune_candidate_ids: shouldReselect ? pruneCandidateIds : [],
      next_action: shouldReselect ? "RESELECT_TOPIC" : "CONTINUE"
    } satisfies TopicReviewResult;
  }
}

function normalizeScore(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(25, Math.round(numeric)));
}

function normalizeScoreBreakdown(value: unknown): TopicReviewScoreBreakdown {
  if (!value || typeof value !== "object") {
    return {
      problem_core_delta: 5,
      answer_angle_delta: 5,
      target_pain_delta: 5,
      promo_entry_delta: 5,
      added_value_delta: 5
    };
  }

  const record = value as Record<string, unknown>;

  return {
    problem_core_delta: normalizeBreakdownScore(record.problem_core_delta),
    answer_angle_delta: normalizeBreakdownScore(record.answer_angle_delta),
    target_pain_delta: normalizeBreakdownScore(record.target_pain_delta),
    promo_entry_delta: normalizeBreakdownScore(record.promo_entry_delta),
    added_value_delta: normalizeBreakdownScore(record.added_value_delta)
  };
}

function normalizeBreakdownScore(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }

  return Math.max(0, Math.min(5, Math.round(numeric)));
}
