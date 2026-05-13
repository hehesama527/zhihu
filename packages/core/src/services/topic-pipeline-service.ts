import type { JobStage, PromptSnapshotMap, TopicPriority } from "@zhihu-mvp/shared";
import { TopicRepository } from "../repositories/topic-repository.js";
import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { safeParseJson } from "../utils/json.js";
import {
  type AccountPromptContext,
  buildTopicPromptSuffix,
  buildTopicSoulPromptSuffix,
  buildTopicTargetProductPromptSuffix,
  buildWriterPromptSuffix,
  buildWriterSoulPromptSuffix,
  buildWriterTargetProductPromptSuffix,
  joinPromptSuffixes
} from "./account-prompt-context.js";
import { HumanizerService } from "./humanizer-service.js";
import { LlmService } from "./llm-service.js";
import { ReviewService } from "./review-service.js";
import { TopicBatchPlannerService } from "./topic-batch-planner-service.js";
import { TopicReviewService } from "./topic-review-service.js";
import { type ZhihuAgentContextDocuments, ZhihuAgentContextService } from "./zhihu-agent-context-service.js";
import { type ZhihuCaseResearchOutput, ZhihuCaseResearchService } from "./zhihu-case-research-service.js";

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
      needsManualReview?: boolean;
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
  should_include_soft_promo: boolean;
  soft_promo_directive: {
    should_include: boolean;
    mode: string;
    reason: string;
    product_anchor: string;
    writer_instruction: string;
  };
  writing_plan: TopicWritingPlan;
  must_avoid: string[];
  risk_notes: string[];
  topic_fingerprint: {
    problem_core: string;
    answer_angle: string;
    target_pain: string;
    promo_entry: string;
  };
  case_research?: ZhihuCaseResearchOutput;
};

export type TopicWritingPlan = {
  length_mode: "short" | "standard" | "long";
  target_words_min: number;
  target_words_max: number;
  structure_mode: string;
  should_use_cases: boolean;
  case_style: "none" | "typical_composite" | "personal_reflection" | "contrast_cases";
  should_include_calculation: boolean;
  should_include_list: boolean;
  should_use_bold: boolean;
  bold_targets: string[];
  suggested_sections: string[];
  writer_notes: string;
};

export type WriterAccountContext = AccountPromptContext;

const MAX_REWRITE_ATTEMPTS = 5;
const MAX_DRAFT_REVIEW_ATTEMPTS = MAX_REWRITE_ATTEMPTS + 1;

export class TopicPipelineService {
  private readonly agentContextService = new ZhihuAgentContextService();
  private readonly caseResearchService: ZhihuCaseResearchService;

  constructor(
    private readonly llmService: LlmService,
    private readonly topicRepository: TopicRepository,
    private readonly topicBatchPlannerService: TopicBatchPlannerService,
    private readonly topicReviewService: TopicReviewService,
    private readonly reviewService: ReviewService,
    private readonly humanizerService: HumanizerService
  ) {
    this.caseResearchService = new ZhihuCaseResearchService(this.llmService);
  }

  async prepareNextPublishableDraft(input?: {
    publishJobId?: number | null;
    promptSnapshot?: PromptSnapshotMap | null;
    accountContext?: WriterAccountContext | null;
    accountSoulMarkdown?: string | null;
    onStage?: (stage: JobStage) => Promise<void> | void;
  }) {
    const startedAt = Date.now();
    logDebugTiming("topicPipeline.prepareNextPublishableDraft", "start", {
      publishJobId: input?.publishJobId ?? null,
      accountId: input?.accountContext?.accountId ?? null
    });

    const promptSnapshot = input?.promptSnapshot ?? (await this.llmService.getActivePromptSnapshot());
    const agentContextDocuments = await this.agentContextService.ensureDocuments();

    // Keep the injected service referenced for backward-compatible wiring.
    void this.topicReviewService;

    await this.topicRepository.markAnsweredHistoryCandidates(input?.accountContext?.accountId ?? null);
    const candidatePool = await this.topicRepository.listOpenCandidates(10, input?.accountContext?.accountId ?? null);
    const rankedCandidatePool = await this.topicBatchPlannerService.rankCandidatePool(
      candidatePool,
      promptSnapshot,
      input?.accountContext ?? null,
      input?.accountSoulMarkdown ?? null
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
            promptSuffix: joinPromptSuffixes(
              buildTopicPromptSuffix(input?.accountContext),
              buildTopicSoulPromptSuffix(input?.accountSoulMarkdown),
              buildTopicTargetProductPromptSuffix(agentContextDocuments),
              buildTopicAgentSingleSelectionPromptSuffix()
            )
          }
        );
        topicCard = normalizeTopicAgentOutput(topicCard, candidate.questionTitle);
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

