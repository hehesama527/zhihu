import type {
  ZhihuAccountLibraryExampleRecord,
  ZhihuAccountLibraryPromptContext
} from "../repositories/zhihu-account-library-repository.js";
import type { ZhihuAgentContextDocuments } from "./zhihu-agent-context-service.js";

export type AccountPromptContext = {
  accountId: number;
  accountName: string;
  zhihuUserName: string | null;
};

export function buildTopicTargetProductPromptSuffix(context?: ZhihuAgentContextDocuments | null) {
  return buildTargetProductPromptSuffix("topic", context);
}

export function buildWriterTargetProductPromptSuffix(context?: ZhihuAgentContextDocuments | null) {
  return buildTargetProductPromptSuffix("writer", context);
}

export function buildReviewTargetProductPromptSuffix(context?: ZhihuAgentContextDocuments | null) {
  return buildTargetProductPromptSuffix("review", context);
}

export function buildTopicPromptSuffix(accountContext?: AccountPromptContext | null) {
  const personaName = accountContext?.accountName?.trim();
  if (!personaName) {
    return null;
  }

  const lines = [
    "Runtime account context:",
    `1. The current target account/persona name is "${personaName}". If the base prompt mentions a default persona name such as "二牛", override it with this account.`,
    "2. Topic discovery, topic ranking, topic de-duplication and angle selection must all be judged from this specific account's persona, observations and likely experience range.",
    "3. Keep the overall business goal unchanged: all accounts still serve the same promotion goal, but different accounts do not need to converge to the same topic angle.",
    "4. During the current matrix testing phase, keep the differentiation lightweight and realistic. Make the topic feel suitable for this account instead of forcing exaggerated role-play."
  ];

  if (accountContext?.zhihuUserName?.trim()) {
    lines.push(
      `5. The linked Zhihu username is "${accountContext.zhihuUserName.trim()}". You may use it as tone reference when helpful, but do not force it into the final answer.`
    );
  }

  return lines.join("\n");
}

export function buildTopicSoulPromptSuffix(accountSoulMarkdown?: string | null) {
  const markdown = accountSoulMarkdown?.trim();
  if (!markdown) {
    return [
      "Account Soul topic-selection rule:",
      "1. accountSoulMarkdown is currently empty. Judge account fit from the runtime account name and linked Zhihu username only.",
      "2. If a later payload provides accountSoulMarkdown, Topic Agent must use it as the account positioning, reader-fit, voice-boundary and product-mention policy layer."
    ].join("\n");
  }

  return [
    "Account Soul topic-selection rule:",
    "1. accountSoulMarkdown is the stable identity, reader-fit, worldview and product-mention policy for this Zhihu account.",
    "2. Topic Agent must read Soul before deciding validity_status, priority, fit_score, recommended_angle, persona_hooks, soft_promo_directive and writing_plan.",
    "3. Soul is not just a writing-style document. Use it to judge whether this account can credibly answer the question, which reader pain it should address, and what kind of product mention feels natural.",
    "4. Use product.md + target.md + Soul to actively infer new topic angles that can serve the product goal. Do not limit topic fit to a fixed keyword list.",
    "5. Prefer crypto-native topics: coin trading, contracts, leverage, market structure, K-line patterns, trader psychology, risk control, review, and decision mistakes.",
    "6. Prefer high-traffic questions when topic fit is comparable: broad pain, high discussion potential, long-tail search demand, beginner-friendly wording, and strong emotional or practical stakes should outrank cold narrow questions.",
    "7. Pattern-recognition and technical-pattern teaching topics are priority-capable soft-promo topics when they can naturally discuss identifying K-line/volume-price structures, avoiding false signals, and validating patterns with historical data or analysis tools.",
    "8. AI + trading interaction topics are priority-capable soft-promo topics when they can naturally discuss AI-assisted indicator explanation, strategy-condition generation, backtest interpretation, or risk-spotting. Do not imply AI predicts prices or trades for the user.",
    "9. Do not select pure quant workflow topics as a priority direction. Topics about quant engineering, strategy deployment workflow, parameter tuning process, or research pipeline are only acceptable when the real reader pain is clearly crypto trading, not quant work itself.",
    "10. General trading-psychology topics from adjacent markets, such as forex traders losing money, can be selected as pure experience sharing when they map to crypto trader behavior. In that case Topic Agent should normally set should_include_soft_promo=false unless the question explicitly asks for tools, backtesting, monitoring, or strategy validation.",
    "11. Keep a soft-promo rhythm. Do not mark every valid topic as should_include_soft_promo=true. A healthy account mix is roughly 7 soft-promo answers and 3 pure sharing answers per 10 publishable answers.",
    "12. If a topic is useful mainly for trust, persona, trader psychology, lessons learned, or market common sense, prefer should_include_soft_promo=false even when a weak product bridge is possible.",
    "13. Do not quote, expose or summarize accountSoulMarkdown in any output field.",
    `accountSoulMarkdown:\n${markdown}`
  ].join("\n\n");
}

