import { getMysqlPool } from '../packages/core/src/db/mysql.js';
import { applySchemaMigrations } from '../packages/core/src/db/sql.js';
import { PromptRepository } from '../packages/core/src/repositories/prompt-repository.js';
import { LlmService } from '../packages/core/src/services/llm-service.js';
import { ZhihuAccountLibraryRepository } from '../packages/core/src/repositories/zhihu-account-library-repository.js';
import { AccountSoulService } from '../packages/core/src/services/account-soul-service.js';
import { PromptSetName, PromptSnapshotMap } from '@zhihu-mvp/shared';

// 测试用的 topic
const TOPIC_URL = 'https://www.zhihu.com/question/2022867484454261513';
const TOPIC_TITLE = '量化策略快速上线和深度优化如何权衡？';
const TARGET_ACCOUNT_ID = 1;
const TARGET_ACCOUNT_NAME = 'Default Zhihu Account';
const TARGET_ACCOUNT_ZHIHU = '二牛是个老实人';

// 模拟的 topic research 结果（精简版）
const RESEARCH_SUMMARY = `## 问题核心
- 量化策略上线时机：快速验证 vs 充分回测的矛盾
- 上线过早可能暴露于未知风险，过度优化可能导致过拟合和机会成本
- 市场变化快，策略生命周期有限

## 关键数据
- 主流观点：小资金快速上线验证，大资金充分优化后再上
- 常见做法：先用 5%-10% 资金跑实盘，观察 1-3 个月后再决定是否加大
- 过拟合风险：回测参数超过 3 层嵌套，实盘效果通常打折 50% 以上
- 时间窗口：加密市场策略半衰期约 2-6 个月，传统市场更长

## 争议点
- 有人主张"先跑起来再说"，有人坚持"没回测够一年不上"
- 高频策略和低频策略对优化深度的要求不同
- 个人交易者和机构风控标准差异巨大`;

