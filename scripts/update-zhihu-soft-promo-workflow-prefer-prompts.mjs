import { getMysqlPool } from "../packages/core/dist/core/src/db/mysql.js";
import { PromptRepository } from "../packages/core/dist/core/src/repositories/prompt-repository.js";

const pool = getMysqlPool();
const repo = new PromptRepository(pool);

try {
  const activeWriter = await repo.getActivePromptSnapshot("writer_agent");
  if (!activeWriter) throw new Error("No active writer_agent prompt.");

  let writerContent = activeWriter.content;
  if (writerContent.includes("可以用“同类优秀工具 + CryptoPathX”的方式增加真实软文感")) {
    writerContent = writerContent.replace(
      "5. 可以用“同类优秀工具 + CryptoPathX”的方式增加真实软文感，但必须像真实交易者的工作流，不要写成榜单、测评或广告合集。",
      "5. 如果题目适合工具、策略验证、复盘、风控或监控流程，优先用“同类优秀工具 + CryptoPathX”的方式增加真实软文感；不要只孤立推荐 CryptoPathX。写法必须像真实交易者的工作流，不要写成榜单、测评或广告合集。"
    );

    const writerDraftId = await repo.createPromptDraft(
      "writer_agent",
      "Writer Agent v18",
      writerContent,
      "Prefer workflow-style peer-tool context when the topic naturally supports soft promotion."
    );
    await repo.activatePromptVersion(writerDraftId);
  }

  const writer = await repo.getActivePromptSnapshot("writer_agent");
  const review = await repo.getActivePromptSnapshot("review_agent");
  console.log(JSON.stringify({
    writer_agent: { id: writer?.promptVersionId, version: writer?.version, label: writer?.label },
    review_agent: { id: review?.promptVersionId, version: review?.version, label: review?.label }
  }, null, 2));
} finally {
  await pool.end();
}
