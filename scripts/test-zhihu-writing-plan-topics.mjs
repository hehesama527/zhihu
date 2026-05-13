import { writeFile } from "node:fs/promises";
import { getMysqlPool } from "../packages/core/dist/core/src/db/mysql.js";
import { PromptRepository } from "../packages/core/dist/core/src/repositories/prompt-repository.js";
import { LlmService } from "../packages/core/dist/core/src/services/llm-service.js";
import { AccountSoulService } from "../packages/core/dist/core/src/services/account-soul-service.js";
import { ReviewService } from "../packages/core/dist/core/src/services/review-service.js";
import { HumanizerService } from "../packages/core/dist/core/src/services/humanizer-service.js";
import { ZhihuAgentContextService } from "../packages/core/dist/core/src/services/zhihu-agent-context-service.js";
import {
  buildTopicPromptSuffix,
  buildTopicTargetProductPromptSuffix,
  buildWriterPromptSuffix,
  buildWriterSoulPromptSuffix,
  buildWriterTargetProductPromptSuffix,
  joinPromptSuffixes
} from "../packages/core/dist/core/src/services/account-prompt-context.js";

const ACCOUNT = { id: 1, name: "Default Zhihu Account", zhihuUserName: "二牛是个老实人" };
const ALL_TOPICS = [
  "你见过最好用的量化策略是哪个？可复制吗？",
  "做交易很多年；大家最大的感悟是什么？",
  "个人投资者能否通过量化交易稳定盈利？"
];
function readCustomTopics() {
  const raw = process.env.TOPICS_JSON;
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("TOPICS_JSON must be a JSON array of non-empty strings.");
  }
  return parsed.map((item) => item.trim());
}

function readTopicContexts() {
  const raw = process.env.TOPIC_CONTEXT_JSON ?? process.env.EXTRA_CONTEXT ?? "";
  if (!raw.trim()) {
    return {};
  }

  if (!raw.trim().startsWith("{")) {
    return { default: raw.trim() };
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TOPIC_CONTEXT_JSON must be a JSON object keyed by topic title or 'default'.");
  }
  return parsed;
}

function getTopicContext(title) {
  const value = TOPIC_CONTEXTS[title] ?? TOPIC_CONTEXTS.default ?? "";
  if (!value) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

const CUSTOM_TOPICS = readCustomTopics();
const TOPIC_CONTEXTS = readTopicContexts();
const TOPIC_INDEX = Number(process.env.TOPIC_INDEX ?? Number.NaN);
const TOPICS = CUSTOM_TOPICS ?? (Number.isInteger(TOPIC_INDEX) ? [ALL_TOPICS[TOPIC_INDEX]].filter(Boolean) : ALL_TOPICS);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 2);
const OUTPUT_JSON = process.env.OUTPUT_JSON;
const OUTPUT_MD = process.env.OUTPUT_MD;
const USE_HUMANIZER = process.env.USE_HUMANIZER === "1" || process.env.USE_HUMANIZER === "true";

function buildTopicFallback(title) {
  return {
    title,
    summary: title,
    priority: "P2",
    fit_score: 70,
    question_type: "其他",
    persona_mode: "二牛经验型",
    target_audience: [],
    pain_points: [],
    recommended_angle: "",
    persona_hooks: [],
    soft_promo_mode: "none",
    soft_promo_reason: "",
    should_include_soft_promo: false,
    soft_promo_directive: {
      should_include: false,
      mode: "none",
      reason: "fallback",
      product_anchor: "",
      writer_instruction: "不强制加入软广。"
    },
    writing_plan: {
      length_mode: "standard",
      target_words_min: 2200,
      target_words_max: 3500,
      structure_mode: "结论先行 + 具体理由 + 方法建议 + 克制收口",
      should_use_cases: false,
      case_style: "none",
      should_include_calculation: false,
      should_include_list: false,
      suggested_sections: ["先说结论", "为什么", "怎么做", "最后收口"],
      writer_notes: "按题目自然展开，不要为了长度重复观点。"
    },
    must_avoid: [],
    risk_notes: [],
    topic_fingerprint: {
      problem_core: title,
      answer_angle: "",
      target_pain: "",
      promo_entry: "none"
    }
  };
}

