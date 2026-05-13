import { getMysqlPool } from "../packages/core/dist/core/src/db/mysql.js";
import { PromptRepository } from "../packages/core/dist/core/src/repositories/prompt-repository.js";
import { LlmService } from "../packages/core/dist/core/src/services/llm-service.js";
import { AccountSoulService } from "../packages/core/dist/core/src/services/account-soul-service.js";
import { ReviewService } from "../packages/core/dist/core/src/services/review-service.js";
import { ZhihuAgentContextService } from "../packages/core/dist/core/src/services/zhihu-agent-context-service.js";
import {
  buildWriterPromptSuffix,
  buildWriterSoulPromptSuffix,
  buildWriterTargetProductPromptSuffix,
  joinPromptSuffixes
} from "../packages/core/dist/core/src/services/account-prompt-context.js";

const ACCOUNT = { id: 1, name: "Default Zhihu Account", zhihuUserName: "二牛是个老实人" };
const QUESTION_TITLE = "目前的状态回头看，你交易生涯走过的最大弯路是什么？";
const QUESTION_URL = "https://www.zhihu.com/question/trading-detour-test";
const WRITER_PROMPTS = [
  { key: "v9", label: "Writer Agent v9", id: 57 },
  { key: "v10", label: "Writer Agent v10", id: 59 },
  { key: "v11", label: "Writer Agent v11", id: 60 }
];
const MAX_ATTEMPTS = 2;

function buildTopicCard() {
  return {
    title: QUESTION_TITLE,
    summary:
      "题目核心是让答主回头复盘交易生涯里最大的弯路。回答应使用第一人称经验口吻，重点不是炫耀收益，而是讲清从主观交易、追热点、过度相信感觉，到后来重视规则、记录、回测和风控的转变。避免推荐交易所、合约、杠杆、具体买卖建议或收益承诺。",
    priority: "P1",
    fit_score: 90,
    question_type: "trading_reflection_detour",
    persona_mode: "first_person_reflection",
    target_audience: ["有交易经历的人", "亏过钱后想复盘的新手", "想建立交易规则的用户"],
    pain_points: ["靠感觉交易", "把短期赚钱误认为能力", "不记录交易", "没有验证策略失效场景"],
    recommended_angle:
      "最大的弯路不是亏过哪一笔，而是很长时间把交易当判断题，只想着看对方向，后来才发现更重要的是规则、复盘和知道自己在哪些行情里会失效。",
    persona_hooks: ["第一人称", "复盘感", "少说教", "具体动作", "克制软广"],
    soft_promo_mode: "light",
    soft_promo_reason:
      "交易弯路复盘天然可以承接到规则验证和回测，不适合硬广，但适合自然提到用工具把主观判断拆成可检验规则。",
    should_include_soft_promo: true,
    soft_promo_directive: {
      should_include: true,
      mode: "light",
      reason:
        "题目问交易弯路，CryptoPathX 可以作为后来复盘和验证策略的一步出现，不应成为回答主角。",
      product_anchor:
        "从靠感觉交易转向把入场、止损、止盈和失效场景写成规则，再用历史数据验证。",
      writer_instruction:
        "正文自然出现 CryptoPathX，放在复盘/规则验证段落；不要写成产品介绍，不要暗示工具能预测涨跌或保证盈利。"
    },
    must_avoid: ["推荐交易所", "鼓励合约杠杆", "晒收益", "预测涨跌", "建议具体买卖"],
    risk_notes: ["避免构成投资建议", "避免虚构具体收益统计", "避免把工具写成预测工具"],
    topic_fingerprint: {
      problem_core: "交易生涯最大的弯路是什么",
      answer_angle: "从看对方向转向建立规则、复盘和验证失效场景",
      target_pain: "交易者亏损后不知道问题出在判断、规则还是执行",
      promo_entry: "复盘交易规则和历史验证"
    }
  };
}

function buildWriterSoftPromoPromptSuffix(topicCard) {
  const directive = topicCard.soft_promo_directive;
  return [
    "Topic Agent soft-promo directive:",
    "1. Topic Agent has decided this selected topic is suitable for natural soft promotion.",
    "2. You must include CryptoPathX naturally in the answer, but the answer still needs to solve the Zhihu question first.",
    "3. Use the product only where it fits the selected problem, method, verification path, review workflow, risk-control step, or tool-choice step.",
    "4. Do not write a hard ad, feature dump, guarantee, exchange recommendation, or exaggerated product claim.",
    `5. Topic Agent reason: ${directive.reason}`,
    `6. Product anchor: ${directive.product_anchor}`,
    `7. Writer instruction: ${directive.writer_instruction}`
  ].join("\n");
}