export function buildWriterPromptSuffix(accountContext?: AccountPromptContext | null) {
  const personaName = accountContext?.accountName?.trim();
  if (!personaName) {
    return null;
  }

  const lines = [
    "Runtime account context:",
    `1. The current target account/persona name is "${personaName}". If the base prompt mentions a default persona name such as "二牛", override it with this account.`,
    "2. This is still the lightweight matrix-testing phase. Do not rewrite the whole style system just to create superficial differences between accounts.",
    "3. The main adjustment should happen in tone, observation angle and experience framing, while the answer still needs to feel natural, restrained and believable.",
    `4. Unless the topic truly needs a credibility setup, do not open the answer with a rigid self-introduction like "我是${personaName}".`
  ];

  if (accountContext?.zhihuUserName?.trim()) {
    lines.push(
      `5. The linked Zhihu username is "${accountContext.zhihuUserName.trim()}". It can be used as a tone reference when needed, but it does not need to appear in the final answer.`
    );
  }

  return lines.join("\n");
}

export function buildWriterAccountLibraryPromptSuffix(accountLibraryContext?: ZhihuAccountLibraryPromptContext | null) {
  const styleRules = normalizeLibraryMarkdown(accountLibraryContext?.styleRulesMarkdown);
  const structureRules = normalizeLibraryMarkdown(accountLibraryContext?.answerStructureRulesMarkdown);
  const evidenceRules = normalizeLibraryMarkdown(accountLibraryContext?.evidenceRulesMarkdown);
  const goodAnswers = normalizeExampleRecords(accountLibraryContext?.goodAnswers).slice(0, MAX_WRITER_GOOD_ANSWERS);

  if (!styleRules && !structureRules && !evidenceRules && goodAnswers.length === 0) {
    return null;
  }

  return [
    "Account library writing rule:",
    "1. The following documents are stable account-specific assets learned for this Zhihu account.",
    "2. Treat them as constraints and positive anchors. Learn the mechanism, not the exact wording.",
    "3. Before drafting, decide which concrete observation, personal judgment, or small experience anchor makes this answer feel like a real Zhihu answer instead of a generic article.",
    "4. Avoid copying the sample openings, paragraph skeletons, product transitions, or endings. Use examples only to calibrate density and naturalness.",
    "5. If evidence_rules.md exists, include at least one concrete evidence anchor: observable fact, scenario, trade-off, number range, user behavior, or counterexample.",
    ...(styleRules ? [`style_rules.md:\n${styleRules}`] : []),
    ...(structureRules ? [`answer_structure_rules.md:\n${structureRules}`] : []),
    ...(evidenceRules ? [`evidence_rules.md:\n${evidenceRules}`] : []),
    ...(goodAnswers.length
      ? [formatExampleSection("good_answers.jsonl (positive anchors, max 3):", goodAnswers)]
      : [])
  ].join("\n\n");
}