function buildTopicAgentSingleSelectionPromptSuffix() {
  return [
    "Case-driven planning rule: for crypto, trading, altcoin, contract, strategy, backtesting, risk-control, trading-psychology, capital-size, and stable-profit topics, set writing_plan.should_use_cases=true by default unless the question is only a narrow factual definition.",
    "If candidate.sourceContext.extraContext contains a concrete market case, price path, token path, liquidation story, or user-provided example, preserve it in recommended_angle or writing_plan.writer_notes for Writer.",
    "A usable case must include time/price path or market setup, why a retail trader enters, position or budget, long/short temptation, action deformation such as chasing/holding/stop-loss failure, result pressure, and review takeaway.",
    "Topic Agent 单题最终选题补充规则：",
    "1. 选题结束后，必须单独判断这个选题是否适合自然加入软广。",
    "2. 如果适合，把 should_include_soft_promo 设为 true，soft_promo_mode 设为 light 或 natural，并在 soft_promo_directive.writer_instruction 里明确告诉 Writer：这篇需要自然加入 CryptoPathX。",
    "3. 如果不适合，把 should_include_soft_promo 设为 false，soft_promo_mode 设为 none，topic_fingerprint.promo_entry 写 none，并在 soft_promo_directive.writer_instruction 里明确告诉 Writer：这篇不强制加入软广，不要硬带 CryptoPathX。",
    "4. 只有当 CryptoPathX 的真实能力能解决题目里的具体一步时，才允许 should_include_soft_promo=true；不要因为整体业务目标需要推广，就默认每篇都带。",
    "5. 必须输出 writing_plan，由 Topic Agent 决定正文长度、是否需要案例、是否需要算账、是否适合列表/短标题。",
    "6. 字数规则：现在优先写足，不要压缩。普通可发布话题 target_words_min 建议 2200；长文、经验复盘、交易心理、策略方法论、软文承接空间大的题也不要把 target_words_min 设得太高，通常 2200-2400 就够。需要更厚时提高 target_words_max 和 writer_notes，而不是把硬下限抬到 2600+。target_words_max 建议 3500-4500，但正文总长不要超过 5000 字。",
    "7. length_mode 选择规则：只有非常窄的事实问答才用 short；普通方法题用 standard；交易经历、弯路复盘、新手入门、小本金、策略方法论、软文承接空间大的题默认用 long。",
    "8. 案例规则：只有题目适合故事化时 should_use_cases=true；没有真实输入证据时 case_style 用 typical_composite 或 contrast_cases，不要要求 Writer 编造真实朋友经历。",
    "9. 算账规则：涉及本金、成本、收益预期、回撤、仓位、手续费、策略有效性时 should_include_calculation=true。",
    "10. 只输出 JSON，不要 Markdown。"
  ].join("\n");
}

function buildWriterSoftPromoPromptSuffix(topicCard) {
  const directive = topicCard.soft_promo_directive ?? {};
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
      `9. Writer instruction: ${directive.writer_instruction || ""}`
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
    `5. Writer instruction: ${directive.writer_instruction || ""}`
  ].join("\n");
}

