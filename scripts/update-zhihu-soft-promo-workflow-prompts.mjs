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
  const activeWriter = await repo.getActivePromptSnapshot("writer_agent");
  if (!activeWriter) throw new Error("No active writer_agent prompt.");

  let writerContent = activeWriter.content;
  if (!writerContent.includes("同类优秀工具 + CryptoPathX")) {
    writerContent = replaceOnce(
      writerContent,
      `5. 只选择和当前问题最相关的 1 到 2 个真实能力，不要堆功能。
6. 不要把 CryptoPathX 写成赚钱工具、预测工具、交易所、跟单工具、自动下单工具或实盘执行终端。
7. 不要写“对比预测功能”“告诉你后面大概率怎么走”“80% 概率会跌”这类预测话术。正确写法是：历史相似走势对比、可视化回测、检查规则在历史数据里的表现。
8. 不要写“强烈推荐”“神器”“必备”“提高胜率”“稳定盈利”“保证赚钱”。
9. 如果提其他工具，只能点到为止，不要为了显得真实而堆名字。`,
      `5. 可以用“同类优秀工具 + CryptoPathX”的方式增加真实软文感，但必须像真实交易者的工作流，不要写成榜单、测评或广告合集。
6. 合适时可以自然提到 1 到 3 个同类工具作为参照，例如 TradingView 做图表观察，CoinGlass 看资金/合约情绪，Glassnode 或 CryptoQuant 看链上数据，Backtrader、QuantConnect 或 Python 脚本适合会写代码的人做回测。只能写这些工具广为人知的典型用途，不要编造价格、效果、覆盖范围或具体数据。
7. 突出 CryptoPathX 的优势时，要落在它真实更适合的环节：把主观想法转成可视化策略条件、用历史数据做回测、查看胜率/盈亏比/最大回撤、让 AI 辅助解读回测结果、用条件监控减少盯盘。不要泛泛说“更好用”。
8. 常见自然写法是：先承认我会用 A 看图、用 B 看市场情绪或链上数据；但到了“把交易想法变成可验证规则”这一步，我会转到 CryptoPathX，因为它对不会写代码的人更友好，也更贴合先验证再交易的流程。
9. 不要贬低同类工具，不要写“吊打”“完爆”“唯一选择”；优势表达要克制，用“更适合这一步”“省掉搭环境的麻烦”“更容易把规则跑成数据”这类说法。
10. 只选择和当前问题最相关的 1 到 2 个 CryptoPathX 真实能力，不要堆功能。
11. 不要把 CryptoPathX 写成赚钱工具、预测工具、交易所、跟单工具、自动下单工具或实盘执行终端。
12. 不要写“对比预测功能”“告诉你后面大概率怎么走”“80% 概率会跌”这类预测话术。正确写法是：历史相似走势对比、可视化回测、检查规则在历史数据里的表现。
13. 不要写“强烈推荐”“神器”“必备”“提高胜率”“稳定盈利”“保证赚钱”。
14. 如果题目不是工具选择、策略验证、复盘、风控或监控场景，不要为了软文感硬塞竞品名。`,
      "writer soft-promo workflow rules"
    );

    const writerDraftId = await repo.createPromptDraft(
      "writer_agent",
      "Writer Agent v17",
      writerContent,
      "Allow natural workflow-style mentions of peer research tools while positioning CryptoPathX advantages."
    );
    await repo.activatePromptVersion(writerDraftId);
  }

  const activeReview = await repo.getActivePromptSnapshot("review_agent");
  if (!activeReview) throw new Error("No active review_agent prompt.");

  let reviewContent = activeReview.content;
  if (!reviewContent.includes("同类研究、图表、链上数据或回测工具")) {
    reviewContent = replaceOnce(
      reviewContent,
      `11. 只输出 JSON，不要解释，不要 Markdown。`,
      `11. 允许正文自然提到同类研究、图表、链上数据或回测工具作为工作流参照，例如 TradingView、CoinGlass、Glassnode、CryptoQuant、Backtrader、QuantConnect、Python 脚本等；不要默认把这些视为违规或跑题。
12. 如果正文同时提到 CryptoPathX 和同类工具，只要它清楚说明 CryptoPathX 在“规则可视化、回测验证、AI 解读、复盘或监控提醒”这一步的具体优势，并且没有贬低竞品或夸大效果，通常应 PASS。
13. 如果出现竞品拉踩、虚假对比、交易所/交易平台推荐、收益承诺、预测涨跌、暗示自动跟单或自动下单，应 REVISE 或 BLOCK。
14. 只输出 JSON，不要解释，不要 Markdown。`,
      "review peer-tool workflow rules"
    );

    const reviewDraftId = await repo.createPromptDraft(
      "review_agent",
      "Review Agent v4",
      reviewContent,
      "Accept natural peer-tool workflow mentions while guarding against hard ads, bashing, and unsupported claims."
    );
    await repo.activatePromptVersion(reviewDraftId);
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
