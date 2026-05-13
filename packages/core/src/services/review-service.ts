import type {
  ContentQualityDimension,
  ContentQualityDimensionScore,
  ContentQualityScore,
  ManualReviewReason,
  PromptSnapshotMap
} from "@zhihu-mvp/shared";
import {
  buildReviewSoulPromptSuffix,
  buildReviewTargetProductPromptSuffix,
  joinPromptSuffixes
} from "./account-prompt-context.js";
import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { LlmService } from "./llm-service.js";
import { type ZhihuAgentContextDocuments, ZhihuAgentContextService } from "./zhihu-agent-context-service.js";

export type ReviewStageResult = {
  decision: "PASS" | "REVISE" | "BLOCK" | "BLOCK_DUPLICATION";
  issues: string[];
  reason?: string;
  score?: number;
  strengths?: string[];
  rewrite_brief?: string;
  publish_ready?: boolean;
  duplicate_reason?: string;
  matched_past_contents?: string[];
  review_summary?: string;
  approved_content?: string;
  quality?: Partial<ContentQualityScore> | null;
};

export type ReviewResult = {
  decision: "PASS" | "REVISE" | "BLOCK" | "BLOCK_DUPLICATION";
  hardGate: ReviewStageResult;
  editorial: ReviewStageResult;
  publish: ReviewStageResult;
  quality: ContentQualityScore;
  reviewSummary: string;
  approvedContent: string | null;
};

export type CombinedReviewOutput = {
  hardGate?: Partial<ReviewStageResult> | null;
  editorial?: Partial<ReviewStageResult> | null;
  publish?: Partial<ReviewStageResult> | null;
};

export class ReviewService {
  private readonly agentContextService = new ZhihuAgentContextService();

  constructor(private readonly llmService: LlmService) {}

  async reviewContent(
    input: {
      content: string;
      topicSummary: string;
      topicCard?: Record<string, unknown> | null;
      softPromoDirective?: Record<string, unknown> | null;
      pastContentFingerprints: unknown[];
    },
    promptSnapshot?: PromptSnapshotMap | null,
    hooks?: {
      accountSoulMarkdown?: string | null;
      agentContextDocuments?: ZhihuAgentContextDocuments | null;
      onStage?: (stage: "review_hard_gate" | "review_editorial" | "review_publish") => Promise<void> | void;
    }
  ): Promise<ReviewResult> {
    const startedAt = Date.now();
    logDebugTiming("review.reviewContent", "start", {
      contentLength: input.content.length,
      pastContentFingerprints: input.pastContentFingerprints.length
    });
    await hooks?.onStage?.("review_hard_gate");
    const softPromoDirective = resolveSoftPromoDirective(input.softPromoDirective ?? input.topicCard ?? null);

    const reviewPrompt = await this.llmService.resolvePrompt("review_agent", {
      promptSnapshot
    });
    const agentContextDocuments =
      hooks?.agentContextDocuments ?? (await this.agentContextService.ensureDocuments());

    const combined = await this.llmService.runJsonWithSystemPrompt<CombinedReviewOutput>(
      buildCombinedReviewPrompt(
        reviewPrompt,
        hooks?.accountSoulMarkdown,
        softPromoDirective,
        agentContextDocuments,
        input.topicCard && typeof input.topicCard === "object"
          ? (input.topicCard as Record<string, unknown>).writing_plan
          : null,
        input.topicCard && typeof input.topicCard === "object"
          ? (input.topicCard as Record<string, unknown>).case_research
          : null
      ),
      {
        ...input,
        softPromoDirective
      },
      {
        hardGate: buildHardGateFallback(),
        editorial: buildEditorialFallback(),
        publish: buildPublishFallback(input.content)
      }
    );

    await hooks?.onStage?.("review_editorial");
    await hooks?.onStage?.("review_publish");

    const hardGate = normalizeHardGate(combined.hardGate);
    const editorial = normalizeEditorial(combined.editorial);
    const publish = normalizePublish(combined.publish, input.content);
    const quality = normalizeContentQuality(editorial.quality, editorial, publish);

    if (hardGate.decision === "BLOCK") {
      logDebugTiming("review.reviewContent", "hard_block", {
        elapsedMs: getElapsedMs(startedAt),
        reason: hardGate.reason ?? "Hard gate blocked the draft."
      });
      return {
        decision: "BLOCK",
        hardGate,
        editorial,
        publish,
        quality,
        reviewSummary: hardGate.reason ?? "Hard gate blocked the draft.",
        approvedContent: null
      };
    }

    const finalDecision: ReviewResult["decision"] =
      publish.decision === "BLOCK_DUPLICATION"
        ? "BLOCK_DUPLICATION"
        : editorial.decision === "REVISE" || publish.decision === "REVISE" || quality.manualReviewReasons.length > 0
          ? "REVISE"
          : "PASS";

    logDebugTiming("review.reviewContent", "done", {
      elapsedMs: getElapsedMs(startedAt),
      decision: finalDecision
    });

    return {
      decision: finalDecision,
      hardGate,
      editorial,
      publish,
      quality,
      reviewSummary: publish.review_summary ?? quality.rewriteBrief ?? editorial.rewrite_brief ?? hardGate.reason ?? "",
      approvedContent: finalDecision === "PASS" ? publish.approved_content ?? input.content : null
    };
  }
}