function buildWriterWritingPlanPromptSuffix(topicCard) {
  const plan = topicCard.writing_plan ?? buildTopicFallback(topicCard.title ?? "").writing_plan;
  return [
    "Topic Agent writing plan:",
    "1. Topic Agent decides the article length, structure, case usage, calculation usage, and list usage for this specific topic.",
    "2. Follow this plan unless it directly conflicts with hard safety boundaries, Account Soul, or the soft-promo directive.",
    `3. length_mode: ${plan.length_mode}`,
    `4. target length: ${plan.target_words_min}-${plan.target_words_max} Chinese characters. Aim for at least the lower bound, but do not pad. The upper bound is soft, and the final answer must stay under 5000 Chinese characters.`,
    `5. structure_mode: ${plan.structure_mode}`,
    `6. should_use_cases: ${plan.should_use_cases}`,
    `7. case_style: ${plan.case_style}`,
    `8. should_include_calculation: ${plan.should_include_calculation}`,
    `9. should_include_list: ${plan.should_include_list}`,
    `10. suggested_sections: ${(plan.suggested_sections ?? []).join(" / ")}`,
    `11. writer_notes: ${plan.writer_notes}`,
    "12. If cases are requested but no verified real case is provided, write typical/composite cases clearly as common patterns, not as real friends or real personal records.",
    "13. If the target length is long, add substance through scenarios, calculations, counterexamples, steps, stage suggestions, and review details; do not repeat the same claim just to increase length.",
    "14. For long answers, include at least one complete action chain when cases are requested: trigger/context, position or budget, decision process, outcome pressure, and review takeaway.",
    "15. For crypto/trading topics, the case should carry the argument rather than decorate it. Include price/time path or market setup, entry trigger, position/budget, long/short temptation, stop-loss/take-profit action, emotional deformation, outcome pressure, and review takeaway.",
    "16. If topicContext contains a concrete market case, use it as one possible evidence source with cautious wording, not as a reusable template. Do not claim independent verification.",
    "17. Do not repeatedly reuse the same token, same story arc, or same wording across topics. Prefer different cases from source context/search evidence; if no reliable case is available, use a realistic composite case.",
    "18. Unless the topic is very narrow, aim for roughly 2200+ Chinese characters with real substance; do not stop around 1500-1900 just because the answer already has a complete outline."
  ].join("\n");
}

function buildWriterTopicContextPromptSuffix(topicContext) {
  if (!topicContext) {
    return "";
  }
  return [
    "Topic-specific context from this test run:",
    topicContext,
    "Use this context only as optional case material. Do not copy its wording, do not turn it into a fixed template, and do not claim independent verification."
  ].join("\n");
}

function normalizeWriterOutput(output, title) {
  return {
    title: typeof output.title === "string" ? output.title : title,
    summary: typeof output.summary === "string" ? output.summary : "",
    content: typeof output.content === "string" ? output.content.trim() : "",
    fingerprint: output.fingerprint ?? {}
  };
}

function getRewriteBrief(review) {
  return review.quality?.rewriteBrief || review.editorial?.rewrite_brief || review.reviewSummary || "";
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

function assessContent(result) {
  const content = result.content ?? "";
  const boldCount = countMatches(content, /\*\*[^*\n][\s\S]*?[^*\n]\*\*/g);
  const productCount = countMatches(content, /CryptoPathX/g);
  const firstPersonCount = countMatches(content, /我/g);
  const caseSignals = countMatches(content, /比如|举个|有个|朋友|我见过|我自己|之前|后来|一次|案例/g);
  const calculationSignals = countMatches(content, /\d+|%|u|U|回撤|胜率|盈亏比|本金|仓位|手续费|滑点/g);
  const templateSignals = countMatches(content, /先说结论|最后说|最后补一句|总结一下|回到问题本身/g);
  const promoToneSignals = countMatches(content, /专业级|一站式|核心优势|强大|赋能|显著提升|真实可信|降低门槛/g);
  const paragraphCount = content.split(/\n+/).filter((line) => line.trim()).length;

  const strengths = [];
  const risks = [];
  if (firstPersonCount >= 8) strengths.push("第一人称存在感够，读起来更像个人复盘。");
  else risks.push("第一人称偏少，容易变成泛泛科普。");
  if (caseSignals >= 8) strengths.push("有案例/场景信号，软文承接空间较好。");
  else risks.push("案例感偏弱，建议增加更具体的账户、仓位、亏损或复盘动作。");
  if (calculationSignals >= 10) strengths.push("有数字和交易指标，可信度比纯观点文更好。");
  else risks.push("数字和算账不足，交易类话题会显得虚。");
  if (boldCount >= 2) strengths.push("粗体重点基本达标。");
  else risks.push("粗体不足，重点不够抓眼。");
  if (templateSignals >= 3) risks.push("模板句偏多，开头/收尾可能撞款。");
  if (promoToneSignals >= 3) risks.push("宣传词偏多，可能有硬广味。");
  if (productCount > 2) risks.push("CryptoPathX 出现次数偏多，注意像广告。");

  let manualRating = "可人工审核";
  if (result.finalDecision !== "PASS") {
    manualRating = "不建议发布";
  } else if (risks.length <= 1 && content.length >= 1000) {
    manualRating = "接近可发布";
  } else if (risks.length >= 4) {
    manualRating = "需要重写";
  }

  return {
    contentLength: content.length,
    paragraphCount,
    boldCount,
    productCount,
    firstPersonCount,
    caseSignals,
    calculationSignals,
    templateSignals,
    promoToneSignals,
    manualRating,
    strengths,
    risks
  };
}

function fence(text) {
  return `\`\`\`text\n${String(text ?? "").replace(/```/g, "` ` `")}\n\`\`\``;
}

