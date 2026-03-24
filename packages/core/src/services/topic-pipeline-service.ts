import type { JobStage, PromptSnapshotMap, TopicPriority } from "@zhihu-mvp/shared";
import { TopicRepository } from "../repositories/topic-repository.js";
import { safeParseJson } from "../utils/json.js";
import { HumanizerService } from "./humanizer-service.js";
import { LlmService } from "./llm-service.js";
import { ReviewService } from "./review-service.js";
import { TopicBatchPlannerService } from "./topic-batch-planner-service.js";
import { TopicReviewService } from "./topic-review-service.js";

type PreparedDraftResult =
  | {
      kind: "ready";
      title: string;
      topicCardId: number;
      reviewId: number;
      approvedContent: string;
      promptVersionSnapshotJson: string;
    }
  | {
      kind: "duplicate";
      reason: string;
    }
  | {
      kind: "blocked";
      reason: string;
    };

type TopicAgentOutput = {
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

export class TopicPipelineService {
  constructor(
    private readonly llmService: LlmService,
    private readonly topicRepository: TopicRepository,
    private readonly topicBatchPlannerService: TopicBatchPlannerService,
    private readonly topicReviewService: TopicReviewService,
    private readonly reviewService: ReviewService,
    private readonly humanizerService: HumanizerService
  ) {}

  async prepareNextPublishableDraft(input?: {
    publishJobId?: number | null;
    promptSnapshot?: PromptSnapshotMap | null;
    onStage?: (stage: JobStage) => Promise<void> | void;
  }) {
    const promptSnapshot = input?.promptSnapshot ?? (await this.llmService.getActivePromptSnapshot());
    const candidatePool = await this.topicRepository.listOpenCandidates(10);
    const rankedCandidatePool = await this.topicBatchPlannerService.rankCandidatePool(candidatePool, promptSnapshot);
    const pastTopicFingerprints = await this.topicRepository.getRecentPublishedTopicFingerprints(10);
    const pastContentFingerprints = await this.topicRepository.getRecentPublishedContentFingerprints(10);

    for (const candidate of rankedCandidatePool) {
      const sourceContext = safeParseJson<Record<string, unknown>>(candidate.sourceMetadataText ?? "{}", {});
      let topicCard = normalizeCachedTopicAgentOutput(sourceContext.prefilterTopicCard, candidate.questionTitle);

      if (!topicCard) {
        await input?.onStage?.("topic_agent");
        topicCard = await this.llmService.runJson<TopicAgentOutput>(
          "topic_agent",
          {
            candidate: {
              ...candidate,
              sourceContext: {
                primarySource: candidate.sourceType,
                latestSourceType:
                  typeof sourceContext.latestSourceType === "string" ? sourceContext.latestSourceType : candidate.sourceType,
                discoveredSources: Array.isArray(sourceContext.discoveredSources)
                  ? sourceContext.discoveredSources.map((item) => String(item)).filter(Boolean)
                  : [candidate.sourceType],
                sourceEvents: Array.isArray(sourceContext.sourceEvents) ? sourceContext.sourceEvents : []
              }
            },
            pastTopicFingerprints
          },
          buildTopicAgentFallback(candidate.questionTitle),
          {
            promptSnapshot
          }
        );
        await this.topicRepository.cacheCandidatePrefilter(candidate.id, topicCard);
      }

      await this.topicRepository.updateCandidateTopicMeta({
        candidateId: candidate.id,
        priority: topicCard.priority,
        fitScore: topicCard.fit_score,
        questionType: topicCard.question_type,
        personaMode: topicCard.persona_mode,
        mustAvoid: topicCard.must_avoid ?? [],
        riskNotes: topicCard.risk_notes ?? []
      });

      if (topicCard.priority === "SKIP") {
        await this.topicRepository.markCandidateBlocked(candidate.id, "选题卡判定为不建议进入写作。");
        continue;
      }

      await this.topicRepository.markCandidateProcessing(candidate.id, JSON.stringify(topicCard.topic_fingerprint ?? {}));

      await input?.onStage?.("topic_review");
      const topicReview = await this.topicReviewService.reviewDuplication(
        {
          candidateId: candidate.id,
          candidateTitle: candidate.questionTitle,
          candidateSummary: topicCard.summary ?? candidate.questionTitle,
          candidatePool: rankedCandidatePool.map((item) => ({ id: item.id, title: item.questionTitle })),
          pastTopicFingerprints
        },
        promptSnapshot
      );

      if (topicReview.is_duplicate || topicReview.next_action === "RESELECT_TOPIC") {
        await this.topicRepository.markCandidateDuplicate(
          candidate.id,
          topicReview.duplicate_reason ||
            `选题重复性评分 ${topicReview.score}/25，低于通过线 ${topicReview.passing_score}。`
        );
        await this.topicRepository.pruneCandidates(topicReview.prune_candidate_ids);
        continue;
      }

      const topicCardId = await this.topicRepository.createTopicCard(
        candidate.id,
        topicCard.summary ?? candidate.questionTitle,
        JSON.stringify(topicCard)
      );

      const preparedDraft = await this.generateReviewedDraft(
        {
          publishJobId: input?.publishJobId ?? null,
          topicCardId,
          candidateTitle: candidate.questionTitle,
          questionUrl: candidate.questionUrl,
          topicCard,
          pastContentFingerprints,
          onStage: input?.onStage
        },
        promptSnapshot
      );

      if (!preparedDraft || preparedDraft.kind === "blocked") {
        await this.topicRepository.markCandidateBlocked(
          candidate.id,
          preparedDraft?.kind === "blocked" ? preparedDraft.reason : "稿件未通过审核。"
        );
        continue;
      }

      if (preparedDraft.kind === "duplicate") {
        await this.topicRepository.markCandidateDuplicate(candidate.id, preparedDraft.reason);
        continue;
      }

      await this.topicRepository.markCandidateAccepted(candidate.id, JSON.stringify(topicCard.topic_fingerprint ?? {}));
      return {
        ...preparedDraft,
        questionUrl: candidate.questionUrl
      };
    }

    return null;
  }

  async rewriteExistingTopic(input: {
    publishJobId?: number | null;
    topicCardId: number;
    candidateTitle: string;
    questionUrl: string;
    revisionFeedback: string;
    promptVersionSnapshotJson: string | null;
    onStage?: (stage: JobStage) => Promise<void> | void;
  }) {
    const topicCardRecord = await this.topicRepository.getTopicCardById(input.topicCardId);
    if (!topicCardRecord) {
      return null;
    }

    const promptSnapshot = safeParseJson<PromptSnapshotMap>(input.promptVersionSnapshotJson ?? "{}", {});
    const pastContentFingerprints = await this.topicRepository.getRecentPublishedContentFingerprints(10);
    const topicCard = safeParseJson<Record<string, unknown>>(topicCardRecord.output_json, {
      summary: topicCardRecord.summary_text
    });

    return this.generateReviewedDraft(
      {
        publishJobId: input.publishJobId ?? null,
        topicCardId: input.topicCardId,
        candidateTitle: input.candidateTitle,
        questionUrl: input.questionUrl,
        topicCard,
        pastContentFingerprints,
        revisionFeedback: input.revisionFeedback,
        onStage: input.onStage
      },
      promptSnapshot
    );
  }

  private async generateReviewedDraft(
    input: {
      publishJobId: number | null;
      topicCardId: number;
      candidateTitle: string;
      questionUrl: string;
      topicCard: Record<string, unknown>;
      pastContentFingerprints: unknown[];
      revisionFeedback?: string;
      onStage?: (stage: JobStage) => Promise<void> | void;
    },
    promptSnapshot: PromptSnapshotMap
  ): Promise<PreparedDraftResult | null> {
    let revisionFeedback = input.revisionFeedback ?? "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await input.onStage?.("writer");
      const writerOutput = await this.llmService.runJson(
        "writer_agent",
        {
          questionTitle: input.candidateTitle,
          questionUrl: input.questionUrl,
          topicCard: input.topicCard,
          revisionFeedback
        },
        {
          title: input.candidateTitle,
          summary: "",
          content: "",
          fingerprint: {
            opening_angle: "",
            core_claims: [],
            case_structure: "",
            closing_style: ""
          }
        },
        {
          promptSnapshot
        }
      );

      await this.topicRepository.createDraft(
        input.topicCardId,
        "raw",
        writerOutput.content ?? "",
        writerOutput.summary ?? "",
        JSON.stringify(writerOutput)
      );

      await input.onStage?.("humanizing");
      const humanized = await this.humanizerService.humanize(writerOutput.content ?? "", {
        publishJobId: input.publishJobId,
        stage: "humanizing",
        agentName: "writer_agent"
      });

      const humanizedDraftId = await this.topicRepository.createDraft(
        input.topicCardId,
        "humanized",
        humanized.content,
        writerOutput.summary ?? "",
        JSON.stringify({
          ...writerOutput,
          humanizerNotes: humanized.notes
        })
      );

      const review = await this.reviewService.reviewContent(
        {
          content: humanized.content,
          topicSummary: String(input.topicCard.summary ?? ""),
          pastContentFingerprints: input.pastContentFingerprints
        },
        promptSnapshot,
        {
          onStage: async (stage) => {
            await input.onStage?.(stage);
          }
        }
      );

      const reviewId = await this.topicRepository.createReview({
        draftId: humanizedDraftId,
        reviewStatus: review.decision.toLowerCase(),
        hardGateJson: JSON.stringify(review.hardGate),
        editorialReviewJson: JSON.stringify(review.editorial),
        publishReviewJson: JSON.stringify(review.publish),
        topicDuplicationJson: JSON.stringify(input.topicCard.topic_fingerprint ?? {}),
        contentDuplicationJson: JSON.stringify({
          duplicateReason: review.publish.duplicate_reason ?? "",
          matchedPastContents: review.publish.matched_past_contents ?? []
        }),
        approvedContent: review.approvedContent,
        reviewSummary: review.reviewSummary
      });

      if (review.decision === "PASS" && review.approvedContent) {
        return {
          kind: "ready",
          title: String(writerOutput.title ?? input.candidateTitle),
          topicCardId: input.topicCardId,
          reviewId,
          approvedContent: review.approvedContent,
          promptVersionSnapshotJson: JSON.stringify(promptSnapshot)
        };
      }

      if (review.decision === "BLOCK_DUPLICATION") {
        return {
          kind: "duplicate",
          reason: review.publish.duplicate_reason ?? "内容重复性过高。"
        };
      }

      if (review.decision === "BLOCK") {
        return {
          kind: "blocked",
          reason: review.reviewSummary || "内容被红线规则拦截。"
        };
      }

      revisionFeedback = review.editorial.rewrite_brief ?? review.reviewSummary;
    }

    return {
      kind: "blocked",
      reason: "已经重写 1 次，仍未通过审核。"
    };
  }
}