function buildCombinedReviewPrompt(
  reviewPrompt: string,
  accountSoulMarkdown?: string | null,
  softPromoDirective?: SoftPromoReviewDirective,
  agentContextDocuments?: ZhihuAgentContextDocuments | null,
  writingPlan?: unknown,
  caseResearch?: unknown
) {
  return `${joinPromptSuffixes(
    reviewPrompt,
    buildReviewTargetProductPromptSuffix(agentContextDocuments),
    buildReviewSoulPromptSuffix(accountSoulMarkdown),
    buildReviewWritingPlanPromptSuffix(writingPlan),
    buildReviewCaseResearchPromptSuffix(caseResearch),
    buildReviewSoftPromoPromptSuffix(softPromoDirective)
  )}

Additional instructions:
You are running a combined pre-publish review and must return exactly three sections:
1. hardGate
2. editorial
3. publish

Required output contract:
1. hardGate.decision must be PASS or BLOCK.
2. editorial.decision must be PASS or REVISE.
3. publish.decision must be PASS, REVISE, or BLOCK_DUPLICATION.
4. Only when publish.decision = PASS may publish.approved_content contain the final publishable article.
5. If a section has no issues, return an empty issues array.
6. Do not return a fourth top-level final decision. Return only the three section objects.
7. Return JSON only. No markdown. No explanation outside JSON.
8. editorial.quality must score whether the answer feels native to Zhihu, account-specific, concrete, evidenced, restrained, and low-AI-smell.

${buildAiAuthenticityReviewPromptSuffix()}

Duplication review must be intentionally relaxed.
The goal is not to force every article to sound like it was written by a completely different person.
The real goal is only to prevent the new article from feeling like a copy-paste rewrite of a recent article.

When checking duplication against the last 10 published articles:
1. Shared persona, shared product, shared audience, shared product features, and shared brand voice are normal. Do not treat them as duplication by themselves.
2. Similar product mentions, similar soft-promo logic, similar risk reminders, or one repeated metaphor are not enough for BLOCK_DUPLICATION.
3. If the article still gives fresh value, a new framing, a different problem entry, a meaningfully different argument path, or a different practical takeaway, prefer PASS.
4. If the article is useful but some paragraphs feel too close to past content, prefer REVISE instead of BLOCK_DUPLICATION.
5. Only use BLOCK_DUPLICATION when the overall reading experience strongly feels like the same article rewritten:
   same opening angle,
   same core argument path,
   same case structure,
   same practical advice sequence,
   and same closing push,
   such that a normal reader would likely feel it is basically a recycled answer.
6. Do not block duplication merely because both articles promote the same product in a similar way.

Output schema:
{
  "hardGate": {
    "decision": "PASS | BLOCK",
    "issues": ["issue 1"],
    "reason": "one-sentence reason"
  },
  "editorial": {
    "decision": "PASS | REVISE",
    "issues": ["issue 1"],
    "score": 0,
    "strengths": ["strength 1"],
    "rewrite_brief": "clear rewrite instructions",
    "quality": {
      "overallScore": 78,
      "passingScore": 72,
      "dimensions": {
        "account_fit": { "score": 80, "issues": [], "suggestion": "" },
        "zhihu_native": { "score": 80, "issues": [], "suggestion": "" },
        "experience_realness": { "score": 80, "issues": [], "suggestion": "" },
        "evidence_density": { "score": 80, "issues": [], "suggestion": "" },
        "structure_naturalness": { "score": 80, "issues": [], "suggestion": "" },
        "ai_smell": { "score": 80, "issues": [], "suggestion": "" },
        "promotion_restraint": { "score": 80, "issues": [], "suggestion": "" },
        "freshness": { "score": 80, "issues": [], "suggestion": "" }
      },
      "strengths": ["strength 1"],
      "issues": ["issue 1"],
      "rewriteBrief": "clear rewrite instructions",
      "manualReviewReasons": []
    }
  },
  "publish": {
    "decision": "PASS | REVISE | BLOCK_DUPLICATION",
    "issues": ["issue 1"],
    "publish_ready": true,
    "duplicate_reason": "",
    "matched_past_contents": [],
    "review_summary": "short summary",
    "approved_content": "final publishable article"
  }
}`;
}