function getRewriteBrief(review) {
  return review.quality?.rewriteBrief || review.editorial?.rewrite_brief || review.reviewSummary || "";
}

function normalizeWriterOutput(output) {
  return {
    title: typeof output.title === "string" ? output.title : QUESTION_TITLE,
    summary: typeof output.summary === "string" ? output.summary : "",
    content: typeof output.content === "string" ? output.content.trim() : "",
    fingerprint: output.fingerprint ?? {}
  };
}

async function main() {
  const pool = getMysqlPool();
  const promptRepository = new PromptRepository(pool);
  const llmService = new LlmService(promptRepository);
  const reviewService = new ReviewService(llmService);
  const soulService = new AccountSoulService();
  const contextService = new ZhihuAgentContextService();
  const accountSoul = await soulService.ensureSoulDocument(ACCOUNT);
  const agentContextDocuments = await contextService.ensureDocuments();
  const topicCard = buildTopicCard();
  const baseSnapshot = await llmService.getActivePromptSnapshot();
  const writerPromptSuffix = joinPromptSuffixes(
    buildWriterPromptSuffix(ACCOUNT),
    buildWriterTargetProductPromptSuffix(agentContextDocuments),
    buildWriterSoulPromptSuffix(accountSoul.markdown),
    buildWriterSoftPromoPromptSuffix(topicCard)
  );

  const results = [];
  for (const item of WRITER_PROMPTS) {
    const writerSnapshot = await promptRepository.getPromptVersionSnapshotById(item.id);
    if (!writerSnapshot) {
      throw new Error(`Writer prompt not found: ${item.id}`);
    }

    const promptSnapshot = { ...baseSnapshot, writer_agent: writerSnapshot };
    let revisionFeedback = "";
    let finalWriter = null;
    let finalReview = null;
    const attempts = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const writerOutput = normalizeWriterOutput(
        await llmService.runJson(
          "writer_agent",
          {
            questionTitle: QUESTION_TITLE,
            questionUrl: QUESTION_URL,
            topicCard,
            softPromoDirective: topicCard.soft_promo_directive,
            revisionFeedback
          },
          { title: QUESTION_TITLE, summary: "", content: "", fingerprint: {} },
          { promptSnapshot, promptSuffix: writerPromptSuffix }
        )
      );

      const review = await reviewService.reviewContent(
        {
          content: writerOutput.content,
          topicSummary: topicCard.summary,
          topicCard,
          softPromoDirective: topicCard.soft_promo_directive,
          pastContentFingerprints: []
        },
        promptSnapshot,
        { accountSoulMarkdown: accountSoul.markdown, agentContextDocuments }
      );

      attempts.push({
        attempt,
        writerTitle: writerOutput.title,
        writerSummary: writerOutput.summary,
        contentLength: writerOutput.content.length,
        reviewDecision: review.decision,
        reviewScore: review.quality?.overallScore ?? null,
        reviewIssues: [
          ...(review.hardGate?.issues ?? []),
          ...(review.editorial?.issues ?? []),
          ...(review.publish?.issues ?? [])
        ],
        rewriteBrief: getRewriteBrief(review)
      });

      finalWriter = writerOutput;
      finalReview = review;
      if (review.decision === "PASS") {
        break;
      }
      revisionFeedback = getRewriteBrief(review);
    }

    results.push({
      key: item.key,
      label: item.label,
      promptVersionId: item.id,
      attempts,
      finalDecision: finalReview?.decision ?? "UNKNOWN",
      finalScore: finalReview?.quality?.overallScore ?? null,
      title: finalWriter?.title ?? "",
      summary: finalWriter?.summary ?? "",
      content: finalReview?.approvedContent ?? finalWriter?.content ?? "",
      reviewSummary: finalReview?.reviewSummary ?? "",
      issues: attempts.at(-1)?.reviewIssues ?? []
    });
  }

  await pool.end();
  console.log(JSON.stringify({ questionTitle: QUESTION_TITLE, account: ACCOUNT, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