      topicCard = await this.attachCaseResearchToTopicCard({
        questionTitle: candidate.questionTitle,
        questionUrl: candidate.questionUrl,
        topicCard,
        sourceContext
      });

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
          accountSoulMarkdown: input?.accountSoulMarkdown ?? null,
          agentContextDocuments,
          onStage: input?.onStage
        },
        promptSnapshot
      );

      if (!preparedDraft || preparedDraft.kind === "blocked") {
        if (preparedDraft?.kind === "blocked" && preparedDraft.needsManualReview && input?.publishJobId) {
          logDebugTiming("topicPipeline.prepareNextPublishableDraft", "candidate_needs_manual_review", {
            publishJobId: input.publishJobId,
            candidateId: candidate.id,
            reason: preparedDraft.reason,
            elapsedMs: getElapsedMs(candidateStartedAt)
          });
          return preparedDraft;
        }

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
    accountSoulMarkdown?: string | null;
    onStage?: (stage: JobStage) => Promise<void> | void;
  }) {
    const topicCardRecord = await this.topicRepository.getTopicCardById(input.topicCardId);
    if (!topicCardRecord) {
      return null;
    }

    const promptSnapshot = safeParseJson<PromptSnapshotMap>(input.promptVersionSnapshotJson ?? "{}", {});
    const pastContentFingerprints = await this.topicRepository.getRecentPublishedContentFingerprints(10);
    const topicCard = normalizeTopicAgentOutput(safeParseJson<Record<string, unknown>>(topicCardRecord.output_json, {
      summary: topicCardRecord.summary_text
    }), input.candidateTitle);

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
        accountSoulMarkdown: input.accountSoulMarkdown ?? null,
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
      accountSoulMarkdown?: string | null;
      agentContextDocuments?: ZhihuAgentContextDocuments | null;
      onStage?: (stage: JobStage) => Promise<void> | void;
    },
    promptSnapshot: PromptSnapshotMap
  ): Promise<PreparedDraftResult | null> {
    const startedAt = Date.now();
    let revisionFeedback = input.revisionFeedback ?? "";
    const agentContextDocuments = input.agentContextDocuments ?? (await this.agentContextService.ensureDocuments());
    const topicCard = await this.attachCaseResearchToTopicCard({
      questionTitle: input.candidateTitle,
      questionUrl: input.questionUrl,
      topicCard: input.topicCard
    });

    for (let attempt = 0; attempt < MAX_DRAFT_REVIEW_ATTEMPTS; attempt += 1) {
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
          topicCard,
          softPromoDirective: resolveSoftPromoDirective(topicCard),
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
          promptSuffix: joinPromptSuffixes(
            buildWriterPromptSuffix(input.accountContext),
            buildWriterTargetProductPromptSuffix(agentContextDocuments),
            buildWriterSoulPromptSuffix(input.accountSoulMarkdown),
            buildWriterCaseResearchPromptSuffix(topicCard),
            buildWriterWritingPlanPromptSuffix(topicCard),
            buildWriterSoftPromoPromptSuffix(topicCard)
          )
        }
      );
      logDebugTiming("topicPipeline.generateReviewedDraft", "writer_done", {
        publishJobId: input.publishJobId,
        topicCardId: input.topicCardId,
        attempt: attempt + 1,
        elapsedMs: getElapsedMs(attemptStartedAt)
      });

      const writerContent =
        typeof writerOutput.content === "string" ? writerOutput.content.trim() : "";
      if (writerContent.length < 300) {
        await this.topicRepository.createDraft(
          input.topicCardId,
          "raw",
          writerContent,
          writerOutput.summary ?? "",
          JSON.stringify({
            ...writerOutput,
            topicCard,
            blockedBeforeHumanizer: "writer_content_too_short"
          })
        );
        revisionFeedback = [
          "Previous Writer output was empty or far too short.",
          "Return a complete publishable Zhihu answer in JSON.content.",
          "Follow the Topic Card writing_plan, backend case_research, soft-promo directive, and Account Soul.",
          "Do not return a placeholder, request for input, or meta explanation."
        ].join("\n");
        logDebugTiming("topicPipeline.generateReviewedDraft", "writer_too_short_retry", {
          publishJobId: input.publishJobId,
          topicCardId: input.topicCardId,
          attempt: attempt + 1,
          contentLength: writerContent.length,
          elapsedMs: getElapsedMs(attemptStartedAt)
        });
        continue;
      }

      await this.topicRepository.createDraft(
        input.topicCardId,
        "raw",
        writerContent,
        writerOutput.summary ?? "",
        JSON.stringify({
          ...writerOutput,
          topicCard
        })
      );

      await input.onStage?.("humanizing");
      const humanized = await this.humanizerService.humanize(writerContent, {
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
          topicCard,
          humanizerNotes: humanized.notes
        })
      );

      const review = await this.reviewService.reviewContent(
        {
          content: humanized.content,
          topicSummary: String(topicCard.summary ?? ""),
          topicCard,
          softPromoDirective: resolveSoftPromoDirective(topicCard),
          pastContentFingerprints: input.pastContentFingerprints
        },
        promptSnapshot,
        {
          accountSoulMarkdown: input.accountSoulMarkdown,
          agentContextDocuments,
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
        topicDuplicationJson: JSON.stringify(topicCard.topic_fingerprint ?? {}),
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

      if (review.quality.manualReviewReasons.length > 0 && attempt >= 2) {
        logDebugTiming("topicPipeline.generateReviewedDraft", "attempt_needs_manual_review", {
          publishJobId: input.publishJobId,
          topicCardId: input.topicCardId,
          attempt: attempt + 1,
          reasons: review.quality.manualReviewReasons,
          elapsedMs: getElapsedMs(attemptStartedAt),
          totalElapsedMs: getElapsedMs(startedAt)
        });
        return {
          kind: "blocked",
          reason: buildManualReviewReason(review.quality.manualReviewReasons, review.reviewSummary),
          needsManualReview: Boolean(input.publishJobId)
        };
      }

      revisionFeedback = review.quality.rewriteBrief || review.editorial.rewrite_brief || review.reviewSummary;
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
      reason: `???? ${MAX_REWRITE_ATTEMPTS} ?????????????`,
      needsManualReview: Boolean(input.publishJobId)
    };

  }

  private async attachCaseResearchToTopicCard(input: {
    questionTitle: string;
    questionUrl?: string | null;
    topicCard: TopicAgentOutput | Record<string, unknown>;
    sourceContext?: Record<string, unknown> | null;
  }): Promise<TopicAgentOutput> {
    const existing = readRecord(input.topicCard.case_research);
    if (existing && typeof existing.should_use_case_research === "boolean") {
      return input.topicCard as TopicAgentOutput;
    }

    const research = await this.caseResearchService.research({
      questionTitle: input.questionTitle,
      questionUrl: input.questionUrl ?? null,
      topicCard: input.topicCard,
      sourceContext: input.sourceContext ?? null
    });

    if (!research.should_use_case_research && research.case_materials.length === 0) {
      return input.topicCard as TopicAgentOutput;
    }

    return {
      ...(input.topicCard as TopicAgentOutput),
      case_research: research
    };
  }
}

