import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AccountSoulService,
  HumanizerService,
  LlmService,
  PromptRepository,
  ReviewService,
  TopicBatchPlannerService,
  TopicPipelineService,
  TopicRepository,
  TopicReviewService,
  getMysqlPool,
  safeParseJson
} from "../packages/core/dist/core/src/index.js";

const DEFAULT_TOPIC = "币圈山寨币市场有多残酷?";
const topic = process.env.TOPIC?.trim() || DEFAULT_TOPIC;
const now = new Date();
const accountId = Number(process.env.ACCOUNT_ID ?? 990000 + Math.floor(Math.random() * 9000));
const account = {
  id: accountId,
  name: process.env.ACCOUNT_NAME?.trim() || "二牛",
  zhihuUserName: process.env.ZHIHU_USER_NAME?.trim() || "二牛"
};
const questionUrl =
  process.env.QUESTION_URL?.trim() ||
  `https://www.zhihu.com/question/case-research-smoke-${now.getTime()}-${encodeURIComponent(topic)}`;
const outputPath =
  process.env.OUTPUT_MD?.trim() ||
  path.join(
    "data",
    "zhihu-agent-context",
    `zhihu-case-research-production-smoke-${formatTimestamp(now)}.md`
  );

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function fence(value, language = "text") {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `\`\`\`${language}\n${String(text ?? "").replace(/```/g, "` ` `")}\n\`\`\``;
}

function parseJson(value, fallback = {}) {
  return safeParseJson(value ?? "", fallback);
}

