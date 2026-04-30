import { createHash } from 'node:crypto';
import { getMysqlPool } from '../packages/core/src/db/mysql.js';
import { applySchemaMigrations } from '../packages/core/src/db/sql.js';
import { ZhihuScrapedContentRepository } from '../packages/core/src/repositories/zhihu-scraped-content-repository.js';
import { LlmService } from '../packages/core/src/services/llm-service.js';
import { PromptRepository } from '../packages/core/src/repositories/prompt-repository.js';
import { AccountSoulService } from '../packages/core/src/services/account-soul-service.js';
import { ZhihuAccountLibraryRepository } from '../packages/core/src/repositories/zhihu-account-library-repository.js';
import { PromptSetName } from '@zhihu-mvp/shared';

const TARGET_ACCOUNT_ID = 3;
const TARGET_ACCOUNT_NAME = '知乎测试号-3';
const TARGET_ACCOUNT_ZHIHU = 'test-user-3';
const SOURCE_ACCOUNT = '31-76-72-14-98';

const SAMPLES_PER_TYPE = 20;
const MAX_TOTAL = 0;

async function main() {
  console.log('🚀 第二阶段测试：起草 Account Assets\n');

  // 1. 数据库
  console.log('🗄️  连接数据库...');
  const pool = getMysqlPool();
  await applySchemaMigrations(pool);
  const contentRepo = new ZhihuScrapedContentRepository(pool);

  const pending = await contentRepo.countByStatus(SOURCE_ACCOUNT, 'pending');
  console.log(`📊 待使用样本: ${pending} 条\n`);

  if (pending === 0) {
    console.log('⚠️ 没有 pending 样本。');
    await pool.end();
    return;
  }

  // 2. 加载样本
  console.log('📝 正在从数据库加载样本...');
  const [answers, articles, pins] = await Promise.all([
    contentRepo.listByAccount(SOURCE_ACCOUNT, { contentType: 'answer', status: 'pending', limit: SAMPLES_PER_TYPE }),
    contentRepo.listByAccount(SOURCE_ACCOUNT, { contentType: 'article', status: 'pending', limit: SAMPLES_PER_TYPE }),
    contentRepo.listByAccount(SOURCE_ACCOUNT, { contentType: 'pin', status: 'pending', limit: SAMPLES_PER_TYPE }),
  ]);

  console.log(`  回答: ${answers.length} 条`);
  console.log(`  文章: ${articles.length} 条`);
  console.log(`  想法: ${pins.length} 条\n`);

  const allSamples = [...answers, ...articles, ...pins]
    .slice(0, MAX_TOTAL > 0 ? MAX_TOTAL : undefined);
  console.log(`✅ 共 ${allSamples.length} 条样本\n`);

  // 3. 初始化
  console.log('⚙️  初始化 LLM 服务...');
  const promptRepo = new PromptRepository(pool);
  const llmService = new LlmService(promptRepo);
  const soulService = new AccountSoulService();
  const libraryRepo = new ZhihuAccountLibraryRepository();

  const account = { id: TARGET_ACCOUNT_ID, name: TARGET_ACCOUNT_NAME, zhihuUserName: TARGET_ACCOUNT_ZHIHU };
  const resolution = await libraryRepo.ensureAccountLibraryForAccount(account);
  const accountKey = resolution.accountKey;

  const soulDoc = await soulService.ensureSoulDocument(account);
  const sampleFilterPath = libraryRepo.getAccountLibraryDocumentPath(accountKey, 'sample_filter.md');
  const styleRulesPath = libraryRepo.getAccountLibraryDocumentPath(accountKey, 'style_rules.md');

  let sampleFilterMarkdown = '';
  let existingStyleRulesMarkdown = '';
  try {
    const fs = await import('node:fs/promises');
    sampleFilterMarkdown = await fs.readFile(sampleFilterPath, 'utf8');
  } catch { /* ignore */ }
  try {
    const fs = await import('node:fs/promises');
    existingStyleRulesMarkdown = await fs.readFile(styleRulesPath, 'utf8');
  } catch { /* ignore */ }

  // 4. 样本预览
  const samplePreview = allSamples.slice(0, 8).map(item => ({
    answerUrl: item.questionUrl || null,
    questionTitle: item.questionTitle || '想法/文章',
    createdAt: item.createdAt,
    excerpt: (item.contentText || '').slice(0, 200),
    text: (item.contentText || item.contentHtml || '').slice(0, 500),
  }));

  // 5. 构建 LLM 输入
  const llmInput = {
    stage: 'draft_account_assets',
    mode: 'zhihu_answer_style_learning',
    chain: 'zhihu',
    matchedBy: resolution.matchedBy,
    targetAccount: {
      id: account.id,
      accountKey,
      name: account.name,
      zhihuUserName: account.zhihuUserName,
      accountSoulMarkdown: soulDoc.markdown,
    },
    sourceAccount: {
      platform: 'zhihu',
      handleOrUrl: `https://www.zhihu.com/people/${SOURCE_ACCOUNT}`,
      normalizedUserName: SOURCE_ACCOUNT,
      profileUrl: `https://www.zhihu.com/people/${SOURCE_ACCOUNT}`,
    },
    sampleLimit: allSamples.length,
    filterConfigVersion: 'v1',
    collectionSummary: {
      requestedSampleSize: allSamples.length,
      fetchedSampleCount: allSamples.length,
      filteredOutCount: 0,
      keptSampleCount: allSamples.length,
      sampleQuality: allSamples.length >= 12 ? 'strong' : 'ok',
      sourceHandle: SOURCE_ACCOUNT,
      sourceUrl: `https://www.zhihu.com/people/${SOURCE_ACCOUNT}`,
      collectionSucceeded: true,
      browserDiagnostics: [],
      filterReasonCounts: {},
    },
    sampleFilterMarkdown,
    learnedStyleProfileMarkdown: `## 可学特征
- 结论前置结构：开篇直接给出现象定性或核心判断，随后用"机制/数据/历史对照"分层展开。
- 分层信息密度：宏观背景与微观数据交替出现，每段只处理一个逻辑链（现象→依据→边界）。
- 条件化推演：在给出判断时习惯附加前提（"若…则…"），体现推演过程而非绝对断言。
- 交易心理与现实锚点：长文末尾常回归到普通人面对波动的真实心态。

## 不可学特征
- 垂直领域指令：具体的买卖点位、杠杆操作建议。必须彻底剥离。
- 流量型口号与求关注话术。与目标账号"克制"边界冲突。
- 绝对化预测词汇：需剔除，替换为带概率的客观表述。

## 数字表达
- 精确锚定+适用范围：数字从不孤立出现，必附带时间窗口或条件区间。
- 数据服务于逻辑：引用数据后紧接着给出该数字在当下语境中的含义。

## 开头方式
- 场景/事件直切：第一句直接给出定性或核心判断，不写客套话。
- 判断前置：首段即亮明观点，后续再补原因和数据。

## 收尾方式
- 风险边界提示：结尾落脚于不确定性、仓位控制或长期视角的提醒。
- 经验收口/开放提问：不做强行总结或口号式升华。`,
    samplePreview,
    existingAssets: {
      accountSoulMarkdown: soulDoc.markdown,
      existingLibraryDocs: {
        styleRulesMarkdown: existingStyleRulesMarkdown,
        answerStructureRulesMarkdown: '',
        evidenceRulesMarkdown: '',
        reviewRubricMarkdown: '',
        goodAnswersJsonl: '',
        badAnswersJsonl: '',
      },
      existingNoteAgentAssets: {
        learnedStyleProfileMarkdown: '',
        learnedSamplesJsonl: '',
        sourceMapYaml: '',
        soulCandidateMarkdown: '',
      },
    },
    operatorConstraints: {
      manualTriggerOnly: true,
      doNotOverwriteOfficialSoul: true,
      humanizerMustStay: true,
      requiredOutputs: [
        'soulCandidateMarkdown',
        'styleRulesMarkdown',
        'answerStructureRulesMarkdown',
        'evidenceRulesMarkdown',
        'reviewRubricMarkdown',
        'goodAnswersJsonl',
        'badAnswersJsonl',
      ],
    },
  };

  const promptSuffix = [
    'Runtime rules:',
    '1. This note-agent run is manual-only.',
    '2. Keep humanizer in the main chain.',
    '3. Do not rewrite the topic system.',
    '4. Keep outputs practical, concrete, and account-specific.',
    '5. Return valid JSON only.',
  ].join('\n');

  // 6. 调用 LLM（先用 runPrompt 拿原始文本，再手动解析 JSON）
  console.log('\n' + '='.repeat(60));
  console.log('🧠 正在调用 LLM 起草 Account Assets...');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const timer = setInterval(() => {
    process.stdout.write(`\r   ⏳ 已运行 ${Math.round((Date.now() - startTime) / 1000)}s...`);
  }, 3000);

  try {
    // 直接调 runPrompt 拿到原始文本
    const rawText = await llmService.runPrompt('zhihu_note_agent' as PromptSetName, llmInput, { promptSuffix });
    clearInterval(timer);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // 提取 JSON
    let jsonStr = rawText.trim();
    // 处理 markdown fence
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    let result: any;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      console.log('\n\n❌ JSON 解析失败。原始输出前 1000 字符：\n');
      console.log(rawText.slice(0, 1000));
      console.log('\n--- 后 500 字符 ---\n');
      console.log(rawText.slice(-500));
      process.exit(1);
    }

    // 7. 输出反馈
    console.log('\n\n' + '='.repeat(60));
    console.log('🎉 第二阶段（资产草稿）完成！');
    console.log('='.repeat(60));
    console.log(`总耗时: ${elapsed} 秒\n`);

    console.log('📋 输出摘要:');
    console.log(`  summary: ${result.summary || '(无)'}\n`);

    if (result.diagnostics?.length > 0) {
      console.log('🔍 诊断信息:');
      result.diagnostics.forEach((d: string) => console.log(`  • ${d}`));
      console.log('');
    }

    if (result.operatorNotes?.length > 0) {
      console.log('💡 操作笔记:');
      result.operatorNotes.forEach((n: string) => console.log(`  • ${n}`));
      console.log('');
    }

    // 逐个资产预览
    const assets: Array<{ label: string; content: string }> = [
      { label: 'Soul Candidate', content: result.soulCandidateMarkdown || '' },
      { label: 'Style Rules', content: result.styleRulesMarkdown || '' },
      { label: 'Answer Structure Rules', content: result.answerStructureRulesMarkdown || '' },
      { label: 'Evidence Rules', content: result.evidenceRulesMarkdown || '' },
      { label: 'Review Rubric', content: result.reviewRubricMarkdown || '' },
    ];

    for (const asset of assets) {
      console.log(`📄 ${asset.label}:`);
      console.log('-'.repeat(60));
      if (asset.content) {
        const lines = asset.content.split('\n').slice(0, 30);
        console.log(lines.join('\n'));
        if (asset.content.split('\n').length > 30) {
          console.log('... (仅展示前 30 行)');
        }
      } else {
        console.log('(空)');
      }
      console.log('-'.repeat(60));
      console.log('');
    }

    const goodCount = (result.goodAnswersJsonl || '').split('\n').filter(Boolean).length;
    const badCount = (result.badAnswersJsonl || '').split('\n').filter(Boolean).length;
    console.log(`📊 Good Answers JSONL: ${goodCount} 条`);
    console.log(`📊 Bad Answers JSONL: ${badCount} 条`);

    if (goodCount > 0) {
      console.log('\n📝 Good Answers 预览:');
      (result.goodAnswersJsonl || '').split('\n').filter(Boolean).slice(0, 3).forEach((line: string, i: number) => {
        try {
          const parsed = JSON.parse(line);
          console.log(`  [${i + 1}] ${(parsed.text || '').slice(0, 80)}...`);
        } catch { /* ignore */ }
      });
    }

    if (badCount > 0) {
      console.log('\n📝 Bad Answers 预览:');
      (result.badAnswersJsonl || '').split('\n').filter(Boolean).slice(0, 3).forEach((line: string, i: number) => {
        try {
          const parsed = JSON.parse(line);
          console.log(`  [${i + 1}] ${(parsed.text || '').slice(0, 80)}...`);
        } catch { /* ignore */ }
      });
    }

    console.log('\n✅ 第二阶段（资产草稿）测试完成！');

  } catch (error: any) {
    clearInterval(timer);
    console.error('\n\n❌ 脚本错误:', error.message);
    if (error.stack) console.error('\n', error.stack.split('\n').slice(0, 8).join('\n'));
    process.exit(1);
  }

  await pool.end();
}

main().catch(err => {
  console.error('💥 脚本错误:', err);
  process.exit(1);
});
