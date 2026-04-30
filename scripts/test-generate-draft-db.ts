import { createHash } from 'node:crypto';
import { getMysqlPool } from '../packages/core/src/db/mysql.js';
import { applySchemaMigrations } from '../packages/core/src/db/sql.js';
import { ZhihuScrapedContentRepository } from '../packages/core/src/repositories/zhihu-scraped-content-repository.js';
import { ZhihuNoteAgentService } from '../packages/core/src/services/zhihu-note-agent-service.js';
import { ZhihuAccountLibraryRepository } from '../packages/core/src/repositories/zhihu-account-library-repository.js';
import { LlmService } from '../packages/core/src/services/llm-service.js';
import { PromptRepository } from '../packages/core/src/repositories/prompt-repository.js';
import { AccountSoulService } from '../packages/core/src/services/account-soul-service.js';
import type { ZhihuNoteAgentSourceAccount } from '@zhihu-mvp/shared';

const TARGET_ACCOUNT_ID = 3;
const TARGET_ACCOUNT_NAME = '知乎测试号-3';
const TARGET_ACCOUNT_ZHIHU = 'test-user-3';
const SOURCE_ACCOUNT = '31-76-72-14-98';

// 每类取多少条作为样本
const SAMPLES_PER_TYPE = 20;
// 总上限（0 = 不限制）
const MAX_TOTAL = 0;

// 存储样本 ID 和内容文本的映射，用于最后更新状态
const sampleIdByFingerprint = new Map<string, number>();

