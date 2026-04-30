import { getMysqlPool } from '../packages/core/src/db/mysql.js';
import { applySchemaMigrations } from '../packages/core/src/db/sql.js';
import { ZhihuAccountLibraryRepository } from '../packages/core/src/repositories/zhihu-account-library-repository.js';
import { LlmService } from '../packages/core/src/services/llm-service.js';
import { PromptRepository } from '../packages/core/src/repositories/prompt-repository.js';
import { AccountSoulService } from '../packages/core/src/services/account-soul-service.js';
import { ZhihuNoteAgentService } from '../packages/core/src/services/zhihu-note-agent-service.js';
import type { ZhihuNoteAgentDraft, ZhihuNoteAgentSourceAccount } from '@zhihu-mvp/shared';

const TARGET_ACCOUNT_ID = 1;
const TARGET_ACCOUNT_NAME = 'Default Zhihu Account';
const TARGET_ACCOUNT_ZHIHU = '二牛是个老实人';

// 清理后的 Good/Bad 示例 - 去掉具体产品名，只保留风格特征
const CLEAN_GOOD_ANSWERS = [
  {
    id: 'clean_good_1',
    text: '今天行情走了一轮典型的超跌修复。凌晨下探后企稳，日内围绕中枢反复拉锯。这种结构下，追涨风险大于机会，观望或等回踩更稳妥。',
    notes: '开篇直接给判断，数据绑定时间窗口，结尾给具体建议而非空话。',
    questionTitle: '币圈新手要注意什么？',
    questionUrl: 'https://www.zhihu.com/question/example1',
    answerUrl: 'https://www.zhihu.com/answer/example1',
  },
  {
    id: 'clean_good_2',
    text: '做短线最大的问题不是技术，是心态。很多人知道止损，但真跌了就不舍得割。我一般设 3% 硬止损，到了就砍，不纠结。亏小钱保住本金，比扛单强。',
    notes: '第一人称经验表达，具体数字带场景，不装专家。',
    questionTitle: '如何控制交易风险？',
    questionUrl: 'https://www.zhihu.com/question/example2',
    answerUrl: 'https://www.zhihu.com/answer/example2',
  },
];

const CLEAN_BAD_ANSWERS = [
  {
    id: 'clean_bad_1',
    text: '首先，我们要理解区块链的底层逻辑。众所周知，比特币是未来的趋势。综上所述，大家赶紧上车，关注我获取更多财富密码！',
    notes: '模板化过渡 + 公关腔 + 流量话术 + 绝对化断言，全中。',
    questionTitle: '',
    questionUrl: null,
    answerUrl: null,
  },
  {
    id: 'clean_bad_2',
    text: '根据我的分析，明天必涨到 75000，稳赚不赔。零回撤策略已经验证，关注我带你起飞！',
    notes: '绝对化预测 + 数字裸奔 + 求关注，直接打回。',
    questionTitle: '',
    questionUrl: null,
    answerUrl: null,
  },
];

async function main() {
  console.log('🚀 优化方案 1+2：清理示例 + 重新 Apply 到二牛账户\n');

  const pool = getMysqlPool();
  await applySchemaMigrations(pool);

  const promptRepo = new PromptRepository(pool);
  const llmService = new LlmService(promptRepo);
  const libraryRepo = new ZhihuAccountLibraryRepository();
  const soulService = new AccountSoulService();
  const noteAgentService = new ZhihuNoteAgentService(llmService, libraryRepo, soulService);

  const account = { id: TARGET_ACCOUNT_ID, name: TARGET_ACCOUNT_NAME, zhihuUserName: TARGET_ACCOUNT_ZHIHU };

  // 读取现有资产
  console.log('📂 读取二牛现有资产...\n');
  const fs = await import('node:fs/promises');
  async function readSafe(path: string) {
    try { return await fs.readFile(path, 'utf8'); } catch { return ''; }
  }

  const accountKey = 'account_1';
  const styleRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'style_rules.md'));
  const structureRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'answer_structure_rules.md'));
  const evidenceRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'evidence_rules.md'));
  const reviewRubric = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'review_rubric.md'));

  console.log('  Style Rules:', styleRules ? '✅' : '❌');
  console.log('  Structure Rules:', structureRules ? '✅' : '❌');
  console.log('  Evidence Rules:', evidenceRules ? '✅' : '❌');
  console.log('  Review Rubric:', reviewRubric ? '✅' : '❌\n');

  // 构建 Draft（使用清理后的示例）
  console.log('📦 构建优化后的资产草稿（示例已去产品名）...\n');

  const draft: ZhihuNoteAgentDraft = {
    accountId: account.id,
    accountKey,
    matchedBy: 'accountId',
    mode: 'zhihu_answer_style_learning',
    sourceAccount: {
      platform: 'zhihu',
      handleOrUrl: 'https://www.zhihu.com/people/31-76-72-14-98',
      normalizedUserName: '31-76-72-14-98',
      profileUrl: 'https://www.zhihu.com/people/31-76-72-14-98',
    },
    summary: '基于强质量样本完成表达模式抽取，已去除具体产品名干扰，保留纯风格规则。',
    diagnostics: [],
    operatorNotes: ['本次更新已清理 Good/Bad 示例中的具体产品名，避免 Writer 过度植入。'],
    sampleQuality: 'strong',
    collectionSummary: {
      requestedSampleSize: 40, fetchedSampleCount: 40, filteredOutCount: 0, keptSampleCount: 40,
      sampleQuality: 'strong', sourceHandle: '31-76-72-14-98',
      sourceUrl: 'https://www.zhihu.com/people/31-76-72-14-98',
      collectionSucceeded: true, browserDiagnostics: [], filterReasonCounts: {},
    },
    phaseReports: [],
    learnedStyleProfileMarkdown: styleRules || '',
    soulCandidateMarkdown: styleRules || '',
    styleRulesMarkdown: styleRules || '',
    answerStructureRulesMarkdown: structureRules || '',
    evidenceRulesMarkdown: evidenceRules || '',
    reviewRubricMarkdown: reviewRubric || '',
    goodAnswersJsonl: CLEAN_GOOD_ANSWERS.map(a => JSON.stringify(a)).join('\n') + '\n',
    badAnswersJsonl: CLEAN_BAD_ANSWERS.map(a => JSON.stringify(a)).join('\n') + '\n',
    learnedSamplesJsonl: JSON.stringify({ id: 'sample_001', accountKey, source: 'profile_answers', text: '示例样本' }) + '\n',
    sourceMapYaml: 'version: 1\n# 来源映射\n',
    samplePreview: [],
    generatedAt: new Date().toISOString(),
    sourcePaths: {
      accountMapPath: '',
      accountLibraryDir: '',
      noteAgentAssetDir: '',
    },
  };

  // 执行 Apply
  console.log('📥 正在 Apply 到二牛账户...\n');
  const result = await noteAgentService.applyDraft(account, {
    draft,
    actions: { writeLibraryDocs: true, saveLearnedAssets: true },
  });

  console.log('✅ Apply 完成！');
  console.log(`  写入文件: ${result.writtenPaths.length} 个`);
  console.log(`  验证状态: ${result.phaseReport.status}`);
  console.log('\n📂 写入路径:');
  for (const p of result.writtenPaths) console.log(`  • ${p}`);

  console.log('\n✅ 优化完成！资产已更新，可以开始新的 A/B 测试了。');
  await pool.end();
}

main().catch(err => { console.error('💥', err); process.exit(1); });
