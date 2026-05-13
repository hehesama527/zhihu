import { getMysqlPool } from "../packages/core/dist/core/src/db/mysql.js";
import { PromptRepository } from "../packages/core/dist/core/src/repositories/prompt-repository.js";

const pool = getMysqlPool();
const repo = new PromptRepository(pool);

try {
  const activeTopic = await repo.getActivePromptSnapshot("topic_agent");
  if (!activeTopic) throw new Error("No active topic_agent prompt.");
  let topicContent = activeTopic.content;
  if (!topicContent.includes("target_words_min around 2200")) {
    topicContent = topicContent
      .replace("set target_words_min around 2000", "set target_words_min around 2200")
      .replace("Do not set target_words_min above 2200", "Do not set target_words_min above 2400");
    const topicDraftId = await repo.createPromptDraft(
      "topic_agent",
      "Topic Agent v15",
      topicContent,
      "Raise default fullness target from around 2000 to around 2200 while keeping 5000 hard cap."
    );
    await repo.activatePromptVersion(topicDraftId);
  }

  const activeWriter = await repo.getActivePromptSnapshot("writer_agent");
  if (!activeWriter) throw new Error("No active writer_agent prompt.");
  let writerContent = activeWriter.content;
  if (!writerContent.includes("正文优先写到 2200 字左右或以上")) {
    writerContent = writerContent.replace(
      "8. 长文默认写足，不要为了控制篇幅而压缩案例、算账和复盘细节；除非题目非常窄，否则正文优先写到 2000 字以上，理想区间是 2000-3500 字。",
      "8. 长文默认写足，不要为了控制篇幅而压缩案例、算账和复盘细节；除非题目非常窄，否则正文优先写到 2200 字左右或以上，理想区间是 2000-3500 字。"
    );
    const writerDraftId = await repo.createPromptDraft(
      "writer_agent",
      "Writer Agent v16",
      writerContent,
      "Raise practical long-answer fullness target to roughly 2200+ chars without padding."
    );
    await repo.activatePromptVersion(writerDraftId);
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
