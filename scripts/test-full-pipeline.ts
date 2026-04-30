import { getMysqlPool } from '../packages/core/src/db/mysql.js';
import { applySchemaMigrations } from '../packages/core/src/db/sql.js';
import { PromptRepository } from '../packages/core/src/repositories/prompt-repository.js';
import { LlmService } from '../packages/core/src/services/llm-service.js';
import { ZhihuAccountLibraryRepository } from '../packages/core/src/repositories/zhihu-account-library-repository.js';
import { AccountSoulService } from '../packages/core/src/services/account-soul-service.js';
import { ReviewService } from '../packages/core/src/services/review-service.js';
import { PromptSetName, type PromptSnapshotMap } from '@zhihu-mvp/shared';

const TOPIC_URL = 'https://www.zhihu.com/question/2022867484454261513';
const TOPIC_TITLE = '量化策略快速上线和深度优化如何权衡？';
const TARGET_ACCOUNT_ID = 1;
const TARGET_ACCOUNT_NAME = 'Default Zhihu Account';
const TARGET_ACCOUNT_ZHIHU = '二牛是个老实人';

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

const MAX_REWRITE_ROUNDS = 2;

async function main() {
  console.log('🚀 Writer + Review 全流程对比测试\n');
  console.log(`📌 Topic: ${TOPIC_TITLE}`);
  console.log(`👤 账户: ${TARGET_ACCOUNT_NAME} (${TARGET_ACCOUNT_ZHIHU})\n`);

  const pool = getMysqlPool();
  await applySchemaMigrations(pool);

  const promptRepo = new PromptRepository(pool);
  const llmService = new LlmService(promptRepo);
  const libraryRepo = new ZhihuAccountLibraryRepository();
  const soulService = new AccountSoulService();
  const reviewService = new ReviewService(llmService);

  const account = { id: TARGET_ACCOUNT_ID, name: TARGET_ACCOUNT_NAME, zhihuUserName: TARGET_ACCOUNT_ZHIHU };
  const resolution = await libraryRepo.ensureAccountLibraryForAccount(account);
  const accountKey = resolution.accountKey;
  const soulDoc = await soulService.ensureSoulDocument(account);

  // 读取账户资产
  console.log('📂 正在读取账户资产...\n');
  const fs = await import('node:fs/promises');
  async function readSafe(path: string) {
    try { return await fs.readFile(path, 'utf8'); }
    catch { return ''; }
  }

  const styleRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'style_rules.md'));
  const structureRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'answer_structure_rules.md'));
  const evidenceRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'evidence_rules.md'));
  const reviewRubric = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'review_rubric.md'));
  const goodAnswers = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'good_answers.jsonl'));
  const badAnswers = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'bad_answers.jsonl'));
  const sampleFilter = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'sample_filter.md'));

  const hasAssets = Boolean(styleRules || structureRules || evidenceRules || reviewRubric);
  console.log(`  Style Rules: ${hasAssets ? '✅' : '❌'}`);
  console.log(`  Structure Rules: ${structureRules ? '✅' : '❌'}`);
  console.log(`  Evidence Rules: ${evidenceRules ? '✅' : '❌'}`);
  console.log(`  Review Rubric: ${reviewRubric ? '✅' : '❌'}`);
  console.log(`  Examples: ${goodAnswers ? '✅' : '❌'}\n`);

  // 账户库上下文（用于 Review）
  const accountLibraryContext = hasAssets ? {
    styleRulesMarkdown: styleRules,
    answerStructureRulesMarkdown: structureRules,
    evidenceRulesMarkdown: evidenceRules,
    reviewRubricMarkdown: reviewRubric,
    goodAnswersJsonl: goodAnswers,
    badAnswersJsonl: badAnswers,
    sampleFilterMarkdown: sampleFilter,
  } : null;

  // 构建资产 prompt（Writer 用）
  const assetWriterSuffix = hasAssets
    ? `\n\n## 账户写作规则（必须遵守）\n\n### Style Rules\n${styleRules}\n\n### Structure Rules\n${structureRules}\n\n### Evidence Rules\n${evidenceRules}\n\n### Review Rubric（Review 会用以下标准审核，请提前规避）\n${reviewRubric}`
    : '';

  const examplesWriterSuffix = hasAssets && goodAnswers
    ? `\n\n## 参考示例\n\n### 好的回答风格：\n${goodAnswers.split('\n').filter(Boolean).slice(0, 2).map((l) => { try { return JSON.parse(l).text || ''; } catch { return ''; } }).filter(Boolean).join('\n\n')}\n\n### 不好的回答风格（绝对避免）：\n${badAnswers.split('\n').filter(Boolean).slice(0, 2).map((l) => { try { return JSON.parse(l).text || ''; } catch { return ''; } }).filter(Boolean).join('\n\n')}`
    : '';

  // ============ 测试 A：不带账户资产 ============
  console.log('\n' + '='.repeat(70));
  console.log('📝 测试 A：不带账户资产');
  console.log('='.repeat(70));

  const resultA = await runFullPipeline(
    llmService, reviewService, 'A (无资产)',
    TOPIC_TITLE, TOPIC_URL, RESEARCH_SUMMARY, soulDoc.markdown,
    null, null, accountLibraryContext, soulDoc.markdown
  );
  printPipelineResult('A', resultA);

  // ============ 测试 B：带二牛账户资产 ============
  console.log('\n' + '='.repeat(70));
  console.log('📝 测试 B：带二牛账户资产');
  console.log('='.repeat(70));

  const resultB = await runFullPipeline(
    llmService, reviewService, 'B (带资产)',
    TOPIC_TITLE, TOPIC_URL, RESEARCH_SUMMARY, soulDoc.markdown,
    assetWriterSuffix, examplesWriterSuffix, accountLibraryContext, soulDoc.markdown
  );
  printPipelineResult('B', resultB);

  // ============ 最终对比 ============
  console.log('\n' + '='.repeat(70));
  console.log('📊 全流程对比');
  console.log('='.repeat(70));

  console.log('\n📏 基本指标:');
  console.log(`  A (无资产): 总耗时 ${resultA.totalTime}s | 草稿 ${resultA.draft.length} 字 | Review ${resultA.reviewCount} 轮`);
  console.log(`  B (带资产): 总耗时 ${resultB.totalTime}s | 草稿 ${resultB.draft.length} 字 | Review ${resultB.reviewCount} 轮`);

  console.log('\n🏷️ 最终决策:');
  console.log(`  A: ${resultA.finalDecision}`);
  console.log(`  B: ${resultB.finalDecision}`);

  if (resultA.quality && resultB.quality) {
    console.log('\n📊 质量评分:');
    console.log(`  A 综合分: ${resultA.quality.overallScore}/100 (及格线: ${resultA.quality.passingScore})`);
    console.log(`  B 综合分: ${resultB.quality.overallScore}/100 (及格线: ${resultB.quality.passingScore})`);
    if (resultA.quality.dimensions && resultB.quality.dimensions) {
      const dims = Object.keys(resultA.quality.dimensions) as Array<keyof typeof resultA.quality.dimensions>;
      for (const dim of dims) {
        const aScore = resultA.quality.dimensions[dim]?.score ?? 0;
        const bScore = resultB.quality.dimensions[dim]?.score ?? 0;
        const diff = bScore - aScore;
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
        console.log(`    ${dim}: A=${aScore} B=${bScore} ${arrow}${Math.abs(diff)}`);
      }
    }
  }

  if (resultA.finalDecision === 'PASS' || resultB.finalDecision === 'PASS') {
    console.log('\n✅ 有内容通过审核，可以发布。');
    const winner = resultB.finalDecision === 'PASS' ? 'B' : resultA.finalDecision === 'PASS' ? 'A' : '平局';
    console.log(`🏆 胜者: ${winner}`);
  } else {
    console.log('\n❌ 均未通过审核。');
  }

  await pool.end();
}