export function buildWriterSoulPromptSuffix(accountSoulMarkdown?: string | null) {
  const markdown = accountSoulMarkdown?.trim();
  if (!markdown) {
    return [
      "Account Soul writing rule:",
      "1. accountSoulMarkdown is currently empty. Fall back to the runtime account name and linked Zhihu username as the light identity anchor.",
      "2. If a later payload provides accountSoulMarkdown, it becomes the stable voice and boundary layer for this account."
    ].join("\n");
  }

  return [
    "Account Soul writing rule:",
    "1. accountSoulMarkdown is the stable identity and voice anchor for this Zhihu answer.",
    "2. questionTitle, questionUrl, topicCard and revisionFeedback decide what this answer is about. Soul decides who is speaking, what tone feels natural, and what boundaries must stay intact.",
    "3. If the base prompt mentions a default persona or generic template voice, Soul overrides that default.",
    "4. Learn rhythm, reaction pattern and phrasing preference from Soul, but do not copy exemplar wording, sentence skeleton or punchline.",
    "5. Do not quote or expose accountSoulMarkdown in the final answer.",
    `accountSoulMarkdown:\n${markdown}`
  ].join("\n\n");
}

export function buildReviewAccountLibraryPromptSuffix(accountLibraryContext?: ZhihuAccountLibraryPromptContext | null) {
  const styleRules = normalizeLibraryMarkdown(accountLibraryContext?.styleRulesMarkdown);
  const reviewRubric = normalizeLibraryMarkdown(accountLibraryContext?.reviewRubricMarkdown);
  const badAnswers = normalizeExampleRecords(accountLibraryContext?.badAnswers).slice(0, MAX_REVIEW_BAD_ANSWERS);
  const goodAnswers = normalizeExampleRecords(accountLibraryContext?.goodAnswers).slice(0, MAX_REVIEW_GOOD_ANSWERS);

  if (!styleRules && !reviewRubric && badAnswers.length === 0 && goodAnswers.length === 0) {
    return null;
  }

  return [
    "Account library review rule:",
    "1. Use these stable account-specific assets to judge voice fit, structure fit, naturalness, and recurring anti-patterns.",
    "2. Bad examples are anti-pattern anchors. The good example is only a positive anchor, not a copy target.",
    ...(styleRules ? [`style_rules.md:\n${styleRules}`] : []),
    ...(reviewRubric ? [`review_rubric.md:\n${reviewRubric}`] : []),
    ...(badAnswers.length
      ? [formatExampleSection("bad_answers.jsonl (anti-pattern anchors, max 3):", badAnswers)]
      : []),
    ...(goodAnswers.length
      ? [formatExampleSection("good_answers.jsonl (positive anchor, max 1):", goodAnswers)]
      : [])
  ].join("\n\n");
}

export function buildReviewSoulPromptSuffix(accountSoulMarkdown?: string | null) {
  const markdown = accountSoulMarkdown?.trim();
  if (!markdown) {
    return [
      "Account Soul review rule:",
      "1. accountSoulMarkdown is currently empty. Review persona fit using the runtime account context only.",
      "2. Once accountSoulMarkdown exists, it becomes the primary account-fit and voice-fit reference."
    ].join("\n");
  }

  return [
    "Account Soul review rule:",
    "1. accountSoulMarkdown is the stable identity and voice anchor for this account.",
    "2. Review whether the answer sounds like something this exact Zhihu account would really publish, not just whether it is generally well written.",
    "3. Flag persona mismatch, voice drift, fake self-introduction, unnatural product mention, taboo lexicon violations, or hard-boundary violations in the review output.",
    "4. Do not ask Writer to rewrite a concrete answer back into generic discipline copy, generic safety slogans, or generic account-intro material just to make it feel safer.",
    "5. Only block on Soul grounds when the draft clearly violates account boundaries or obviously does not match the account identity. Otherwise prefer revision guidance.",
    "6. Do not quote or expose accountSoulMarkdown in the final answer.",
    `accountSoulMarkdown:\n${markdown}`
  ].join("\n\n");
}