function buildAiAuthenticityReviewPromptSuffix() {
  return USE_COMBINED_REVIEW_AI_AUTHENTICITY_PROMPT_ROLLBACK
    ? COMBINED_REVIEW_AI_AUTHENTICITY_PROMPT_ROLLBACK
    : COMBINED_REVIEW_AI_AUTHENTICITY_PROMPT_V1;
}

const USE_COMBINED_REVIEW_AI_AUTHENTICITY_PROMPT_ROLLBACK = false;
const COMBINED_REVIEW_AI_AUTHENTICITY_PROMPT_ROLLBACK = "";

const COMBINED_REVIEW_AI_AUTHENTICITY_PROMPT_V1 = `AI-authenticity review:
This is a prompt-only review signal inside Review Agent. It is not a separate approval gate.
Judge whether the draft reads like AI-generated content or AI-humanized content. Do not claim authorship certainty; judge only reader-facing risk.

Check these signals:
1. Over-complete, over-smooth argument structure.
2. Template openings, universal conclusions, or standard three-part progression.
3. Personal-experience wording without concrete scene support, such as vague "I used to..." or "from my experience..." claims.
4. Dense numbers, cases, or judgments with unclear source boundaries.
5. Cases that feel too perfectly constructed instead of naturally observed or clearly marked as composite.
6. Product insertion that is too smooth, too planned, or reads like a soft-ad bridge rather than a workflow step.
7. Paragraph rhythm that is too stable, where every paragraph follows claim + explanation + summary.
8. Deliberately strong opinions, deliberately colloquial lines, or "veteran trader" voice that feels staged.
9. Polished golden-line endings, slogan-like elevation, or over-neat closure.
10. Generic AI filler such as "therefore / meanwhile / overall", vague authority attribution, excessive abstract nouns, and unnecessary three-item lists.
11. Repeatedly using the same voice pattern across long answers, especially when every paragraph stays equally polished and equally complete.
12. Using a pseudo-experienced tone without one or two grounded, imperfect details that a real person would usually leave in.

Scoring rubric for editorial.quality.dimensions.ai_smell.score:
85-100: Almost no obvious AI-writing risk.
70-84: Light AI smell; publishable if other review dimensions pass.
55-69: Moderate AI smell; give local rewrite suggestions and make the suspicious passages explicit.
40-54: Obvious AI smell; request REVISE and identify the sections that should be rewritten.
0-39: Highly templated or synthetic; do not publish without major rewrite.

Sensitivity rule:
1. If the draft shows 3 or more concrete AI-smell signals from the list above, do not keep ai_smell above 69.
2. If the draft shows 5 or more signals, or one very strong staged-persona signal, score ai_smell below 55 unless there is very strong grounded detail that clearly outweighs the pattern.
3. A polished long answer is not automatically AI-written, but if the polish stays uniform across most paragraphs and there are no rough edges, do not be conservative with the score.

Output requirements for AI-smell feedback:
1. Put concrete findings in editorial.quality.dimensions.ai_smell.issues.
2. Put executable rewrite direction in editorial.quality.dimensions.ai_smell.suggestion.
3. If AI smell contributes to revision, include the same concrete evidence in editorial.rewrite_brief and editorial.quality.rewriteBrief so Writer can revise through the existing Review -> Writer loop.
4. Quote or summarize the suspicious original phrase or paragraph. Do not write vague feedback such as "make it more natural".
5. If evidence is weak, keep ai_smell.score >= 70 and do not force REVISE only for AI smell.
6. Only score below 55 when there are multiple concrete signals or one severe signal that would make a normal Zhihu reader feel the answer is synthetic.
7. If the article is structurally strong but still feels over-polished, point to the exact paragraphs that read most staged instead of giving a generic global comment.

Example feedback style:
1. "以前我也这样，后来学着做回测" uses personal-experience voice but has no specific scene or action detail, so it feels like humanized-template writing. Ask Writer to either add a concrete operation detail or change it to a general reader observation.
2. "CryptoPathX" appears in consecutive paragraphs and the transition is too smooth, making the product mention feel pre-planned. Ask Writer to keep one product mention and turn the other into "visual backtesting tool" or a concrete workflow step.
3. The closing sentence is too polished and slogan-like. Ask Writer to end with a restrained action boundary or a specific risk reminder.`;

