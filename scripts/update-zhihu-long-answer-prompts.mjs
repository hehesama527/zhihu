import { getMysqlPool } from "../packages/core/dist/core/src/db/mysql.js";
import { PromptRepository } from "../packages/core/dist/core/src/repositories/prompt-repository.js";

function replaceOnce(content, from, to, label) {
  if (!content.includes(from)) {
    throw new Error(`Missing expected prompt fragment: ${label}`);
  }
  return content.replace(from, to);
}

function replaceLine(lines, predicate, replacement, label) {
  const index = lines.findIndex(predicate);
  if (index < 0) {
    throw new Error(`Missing expected prompt line: ${label}`);
  }
  lines.splice(index, 1, ...replacement.split("\n"));
}

const pool = getMysqlPool();
const repo = new PromptRepository(pool);

try {
  const activeTopic = await repo.getActivePromptSnapshot("topic_agent");
  if (!activeTopic) {
    throw new Error("No active topic_agent prompt.");
  }

  let topicContent = activeTopic.content;
  if (!topicContent.includes("2000-3500 Chinese characters")) {
    topicContent = replaceOnce(
      topicContent,
      `6. target_words_min is a hard lower bound for Writer. target_words_max is only a soft reference; it is acceptable for Writer to exceed it when the topic needs more substance.
7. If cases are needed, prefer realistic composite cases with plausible market data ranges. Do not instruct Writer to fabricate verified real friends, real profit records, or exact personal statistics.
8. For standard/long answers, set should_use_bold=true and provide bold_targets such as core conclusion, risk boundary, calculation takeaway, operating principle, or product boundary.
9. suggested_sections are planning cues, not mandatory literal headings. Avoid repeating the same opening and closing labels across similar topics.
10. Keep reasons concise and operational.`,
      `6. target_words_min is a hard lower bound for Writer. target_words_max is only a soft reference; it is acceptable for Writer to exceed it when the topic needs more substance.
7. Prefer fuller Zhihu answers over short answers. For normal publishable topics, use 2000-3500 Chinese characters as the default range. Do not tightly control length; only keep the final answer under 5000 Chinese characters.
8. Use short only for very narrow factual questions. Most trading psychology, strategy, beginner, capital, review, and soft-promo-friendly topics should be long.
9. If cases are needed, prefer realistic composite cases with plausible market data ranges. Do not instruct Writer to fabricate verified real friends, real profit records, or exact personal statistics.
10. For standard/long answers, set should_use_bold=true and provide bold_targets such as core conclusion, risk boundary, calculation takeaway, operating principle, or product boundary.
11. suggested_sections are planning cues, not mandatory literal headings. Avoid repeating the same opening and closing labels across similar topics.
12. Keep reasons concise and operational.`,
      "topic length rules"
    );
  }
  topicContent = topicContent.replace(`"target_words_min": 900,`, `"target_words_min": 2000,`);
  topicContent = topicContent.replace(`"target_words_max": 1300,`, `"target_words_max": 3500,`);

  if (!activeTopic.content.includes("2000-3500 Chinese characters")) {
    const topicDraftId = await repo.createPromptDraft(
      "topic_agent",
      "Topic Agent v13",
      topicContent,
      "Widened Zhihu answer length planning: default 2000-3500 chars, under 5000 chars."
    );
    await repo.activatePromptVersion(topicDraftId);
  }

  const activeWriter = await repo.getActivePromptSnapshot("writer_agent");
  if (!activeWriter) {
    throw new Error("No active writer_agent prompt.");
  }

  if (!activeWriter.content.includes("正文优先写到 2000-3500 字之间")) {
    const writerLines = activeWriter.content.split("\n");
    replaceLine(
      writerLines,
      (line) => line.includes("writing_plan.target_words_min"),
      `7. writing_plan.target_words_min 是硬下限，正文可以超过 target_words_max，但不能明显低于 target_words_min。
8. 长文默认写足，不要为了控制篇幅而压缩案例、算账和复盘细节；除非题目非常窄，否则正文优先写到 2000-3500 字之间。
9. 长度不需要精确控制，但正文不要超过 5000 字；增加篇幅时必须增加具体场景、动作链、数字、反例和复盘细节，不要重复同一个观点。`,
      "writer length priority"
    );
    replaceLine(
      writerLines,
      (line) => line.startsWith("2.") && line.includes("3") && line.includes("6"),
      "2. 中段用 6 到 10 个自然段展开，每段只解决一个具体问题。",
      "writer paragraph range"
    );
    replaceLine(
      writerLines,
      (line) => line.includes("**") && line.includes("2") && line.includes("4"),
      "5. 标准/长文必须使用 **加粗** 强调关键判断、风险边界、算账结论或操作原则，全文建议 3 到 6 处；不要整段加粗，不要把加粗当标题用。",
      "writer bold range"
    );

    const writerDraftId = await repo.createPromptDraft(
      "writer_agent",
      "Writer Agent v14",
      writerLines.join("\n"),
      "Widened long-answer target and required fuller case/calculation/review detail."
    );
    await repo.activatePromptVersion(writerDraftId);
  }

  const topic = await repo.getActivePromptSnapshot("topic_agent");
  const writer = await repo.getActivePromptSnapshot("writer_agent");
  console.log(JSON.stringify({
    topic_agent: { id: topic?.promptVersionId, version: topic?.version, label: topic?.label },
    writer_agent: { id: writer?.promptVersionId, version: writer?.version, label: writer?.label }
  }, null, 2));
} finally {
  await pool.end();
}