async function main() {
  console.log('🚀 Writer Agent 对比测试\n');
  console.log(`📌 Topic: ${TOPIC_TITLE}`);
  console.log(`👤 账户: ${TARGET_ACCOUNT_NAME} (${TARGET_ACCOUNT_ZHIHU})\n`);

  const pool = getMysqlPool();
  await applySchemaMigrations(pool);

  const promptRepo = new PromptRepository(pool);
  const llmService = new LlmService(promptRepo);
  const libraryRepo = new ZhihuAccountLibraryRepository();
  const soulService = new AccountSoulService();

  const account = { id: TARGET_ACCOUNT_ID, name: TARGET_ACCOUNT_NAME, zhihuUserName: TARGET_ACCOUNT_ZHIHU };
  const resolution = await libraryRepo.ensureAccountLibraryForAccount(account);
  const accountKey = resolution.accountKey;
  const soulDoc = await soulService.ensureSoulDocument(account);

  // 读取二牛的账户资产
  console.log('📂 正在读取二牛的账户资产...\n');
  const fs = await import('node:fs/promises');

  async function readFileSafe(path: string) {
    try { return await fs.readFile(path, 'utf8'); }
    catch { return ''; }
  }

  const libDir = libraryRepo.getAccountLibraryPath(accountKey);
  const styleRules = await readFileSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'style_rules.md'));
  const structureRules = await readFileSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'answer_structure_rules.md'));
  const evidenceRules = await readFileSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'evidence_rules.md'));
  const reviewRubric = await readFileSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'review_rubric.md'));
  const goodAnswers = await readFileSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'good_answers.jsonl'));
  const badAnswers = await readFileSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'bad_answers.jsonl'));

  console.log(`  Style Rules: ${styleRules ? '✅' : '❌'} (${styleRules.length} chars)`);
  console.log(`  Structure Rules: ${structureRules ? '✅' : '❌'} (${structureRules.length} chars)`);
  console.log(`  Evidence Rules: ${evidenceRules ? '✅' : '❌'} (${evidenceRules.length} chars)`);
  console.log(`  Review Rubric: ${reviewRubric ? '✅' : '❌'} (${reviewRubric.length} chars)`);
  console.log(`  Good Answers: ${goodAnswers ? '✅' : '❌'} (${goodAnswers.split('\n').filter(Boolean).length} 条)`);
  console.log(`  Bad Answers: ${badAnswers ? '✅' : '❌'} (${badAnswers.split('\n').filter(Boolean).length} 条)\n`);

  // Writer prompt 模板
  const writerSystemPrompt = `你是知乎答主"${TARGET_ACCOUNT_ZHIHU}"的写作代理。你需要根据问题和研究摘要，写一篇知乎回答。

写作要求：
1. 观点必须前置，开篇直接给判断或切入问题本质
2. 用自然段落，不要用提纲式结构
3. 可以带个人判断和经验，但不要装全知专家
4. 数字和例子要服务判断，不要堆砌
5. 结尾落脚于现实建议或不确定性，不要喊口号
6. 字数约 800-1200 字
7. 只输出回答正文，不要解释、不要 Markdown 标题、不要前后缀`;

  // 附加资产规则（带资产模式用）
  const assetPromptSuffix = styleRules || structureRules || evidenceRules || reviewRubric
    ? `\n\n## 你的写作必须遵守以下账户规则：\n\n### Style Rules\n${styleRules || '(无)'}\n\n### Structure Rules\n${structureRules || '(无)'}\n\n### Evidence Rules\n${evidenceRules || '(无)'}\n\n### Review Rubric\n${reviewRubric || '(无)'}`
    : '';

  // 附加示例（带资产模式用）
  const examplesPrompt = goodAnswers && badAnswers
    ? `\n\n## 参考示例\n\n### 好的回答风格（学习）：\n${(goodAnswers || '').split('\n').filter(Boolean).slice(0, 2).map((line) => { try { return JSON.parse(line).text || ''; } catch { return ''; } }).filter(Boolean).join('\n\n')}\n\n### 不好的回答风格（避免）：\n${(badAnswers || '').split('\n').filter(Boolean).slice(0, 2).map((line) => { try { return JSON.parse(line).text || ''; } catch { return ''; } }).filter(Boolean).join('\n\n')}`
    : '';

  // ============ 测试 A：不带账户资产 ============
  console.log('\n' + '='.repeat(60));
  console.log('📝 测试 A：不带账户资产（纯 LLM 默认风格）');
  console.log('='.repeat(60));

  const inputA = {
    questionTitle: TOPIC_TITLE,
    questionUrl: TOPIC_URL,
    researchSummary: RESEARCH_SUMMARY,
    accountSoul: soulDoc.markdown,
    assetRules: '',
    examples: '',
  };

  let resultA: string;
  const timerA = setInterval(() => process.stdout.write(`\r   ⏳ A: 已运行 ${Math.round((Date.now() - Date.now() + 0) / 1000)}s...`), 2000);
  const startA = Date.now();
  const timerA2 = setInterval(() => {
    const elapsed = Math.round((Date.now() - startA) / 1000);
    process.stdout.write(`\r   ⏳ A: 已运行 ${elapsed}s...`);
  }, 2000);

  try {
    const textA = await llmService.runPrompt('writer_agent' as PromptSetName, inputA);
    clearInterval(timerA2);
    const elapsedA = Math.round((Date.now() - startA) / 1000);
    resultA = textA;

    console.log(`\n\n✅ A 完成 (耗时: ${elapsedA}s)\n`);
    console.log('--- A 的回答内容 ---');
    console.log(resultA);
    console.log('--- A 的回答结束 ---\n');
  } catch (e: any) {
    clearInterval(timerA2);
    console.error('\n❌ A 失败:', e.message);
    resultA = '(生成失败)';
  }

  // ============ 测试 B：带二牛账户资产 ============
  console.log('\n' + '='.repeat(60));
  console.log('📝 测试 B：带二牛账户资产（应用刚 learn 的规则）');
  console.log('='.repeat(60));

  const inputB = {
    questionTitle: TOPIC_TITLE,
    questionUrl: TOPIC_URL,
    researchSummary: RESEARCH_SUMMARY,
    accountSoul: soulDoc.markdown,
    assetRules: assetPromptSuffix + examplesPrompt,
    examples: '',
  };

  let resultB: string;
  const startB = Date.now();
  const timerB = setInterval(() => {
    const elapsed = Math.round((Date.now() - startB) / 1000);
    process.stdout.write(`\r   ⏳ B: 已运行 ${elapsed}s...`);
  }, 2000);

  try {
    const textB = await llmService.runPrompt('writer_agent' as PromptSetName, inputB);
    clearInterval(timerB);
    const elapsedB = Math.round((Date.now() - startB) / 1000);
    resultB = textB;

    console.log(`\n\n✅ B 完成 (耗时: ${elapsedB}s)\n`);
    console.log('--- B 的回答内容 ---');
    console.log(resultB);
    console.log('--- B 的回答结束 ---\n');
  } catch (e: any) {
    clearInterval(timerB);
    console.error('\n❌ B 失败:', e.message);
    resultB = '(生成失败)';
  }

  // ============ 对比总结 ============
  console.log('\n' + '='.repeat(60));
  console.log('📊 对比总结');
  console.log('='.repeat(60));

  console.log('\n📏 基本指标:');
  console.log(`  A (不带资产): ${resultA.length} 字符, ${resultA.split('\n').length} 行`);
  console.log(`  B (带资产):   ${resultB.length} 字符, ${resultB.split('\n').length} 行`);

  console.log('\n🔍 请人工对比以下维度:');
  console.log('  1. 开头是否前置了核心判断？');
  console.log('  2. 是否使用了"首先/其次/最后"等僵硬过渡？');
  console.log('  3. 数字是否带时间窗口/语境解读？');
  console.log('  4. 结尾是否落脚于不确定性或现实建议？');
  console.log('  5. 是否有"综上所述/总而言之"等 AI 痕迹？');
  console.log('  6. 整体读起来哪个更像真人答主？');

  await pool.end();
}

main().catch(err => {
  console.error('💥 错误:', err);
  process.exit(1);
});