type SoftPromoReviewDirective = {
  shouldInclude: boolean;
  mode: string;
  reason: string;
  productAnchor: string;
  writerInstruction: string;
};

function resolveSoftPromoDirective(value: unknown): SoftPromoReviewDirective {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const nested =
    record.soft_promo_directive && typeof record.soft_promo_directive === "object"
      ? (record.soft_promo_directive as Record<string, unknown>)
      : record;
  const rawMode =
    nested.mode === "light" || nested.mode === "natural" || nested.mode === "none"
      ? nested.mode
      : record.soft_promo_mode === "light" || record.soft_promo_mode === "natural" || record.soft_promo_mode === "none"
        ? String(record.soft_promo_mode)
        : "none";
  const shouldInclude =
    typeof nested.should_include === "boolean"
      ? nested.should_include
      : typeof record.should_include_soft_promo === "boolean"
        ? record.should_include_soft_promo
        : rawMode === "light" || rawMode === "natural";
  const topicFingerprint =
    record.topic_fingerprint && typeof record.topic_fingerprint === "object"
      ? (record.topic_fingerprint as Record<string, unknown>)
      : {};

  return {
    shouldInclude,
    mode: shouldInclude ? (rawMode === "none" ? "light" : rawMode) : "none",
    reason: pickNonEmptyString(nested.reason, record.soft_promo_reason),
    productAnchor: shouldInclude ? pickNonEmptyString(nested.product_anchor, topicFingerprint.promo_entry) : "",
    writerInstruction: pickNonEmptyString(nested.writer_instruction)
  };
}

