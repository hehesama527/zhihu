import type { JobStage, PromptSnapshotMap, TopicPriority } from "@zhihu-mvp/shared";
import { TopicRepository } from "../repositories/topic-repository.js";
import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { safeParseJson } from "../utils/json.js";
import { type AccountPromptContext, buildTopicPromptSuffix } from "./account-prompt-context.js";
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

export type WriterAccountContext = AccountPromptContext;

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
    accountContext?: WriterAccountContext | null;
    onStage?: (stage: JobStage) => Promise<void> | void;
  }) {
    const startedAt = Date.now();
    logDebugTiming("topicPipeline.prepareNextPublishableDraft", "start", {
      publishJobId: input?.publishJobId ?? null,
      accountId: input?.accountContext?.accountId ?? null
    });

    const promptSnapshot = input?.promptSnapshot ?? (await this.llmService.getActivePromptSnapshot());

    // Keep the injected service referenced for backward-compatible wiring.
    void this.topicReviewService;

    await this.topicRepository.markAnsweredHistoryCandidates(input?.accountContext?.accountId ?? null);
    const candidatePool = await this.topicRepository.listOpenCandidates(10, input?.accountContext?.accountId ?? null);
    const rankedCandidatePool = await this.topicBatchPlannerService.rankCandidatePool(
      candidatePool,
      promptSnapshot,
      input?.accountContext ?? null
    );
    logDebugTiming("topicPipeline.prepareNextPublishableDraft", "loaded_candidates", {
      publishJobId: input?.publishJobId ?? null,
      accountId: input?.accountContext?.accountId ?? null,
      candidatePoolSize: candidatePool.length,
      rankedCandidatePoolSize: rankedCandidatePool.length,
      elapsedMs: getElapsedMs(startedAt)
    });
    const pastTopicFingerprints = await this.topicRepository.getRecentPublishedTopicFingerprints(
      10,
      input?.accountContext?.accountId ?? null
    );
    const pastContentFingerprints = await this.topicRepository.getRecentPublishedContentFingerprints(10);

    for (const candidate of rankedCandidatePool) {
      const candidateStartedAt = Date.now();
      logDebugTiming("topicPipeline.prepareNextPublishableDraft", "candidate_start", {
        publishJobId: input?.publishJobId ?? null,
        candidateId: candidate.id,
        questionTitle: candidate.questionTitle
      });

      const answeredTopic = await this.topicRepository.findAnsweredTopicByQuestionUrl(candidate.questionUrl);
      if (answeredTopic) {
        await this.topicRepository.markCandidateDuplicate(candidate.id, answeredTopic.duplicateReason);
        logDebugTiming("topicPipeline.prepareNextPublishableDraft", "candidate_answered_duplicate", {
          publishJobId: input?.publishJobId ?? null,
          candidateId: candidate.id,
          elapsedMs: getElapsedMs(candidateStartedAt)
        });
        continue;
      }

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
            promptSnapshot,
            promptSuffix: buildTopicPromptSuffix(input?.accountContext)
          }
        );
        await this.topicRepository.cacheCandidatePrefilter(candidate.id, topicCard);
        logDebugTiming("topicPipeline.prepareNextPublishableDraft", "candidate_topic_agent_done", {
          publishJobId: input?.publishJobId ?? null,
          candidateId: candidate.id,
          elapsedMs: getElapsedMs(candidateStartedAt)
        });
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
        await this.topicRepository.markCandidateBlocked(candidate.id, "topic skipped by scripted prefilter");
        logDebugTiming("topicPipeline.prepareNextPublishableDraft", "candidate_skipped", {
          publishJobId: input?.publishJobId ?? null,
          candidateId: candidate.id,
          elapsedMs: getElapsedMs(candidateStartedAt)
        });
        continue;
      }

      await this.topicRepository.markCandidateProcessing(candidate.id, JSON.stringify(topicCard.topic_fingerprint ?? {}));

      // Historical duplicate screening now uses only the normalized question URL.
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
          accountContext: input?.accountContext ?? null,
          onStage: input?.onStage
        },
        promptSnapshot
      );

      if (!preparedDraft || preparedDraft.kind === "blocked") {
        await this.topicRepository.markCandidateBlocked(
          candidate.id,
          preparedDraft?.kind === "blocked" ? preparedDraft.reason : "draft blocked before publish"
        );
        logDebugTiming("topicPipeline.prepareNextPublishableDraft", "candidate_blocked", {
          publishJobId: input?.publishJobId ?? null,
          candidateId: candidate.id,
          reason: preparedDraft?.kind === "blocked" ? preparedDraft.reason : "draft blocked before publish",
          elapsedMs: getElapsedMs(candidateStartedAt)
        });
        continue;
      }

      if (preparedDraft.kind === "duplicate") {
        await this.topicRepository.markCandidateDuplicate(candidate.id, preparedDraft.reason);
        logDebugTiming("topicPipeline.prepareNextPublishableDraft", "candidate_duplicate", {
          publishJobId: input?.publishJobId ?? null,
          candidateId: candidate.id,
          reason: preparedDraft.reason,
          elapsedMs: getElapsedMs(candidateStartedAt)
        });
        continue;
      }

      await this.topicRepository.markCandidateAccepted(candidate.id, JSON.stringify(topicCard.topic_fingerprint ?? {}));
      logDebugTiming("topicPipeline.prepareNextPublishableDraft", "candidate_ready", {
        publishJobId: input?.publishJobId ?? null,
        candidateId: candidate.id,
        topicCardId: preparedDraft.topicCardId,
        reviewId: preparedDraft.reviewId,
        elapsedMs: getElapsedMs(candidateStartedAt),
        totalElapsedMs: getElapsedMs(startedAt)
      });
      return {
        ...preparedDraft,
        questionUrl: candidate.questionUrl
      };
    }

    logDebugTiming("topicPipeline.prepareNextPublishableDraft", "no_candidate_ready", {
      publishJobId: input?.publishJobId ?? null,
      accountId: input?.accountContext?.accountId ?? null,
      elapsedMs: getElapsedMs(startedAt)
    });
    return null;
  }

  async rewriteExistingTopic(input: {
    publishJobId?: number | null;
    topicCardId: number;
    candidateTitle: string;
    questionUrl: string;
    revisionFeedback: string;
    promptVersionSnapshotJson: string | null;
    accountContext?: WriterAccountContext | null;
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
        accountContext: input.accountContext ?? null,
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
      accountContext?: WriterAccountContext | null;
      onStage?: (stage: JobStage) => Promise<void> | void;
    },
    promptSnapshot: PromptSnapshotMap
  ): Promise<PreparedDraftResult | null> {
    const startedAt = Date.now();
    let revisionFeedback = input.revisionFeedback ?? "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptStartedAt = Date.now();
      logDebugTiming("topicPipeline.generateReviewedDraft", "attempt_start", {
        publishJobId: input.publishJobId,
        topicCardId: input.topicCardId,
        attempt: attempt + 1
      });

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
          promptSnapshot,
          promptSuffix: buildWriterPromptSuffix(input.accountContext)
        }
      );
      logDebugTiming("topicPipeline.generateReviewedDraft", "writer_done", {
        publishJobId: input.publishJobId,
        topicCardId: input.topicCardId,
        attempt: attempt + 1,
        elapsedMs: getElapsedMs(attemptStartedAt)
      });

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
      logDebugTiming("topicPipeline.generateReviewedDraft", "humanizer_done", {
        publishJobId: input.publishJobId,
        topicCardId: input.topicCardId,
        attempt: attempt + 1,
        elapsedMs: getElapsedMs(attemptStartedAt)
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
      logDebugTiming("topicPipeline.generateReviewedDraft", "review_done", {
        publishJobId: input.publishJobId,
        topicCardId: input.topicCardId,
        attempt: attempt + 1,
        decision: review.decision,
        elapsedMs: getElapsedMs(attemptStartedAt)
      });

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
        logDebugTiming("topicPipeline.generateReviewedDraft", "attempt_pass", {
          publishJobId: input.publishJobId,
          topicCardId: input.topicCardId,
          attempt: attempt + 1,
          elapsedMs: getElapsedMs(attemptStartedAt),
          totalElapsedMs: getElapsedMs(startedAt)
        });
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
        logDebugTiming("topicPipeline.generateReviewedDraft", "attempt_duplicate", {
          publishJobId: input.publishJobId,
          topicCardId: input.topicCardId,
          attempt: attempt + 1,
          elapsedMs: getElapsedMs(attemptStartedAt),
          totalElapsedMs: getElapsedMs(startedAt)
        });
        return {
          kind: "duplicate",
          reason: review.publish.duplicate_reason ?? "content duplication detected during publish review"
        };
      }

      if (review.decision === "BLOCK") {
        logDebugTiming("topicPipeline.generateReviewedDraft", "attempt_blocked", {
          publishJobId: input.publishJobId,
          topicCardId: input.topicCardId,
          attempt: attempt + 1,
          reason: review.reviewSummary || "content blocked by review",
          elapsedMs: getElapsedMs(attemptStartedAt),
          totalElapsedMs: getElapsedMs(startedAt)
        });
        return {
          kind: "blocked",
          reason: review.reviewSummary || "content blocked by review"
        };
      }

      revisionFeedback = review.editorial.rewrite_brief ?? review.reviewSummary;
      logDebugTiming("topicPipeline.generateReviewedDraft", "attempt_revise", {
        publishJobId: input.publishJobId,
        topicCardId: input.topicCardId,
        attempt: attempt + 1,
        elapsedMs: getElapsedMs(attemptStartedAt),
        totalElapsedMs: getElapsedMs(startedAt)
      });
    }

    logDebugTiming("topicPipeline.generateReviewedDraft", "rewrite_limit_reached", {
      publishJobId: input.publishJobId,
      topicCardId: input.topicCardId,
      elapsedMs: getElapsedMs(startedAt)
    });
    return {
      kind: "blocked",
      reason: "rewrite limit reached without passing review"
    };
  }
}

