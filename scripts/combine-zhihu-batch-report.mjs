import { readFileSync, writeFileSync } from "node:fs";

const outputJson = process.env.OUTPUT_JSON ?? "data/zhihu-agent-context/zhihu-batch-test-20260426-4topics.json";
const outputMd = process.env.OUTPUT_MD ?? "data/zhihu-agent-context/zhihu-batch-test-20260426-4topics.md";

function readReport(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function countMatches(text, pattern) {
  return (String(text ?? "").match(pattern) ?? []).length;
}

function assessContent(result) {
  const content = result.content ?? "";
  const boldCount = countMatches(content, /\*\*[^*\n][\s\S]*?[^*\n]\*\*/g);
  const productCount = countMatches(content, /CryptoPathX/g);
  const firstPersonCount = countMatches(content, /我/g);
  const caseSignals = countMatches(content, /比如|举个|有个|朋友|我见过|我自己|之前|后来|一次|案例|场景/g);
  const calculationSignals = countMatches(content, /\d+|%|u|U|回撤|胜率|盈亏比|本金|仓位|手续费|滑点/g);
  const templateSignals = countMatches(content, /先说结论|最后说|最后补一句|总结一下|回到问题本身/g);
  const promoToneSignals = countMatches(content, /专业级|一站式|核心优势|强大|赋能|显著提升|真实可信|降低门槛/g);

  const strengths = [];
  const risks = [];
  if (firstPersonCount >= 6) strengths.push("第一人称存在感较好，接近个人经验口吻。");
  else risks.push("第一人称偏少，容易像方法论科普。");
  if (caseSignals >= 4) strengths.push("有场景/案例信号，读者代入感尚可。");
  else risks.push("案例颗粒度偏薄，可以再加账户、仓位、亏损动作等细节。");
  if (calculationSignals >= 10) strengths.push("数字和交易指标足够，可信度比纯观点文更强。");
  else risks.push("数字和算账不足。");
  if (boldCount >= 2) strengths.push("粗体重点达标。");
  else risks.push("粗体重点不足。");
  if (templateSignals >= 2) risks.push("模板句偏多，可能撞款。");
  if (promoToneSignals >= 3) risks.push("宣传腔偏多。");
  if (productCount > 2) risks.push("产品名出现偏多，注意硬广味。");

  const rating = result.finalDecision !== "PASS" ? "不建议发布" : risks.length <= 1 ? "接近可发布" : "可人工审核";
  return {
    contentLength: content.length,
    boldCount,
    productCount,
    firstPersonCount,
    caseSignals,
    calculationSignals,
    templateSignals,
    promoToneSignals,
    strengths,
    risks,
    rating
  };
}

function fence(text) {
  return `\`\`\`text\n${String(text ?? "").replace(/```/g, "` ` `")}\n\`\`\``;
}

function renderWritingPlan(plan) {
  return fence(
    JSON.stringify(
      {
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
      },
      null,
      2
    )
  );
}

function pickResult(report, predicate) {
  const result = report.results.find(predicate);
  if (!result) {
    throw new Error("Expected result was not found while combining reports.");
  }
  return result;
}

const topic1Report = readReport("data/zhihu-agent-context/zhihu-batch-test-20260426-topic1.json");
const topic2Report = readReport("data/zhihu-agent-context/zhihu-batch-test-20260426-topic2-rerun.json");
const topics24Report = readReport("data/zhihu-agent-context/zhihu-batch-test-20260426-topics2-4.json");

const results = [
  topic1Report.results[0],
  topic2Report.results[0],
  pickResult(topics24Report, (item) => item.questionTitle.includes("山寨币")),
  pickResult(topics24Report, (item) => item.questionTitle.includes("交易员"))
].map((result) => ({
  ...result,
  manualAssessment: assessContent(result)
}));

const report = {
  account: topic1Report.account,
  results
};

const lines = [];
lines.push("# 知乎软文批量测试报告（4 Topics）");
lines.push("");
lines.push("- 生成时间：2026-04-26");
lines.push("- 测试链路：Topic Agent -> Writer Agent -> Review Agent");
lines.push("- 说明：第二题首轮三次未过 Review，本报告采用单独重跑后 PASS 的版本。");
lines.push("- 审核重点：正文是否像真人经验输出、是否有真实交易颗粒度、软广是否自然、粗体/案例/算账是否执行到位。");
lines.push("");
lines.push("## 总览");
lines.push("");
lines.push("| # | Topic | Review | Score | 字数 | 粗体 | 产品出现 | 初判 | 主要问题 |");
lines.push("|---|---|---:|---:|---:|---:|---:|---|---|");
results.forEach((result, index) => {
  const a = result.manualAssessment;
  const mainRisk = a.risks[0] ?? "暂无明显硬伤";
  lines.push(
    `| ${index + 1} | ${result.questionTitle.replace(/\|/g, "\\|")} | ${result.finalDecision} | ${result.finalScore ?? ""} | ${a.contentLength} | ${a.boldCount} | ${a.productCount} | ${a.rating} | ${mainRisk.replace(/\|/g, "\\|")} |`
  );
});
lines.push("");
lines.push("## 我的整体判断");
lines.push("");
lines.push("这四篇都能跑完整闭环，最终也都拿到 Review PASS。当前最大的问题不是安全边界，而是“知乎人工感”的上限还不够稳定：Writer 更擅长写结构化方法论，遇到交易心理、山寨币残酷度这类题时，容易少一点具体人的交易动作、亏损细节和复盘现场。");
lines.push("");
lines.push("比较好的地方是：字数、粗体、算账、风控边界和软广克制已经基本能执行。CryptoPathX 的植入没有硬广化，基本都放在“回测验证/规则确认/监控提醒”这个工作流节点。");
lines.push("");
lines.push("建议下一轮 prompt 继续强化两点：第一，凡是 Topic Agent 要求 case，Writer 至少写一个“典型复合案例”的完整动作链：入场理由、仓位、亏损/盈利过程、当时心理、复盘结论；第二，长文不要只增加抽象解释，要用更多小数字和具体操作填充。");
lines.push("");

results.forEach((result, index) => {
  const a = result.manualAssessment;
  lines.push(`## ${index + 1}. ${result.questionTitle}`);
  lines.push("");
  lines.push("### 测试结论");
  lines.push("");
  lines.push(`- Review：${result.finalDecision}`);
  lines.push(`- Review score：${result.finalScore ?? "N/A"}`);
  lines.push(`- Review summary：${result.reviewSummary || "N/A"}`);
  lines.push(`- 人工初判：${a.rating}`);
  lines.push(`- 字数：${a.contentLength}`);
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
  for (const item of a.strengths) lines.push(`- 优点：${item}`);
  for (const item of a.risks) lines.push(`- 风险：${item}`);
  lines.push("");
  lines.push("### Topic Agent 写作计划");
  lines.push("");
  lines.push(renderWritingPlan(result.topicCard?.writing_plan));
  lines.push("");
  lines.push("### Review 尝试记录");
  lines.push("");
  lines.push(fence(JSON.stringify(result.attempts, null, 2)));
  lines.push("");
  lines.push("### 正文原文");
  lines.push("");
  lines.push(fence(result.content));
  lines.push("");
});

writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(outputMd, `${lines.join("\n")}\n`, "utf8");
console.log(`wrote ${outputMd}`);