function buildReviewSoftPromoPromptSuffix(directive?: SoftPromoReviewDirective) {
  const resolved = directive ?? resolveSoftPromoDirective(null);
  if (resolved.shouldInclude) {
    return [
      "Soft-promo review rule:",
      "1. Topic Agent is the source of truth for whether this selected topic requires a soft promotion.",
      "2. Topic Agent marked include_soft_promo=true, so check whether the draft naturally includes CryptoPathX in a concrete, non-exaggerated way.",
      "3. If CryptoPathX is completely absent, editorial.decision should usually be REVISE with a concise rewrite_brief asking Writer to add it naturally at the selected product anchor.",
      "4. If CryptoPathX appears but reads like a hard ad, feature dump, guarantee, exchange recommendation, or unrelated insertion, ask for revision.",
      `5. Topic Agent reason: ${resolved.reason || "not provided"}`,
      resolved.productAnchor ? `6. Product anchor: ${resolved.productAnchor}` : null,
      resolved.writerInstruction ? `7. Writer instruction: ${resolved.writerInstruction}` : null
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Soft-promo review rule:",
    "1. Topic Agent is the source of truth for whether this selected topic requires a soft promotion.",
    "2. Topic Agent marked include_soft_promo=false, so do not request revision merely because CryptoPathX is absent.",
    "3. For this topic, absence of product mention is acceptable when the answer is otherwise useful and on-topic.",
    "4. If the draft adds CryptoPathX despite include_soft_promo=false, only flag it when the mention is unnatural, risky, exaggerated, or distracts from the answer.",
    `5. Topic Agent reason: ${resolved.reason || "not provided"}`,
    resolved.writerInstruction ? `6. Writer instruction: ${resolved.writerInstruction}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function buildReviewCaseResearchPromptSuffix(caseResearch?: unknown) {
  const record = caseResearch && typeof caseResearch === "object" ? (caseResearch as Record<string, unknown>) : null;
  if (!record) {
    return "";
  }

  const materials = Array.isArray(record.case_materials)
    ? record.case_materials
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
        .filter((item): item is Record<string, unknown> => item !== null)
        .slice(0, 4)
    : [];

  return [
    "Backend case_research review rule:",
    `1. should_use_case_research: ${record.should_use_case_research === true}`,
    typeof record.research_summary === "string" && record.research_summary.trim()
      ? `2. research_summary: ${record.research_summary.trim()}`
      : null,
    materials.length
      ? `3. case_materials: ${JSON.stringify(
          materials.map((item) => ({
            case_label: item.case_label,
            source_type: item.source_type,
            source_label: item.source_label,
            time_or_period: item.time_or_period,
            price_or_market_path: item.price_or_market_path,
            retail_entry_trigger: item.retail_entry_trigger,
            risk_mechanism: item.risk_mechanism,
            outcome_pressure: item.outcome_pressure,
            confidence: item.confidence,
            caution: item.caution
          }))
        )}`
      : "3. case_materials: []",
    "4. If writing_plan asks for cases and useful backend case_research exists, revise a draft that ignores it and stays generic without a safety reason.",
    "5. If a case material is low-confidence or source_type=composite_hint, Writer must not state it as a verified real event, real friend story, or exact personal record.",
    "6. Do not require source links in the final answer; judge whether the article uses the material cautiously and concretely.",
    "7. If the draft copies source/reference wording or repeats one old user-provided case while backend case_research has other usable material, ask for revision."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildReviewWritingPlanPromptSuffix(value: unknown) {
  const plan = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!plan) {
    return null;
  }

  const lengthMode = typeof plan.length_mode === "string" ? plan.length_mode : "standard";
  const targetMin = Number.isFinite(Number(plan.target_words_min)) ? Number(plan.target_words_min) : 0;
  const targetMax = Number.isFinite(Number(plan.target_words_max)) ? Number(plan.target_words_max) : 0;
  const structureMode = typeof plan.structure_mode === "string" ? plan.structure_mode : "";
  const shouldUseCases = plan.should_use_cases === true;
  const caseStyle = typeof plan.case_style === "string" ? plan.case_style : "none";
  const shouldIncludeCalculation = plan.should_include_calculation === true;
  const shouldIncludeList = plan.should_include_list === true;
  const shouldUseBold = plan.should_use_bold === true;
  const boldTargets = Array.isArray(plan.bold_targets)
    ? plan.bold_targets.map((item) => String(item)).filter(Boolean)
    : [];
  const suggestedSections = Array.isArray(plan.suggested_sections)
    ? plan.suggested_sections.map((item) => String(item)).filter(Boolean)
    : [];
  const writerNotes = typeof plan.writer_notes === "string" ? plan.writer_notes : "";

  return [
    "Topic Agent writing-plan review rule:",
    "1. Topic Agent is allowed to decide this article's target length, structure, case usage, calculation usage, and list usage.",
    "2. Review whether the draft substantially follows writing_plan, but do not demand mechanical section copying.",
    `3. length_mode: ${lengthMode}`,
    targetMin || targetMax
      ? `4. target length: at least ${targetMin || "unknown"} Chinese characters; ${targetMax || "unknown"} is a soft reference, not a hard cap.`
      : null,
    structureMode ? `5. structure_mode: ${structureMode}` : null,
    `6. should_use_cases: ${shouldUseCases}`,
    `7. case_style: ${caseStyle}`,
    `8. should_include_calculation: ${shouldIncludeCalculation}`,
    `9. should_include_list: ${shouldIncludeList}`,
    `10. should_use_bold: ${shouldUseBold}`,
    boldTargets.length ? `11. bold_targets: ${boldTargets.join(" / ")}` : null,
    suggestedSections.length ? `12. suggested_sections: ${suggestedSections.join(" / ")}` : null,
    writerNotes ? `13. writer_notes: ${writerNotes}` : null,
    "12. target_words_min is a hard lower bound. If the draft is below target_words_min, editorial.decision should be REVISE unless the writing_plan is clearly unsafe or impossible.",
    "13. target_words_max is only a soft reference. Do not ask Writer to shorten a useful answer merely because it exceeds target_words_max.",
    "14. If cases are requested, prefer realistic typical/composite cases with plausible and self-consistent data. Do not require fabricated real friends, real profit records, or unverifiable personal data.",
    "14a. If should_use_cases=true, a case is under-developed when it only says abstract ideas like liquidity, chips, drawdown, or psychology without a concrete action chain.",
    "14b. A publishable trading/crypto case should include most of these: time/price path or market setup, why the retail trader enters, position or budget, long/short temptation, stop-loss/take-profit action, emotional deformation, outcome pressure, and review takeaway.",
    "14c. If topic/user/source context supplied a concrete case and the draft ignores it without a safety reason, ask for revision.",
    "14d. User-provided examples are style/quality references, not reusable copy. If the draft copies reference wording or keeps reusing the same token/story arc across different topics when other cases are available, ask for revision.",
    "15. If requested cases/calculation/list are missing or under-developed, ask for revision even if the answer is otherwise readable.",
    "16. If should_use_bold=true and the draft has no meaningful **bold** emphasis on key conclusions/risk/calculation/principles, ask for revision.",
    "17. Flag repeated formulaic openings/endings such as always using '先说结论' and '最后补一句' when they make the article feel templated."
  ]
    .filter(Boolean)
    .join("\n");
}

function pickNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function buildHardGateFallback(): ReviewStageResult {
  return {
    decision: "PASS",
    issues: [],
    reason: ""
  };
}

function buildEditorialFallback(): ReviewStageResult {
  return {
    decision: "PASS",
    issues: [],
    score: 22,
    strengths: [],
    rewrite_brief: ""
  };
}

function buildPublishFallback(content: string): ReviewStageResult {
  return {
    decision: "PASS",
    issues: [],
    publish_ready: true,
    duplicate_reason: "",
    matched_past_contents: [],
    review_summary: "",
    approved_content: content
  };
}

function normalizeHardGate(value: Partial<ReviewStageResult> | null | undefined): ReviewStageResult {
  return {
    ...buildHardGateFallback(),
    ...(value ?? {}),
    decision: value?.decision === "BLOCK" ? "BLOCK" : "PASS",
    issues: normalizeStringArray(value?.issues),
    reason: typeof value?.reason === "string" ? value.reason : ""
  };
}

function normalizeEditorial(value: Partial<ReviewStageResult> | null | undefined): ReviewStageResult {
  return {
    ...buildEditorialFallback(),
    ...(value ?? {}),
    decision: value?.decision === "REVISE" ? "REVISE" : "PASS",
    issues: normalizeStringArray(value?.issues),
    score: normalizeScore(value?.score, 22),
    strengths: normalizeStringArray(value?.strengths),
    rewrite_brief: typeof value?.rewrite_brief === "string" ? value.rewrite_brief : "",
    quality: value?.quality ?? null
  };
}

function normalizePublish(value: Partial<ReviewStageResult> | null | undefined, content: string): ReviewStageResult {
  const normalizedDecision: ReviewStageResult["decision"] =
    value?.decision === "BLOCK_DUPLICATION" || value?.decision === "REVISE" ? value.decision : "PASS";

  const approvedContent =
    normalizedDecision === "PASS" && typeof value?.approved_content === "string" && value.approved_content.trim()
      ? value.approved_content
      : normalizedDecision === "PASS"
        ? content
        : "";

  return {
    ...buildPublishFallback(content),
    ...(value ?? {}),
    decision: normalizedDecision,
    issues: normalizeStringArray(value?.issues),
    publish_ready: typeof value?.publish_ready === "boolean" ? value.publish_ready : normalizedDecision === "PASS",
    duplicate_reason: typeof value?.duplicate_reason === "string" ? value.duplicate_reason : "",
    matched_past_contents: normalizeStringArray(value?.matched_past_contents),
    review_summary: typeof value?.review_summary === "string" ? value.review_summary : "",
    approved_content: approvedContent
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeScore(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeContentQuality(
  value: Partial<ContentQualityScore> | null | undefined,
  editorial: ReviewStageResult,
  publish: ReviewStageResult
): ContentQualityScore {
  const dimensions = normalizeQualityDimensions(value?.dimensions);
  const overallScore = normalizeScore(value?.overallScore, normalizeScore(editorial.score, 72));
  const passingScore = normalizeScore(value?.passingScore, 72);
  const issues = dedupeStringArray([
    ...normalizeStringArray(value?.issues),
    ...normalizeStringArray(editorial.issues),
    ...normalizeStringArray(publish.issues)
  ]);
  const manualReviewReasons = normalizeManualReviewReasons(value?.manualReviewReasons);

  if (overallScore < passingScore) {
    manualReviewReasons.push("low_quality_score");
  }
  if ((dimensions.ai_smell?.score ?? 100) < 55) {
    manualReviewReasons.push("high_ai_smell");
  }
  if ((dimensions.promotion_restraint?.score ?? 100) < 55) {
    manualReviewReasons.push("promotion_risk");
  }
  if ((dimensions.account_fit?.score ?? 100) < 55) {
    manualReviewReasons.push("account_mismatch");
  }
  if ((dimensions.evidence_density?.score ?? 100) < 50) {
    manualReviewReasons.push("weak_evidence");
  }

  return {
    overallScore,
    passingScore,
    dimensions,
    strengths: dedupeStringArray([...normalizeStringArray(value?.strengths), ...normalizeStringArray(editorial.strengths)]),
    issues,
    rewriteBrief:
      typeof value?.rewriteBrief === "string" && value.rewriteBrief.trim()
        ? value.rewriteBrief.trim()
        : editorial.rewrite_brief ?? publish.review_summary ?? "",
    manualReviewReasons: dedupeManualReviewReasons(manualReviewReasons)
  };
}

function normalizeQualityDimensions(value: unknown): Partial<Record<ContentQualityDimension, ContentQualityDimensionScore>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Partial<Record<ContentQualityDimension, Partial<ContentQualityDimensionScore>>>;
  const result: Partial<Record<ContentQualityDimension, ContentQualityDimensionScore>> = {};
  for (const key of QUALITY_DIMENSIONS) {
    const dimension = record[key];
    if (!dimension || typeof dimension !== "object") {
      continue;
    }
    result[key] = {
      score: normalizeScore(dimension.score, 72),
      issues: normalizeStringArray(dimension.issues),
      suggestion: typeof dimension.suggestion === "string" ? dimension.suggestion : ""
    };
  }
  return result;
}

function normalizeManualReviewReasons(value: unknown): ManualReviewReason[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ManualReviewReason => MANUAL_REVIEW_REASONS.includes(item as ManualReviewReason));
}

function dedupeStringArray(value: string[]) {
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function dedupeManualReviewReasons(value: ManualReviewReason[]) {
  return [...new Set(value)];
}

const QUALITY_DIMENSIONS: ContentQualityDimension[] = [
  "account_fit",
  "zhihu_native",
  "experience_realness",
  "evidence_density",
  "structure_naturalness",
  "ai_smell",
  "promotion_restraint",
  "freshness"
];

const MANUAL_REVIEW_REASONS: ManualReviewReason[] = [
  "low_quality_score",
  "account_mismatch",
  "high_ai_smell",
  "promotion_risk",
  "weak_evidence",
  "rewrite_limit_reached"
];
