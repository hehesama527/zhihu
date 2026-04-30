import { createHash } from 'node:crypto';
import { getMysqlPool } from '../packages/core/src/db/mysql.js';
import { applySchemaMigrations } from '../packages/core/src/db/sql.js';
import { ZhihuScrapedContentRepository } from '../packages/core/src/repositories/zhihu-scraped-content-repository.js';
import { LlmService } from '../packages/core/src/services/llm-service.js';
import { PromptRepository } from '../packages/core/src/repositories/prompt-repository.js';
import { AccountSoulService } from '../packages/core/src/services/account-soul-service.js';
import { ZhihuAccountLibraryRepository } from '../packages/core/src/repositories/zhihu-account-library-repository.js';
import { extractResponseText, safeParseJson } from '../packages/core/src/utils/json.js';
import { createLlmTextResponse } from '../packages/core/src/utils/llm-text.js';
import type { ZhihuNoteAgentSourceAccount } from '@zhihu-mvp/shared';

const TARGET_ACCOUNT_ID = 3;
const TARGET_ACCOUNT_NAME = '知乎测试号-3';
const TARGET_ACCOUNT_ZHIHU = 'test-user-3';
const SOURCE_ACCOUNT = '31-76-72-14-98';

const SAMPLES_PER_TYPE = 20;
const MAX_TOTAL = 0;

async function main() {
  console.log('🚀 第一阶段测试：提炼 Style Profile\n');

  // 1. 数据库
  console.log('🗄️  连接数据库...');
  const pool = getMysqlPool();
  await applySchemaMigrations(pool);
  const contentRepo = new ZhihuScrapedContentRepository(pool);

  const pending = await contentRepo.countByStatus(SOURCE_ACCOUNT, 'pending');
  console.log(`📊 待使用样本: ${pending} 条\n`);

  if (pending === 0) {
    console.log('⚠️ 没有 pending 样本。请先重新采集或手动改回部分记录状态。');
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

  // 3. 初始化 LLM
  console.log('⚙️  初始化 LLM 服务...');
  const promptRepo = new PromptRepository(pool);
  const llmService = new LlmService(promptRepo);
  const soulService = new AccountSoulService();
  const libraryRepo = new ZhihuAccountLibraryRepository();

  const account = { id: TARGET_ACCOUNT_ID, name: TARGET_ACCOUNT_NAME, zhihuUserName: TARGET_ACCOUNT_ZHIHU };
  const resolution = await libraryRepo.ensureAccountLibraryForAccount(account);
  const accountKey = resolution.accountKey;

  // 获取现有资产
  const soulDoc = await soulService.ensureSoulDocument(account);
  const sampleFilterPath = libraryRepo.getAccountLibraryDocumentPath(accountKey, 'sample_filter.md');
  const styleRulesPath = libraryRepo.getAccountLibraryDocumentPath(accountKey, 'style_rules.md');

  let sampleFilterMarkdown = '';
  let existingStyleRulesMarkdown = '';
  try {
    sampleFilterMarkdown = await (await import('node:fs/promises')).readFile(sampleFilterPath, 'utf8');
  } catch { /* ignore */ }
  try {
    existingStyleRulesMarkdown = await (await import('node:fs/promises')).readFile(styleRulesPath, 'utf8');
  } catch { /* ignore */ }

  // 4. 构建样本预览
  const samplePreview = allSamples.map(item => ({
    questionTitle: item.questionTitle || '想法/文章',
    questionUrl: item.questionUrl || null,
    excerpt: (item.contentText || '').slice(0, 200),
    text: item.contentText || item.contentHtml || '',
  }));

  // 5. 调用 LLM 提炼 Style Profile
  console.log('\n' + '='.repeat(60));
  console.log('🧠 正在调用 LLM 提炼 Style Profile...');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const timer = setInterval(() => {
    process.stdout.write(`\r   ⏳ 已运行 ${Math.round((Date.now() - startTime) / 1000)}s...`);
  }, 3000);

  try {
    const result = await llmService.runJson<any>(
      'zhihu_note_agent',
      {
        stage: 'distill_style_profile',
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
          sampleQuality: allSamples.length >= 12 ? 'strong' : allSamples.length >= 8 ? 'ok' : 'weak',
          sourceHandle: SOURCE_ACCOUNT,
          sourceUrl: `https://www.zhihu.com/people/${SOURCE_ACCOUNT}`,
          collectionSucceeded: true,
          browserDiagnostics: [],
          filterReasonCounts: {},
        },
        sampleFilterMarkdown: sampleFilterMarkdown,
        samples: samplePreview,
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
          doNotTouchTopicChain: true,
          doNotCopyViewpoints: true,
          requiredSections: ['可学特征', '不可学特征', '数字表达', '开头方式', '收尾方式'],
        },
      },
      null,
      {
        promptSuffix: [
          'Runtime rules:',
          '1. This note-agent run is manual-only.',
          '2. Keep humanizer in the main chain.',
          '3. Do not rewrite the topic system.',
          '4. Keep outputs practical, concrete, and account-specific.',
          '5. Return valid JSON only.',
        ].join('\n'),
      }
    );

    clearInterval(timer);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // 6. 输出反馈
    console.log('\n\n' + '='.repeat(60));
    console.log('🎉 提炼阶段完成！');
    console.log('='.repeat(60));
    console.log(`总耗时: ${elapsed} 秒\n`);

    console.log('📋 输出摘要:');
    console.log(`  summary: ${result.summary || '(无)'}\n`);

    if (result.diagnostics && result.diagnostics.length > 0) {
      console.log('🔍 诊断信息:');
      result.diagnostics.forEach(d => console.log(`  • ${d}`));
      console.log('');
    }

    if (result.operatorNotes && result.operatorNotes.length > 0) {
      console.log('💡 操作笔记:');
      result.operatorNotes.forEach(n => console.log(`  • ${n}`));
      console.log('');
    }

    if (result.learnedStyleProfileMarkdown) {
      console.log('📄 Learned Style Profile (Markdown):');
      console.log('-'.repeat(60));
      console.log(result.learnedStyleProfileMarkdown);
      console.log('-'.repeat(60));
    }

    // 7. 检查 required sections
    const requiredSections = ['可学特征', '不可学特征', '数字表达', '开头方式', '收尾方式'];
    const md = result.learnedStyleProfileMarkdown || '';
    console.log('\n📑 必填章节检查:');
    for (const section of requiredSections) {
      const has = new RegExp(`^##\\s+${section}`, 'm').test(md);
      console.log(`  ${has ? '✅' : '❌'} ${section}`);
    }

    console.log('\n✅ 第一阶段（提炼）测试完成！');

  } catch (error: any) {
    clearInterval(timer);
    console.error('\n\n❌ LLM 调用失败:', error.message);
    if (error.stack) console.error('\n', error.stack.split('\n').slice(0, 8).join('\n'));
    process.exit(1);
  }

  await pool.end();
}

main().catch(err => {
  console.error('💥 脚本错误:', err);
  process.exit(1);
});
