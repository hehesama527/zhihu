import { getMysqlPool } from "../packages/core/dist/core/src/db/mysql.js";
import { PromptRepository } from "../packages/core/dist/core/src/repositories/prompt-repository.js";

function replaceOnce(content, from, to, label) {
  if (!content.includes(from)) {
    throw new Error(`Missing expected prompt fragment: ${label}`);
  }
  return content.replace(from, to);
}

const pool = getMysqlPool();
const repo = new PromptRepository(pool);

try {
  const activeTopic = await repo.getActivePromptSnapshot("topic_agent");
  if (!activeTopic) throw new Error("No active topic_agent prompt.");

  let topicContent = activeTopic.content;
  if (!topicContent.includes("target_words_min around 2000")) {
    topicContent = replaceOnce(
      topicContent,
      `7. Prefer fuller Zhihu answers over short answers. For normal publishable topics, use 2000-3500 Chinese characters as the default range. Do not tightly control length; only keep the final answer under 5000 Chinese characters.
8. Use short only for very narrow factual questions.`,
      `7. Prefer fuller Zhihu answers over short answers. For normal publishable topics, set target_words_min around 2000 and use 2000-3500 Chinese characters as the default fullness range. Do not tightly control length; only keep the final answer under 5000 Chinese characters.
8. Do not set target_words_min above 2200 unless the topic explicitly needs a very deep essay. If a topic needs more depth, increase target_words_max and writer_notes instead of raising the hard lower bound too much.
9. Use short only for very narrow factual questions.`,
      "topic relaxed length rule"
    );
    topicContent = topicContent
      .replace(/^9\. If cases are needed,/m, "10. If cases are needed,")
      .replace(/^10\. For standard\/long answers,/m, "11. For standard/long answers,")
      .replace(/^11\. suggested_sections/m, "12. suggested_sections")
      .replace(/^12\. Keep reasons/m, "13. Keep reasons");

    const topicDraftId = await repo.createPromptDraft(
      "topic_agent",
      "Topic Agent v14",
      topicContent,
      "Relaxed long-answer lower bound: target around 2000, keep under 5000."
    );
    await repo.activatePromptVersion(topicDraftId);
  }

  const activeWriter = await repo.getActivePromptSnapshot("writer_agent");
  if (!activeWriter) throw new Error("No active writer_agent prompt.");

  let writerContent = activeWriter.content;
  if (writerContent.includes("正文优先写到 2000-3500 字之间")) {
    writerContent = writerContent.replace(
      "8. 长文默认写足，不要为了控制篇幅而压缩案例、算账和复盘细节；除非题目非常窄，否则正文优先写到 2000-3500 字之间。",
      "8. 长文默认写足，不要为了控制篇幅而压缩案例、算账和复盘细节；除非题目非常窄，否则正文优先写到 2000 字以上，理想区间是 2000-3500 字。"
    );
    const writerDraftId = await repo.createPromptDraft(
      "writer_agent",
      "Writer Agent v15",
      writerContent,
      "Relaxed long-answer target: write over 2000 when useful, avoid padding, keep under 5000."
    );
    await repo.activatePromptVersion(writerDraftId);
  }

  const activeReview = await repo.getActivePromptSnapshot("review_agent");
  if (!activeReview) throw new Error("No active review_agent prompt.");

  let reviewContent = activeReview.content;
  if (!reviewContent.includes("长度审核不要机械卡 target_words_min")) {
    reviewContent = replaceOnce(
      reviewContent,
      `8. 只输出 JSON，不要解释，不要 Markdown。`,
      `8. 长度审核不要机械卡 target_words_min。当前策略是：2000-3500 字都可以，长度无需精确控制，但正文不得超过 5000 字。
9. 如果正文已经超过约 2000 字，并且案例、算账、复盘或操作细节足够，不要仅因为没有达到 topicCard.writing_plan.target_words_min 就 REVISE。
10. 只有当正文明显单薄、低于约 1800 字、缺少写作计划要求的案例/算账/列表/加粗，或超过 5000 字时，才因为长度或结构要求 REVISE。
11. 只输出 JSON，不要解释，不要 Markdown。`,
      "review relaxed length rule"
    );
    const reviewDraftId = await repo.createPromptDraft(
      "review_agent",
      "Review Agent v3",
      reviewContent,
      "Relaxed length review: do not block substantive 2000+ char answers solely for target min mismatch; enforce 5000 cap."
    );
    await repo.activatePromptVersion(reviewDraftId);
  }

  const topic = await repo.getActivePromptSnapshot("topic_agent");
  const writer = await repo.getActivePromptSnapshot("writer_agent");
  const review = await repo.getActivePromptSnapshot("review_agent");
  console.log(JSON.stringify({
    topic_agent: { id: topic?.promptVersionId, version: topic?.version, label: topic?.label },
    writer_agent: { id: writer?.promptVersionId, version: writer?.version, label: writer?.label },
    review_agent: { id: review?.promptVersionId, version: review?.version, label: review?.label }
  }, null, 2));
} finally {
  await pool.end();
}