function buildTopicAgentFallback(questionTitle: string): TopicAgentOutput {
  return {
    title: questionTitle,
    summary: questionTitle,
    priority: "P2",
    fit_score: 60,
    question_type: "other",
    persona_mode: "default",
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
    question_type: typeof record.question_type === "string" && record.question_type.trim() ? record.question_type : "other",
    persona_mode: typeof record.persona_mode === "string" && record.persona_mode.trim() ? record.persona_mode : "default",
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

function buildWriterPromptSuffix(accountContext?: WriterAccountContext | null) {
  const personaName = accountContext?.accountName?.trim();
  if (!personaName) {
    return null;
  }

  const lines = [
    "Runtime supplement:",
    `1. The active persona name for this run is "${personaName}". If the base prompt mentions another default name, override it with this persona.`,
    "2. Keep account differentiation light and realistic. Do not force exaggerated role-play just to make accounts feel different.",
    "3. Adjust tone, observation angle, and experience framing to fit this persona, while keeping the answer natural and useful.",
    `4. Unless the topic truly needs explicit credibility setup, do not open with a self-introduction like "I am ${personaName}".`
  ];

  if (accountContext?.zhihuUserName?.trim()) {
    lines.push(
      `5. The mapped Zhihu username is "${accountContext.zhihuUserName.trim()}". Use it only as tone context when needed; do not force it into the article body.`
    );
  }

  return lines.join("\n");
}