type PipelineResult = {
  draft: string;
  reviewCount: number;
  finalDecision: string;
  totalTime: number;
  quality: any;
  stages: string[];
};

async function runFullPipeline(
  llmService: LlmService,
  reviewService: ReviewService,
  label: string,
  questionTitle: string,
  questionUrl: string,
  researchSummary: string,
  soulMarkdown: string,
  assetSuffix: string | null,
  examplesSuffix: string | null,
  accountLibraryContext: any,
  accountSoulMarkdown: string
): Promise<PipelineResult> {
  const stages: string[] = [];
  const startAll = Date.now();
  let currentDraft = '';
  let rewriteBrief = '';
  let reviewCount = 0;
  let finalQuality: any = null;
  let finalDecision = 'UNKNOWN';

  for (let round = 0; round <= MAX_REWRITE_ROUNDS; round++) {
    const roundLabel = round === 0 ? '初稿' : `重写第 ${round} 轮`;
    console.log(`\n🔄 ${label} - ${roundLabel}...`);

    // 1. Writer 生成草稿
    const writerPrompt = `你是知乎答主的写作代理。根据问题和研究摘要写知乎回答。

核心要求：
1. 观点必须前置，开篇直接给判断或切入问题本质
2. 用自然段落，不要用提纲式结构
3. 可以带个人判断和经验，但不要装全知专家
4. 数字和例子要服务判断，不要堆砌
5. 结尾落脚于现实建议或不确定性，不要喊口号
6. 字数约 800-1200 字
7. 只输出回答正文，不要解释、不要 Markdown 标题、不要前后缀${assetSuffix || ''}${examplesSuffix || ''}`;

    const writerInput = {
      questionTitle,
      questionUrl,
      researchSummary,
      accountSoul: soulMarkdown,
      rewriteBrief: rewriteBrief || undefined,
      round: round + 1,
    };

    const writerStart = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - writerStart) / 1000);
      process.stdout.write(`\r   ⏳ ${label} ${roundLabel}: ${elapsed}s`);
    }, 1500);

    const draft = await llmService.runPrompt('writer_agent' as PromptSetName, writerInput);
    clearInterval(timer);
    const writerTime = Math.round((Date.now() - writerStart) / 1000);
    currentDraft = extractContentFromDraft(draft);
    console.log(`\r   ✅ ${label} ${roundLabel}: ${writerTime}s | ${currentDraft.length} 字`);
    stages.push(`Writer ${roundLabel}: ${writerTime}s`);

    // 2. Review 审核
    const reviewStart = Date.now();
    reviewCount++;

    const reviewInput = {
      content: currentDraft,
      topicSummary: researchSummary,
      pastContentFingerprints: [],
    };

    const reviewResult = await reviewService.reviewContent(reviewInput, null, {
      accountLibraryContext,
      accountSoulMarkdown,
    });

    const reviewTime = Math.round((Date.now() - reviewStart) / 1000);
    stages.push(`Review ${roundLabel}: ${reviewTime}s → ${reviewResult.decision}`);

    finalQuality = reviewResult.quality;
    finalDecision = reviewResult.decision;

    console.log(`   📋 Review: ${reviewTime}s | 决策: ${reviewResult.decision}`);

    if (reviewResult.quality) {
      console.log(`   📊 综合分: ${reviewResult.quality.overallScore}/100 (及格: ${reviewResult.quality.passingScore})`);
      const dims = reviewResult.quality.dimensions;
      if (dims) {
        for (const [key, val] of Object.entries(dims)) {
          const d = val as { score?: number };
          if (d.score !== undefined) {
            console.log(`      ${key}: ${d.score}`);
          }
        }
      }
    }

    if (reviewResult.hardGate.issues.length > 0) {
      console.log(`   🚫 HardGate: ${reviewResult.hardGate.issues.join('; ')}`);
    }
    if (reviewResult.editorial.issues.length > 0) {
      console.log(`   ✏️  Editorial: ${reviewResult.editorial.issues.join('; ')}`);
    }

    if (reviewResult.decision === 'BLOCK') {
      console.log(`\n   ❌ ${label}: Hard Gate 拦截，流程终止`);
      break;
    }

    if (reviewResult.decision === 'PASS') {
      console.log(`\n   ✅ ${label}: 审核通过，可以发布！`);
      break;
    }

    // REVISE: 准备下一轮重写
    if (round < MAX_REWRITE_ROUNDS) {
      rewriteBrief = reviewResult.quality?.rewriteBrief
        || reviewResult.editorial.rewrite_brief
        || reviewResult.reviewSummary
        || '请根据 Review 意见重写。';
      console.log(`\n   🔄 ${label}: 需要重写，原因: ${reviewResult.reviewSummary.slice(0, 80)}...`);
      console.log(`   📝 重写指令: ${rewriteBrief.slice(0, 120)}...`);
    } else {
      console.log(`\n   ⚠️ ${label}: 已达最大重写次数 (${MAX_REWRITE_ROUNDS})，最终决策: ${reviewResult.decision}`);
    }
  }

  return {
    draft: currentDraft,
    reviewCount,
    finalDecision,
    totalTime: Math.round((Date.now() - startAll) / 1000),
    quality: finalQuality,
    stages,
  };
}

function extractContentFromDraft(raw: string): string {
  // 如果 LLM 返回了 JSON，提取 content 字段
  try {
    const parsed = JSON.parse(raw);
    if (parsed.content) return parsed.content;
    if (parsed.answer) return parsed.answer;
    if (parsed.text) return parsed.text;
  } catch { /* not JSON */ }
  // 如果是 markdown code fence，提取内部内容
  const fenceMatch = raw.match(/```(?:markdown|text)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return raw.trim();
}

function printPipelineResult(label: string, result: PipelineResult) {
  console.log(`\n📄 ${label} 最终草稿 (${result.draft.length} 字):`);
  console.log('-'.repeat(70));
  // 显示前 600 字符 + 最后 200 字符
  const preview = result.draft.length > 800
    ? result.draft.slice(0, 600) + '\n\n... (中间省略) ...\n\n' + result.draft.slice(-200)
    : result.draft;
  console.log(preview);
  console.log('-'.repeat(70));
}

main().catch(err => {
  console.error('💥 错误:', err);
  process.exit(1);
});