function renderReport(input) {
  const {
    topic,
    questionUrl,
    account,
    candidateResult,
    candidateRow,
    preparedDraft,
    topicCard,
    rawDraft,
    humanizedDraft,
    review,
    stageLog,
    outputPath
  } = input;
  const caseResearch = topicCard?.case_research ?? rawDraft?.topicCard?.case_research ?? null;
  const rawOutput = parseJson(rawDraft?.output_json, {});
  const humanizedOutput = parseJson(humanizedDraft?.output_json, {});

  const lines = [];
  lines.push("# Zhihu Production Case Research Smoke Test");
  lines.push("");
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Topic: ${topic}`);
  lines.push(`- Question URL: ${questionUrl}`);
  lines.push(`- Account: ${account.name} (#${account.id})`);
  lines.push(`- Candidate ID: ${candidateResult?.id ?? "N/A"}`);
  lines.push(`- Candidate was new: ${candidateResult?.isNew ?? "N/A"}`);
  lines.push(`- Candidate status: ${candidateRow?.status ?? "N/A"}`);
  if (candidateRow?.duplication_fingerprint_text) {
    lines.push(`- Candidate block/duplication note: ${candidateRow.duplication_fingerprint_text}`);
  }
  lines.push(`- Output path: ${outputPath}`);
  lines.push("- Chain: Topic Agent -> Backend Case Research -> Writer Agent -> humanizer-zh -> Review Agent");
  lines.push("- Manual case injection: no");
  lines.push("");
  lines.push("## Stage Log");
  lines.push("");
  lines.push(fence(stageLog, "json"));
  lines.push("");
  lines.push("## Prepared Result");
  lines.push("");
  lines.push(fence(preparedDraft, "json"));
  lines.push("");
  lines.push("## Topic Card");
  lines.push("");
  lines.push(fence(topicCard, "json"));
  lines.push("");
  lines.push("## Backend Case Research");
  lines.push("");
  lines.push(fence(caseResearch, "json"));
  lines.push("");
  lines.push("## Review");
  lines.push("");
  lines.push(fence(
    review
      ? {
          id: review.id,
          review_status: review.review_status,
          review_summary: review.review_summary,
          hard_gate_json: parseJson(review.hard_gate_json, {}),
          editorial_review_json: parseJson(review.editorial_review_json, {}),
          publish_review_json: parseJson(review.publish_review_json, {})
        }
      : null,
    "json"
  ));
  lines.push("");
  lines.push("## Writer Raw Output JSON");
  lines.push("");
  lines.push(fence(rawOutput, "json"));
  lines.push("");
  lines.push("## Humanized Output JSON");
  lines.push("");
  lines.push(fence(humanizedOutput, "json"));
  lines.push("");
  lines.push("## Writer Raw Content");
  lines.push("");
  lines.push(fence(rawDraft?.content ?? ""));
  lines.push("");
  lines.push("## Humanized Content");
  lines.push("");
  lines.push(fence(humanizedDraft?.content ?? ""));
  lines.push("");
  lines.push("## Approved Content");
  lines.push("");
  lines.push(fence(preparedDraft?.approvedContent ?? review?.approved_content ?? ""));
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function getCandidateRow(pool, candidateId) {
  const [rows] = await pool.query(`SELECT * FROM topic_candidates WHERE id = ? LIMIT 1`, [candidateId]);
  return rows[0] ?? null;
}

async function getLatestTopicCardForCandidate(pool, candidateId) {
  const [rows] = await pool.query(
    `SELECT * FROM topic_cards WHERE topic_candidate_id = ? ORDER BY id DESC LIMIT 1`,
    [candidateId]
  );
  return rows[0] ?? null;
}

async function getLatestReviewForTopicCard(pool, topicCardId) {
  const [rows] = await pool.query(
    `SELECT rv.*
     FROM reviews rv
     JOIN drafts d ON d.id = rv.draft_id
     WHERE d.topic_card_id = ?
     ORDER BY rv.id DESC
     LIMIT 1`,
    [topicCardId]
  );
  return rows[0] ?? null;
}

async function main() {
  const pool = getMysqlPool();
  try {
    const promptRepository = new PromptRepository(pool);
    const topicRepository = new TopicRepository(pool);
    const llmService = new LlmService(promptRepository);
    const topicBatchPlannerService = new TopicBatchPlannerService(llmService, topicRepository);
    const topicReviewService = new TopicReviewService(llmService);
    const reviewService = new ReviewService(llmService);
    const humanizerService = new HumanizerService();
    const topicPipelineService = new TopicPipelineService(
      llmService,
      topicRepository,
      topicBatchPlannerService,
      topicReviewService,
      reviewService,
      humanizerService
    );
    const soulService = new AccountSoulService();
    const soulDocument = await soulService.ensureSoulDocument({
      id: account.id,
      name: account.name,
      zhihuUserName: account.zhihuUserName
    });
    const promptSnapshot = await llmService.getActivePromptSnapshot();

    const candidateResult = await topicRepository.createOrGetCandidate({
      accountId: account.id,
      questionUrl,
      questionTitle: topic,
      sourceType: "production_case_research_smoke",
      sourceMetadata: {
        smokeTest: true,
        seededAt: now.toISOString(),
        note: "No manual case material is injected. Backend case research must collect its own materials."
      }
    });

    const stageLog = [];
    const preparedDraft = await topicPipelineService.prepareNextPublishableDraft({
      promptSnapshot,
      accountContext: {
        accountId: account.id,
        accountName: account.name,
        zhihuUserName: account.zhihuUserName
      },
      accountSoulMarkdown: soulDocument.markdown,
      onStage: async (stage) => {
        stageLog.push({
          stage,
          at: new Date().toISOString()
        });
      }
    });

    const candidateRow = await getCandidateRow(pool, candidateResult.id);
    const topicCardRecord =
      preparedDraft?.kind === "ready"
        ? await topicRepository.getTopicCardById(preparedDraft.topicCardId)
        : await getLatestTopicCardForCandidate(pool, candidateResult.id);
    const topicCard = topicCardRecord ? parseJson(topicCardRecord.output_json, {}) : null;
    const topicCardId = preparedDraft?.kind === "ready" ? preparedDraft.topicCardId : topicCardRecord?.id ?? null;
    const rawDraft =
      topicCardId != null ? await topicRepository.getLatestDraftForTopicCard(topicCardId, "raw") : null;
    const humanizedDraft =
      topicCardId != null ? await topicRepository.getLatestDraftForTopicCard(topicCardId, "humanized") : null;
    const review =
      preparedDraft?.kind === "ready"
        ? await topicRepository.getReviewById(preparedDraft.reviewId)
        : topicCardId != null
          ? await getLatestReviewForTopicCard(pool, topicCardId)
          : null;

    const markdown = renderReport({
      topic,
      questionUrl,
      account,
      candidateResult,
      candidateRow,
      preparedDraft,
      topicCard,
      rawDraft,
      humanizedDraft,
      review,
      stageLog,
      outputPath
    });

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown, "utf8");

    console.log(JSON.stringify({ outputPath, preparedDraft, stageLog }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