function renderWritingPlan(plan) {
  const picked = {
    length_mode: plan?.length_mode,
    target_words_min: plan?.target_words_min,
    target_words_max: plan?.target_words_max,
    should_use_cases: plan?.should_use_cases,
    case_style: plan?.case_style,
    should_include_calculation: plan?.should_include_calculation,
    should_include_list: plan?.should_include_list,
    should_use_bold: plan?.should_use_bold,
    bold_targets: plan?.bold_targets,
    suggested_sections: plan?.suggested_sections,
    writer_notes: plan?.writer_notes
  };
  return fence(JSON.stringify(picked, null, 2));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# 知乎软文批量测试报告");
  lines.push("");
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- Topic 数量：${report.results.length}`);
  lines.push(`- 账号：${report.account.name}`);
  lines.push(`- 流程：Topic Agent -> Writer Agent -> ${report.usedHumanizer ? "humanizer-zh -> " : ""}Review Agent`);
  lines.push("");
  lines.push("## 总览");
  lines.push("");
  lines.push("| # | Topic | Review | Score | 字数 | 粗体 | 产品出现 | 人工判断 | 主要风险 |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---|---|");
  report.results.forEach((result, index) => {
    const a = result.manualAssessment;
    const mainRisk = a.risks[0] ?? "暂无明显硬伤";
    lines.push(
      `| ${index + 1} | ${result.questionTitle.replace(/\|/g, "\\|")} | ${result.finalDecision} | ${result.finalScore ?? ""} | ${a.contentLength} | ${a.boldCount} | ${a.productCount} | ${a.manualRating} | ${mainRisk.replace(/\|/g, "\\|")} |`
    );
  });
  lines.push("");

  report.results.forEach((result, index) => {
    const a = result.manualAssessment;
    lines.push(`## ${index + 1}. ${result.questionTitle}`);
    lines.push("");
    lines.push("### 测试结论");
    lines.push("");
    lines.push(`- Review：${result.finalDecision}`);
    lines.push(`- Review score：${result.finalScore ?? "N/A"}`);
    lines.push(`- Review summary：${result.reviewSummary || "N/A"}`);
    lines.push(`- Humanizer：${result.usedHumanizer ? "启用" : "未启用"}`);
    if (result.rawContent) {
      lines.push(`- Writer 原文字数：${result.rawContent.length}`);
    }
    lines.push(`- 人工初判：${a.manualRating}`);
    lines.push(`- 字数：${a.contentLength}`);
    lines.push(`- 段落数：${a.paragraphCount}`);
    lines.push(`- 粗体数量：${a.boldCount}`);
    lines.push(`- CryptoPathX 出现次数：${a.productCount}`);
    lines.push(`- 第一人称“我”出现次数：${a.firstPersonCount}`);
    lines.push(`- 案例/场景信号：${a.caseSignals}`);
    lines.push(`- 数字/算账信号：${a.calculationSignals}`);
    lines.push(`- 模板句信号：${a.templateSignals}`);
    lines.push(`- 宣传腔信号：${a.promoToneSignals}`);
    lines.push("");
    lines.push("### 我会重点看");
    lines.push("");
    if (a.strengths.length) {
      for (const item of a.strengths) lines.push(`- 优点：${item}`);
    }
    if (a.risks.length) {
      for (const item of a.risks) lines.push(`- 风险：${item}`);
    }
    if (!a.strengths.length && !a.risks.length) {
      lines.push("- 暂无明显自动化信号，需要人工阅读全文判断。");
    }
    lines.push("");
    lines.push("### Topic Agent 写作计划");
    lines.push("");
    lines.push(renderWritingPlan(result.topicCard?.writing_plan));
    lines.push("");
    if (result.topicContext) {
      lines.push("### Topic Context");
      lines.push("");
      lines.push(fence(result.topicContext));
      lines.push("");
    }
    lines.push("### Review 尝试记录");
    lines.push("");
    lines.push(fence(JSON.stringify(result.attempts, null, 2)));
    lines.push("");
    if (result.usedHumanizer && result.rawContent && result.rawContent !== result.content) {
      lines.push("### Writer 原文（humanizer 前）");
      lines.push("");
      lines.push(fence(result.rawContent));
      lines.push("");
    }
    if (result.usedHumanizer && result.humanizerNotes?.length) {
      lines.push("### Humanizer Notes");
      lines.push("");
      lines.push(fence(JSON.stringify(result.humanizerNotes, null, 2)));
      lines.push("");
    }
    lines.push("### 正文原文");
    lines.push("");
    lines.push(fence(result.content));
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

async function main() {
  const pool = getMysqlPool();
  const promptRepository = new PromptRepository(pool);
  const llmService = new LlmService(promptRepository);
  const reviewService = new ReviewService(llmService);
  const humanizerService = new HumanizerService();
  const soulService = new AccountSoulService();
  const contextService = new ZhihuAgentContextService();
  const accountSoul = await soulService.ensureSoulDocument(ACCOUNT);
  const agentContextDocuments = await contextService.ensureDocuments();
  const promptSnapshot = await llmService.getActivePromptSnapshot();
  const results = [];

  for (const title of TOPICS) {
    const topicContext = getTopicContext(title);
    const topicCard = await llmService.runJson(
      "topic_agent",
      {
        candidate: {
          id: 0,
          questionTitle: title,
          questionUrl: `https://www.zhihu.com/question/local-test-${encodeURIComponent(title)}`,
          sourceType: "manual_test",
          sourceContext: {
            primarySource: "manual_test",
            latestSourceType: "manual_test",
            discoveredSources: ["manual_test"],
            sourceEvents: [],
            extraContext: topicContext
          }
        },
        pastTopicFingerprints: []
      },
      buildTopicFallback(title),
      {
        promptSnapshot,
        promptSuffix: joinPromptSuffixes(
          buildTopicPromptSuffix(ACCOUNT),
          buildTopicTargetProductPromptSuffix(agentContextDocuments),
          buildTopicAgentSingleSelectionPromptSuffix()
        )
      }
    );

    let revisionFeedback = "";
    let finalWriter = null;
    let finalReview = null;
    const attempts = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const writerOutput = normalizeWriterOutput(
        await llmService.runJson(
          "writer_agent",
          {
            questionTitle: title,
            questionUrl: `https://www.zhihu.com/question/local-test-${encodeURIComponent(title)}`,
            topicCard,
            softPromoDirective: topicCard.soft_promo_directive,
            topicContext,
            revisionFeedback
          },
          { title, summary: "", content: "", fingerprint: {} },
          {
            promptSnapshot,
            promptSuffix: joinPromptSuffixes(
              buildWriterPromptSuffix(ACCOUNT),
              buildWriterTargetProductPromptSuffix(agentContextDocuments),
              buildWriterSoulPromptSuffix(accountSoul.markdown),
              buildWriterWritingPlanPromptSuffix(topicCard),
              buildWriterTopicContextPromptSuffix(topicContext),
              buildWriterSoftPromoPromptSuffix(topicCard)
            )
          }
        )
      );

      let contentForReview = writerOutput.content;
      let humanizerNotes = [];
      if (USE_HUMANIZER) {
        const humanized = await humanizerService.humanize(writerOutput.content, {
          stage: "test_humanizing",
          agentName: "writer_agent"
        });
        contentForReview = humanized.content;
        humanizerNotes = humanized.notes ?? [];
      }

      const review = await reviewService.reviewContent(
        {
          content: contentForReview,
          topicSummary: topicCard.summary ?? title,
          topicCard,
          softPromoDirective: topicCard.soft_promo_directive,
          pastContentFingerprints: []
        },
        promptSnapshot,
        { accountSoulMarkdown: accountSoul.markdown, agentContextDocuments }
      );

      attempts.push({
        attempt,
        contentLength: contentForReview.length,
        rawContentLength: writerOutput.content.length,
        usedHumanizer: USE_HUMANIZER,
        humanizerNotes,
        reviewDecision: review.decision,
        reviewScore: review.quality?.overallScore ?? null,
        reviewIssues: [
          ...(review.hardGate?.issues ?? []),
          ...(review.editorial?.issues ?? []),
          ...(review.publish?.issues ?? [])
        ],
        rewriteBrief: getRewriteBrief(review)
      });

      finalWriter = {
        ...writerOutput,
        rawContent: writerOutput.content,
        content: contentForReview,
        usedHumanizer: USE_HUMANIZER,
        humanizerNotes
      };
      finalReview = review;
      if (review.decision === "PASS") {
        break;
      }
      revisionFeedback = getRewriteBrief(review);
    }

    results.push({
      questionTitle: title,
      topicContext,
      topicCard,
      attempts,
      finalDecision: finalReview?.decision ?? "UNKNOWN",
      finalScore: finalReview?.quality?.overallScore ?? null,
      title: finalWriter?.title ?? title,
      summary: finalWriter?.summary ?? "",
      content: finalReview?.approvedContent ?? finalWriter?.content ?? "",
      rawContent: finalWriter?.rawContent ?? "",
      usedHumanizer: finalWriter?.usedHumanizer ?? USE_HUMANIZER,
      humanizerNotes: finalWriter?.humanizerNotes ?? [],
      reviewSummary: finalReview?.reviewSummary ?? "",
      issues: attempts.at(-1)?.reviewIssues ?? []
    });

    if (OUTPUT_JSON || OUTPUT_MD) {
      const partialReport = {
        account: ACCOUNT,
        usedHumanizer: USE_HUMANIZER,
        results: results.map((result) => ({
          ...result,
          manualAssessment: assessContent(result)
        }))
      };
      if (OUTPUT_JSON) {
        await writeFile(OUTPUT_JSON, `${JSON.stringify(partialReport, null, 2)}\n`, "utf8");
      }
      if (OUTPUT_MD) {
        await writeFile(OUTPUT_MD, renderMarkdown(partialReport), "utf8");
      }
    }
  }

  const report = {
    account: ACCOUNT,
    usedHumanizer: USE_HUMANIZER,
    results: results.map((result) => ({
      ...result,
      manualAssessment: assessContent(result)
    }))
  };

  await pool.end();

  if (OUTPUT_JSON) {
    await writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (OUTPUT_MD) {
    await writeFile(OUTPUT_MD, renderMarkdown(report), "utf8");
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