function buildManualReviewReason(reasons: string[], fallback: string) {
  const normalized = reasons.length ? reasons.join(", ") : "quality_review";
  return `???????????${normalized}${fallback ? `?${fallback}` : ""}`;
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
    should_include_soft_promo: false,
    soft_promo_directive: buildSoftPromoDirective({
      shouldInclude: false,
      mode: "none",
      reason: "选题兜底结果未确认软广契合点。",
      productAnchor: ""
    }),
    writing_plan: buildFallbackWritingPlan(),
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

  return normalizeTopicAgentOutput(record, questionTitle);
}

function normalizeTopicAgentOutput(value: unknown, questionTitle: string): TopicAgentOutput {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const fallback = buildTopicAgentFallback(questionTitle);
  const priority = record.priority;
  const rawMode = normalizeSoftPromoMode(record.soft_promo_mode, fallback.soft_promo_mode);
  const explicitShouldInclude =
    typeof record.should_include_soft_promo === "boolean" ? record.should_include_soft_promo : null;
  const shouldInclude = explicitShouldInclude ?? (rawMode === "light" || rawMode === "natural");
  const softPromoMode = shouldInclude ? (rawMode === "none" ? "light" : rawMode) : "none";

  const fingerprint =
    record.topic_fingerprint && typeof record.topic_fingerprint === "object"
      ? (record.topic_fingerprint as Record<string, unknown>)
      : {};

  const softPromoReason =
    typeof record.soft_promo_reason === "string" && record.soft_promo_reason.trim()
      ? record.soft_promo_reason.trim()
      : shouldInclude
        ? "该选题与产品真实能力存在自然承接点。"
        : "该选题不适合强制加入软广。";

  const rawPromoEntry = typeof fingerprint.promo_entry === "string" ? fingerprint.promo_entry.trim() : "";
  const productAnchor = shouldInclude && rawPromoEntry && rawPromoEntry !== "none" ? rawPromoEntry : "";
  const softPromoDirective = normalizeSoftPromoDirective(record.soft_promo_directive, {
    shouldInclude,
    mode: softPromoMode,
    reason: softPromoReason,
    productAnchor
  });

  const normalized: TopicAgentOutput = {
    ...fallback,
    title: typeof record.title === "string" && record.title.trim() ? record.title : questionTitle,
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary : questionTitle,
    priority: priority === "P0" || priority === "P1" || priority === "P2" || priority === "SKIP" ? priority : fallback.priority,
    fit_score: normalizeFitScore(record.fit_score, fallback.fit_score),
    question_type:
      typeof record.question_type === "string" && record.question_type.trim() ? record.question_type : fallback.question_type,
    persona_mode:
      typeof record.persona_mode === "string" && record.persona_mode.trim() ? record.persona_mode : fallback.persona_mode,
    target_audience: normalizeStringArray(record.target_audience),
    pain_points: normalizeStringArray(record.pain_points),
    recommended_angle: typeof record.recommended_angle === "string" ? record.recommended_angle : fallback.recommended_angle,
    persona_hooks: normalizeStringArray(record.persona_hooks),
    soft_promo_mode: softPromoMode,
    soft_promo_reason: softPromoReason,
    should_include_soft_promo: shouldInclude,
    soft_promo_directive: softPromoDirective,
    writing_plan: normalizeWritingPlan(record.writing_plan, fallback.writing_plan),
    must_avoid: normalizeStringArray(record.must_avoid),
    risk_notes: normalizeStringArray(record.risk_notes),
    topic_fingerprint: {
      problem_core:
        typeof fingerprint.problem_core === "string" && fingerprint.problem_core.trim()
          ? fingerprint.problem_core
          : questionTitle,
      answer_angle: typeof fingerprint.answer_angle === "string" ? fingerprint.answer_angle : "",
      target_pain: typeof fingerprint.target_pain === "string" ? fingerprint.target_pain : "",
      promo_entry: shouldInclude ? rawPromoEntry || softPromoDirective.product_anchor || "待 Writer 自然确认" : "none"
    }
  };

  normalized.writing_plan = applyCaseDrivenWritingPlanDefaults(
    normalized.writing_plan,
    [
      questionTitle,
      normalized.title,
      normalized.summary,
      normalized.question_type,
      normalized.recommended_angle,
      normalized.pain_points.join("\n"),
      normalized.persona_hooks.join("\n")
    ].join("\n")
  );

  return normalized;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const CASE_DRIVEN_TOPIC_PATTERNS = [
  /\u5e01\u5708/u,
  /\u7092\u5e01/u,
  /\u5c71\u5be8\u5e01/u,
  /\u52a0\u5bc6\u8d27\u5e01/u,
  /\u4ea4\u6613/u,
  /\u91cf\u5316/u,
  /\u7b56\u7565/u,
  /\u56de\u6d4b/u,
  /\u5408\u7ea6/u,
  /\u6760\u6746/u,
  /\u4ed3\u4f4d/u,
  /\u6b62\u635f/u,
  /\u505a\u591a|\u505a\u7a7a/u,
  /\u5fc3\u6001/u,
  /\u5f2f\u8def/u,
  /\u7a33\u5b9a\u76c8\u5229/u,
  /\u76c8\u4e8f|\u56de\u64a4|\u6ed1\u70b9|\u7206\u4ed3/u,
  /\b(?:BTC|ETH|Crypto|RSI|MACD|K\u7ebf|U)\b/iu
];

function shouldUseCaseDrivenDefaults(seedText: string) {
  return CASE_DRIVEN_TOPIC_PATTERNS.some((pattern) => pattern.test(seedText));
}

function appendCaseWriterNote(existing: string) {
  const note =
    "Case-driven default: for crypto/trading topics, make at least one concrete case carry the core argument. Prefer source/user-provided cases or backend case_research when available; otherwise use a realistic composite case with price/time path, entry trigger, position or budget, long/short temptation, stop-loss/action deformation, outcome pressure, and review takeaway. Do not keep reusing the same token, story arc, or reference wording across different answers.";

  if (!existing) {
    return note;
  }
  if (existing.includes("Case-driven default")) {
    return existing;
  }
  return `${existing}\n${note}`;
}

function appendUniqueItems(existing: string[], items: string[]) {
  const next = [...existing];
  for (const item of items) {
    if (!next.includes(item)) {
      next.push(item);
    }
  }
  return next;
}

function applyCaseDrivenWritingPlanDefaults(plan: TopicWritingPlan, seedText: string): TopicWritingPlan {
  if (!shouldUseCaseDrivenDefaults(seedText)) {
    return plan;
  }

  const targetMin = Math.max(plan.target_words_min, 2200);
  const targetMax = Math.max(plan.target_words_max, 3500, targetMin);

  return {
    ...plan,
    length_mode: plan.length_mode === "short" ? "standard" : "long",
    target_words_min: Math.min(targetMin, 2600),
    target_words_max: Math.min(Math.max(targetMax, 3500), 5000),
    structure_mode: plan.structure_mode
      ? `${plan.structure_mode} + case action chain`
      : "direct judgment + concrete case action chain + calculation/review + practical boundary",
    should_use_cases: true,
    case_style: plan.case_style === "none" ? "typical_composite" : plan.case_style,
    should_include_calculation: true,
    should_use_bold: true,
    bold_targets: appendUniqueItems(plan.bold_targets, [
      "core judgment",
      "risk boundary",
      "case takeaway",
      "operating principle"
    ]).slice(0, 6),
    suggested_sections: appendUniqueItems(plan.suggested_sections, [
      "concrete case",
      "action chain",
      "review takeaway"
    ]).slice(0, 10),
    writer_notes: appendCaseWriterNote(plan.writer_notes)
  };
}

function buildFallbackWritingPlan(): TopicWritingPlan {
  return {
    length_mode: "standard",
    target_words_min: 2200,
    target_words_max: 3500,
    structure_mode: "开头判断 + 具体理由 + 方法建议 + 克制收口",
    should_use_cases: false,
    case_style: "none",
    should_include_calculation: false,
    should_include_list: false,
    should_use_bold: true,
    bold_targets: ["核心结论", "风险边界", "算账结论", "操作原则"],
    suggested_sections: ["开头判断", "核心原因", "具体做法", "克制收口"],
    writer_notes: "按题目自然展开，target_words_min 是硬下限；不要为了长度重复观点。"
  };
}

function normalizeWritingPlan(value: unknown, fallback: TopicWritingPlan): TopicWritingPlan {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const lengthMode =
    record.length_mode === "short" || record.length_mode === "standard" || record.length_mode === "long"
      ? record.length_mode
      : fallback.length_mode;
  const defaultRange =
    lengthMode === "long"
      ? { min: 2200, max: 3500 }
      : lengthMode === "short"
        ? { min: 800, max: 1200 }
        : { min: 1800, max: 3000 };
  const min = normalizeWordCount(record.target_words_min, fallback.target_words_min || defaultRange.min, 2600);
  const max = normalizeWordCount(record.target_words_max, fallback.target_words_max || defaultRange.max, 5000);
  const normalizedMin = Math.min(min, max);
  const normalizedMax = Math.max(min, max);
  const caseStyle =
    record.case_style === "typical_composite" ||
    record.case_style === "personal_reflection" ||
    record.case_style === "contrast_cases" ||
    record.case_style === "none"
      ? record.case_style
      : fallback.case_style;

  return {
    length_mode: lengthMode,
    target_words_min: normalizedMin,
    target_words_max: normalizedMax,
    structure_mode:
      typeof record.structure_mode === "string" && record.structure_mode.trim()
        ? record.structure_mode.trim()
        : fallback.structure_mode,
    should_use_cases:
      typeof record.should_use_cases === "boolean"
        ? record.should_use_cases
        : fallback.should_use_cases,
    case_style: caseStyle,
    should_include_calculation:
      typeof record.should_include_calculation === "boolean"
        ? record.should_include_calculation
        : fallback.should_include_calculation,
    should_include_list:
      typeof record.should_include_list === "boolean"
        ? record.should_include_list
        : fallback.should_include_list,
    should_use_bold:
      typeof record.should_use_bold === "boolean"
        ? record.should_use_bold
        : fallback.should_use_bold,
    bold_targets: normalizeStringArray(record.bold_targets).length
      ? normalizeStringArray(record.bold_targets).slice(0, 6)
      : fallback.bold_targets,
    suggested_sections: normalizeStringArray(record.suggested_sections).length
      ? normalizeStringArray(record.suggested_sections).slice(0, 10)
      : fallback.suggested_sections,
    writer_notes:
      typeof record.writer_notes === "string" && record.writer_notes.trim()
        ? record.writer_notes.trim()
        : fallback.writer_notes
  };
}

function normalizeWordCount(value: unknown, fallback: number, maxValue = 5000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(400, Math.min(maxValue, Math.round(numeric)));
}

function normalizeFitScore(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const normalized = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function normalizeSoftPromoMode(value: unknown, fallback: string) {
  return value === "light" || value === "natural" || value === "none" ? value : fallback;
}

function normalizeSoftPromoDirective(
  value: unknown,
  fallback: {
    shouldInclude: boolean;
    mode: string;
    reason: string;
    productAnchor: string;
  }
) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const shouldInclude =
    typeof record.should_include === "boolean" ? record.should_include : fallback.shouldInclude;
  const mode = shouldInclude ? normalizeSoftPromoMode(record.mode, fallback.mode) : "none";
  const reason =
    typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : fallback.reason;
  const productAnchor =
    typeof record.product_anchor === "string" && record.product_anchor.trim()
      ? record.product_anchor.trim()
      : fallback.productAnchor;
  const writerInstruction =
    typeof record.writer_instruction === "string" && record.writer_instruction.trim()
      ? record.writer_instruction.trim()
      : buildSoftPromoWriterInstruction({ shouldInclude, mode, reason, productAnchor });

  return {
    should_include: shouldInclude,
    mode,
    reason,
    product_anchor: shouldInclude ? productAnchor : "",
    writer_instruction: writerInstruction
  };
}

function buildSoftPromoDirective(input: {
  shouldInclude: boolean;
  mode: string;
  reason: string;
  productAnchor: string;
}) {
  return {
    should_include: input.shouldInclude,
    mode: input.shouldInclude ? input.mode : "none",
    reason: input.reason,
    product_anchor: input.shouldInclude ? input.productAnchor : "",
    writer_instruction: buildSoftPromoWriterInstruction(input)
  };
}

function buildSoftPromoWriterInstruction(input: {
  shouldInclude: boolean;
  mode: string;
  reason: string;
  productAnchor: string;
}) {
  if (!input.shouldInclude) {
    return "Topic Agent 判断该选题不适合强制加入软广。Writer 应优先把问题回答完整，不要为了推广硬带 CryptoPathX。";
  }

  const anchor = input.productAnchor ? `承接点：${input.productAnchor}。` : "";
  return `Topic Agent 判断该选题适合自然加入软广，Writer 需要在不破坏回答价值的前提下自然提到 CryptoPathX。${anchor}原因：${input.reason}`;
}

function resolveSoftPromoDirective(topicCard: Record<string, unknown>) {
  return normalizeSoftPromoDirective(topicCard.soft_promo_directive, {
    shouldInclude:
      typeof topicCard.should_include_soft_promo === "boolean"
        ? topicCard.should_include_soft_promo
        : topicCard.soft_promo_mode === "light" || topicCard.soft_promo_mode === "natural",
    mode: typeof topicCard.soft_promo_mode === "string" ? topicCard.soft_promo_mode : "none",
    reason: typeof topicCard.soft_promo_reason === "string" ? topicCard.soft_promo_reason : "",
    productAnchor:
      topicCard.topic_fingerprint &&
      typeof topicCard.topic_fingerprint === "object" &&
      typeof (topicCard.topic_fingerprint as Record<string, unknown>).promo_entry === "string"
        ? String((topicCard.topic_fingerprint as Record<string, unknown>).promo_entry)
        : ""
  });
}

function buildTopicAgentSingleSelectionPromptSuffix() {
  return [
    "Case-driven planning rule: for crypto, trading, altcoin, contract, strategy, backtesting, risk-control, trading-psychology, capital-size, and stable-profit topics, set writing_plan.should_use_cases=true by default unless the question is only a narrow factual definition.",
    "Case preservation rule: if sourceContext, backend case_research, user notes, title, or candidate context contains a concrete market case, price path, token path, or failure story, preserve it in recommended_angle or writing_plan.writer_notes for Writer.",
    "Case quality rule: a usable case must include time/price path or market setup, why a retail trader enters, position or budget, long/short temptation, action deformation such as chasing/holding/stop-loss failure, result pressure, and review takeaway.",
    "Case diversity rule: user-provided examples are style/quality references, not reusable copy. Do not keep reusing the same token, same price path, same story arc, or same wording across different answers.",
    "Topic Agent 单题最终选题补充规则：",
    "1. 必须认真使用 product.md、target.md 和 Account Soul，不要只按量化/回测关键词判断选题价值。",
    "2. Topic Agent 需要自主判断题目是否适合当前账号，但内容重心必须更多放在币圈交易者身上：炒币、合约、杠杆、山寨币/主流币、行情结构、K 线形态、形态教学、AI 辅助交易判断、交易心态、风控、复盘和踩坑经验。",
    "3. 在方向符合时，尽可能选择流量更高的问题：痛点更大众、讨论空间更大、搜索需求更稳定、标题更像真实用户会点的问题，应优先于很冷、很窄、很工程化的问题。",
    "4. 形态识别/技术形态教学类题可以选，也可以加入软广。承接点是 Pattern Analysis、K 线/量价结构识别、误判边界和历史验证，不要写成指标百科。",
    "5. AI 和交易联动类题可以选，也可以加入软广。承接点是 AI 解释指标、生成策略条件、解读回测结果、发现风险点；严禁暗示 AI 能预测行情、喊单或替用户交易。",
    "6. 不要再把纯量化工作流作为选题方向。题目如果主要讨论量化策略上线、深度优化、参数调优、研究 pipeline 或团队研发效率，而不是币圈交易者的真实交易痛点，应设为 SKIP 或低优先级。",
    "7. 泛交易心态题可以选，例如外汇交易者为什么亏损、如何避免成为韭菜这类题；但它们更适合作为纯经验分享，不要默认加入 CryptoPathX。",
    "8. 对泛交易心态题，除非题目明确问工具、回测、监控、策略验证或复盘系统，否则 should_include_soft_promo=false，soft_promo_mode=none，topic_fingerprint.promo_entry=none。",
    "9. 软广需要有节奏，不要每一篇都带。整体按约 10 条里 7 条自然带产品、3 条纯分享/纯经验/纯观点来控制。",
    "10. 即使题目能勉强接到产品，只要它更适合做人设信任、交易心态、踩坑经验、币圈常识或观点判断，就应优先留白：should_include_soft_promo=false。",
    "11. 不要让纯量化题天然优先；如果币圈/心态/形态/风控/AI 交易联动题更符合账号 Soul 和读者痛点，可以给更高 priority 和 fit_score。",
    "12. 选题结束后，必须单独判断这个选题是否适合自然加入软广。",
    "13. 如果适合，把 should_include_soft_promo 设为 true，soft_promo_mode 设为 light 或 natural，并在 soft_promo_directive.writer_instruction 里明确告诉 Writer：这篇需要自然加入 CryptoPathX。",
    "14. 如果不适合，把 should_include_soft_promo 设为 false，soft_promo_mode 设为 none，topic_fingerprint.promo_entry 写 none，并在 soft_promo_directive.writer_instruction 里明确告诉 Writer：这篇不强制加入软广，不要硬带 CryptoPathX。",
    "15. 只有当 CryptoPathX 的真实能力能解决题目里的具体一步时，才允许 should_include_soft_promo=true；不要因为业务目标需要推广就默认每篇都带。",
    "16. 必须输出 writing_plan，由 Topic Agent 决定正文长度、是否需要案例、是否需要算账、是否适合列表/短标题、哪些重点需要加粗。",
    "17. length_mode 选择规则：简单知识问答用 short；普通方法题用 standard；交易经历、弯路复盘、新手入门、小本金、策略方法论、软文承接空间大的题用 long。",
    "18. 字数规则：target_words_min 是 Writer 必须达到的硬下限；target_words_max 只是软参考，可以超过，不能为了压字数牺牲案例、算账和信息密度。",
    "19. 案例规则：只有题目适合故事化时 should_use_cases=true；没有真实输入证据时 case_style 用 typical_composite 或 contrast_cases，可以要求 Writer 写接近真实的复合案例，但不要要求伪造真实朋友经历。",
    "20. 数据规则：案例里的胜率、回撤、盈亏比、仓位、手续费、滑点等数字要贴近真实市场常识、保守且自洽，不要要求精确历史统计。",
    "21. 算账规则：涉及本金、成本、收益预期、回撤、仓位、手续费、策略有效性时 should_include_calculation=true。",
    "22. 加粗规则：standard/long 文章默认 should_use_bold=true，bold_targets 应指定 2-5 类重点，如核心结论、风险边界、算账结论、操作原则、产品边界。",
    "23. suggested_sections 是结构提示，不是要求 Writer 原样使用的标题；避免反复输出“先说结论/最后补一句”这类固定模板。",
    "24. 只输出 JSON，不要 Markdown。",
    "单题输出格式必须包含以下字段：",
    "{",
    '  "title": "建议标题",',
    '  "summary": "100-180字选题摘要",',
    '  "priority": "P0 | P1 | P2 | SKIP",',
    '  "fit_score": 0,',
    '  "question_type": "工具推荐 | 方法验证 | 入门认知 | 行情判断 | 风险管理 | 策略构建 | 纯干货 | 其他",',
    '  "persona_mode": "二牛实测型 | 二牛踩坑型 | 二牛对比型 | 二牛经验型",',
    '  "target_audience": ["目标读者1"],',
    '  "pain_points": ["痛点1"],',
    '  "recommended_angle": "最适合切入的写法",',
    '  "persona_hooks": ["适合强化人设的细节"],',
    '  "soft_promo_mode": "none | light | natural",',
    '  "soft_promo_reason": "为什么适合或不适合自然植入",',
    '  "should_include_soft_promo": false,',
    '  "soft_promo_directive": {',
    '    "should_include": false,',
    '    "mode": "none | light | natural",',
    '    "reason": "选题层面的软广适配判断",',
    '    "product_anchor": "适合植入时写具体承接点，不适合写空字符串",',
    '    "writer_instruction": "给 Writer 的明确执行指令"',
    "  },",
    '  "writing_plan": {',
    '    "length_mode": "short | standard | long",',
    '    "target_words_min": 900,',
    '    "target_words_max": 1300,',
    '    "structure_mode": "例如：开头判断 + 典型案例 + 算账 + 具体做法 + 克制收口",',
    '    "should_use_cases": false,',
    '    "case_style": "none | typical_composite | personal_reflection | contrast_cases",',
    '    "should_include_calculation": false,',
    '    "should_include_list": false,',
    '    "should_use_bold": true,',
    '    "bold_targets": ["核心结论", "风险边界", "算账结论"],',
    '    "suggested_sections": ["开头判断", "典型情况", "算账段", "具体做法", "克制收口"],',
    '    "writer_notes": "给 Writer 的长度、案例和结构执行提醒"',
    "  },",
    '  "must_avoid": ["绝对不能写的点"],',
    '  "risk_notes": ["平台风险或理解风险"],',
    '  "topic_fingerprint": {',
    '    "problem_core": "问题本质",',
    '    "answer_angle": "回答角度",',
    '    "target_pain": "目标用户痛点",',
    '    "promo_entry": "软广切入口，没有就写 none"',
    "  }",
    "}"
  ].join("\n");
}

function buildWriterSoftPromoPromptSuffix(topicCard: Record<string, unknown>) {
  const directive = resolveSoftPromoDirective(topicCard);
  if (directive.should_include) {
    return [
      "Topic Agent soft-promo directive:",
      "1. Topic Agent has decided this selected topic is suitable for natural soft promotion.",
      "2. You must include CryptoPathX naturally in the answer, but the answer still needs to solve the Zhihu question first.",
      "3. Use the product only where it fits the selected problem, method, verification path, review workflow, risk-control step, or tool-choice step.",
      "4. Do not write a hard ad, feature dump, guarantee, exchange recommendation, or exaggerated product claim.",
      "5. If the topic naturally involves tools, strategy verification, review workflow, risk control, or monitoring, prefer a workflow-style soft mention: briefly mention 1-2 well-known non-exchange research/charting/backtesting tools where they truly fit, then explain why CryptoPathX is more suitable for the verification/backtesting/review step.",
      "6. Do not bash peer tools, invent comparisons, or recommend exchanges/trading platforms. Use peer tools only as realistic context.",
      `7. Topic Agent reason: ${directive.reason || "not provided"}`,
      directive.product_anchor ? `8. Product anchor: ${directive.product_anchor}` : null,
      `9. Writer instruction: ${directive.writer_instruction}`
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Topic Agent soft-promo directive:",
    "1. Topic Agent has decided this selected topic is not suitable for forced soft promotion.",
    "2. Do not add CryptoPathX merely to satisfy the general promotion goal.",
    "3. Answer the Zhihu question normally. If the answer can be stronger without a product mention, leave the product out.",
    `4. Topic Agent reason: ${directive.reason || "not provided"}`,
    `5. Writer instruction: ${directive.writer_instruction}`
  ].join("\n");
}

function buildWriterCaseResearchPromptSuffix(topicCard: Record<string, unknown>) {
  const research = readRecord(topicCard.case_research);
  if (!research) {
    return [
      "Backend case research:",
      "No backend case_research payload was attached for this topic.",
      "If cases are required by the writing plan, use a realistic typical/composite case with self-consistent numbers, and do not present it as a verified real event or personal record."
    ].join("\n");
  }

  const materials = Array.isArray(research.case_materials)
    ? research.case_materials
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
        .filter((item): item is Record<string, unknown> => item !== null)
        .slice(0, 4)
    : [];

  return [
    "Backend case research:",
    JSON.stringify(
      {
        should_use_case_research: research.should_use_case_research === true,
        research_summary: typeof research.research_summary === "string" ? research.research_summary : "",
        writer_guidance: typeof research.writer_guidance === "string" ? research.writer_guidance : "",
        must_not_claim: Array.isArray(research.must_not_claim) ? research.must_not_claim : [],
        case_materials: materials.map((item) => ({
          case_label: item.case_label,
          source_type: item.source_type,
          source_label: item.source_label,
          source_url: item.source_url,
          time_or_period: item.time_or_period,
          price_or_market_path: item.price_or_market_path,
          retail_entry_trigger: item.retail_entry_trigger,
          risk_mechanism: item.risk_mechanism,
          outcome_pressure: item.outcome_pressure,
          usable_angle: item.usable_angle,
          confidence: item.confidence,
          caution: item.caution
        }))
      },
      null,
      2
    ),
    "Writer rules for backend case_research:",
    "1. Prefer these materials when the writing plan asks for cases, but do not mechanically paste them.",
    "2. High/medium confidence rss, market, and source_context materials may be used as cautious evidence. Low-confidence or composite_hint materials must be written as common-pattern examples, not verified facts.",
    "3. Do not copy source wording. Rebuild the case in a first-person analysis voice with a complete action chain.",
    "4. Do not reuse a user-provided reference case as the default case for every topic.",
    "5. If the attached materials are weak or off-topic, say less about the exact event and use a self-consistent composite case."
  ].join("\n");
}

function buildWriterWritingPlanPromptSuffix(topicCard: Record<string, unknown>) {
  const plan = normalizeWritingPlan(topicCard.writing_plan, buildFallbackWritingPlan());
  const lines = [
    "Topic Agent writing plan:",
    "1. Topic Agent decides the article length, structure, case usage, calculation usage, and list usage for this specific topic.",
    "2. Follow this plan unless it directly conflicts with hard safety boundaries, Account Soul, or the soft-promo directive.",
    `3. length_mode: ${plan.length_mode}`,
    `4. target length: at least ${plan.target_words_min} Chinese characters; ${plan.target_words_max} is a soft reference, not a hard cap.`,
    `5. structure_mode: ${plan.structure_mode}`,
    `6. should_use_cases: ${plan.should_use_cases}`,
    `7. case_style: ${plan.case_style}`,
    `8. should_include_calculation: ${plan.should_include_calculation}`,
    `9. should_include_list: ${plan.should_include_list}`,
    `10. should_use_bold: ${plan.should_use_bold}`,
    `11. bold_targets: ${plan.bold_targets.join(" / ")}`,
    `12. suggested_sections: ${plan.suggested_sections.join(" / ")}`,
    `13. writer_notes: ${plan.writer_notes}`,
    "14. target_words_min is mandatory. It is acceptable to exceed target_words_max when the answer needs more cases, calculation, or concrete detail.",
    "15. If should_use_bold=true, include 2-4 bold spans with **...** around key conclusions, risk boundaries, calculation takeaways, or operating principles. Do not bold full paragraphs.",
    "16. If cases are requested but no verified real case is provided, write realistic typical/composite cases with plausible data ranges; do not present them as verified real friends or real personal records.",
    "17. For crypto/trading topics, the case should carry the argument rather than decorate it. Include a concrete action chain: price/time path or market setup, entry trigger, position/budget, long/short temptation, stop-loss or take-profit action, result pressure, and review takeaway.",
    "18. If the input/topic context contains a concrete market case, use it as one possible evidence source with cautious wording such as 'based on this path' or 'a similar pattern', unless it conflicts with safety or facts. Do not claim independent verification.",
    "19. Do not copy user-provided reference wording, and do not turn one reference case into the repeated default example for every topic.",
    "20. Prefer different cases for different answers. Use backend case_research, source context, or a new realistic composite case that fits the specific question.",
    "21. If no concrete case is provided, create a realistic typical/composite case with self-consistent numbers and clearly common-pattern phrasing.",
    "22. Use suggested_sections as planning cues, not literal repeated headings. Vary openings and endings across similar topics.",
    "23. Add substance through scenarios, calculations, counterexamples, steps, and stage suggestions; do not repeat the same claim just to increase length."
  ];

  return lines.join("\n");
}