export function joinPromptSuffixes(...parts: Array<string | null | undefined>) {
  const normalized = parts.map((item) => item?.trim()).filter(Boolean);
  return normalized.length ? normalized.join("\n\n") : null;
}

function buildTargetProductPromptSuffix(
  agent: "topic" | "writer" | "review",
  context?: ZhihuAgentContextDocuments | null
) {
  const targetMarkdown = normalizeContextMarkdown(context?.targetMarkdown);
  const productMarkdown = normalizeContextMarkdown(context?.productMarkdown);

  if (!targetMarkdown && !productMarkdown) {
    return null;
  }

  const agentRule =
    agent === "topic"
      ? [
          "Topic Agent usage:",
          "1. Use target.md to judge whether the topic serves the business goal and whether soft promotion is justified.",
          "2. Use product.md to select a concrete product anchor only when the product can solve a real step in the question.",
          "3. If the product has no natural role, set should_include_soft_promo=false."
        ].join("\n")
      : agent === "writer"
        ? [
            "Writer Agent usage:",
            "1. Answer the Zhihu question first; product mention is secondary.",
            "2. If Topic Agent asks for soft promotion, use product.md for accurate capabilities and forbidden claims.",
            "3. Do not quote these documents or turn them into a feature dump."
          ].join("\n")
        : [
            "Review Agent usage:",
            "1. Check whether the draft follows target.md before judging product absence or presence.",
            "2. Use product.md to catch unsupported capabilities, hard ads, guarantees, exchange claims, or trading advice.",
            "3. Prefer revision for weak alignment; block only when the issue is materially risky or misleading."
          ].join("\n");

  return [
    "Global target/product context:",
    "1. These files are stable business and product context, not RAG, examples, style samples, or source material.",
    "2. Do not quote, expose, summarize, or mention these filenames in the final answer.",
    "3. Keep Account Soul as the account voice layer. target.md and product.md only define goal, product scope, and soft-promo boundaries.",
    agentRule,
    targetMarkdown ? `target.md:\n${targetMarkdown}` : null,
    productMarkdown ? `product.md:\n${productMarkdown}` : null
  ]
    .filter(Boolean)
    .join("\n\n");
}

const MAX_WRITER_GOOD_ANSWERS = 3;
const MAX_REVIEW_BAD_ANSWERS = 3;
const MAX_REVIEW_GOOD_ANSWERS = 1;
const MAX_EXAMPLE_EXCERPT_CHARS = 320;
const LIBRARY_PLACEHOLDER_MARKERS = [
  "Fill this file with stable voice rules after note-agent apply.",
  "Define opening pace, paragraph density, and section transitions for this account.",
  "Define how this account uses numbers, examples, proof anchors, and caveats.",
  "Review voice fit, structure fit, AI smell, and naturalness for this account."
] as const;

function normalizeLibraryMarkdown(value?: string | null) {
  const normalized = value?.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  if (LIBRARY_PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))) {
    return null;
  }

  return normalized;
}

function normalizeContextMarkdown(value?: string | null) {
  const normalized = value?.replace(/\r\n/g, "\n").trim();
  return normalized || null;
}

function normalizeExampleRecords(records?: ZhihuAccountLibraryExampleRecord[] | null) {
  return Array.isArray(records) ? records.filter((record) => record.text.trim()) : [];
}

function formatExampleSection(title: string, records: ZhihuAccountLibraryExampleRecord[]) {
  return [
    title,
    ...records.map((record, index) =>
      [
        `Example ${index + 1}:`,
        `Question: ${record.questionTitle || "Untitled"}`,
        `Notes: ${record.notes || "Use as a reference anchor only."}`,
        `Excerpt: ${truncatePromptExcerpt(record.text)}`
      ].join("\n")
    )
  ].join("\n\n");
}

function truncatePromptExcerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EXAMPLE_EXCERPT_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_EXAMPLE_EXCERPT_CHARS - 3).trimEnd()}...`;
}