function buildTopicAgentFallback(questionTitle: string): TopicAgentOutput {
  return {
    title: questionTitle,
    summary: questionTitle,
    priority: "P2",
    fit_score: 60,
    question_type: "其他",
    persona_mode: "二牛经验型",
    target_audience: [],
    pain_points: [],
    recommended_angle: "",
    persona_hooks: [],
    soft_promo_mode: "none",
    soft_promo_reason: "",
    must_avoid: [],
    risk_notes: [],
    topic_fingerprint: {
      problem_core: questionTitle,
      answer_angle: "",
      target_pain: "",
      promo_entry: "none"
    }
  };
}

function normalizeCachedTopicAgentOutput(value: unknown, questionTitle: string): TopicAgentOutput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const priority = record.priority;
  if (priority !== "P0" && priority !== "P1" && priority !== "P2" && priority !== "SKIP") {
    return null;
  }

  const fingerprint =
    record.topic_fingerprint && typeof record.topic_fingerprint === "object"
      ? (record.topic_fingerprint as Record<string, unknown>)
      : {};

  return {
    ...buildTopicAgentFallback(questionTitle),
    title: typeof record.title === "string" && record.title.trim() ? record.title : questionTitle,
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary : questionTitle,
    priority,
    fit_score: Number.isFinite(Number(record.fit_score)) ? Number(record.fit_score) : 60,
    question_type: typeof record.question_type === "string" && record.question_type.trim() ? record.question_type : "其他",
    persona_mode: typeof record.persona_mode === "string" && record.persona_mode.trim() ? record.persona_mode : "二牛经验型",
    target_audience: normalizeStringArray(record.target_audience),
    pain_points: normalizeStringArray(record.pain_points),
    recommended_angle: typeof record.recommended_angle === "string" ? record.recommended_angle : "",
    persona_hooks: normalizeStringArray(record.persona_hooks),
    soft_promo_mode: typeof record.soft_promo_mode === "string" ? record.soft_promo_mode : "none",
    soft_promo_reason: typeof record.soft_promo_reason === "string" ? record.soft_promo_reason : "",
    must_avoid: normalizeStringArray(record.must_avoid),
    risk_notes: normalizeStringArray(record.risk_notes),
    topic_fingerprint: {
      problem_core:
        typeof fingerprint.problem_core === "string" && fingerprint.problem_core.trim()
          ? fingerprint.problem_core
          : questionTitle,
      answer_angle: typeof fingerprint.answer_angle === "string" ? fingerprint.answer_angle : "",
      target_pain: typeof fingerprint.target_pain === "string" ? fingerprint.target_pain : "",
      promo_entry: typeof fingerprint.promo_entry === "string" ? fingerprint.promo_entry : "none"
    }
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
