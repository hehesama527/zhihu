import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { LlmService } from "./llm-service.js";

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
};

export type ReviewResult = {
  decision: "PASS" | "REVISE" | "BLOCK" | "BLOCK_DUPLICATION";
  hardGate: ReviewStageResult;
  editorial: ReviewStageResult;
  publish: ReviewStageResult;
  reviewSummary: string;
  approvedContent: string | null;
};

export type CombinedReviewOutput = {
  hardGate?: Partial<ReviewStageResult> | null;
  editorial?: Partial<ReviewStageResult> | null;
  publish?: Partial<ReviewStageResult> | null;
};

export class ReviewService {
  constructor(private readonly llmService: LlmService) {}

  async reviewContent(
    input: {
      content: string;
      topicSummary: string;
      pastContentFingerprints: unknown[];
    },
    promptSnapshot?: PromptSnapshotMap | null,
    hooks?: {
      onStage?: (stage: "review_hard_gate" | "review_editorial" | "review_publish") => Promise<void> | void;
    }
  ): Promise<ReviewResult> {
    const startedAt = Date.now();
    logDebugTiming("review.reviewContent", "start", {
      contentLength: input.content.length,
      pastContentFingerprints: input.pastContentFingerprints.length
    });
    await hooks?.onStage?.("review_hard_gate");

    const reviewPrompt = await this.llmService.resolvePrompt("review_agent", {
      promptSnapshot
    });

    const combined = await this.llmService.runJsonWithSystemPrompt<CombinedReviewOutput>(
      buildCombinedReviewPrompt(reviewPrompt),
      input,
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
        reviewSummary: hardGate.reason ?? "Hard gate blocked the draft.",
        approvedContent: null
      };
    }

    const finalDecision: ReviewResult["decision"] =
      publish.decision === "BLOCK_DUPLICATION"
        ? "BLOCK_DUPLICATION"
        : editorial.decision === "REVISE" || publish.decision === "REVISE"
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
      reviewSummary: publish.review_summary ?? editorial.rewrite_brief ?? hardGate.reason ?? "",
      approvedContent: finalDecision === "PASS" ? publish.approved_content ?? input.content : null
    };
  }
}

function buildCombinedReviewPrompt(reviewPrompt: string) {
  return `${reviewPrompt}

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
    "rewrite_brief": "clear rewrite instructions"
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
    rewrite_brief: typeof value?.rewrite_brief === "string" ? value.rewrite_brief : ""
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
