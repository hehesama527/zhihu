import { readFileSync, writeFileSync } from "node:fs";

const relaxed = JSON.parse(readFileSync("data/zhihu-agent-context/zhihu-batch-test-20260426-4topics-long-relaxed.json", "utf8"));
const target2200 = JSON.parse(readFileSync("data/zhihu-agent-context/zhihu-batch-test-20260426-4topics-long-2200.json", "utf8"));

const outputJson = "data/zhihu-agent-context/zhihu-batch-test-20260426-4topics-long-final.json";
const outputMd = "data/zhihu-agent-context/zhihu-batch-test-20260426-4topics-long-final.md";

function boldCount(content) {
  return (content.match(/\*\*[^*\n][\s\S]*?[^*\n]\*\*/g) ?? []).length;
}

function productCount(content) {
  return (content.match(/CryptoPathX/g) ?? []).length;
}

function countMatches(text, pattern) {
  return (String(text ?? "").match(pattern) ?? []).length;
}

function assessContent(result) {
  const content = result.content ?? "";
  const risks = [];
  const strengths = [];
  const firstPersonCount = countMatches(content, /我/g);
  const caseSignals = countMatches(content, /比如|举个|有个|朋友|我见过|我自己|之前|后来|一次|案例|场景|典型/g);
  const calculationSignals = countMatches(content, /\d+|%|u|U|回撤|胜率|盈亏比|本金|仓位|手续费|滑点/g);
  const templateSignals = countMatches(content, /先说结论|最后说|最后补一句|总结一下|回到问题本身/g);
  const promoToneSignals = countMatches(content, /专业级|一站式|核心优势|强大|赋能|显著提升|真实可信|降低门槛/g);

  if (content.length >= 2000) strengths.push("篇幅达到 2000+，比上一轮更接近长文形态。");
  else risks.push("篇幅略低于 2000，需要人工判断是否仍显单薄。");
  if (boldCount(content) >= 2) strengths.push("粗体重点达标。");
  else risks.push("粗体不足，重点不够抓眼。");
  if (firstPersonCount >= 5) strengths.push("第一人称有一定存在感。");
  else risks.push("第一人称偏少，容易像方法论科普。");
  if (caseSignals >= 5) strengths.push("有场景/案例信号，具备一定代入感。");
  else risks.push("案例颗粒度偏薄，可以再加账户、仓位、亏损动作等细节。");
  if (calculationSignals >= 10) strengths.push("数字和交易指标足够，可信度比纯观点文更强。");
  else risks.push("数字和算账不足。");
  if (templateSignals >= 2) risks.push("模板句偏多，可能撞款。");
  if (promoToneSignals >= 3) risks.push("宣传腔偏多。");

  return {
    contentLength: content.length,
    paragraphCount: content.split(/\n+/).filter((line) => line.trim()).length,
    boldCount: boldCount(content),
    productCount: productCount(content),
    firstPersonCount,
    caseSignals,
    calculationSignals,
    templateSignals,
    promoToneSignals,
    rating: result.finalDecision !== "PASS" ? "不建议发布" : risks.length <= 1 ? "接近可发布" : "可人工审核",
    strengths,
    risks
  };
}

function scoreCandidate(result) {
  const content = result.content ?? "";
  let score = 0;
  if (result.finalDecision === "PASS") score += 10000;
  score += Math.min(content.length, 3500);
  if (content.length >= 2000) score += 1200;
  score += boldCount(content) * 120;
  score += productCount(content) * 40;
  score += (result.finalScore ?? 0) * 10;
  if (content.length > 5000) score -= 10000;
  return score;
}

function fence(text) {
  return `\`\`\`text\n${String(text ?? "").replace(/```/g, "` ` `")}\n\`\`\``;
}

function renderPlan(plan) {
  return fence(JSON.stringify({
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
  }, null, 2));
}

const allByTopic = new Map();
for (const result of [...relaxed.results, ...target2200.results]) {
  const list = allByTopic.get(result.questionTitle) ?? [];
  list.push(result);
  allByTopic.set(result.questionTitle, list);
}

const topicOrder = target2200.results.map((item) => item.questionTitle);
const results = topicOrder.map((title) => {
  const candidates = allByTopic.get(title) ?? [];
  const picked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
  return {
    ...picked,
    selectedFrom: picked.content === target2200.results.find((item) => item.questionTitle === title)?.content ? "long-2200" : "long-relaxed",
    manualAssessment: assessContent(picked)
  };
});

const report = { account: target2200.account, results };
writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const lines = [];
lines.push("# 知乎软文批量测试报告（长文最佳版）");
lines.push("");
lines.push("- 生成时间：2026-04-26");
lines.push("- 测试链路：Topic Agent -> Writer Agent -> Review Agent");
lines.push("- 长度策略：目标 2000-3500 字，不机械控字数，硬上限 5000 字。");
lines.push("- 选择策略：从 `long-relaxed` 与 `long-2200` 两轮 PASS 结果中，为每个 topic 选择更接近长文、有粗体、有案例/算账的版本。");
lines.push("");
lines.push("## 总览");
lines.push("");
lines.push("| # | Topic | 来源 | Review | Score | 字数 | 粗体 | 产品出现 | 初判 | 主要问题 |");
lines.push("|---|---|---|---:|---:|---:|---:|---:|---|---|");
results.forEach((result, index) => {
  const a = result.manualAssessment;
  lines.push(`| ${index + 1} | ${result.questionTitle.replace(/\|/g, "\\|")} | ${result.selectedFrom} | ${result.finalDecision} | ${result.finalScore ?? ""} | ${a.contentLength} | ${a.boldCount} | ${a.productCount} | ${a.rating} | ${(a.risks[0] ?? "暂无明显硬伤").replace(/\|/g, "\\|")} |`);
});
lines.push("");
lines.push("## 我的整体判断");
lines.push("");
lines.push("这版比上一轮短文明显厚一些。1、2、4 都稳定在 2200 字以上；第三题选用上一轮 2052 字版本，因为最新一轮虽然 PASS，但只有 1846 字且没有粗体，不适合作为人工审核主版本。");
lines.push("");
lines.push("当前仍然最值得继续优化的是“具体人的动作链”：有些篇章已经有数字和逻辑，但还可以多写一点入场时的心理、仓位怎么拆、亏损后怎么复盘，少一点抽象方法论。");
lines.push("");

results.forEach((result, index) => {
  const a = result.manualAssessment;
  lines.push(`## ${index + 1}. ${result.questionTitle}`);
  lines.push("");
  lines.push("### 测试结论");
  lines.push("");
  lines.push(`- 来源：${result.selectedFrom}`);
  lines.push(`- Review：${result.finalDecision}`);
  lines.push(`- Review score：${result.finalScore ?? "N/A"}`);
  lines.push(`- Review summary：${result.reviewSummary || "N/A"}`);
  lines.push(`- 人工初判：${a.rating}`);
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
  for (const item of a.strengths) lines.push(`- 优点：${item}`);
  for (const item of a.risks) lines.push(`- 风险：${item}`);
  lines.push("");
  lines.push("### Topic Agent 写作计划");
  lines.push("");
  lines.push(renderPlan(result.topicCard?.writing_plan));
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

writeFileSync(outputMd, `${lines.join("\n")}\n`, "utf8");
console.log(`wrote ${outputMd}`);