async function main() {
  console.log('🚀 generateDraft + applyDraft 完整闭环测试\n');

  // 1. 数据库连接 + 迁移
  console.log('🗄️  连接数据库...');
  const pool = getMysqlPool();
  await applySchemaMigrations(pool);
  const contentRepo = new ZhihuScrapedContentRepository(pool);

  const total = await contentRepo.countByAccount(SOURCE_ACCOUNT);
  const pending = await contentRepo.countByStatus(SOURCE_ACCOUNT, 'pending');
  console.log(`📊 总记录: ${total} 条 | 待使用 (pending): ${pending} 条`);
  console.log(`📊 已使用 (used): ${await contentRepo.countByStatus(SOURCE_ACCOUNT, 'used')} 条`);
  console.log(`📊 已拒绝 (rejected): ${await contentRepo.countByStatus(SOURCE_ACCOUNT, 'rejected')} 条\n`);

  if (pending === 0) {
    console.log('⚠️  没有 pending 状态的样本。如需重新测试，请手动把部分记录状态改回 pending。');
    await pool.end();
    return;
  }

  // 2. 从数据库加载样本
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

  // 建立指纹 -> ID 映射
  for (const item of allSamples) {
    const fp = createHash('sha256').update(item.contentText || item.contentHtml || '').digest('hex');
    sampleIdByFingerprint.set(fp, item.id);
  }

  console.log(`✅ 共 ${allSamples.length} 条样本进入流程\n`);

  // 3. 自定义 DB 采集器
  const dbSampleCollector = async (
    _sourceAccount: ZhihuNoteAgentSourceAccount,
    input: { sampleLimit: number; manualSeedTexts: string[] }
  ) => {
    console.log('🔹 [DB Collector] 从数据库返回样本');
    return {
      samples: allSamples.slice(0, input.sampleLimit).map(item => ({
        answerUrl: item.questionUrl || null,
        questionTitle: item.questionTitle || '想法/文章',
        questionUrl: item.questionUrl || null,
        createdAt: item.createdAt,
        excerpt: (item.contentText || '').slice(0, 200),
        text: item.contentText || item.contentHtml || '',
      })),
      diagnostics: ['Samples loaded from zhihu_scraped_content database (paginated API fetch)'],
      collectionSucceeded: true,
    };
  };

  // 4. 初始化服务
  console.log('⚙️  初始化服务...');
  const promptRepo = new PromptRepository(pool);
  const llmService = new LlmService(promptRepo);
  const libraryRepo = new ZhihuAccountLibraryRepository();
  const soulService = new AccountSoulService();
  const noteAgentService = new ZhihuNoteAgentService(llmService, libraryRepo, soulService, dbSampleCollector);

  const account = { id: TARGET_ACCOUNT_ID, name: TARGET_ACCOUNT_NAME, zhihuUserName: TARGET_ACCOUNT_ZHIHU };
  const generateInput = {
    mode: 'zhihu_answer_style_learning' as const,
    sourceAccount: { platform: 'zhihu' as const, handleOrUrl: `https://www.zhihu.com/people/${SOURCE_ACCOUNT}` },
    sampleLimit: MAX_TOTAL > 0 ? MAX_TOTAL : allSamples.length,
    filterConfigVersion: 'v1',
    manualSeedTexts: [] as string[],
  };

  // 5. 执行 generateDraft
  console.log('\n' + '='.repeat(60));
  console.log('🧠 执行 generateDraft...');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const timer = setInterval(() => {
    process.stdout.write(`\r   ⏳ 已运行 ${Math.round((Date.now() - startTime) / 1000)}s...`);
  }, 3000);

  let draft: any;
  try {
    draft = await noteAgentService.generateDraft(account, generateInput);
    clearInterval(timer);
  } catch (error: any) {
    clearInterval(timer);
    console.error('\n\n❌ generateDraft 失败:', error.message);
    process.exit(1);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n✅ generateDraft 完成 (耗时: ${elapsed}s)\n`);

  // 6. 根据过滤结果更新数据库状态
  console.log('🏷️  正在根据过滤结果更新数据库样本状态...');
  
  // draft.learnedSamplesJsonl 包含了最终保留的样本（带 fingerprint）
  const keptFingerprints = new Set<string>();
  for (const line of draft.learnedSamplesJsonl.split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.fingerprint) keptFingerprints.add(parsed.fingerprint);
    } catch { /* ignore */ }
  }

  // 计算被过滤掉的指纹
  const filteredOutFingerprints = new Map<string, string[]>(); // reason -> fingerprints
  if (draft.collectionSummary.filterReasonCounts) {
    // 我们无法精确知道哪个指纹对应哪个原因，但可以用整体统计
  }

  // 简化方案：保留的样本标记为 used，其余输入的样本标记为 rejected（原因是 filter）
  const updates = allSamples.map(item => {
    const fp = createHash('sha256').update(item.contentText || item.contentHtml || '').digest('hex');
    if (keptFingerprints.has(fp)) {
      return { id: item.id, status: 'used' as const };
    }
    return { id: item.id, status: 'rejected' as const, rejectedReason: 'filtered_by_note_agent' };
  });

  await contentRepo.batchUpdateStatus(updates);
  console.log(`   ✅ 已更新 ${updates.length} 条记录状态\n`);

  // 7. 执行 applyDraft
  console.log('='.repeat(60));
  console.log('📥 执行 applyDraft（写回资产）...');
  console.log('='.repeat(60));

  const applyResult = await noteAgentService.applyDraft(account, {
    draft,
    actions: {
      writeLibraryDocs: true,
      saveLearnedAssets: true,
    },
  });

  console.log(`\n✅ applyDraft 完成！`);
  console.log(`   写入文件: ${applyResult.writtenPaths.length} 个`);
  console.log(`   写回路径:`);
  for (const p of applyResult.writtenPaths) {
    console.log(`     • ${p}`);
  }

  // 8. 最终摘要
  console.log('\n' + '='.repeat(60));
  console.log('🏁 全流程测试完成');
  console.log('='.repeat(60));
  console.log(`总耗时: ${elapsed}s (generate) + 写回时间`);
  console.log(`样本质量: ${draft.sampleQuality}`);
  console.log(`采集 → 过滤: ${draft.collectionSummary.fetchedSampleCount} → ${draft.collectionSummary.keptSampleCount} 保留`);
  console.log(`数据库更新: ${updates.length} 条 (used=${keptFingerprints.size}, rejected=${updates.length - keptFingerprints.size})`);
  console.log(`资产已写入: ${applyResult.writtenPaths.length} 个文件`);

  console.log('\n🎉 全部四个阶段验证通过！');

  await pool.end();
}

main().catch(err => {
  console.error('💥 脚本错误:', err);
  process.exit(1);
});
