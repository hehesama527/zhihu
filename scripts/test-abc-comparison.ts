import { getMysqlPool } from '../packages/core/src/db/mysql.js';
import { applySchemaMigrations } from '../packages/core/src/db/sql.js';
import { PromptRepository } from '../packages/core/src/repositories/prompt-repository.js';
import { LlmService } from '../packages/core/src/services/llm-service.js';
import { ZhihuAccountLibraryRepository } from '../packages/core/src/repositories/zhihu-account-library-repository.js';
import { AccountSoulService } from '../packages/core/src/services/account-soul-service.js';
import { ReviewService } from '../packages/core/src/services/review-service.js';
import type { PromptSetName } from '@zhihu-mvp/shared';
import fs from 'node:fs/promises';

const TARGET_ACCOUNT_ID = 1;
const TARGET_ACCOUNT_NAME = 'Default Zhihu Account';
const TARGET_ACCOUNT_ZHIHU = '二牛是个老实人';
const TOPIC_COUNT = 4;
const MAX_REWRITE_ROUNDS = 3;

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

async function readSafe(path: string): Promise<string> {
  try { return await fs.readFile(path, 'utf8'); } catch { return ''; }
}

type TopicCase = {
  questionTitle: string;
  questionUrl: string;
  researchSummary: string;
  questionType: string | null;
};

type RoundRecord = {
  round: number;
  writerTime: number;
  reviewTime: number;
  decision: string;
  overallScore: number;
  issues: string[];
};

type TestResult = {
  label: string;
  description: string;
  draft: string;
  reviewTime: number;
  writerTime: number;
  decision: string;
  overallScore: number;
  dimensions: Record<string, { score: number }>;
  strengths: string[];
  issues: string[];
  rounds: RoundRecord[];
};

async function main() {
  console.log('🚀 A/B/C 三路对比测试\n');

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

  // 读取资产
  const styleRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'style_rules.md'));
  const structureRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'answer_structure_rules.md'));
  const evidenceRules = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'evidence_rules.md'));
  const reviewRubric = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'review_rubric.md'));
  const goodAnswers = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'good_answers.jsonl'));
  const badAnswers = await readSafe(libraryRepo.getAccountLibraryDocumentPath(accountKey, 'bad_answers.jsonl'));

  const accountLibraryContext = {
    styleRulesMarkdown: styleRules,
    answerStructureRulesMarkdown: structureRules,
    evidenceRulesMarkdown: evidenceRules,
    reviewRubricMarkdown: reviewRubric,
    goodAnswersJsonl: goodAnswers,
    badAnswersJsonl: badAnswers,
  };

  // 构建资产 prompt（B 用）
  const assetWriterSuffix = [
    '## 账户写作规则（必须遵守）',
    '### Style Rules', styleRules,
    '### Structure Rules', structureRules,
    '### Evidence Rules', evidenceRules,
    '### Review Rubric（Review 会用以下标准审核）', reviewRubric,
  ].filter(Boolean).join('\n\n');

  const examplesWriterSuffix = goodAnswers
    ? ['## 参考示例',
       '### 好的回答风格（学习）:',
       goodAnswers.split('\n').filter(Boolean).slice(0, 2).map((l) => { try { return JSON.parse(l).text || ''; } catch { return ''; } }).filter(Boolean).join('\n\n'),
       '### 不好的回答风格（绝对避免）:',
       badAnswers.split('\n').filter(Boolean).slice(0, 2).map((l) => { try { return JSON.parse(l).text || ''; } catch { return ''; } }).filter(Boolean).join('\n\n'),
    ].join('\n\n') : '';

  // 三组配置
  const tests = [
    {
      label: 'A',
      description: '无任何账户资产（纯 LLM 默认风格）',
      writerSuffix: '',
      examplesSuffix: '',
      libraryContext: null as any,
    },
    {
      label: 'B',
      description: '完整账户资产（Style Rules + Structure + Evidence + Review Rubric + Good/Bad 示例）',
      writerSuffix: assetWriterSuffix,
      examplesSuffix: examplesWriterSuffix,
      libraryContext: accountLibraryContext,
    },
    {
      label: 'C',
      description: '仅 Soul（只用账户灵魂文档，不加任何 note-agent 资产）',
      writerSuffix: `## 账户定位（Soul）\n${soulDoc.markdown}`,
      examplesSuffix: '',
      libraryContext: null,
    },
  ];

  const topicCases = await loadTopicCases(pool, TOPIC_COUNT);
  console.log(`📚 本次将测试 ${topicCases.length} 个题目`);

  const outputPath = './scripts/test-abc-report.md';
  const existingReport = await readSafe(outputPath);
  if (!existingReport.trim()) {
    await fs.writeFile(
      outputPath,
      `# Writer Agent A/B/C 对比测试报告（多题）\n\n- 账户：${TARGET_ACCOUNT_ZHIHU}\n- 开始时间：${new Date().toLocaleString('zh-CN')}\n\n`,
      'utf8'
    );
  }

  for (let topicIndex = 0; topicIndex < topicCases.length; topicIndex += 1) {
    const topicCase = topicCases[topicIndex];
    console.log(`\n${'#'.repeat(90)}`);
    console.log(`🎯 题目 ${topicIndex + 1}/${topicCases.length}: ${topicCase.questionTitle}`);
    console.log(`🔗 ${topicCase.questionUrl}`);
    console.log(`${'#'.repeat(90)}\n`);

    const results: TestResult[] = [];

    for (const t of tests) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`📝 测试 ${t.label}：${t.description}`);
      console.log('='.repeat(70));

      let finalDraft = '';
      let finalDecision = 'REVISE';
      let finalOverallScore = 0;
      let finalDimensions: Record<string, { score: number }> = {};
      let finalStrengths: string[] = [];
      let finalIssues: string[] = [];
      let finalWriterTime = 0;
      let finalReviewTime = 0;
      const rounds: RoundRecord[] = [];
      let rewriteGuidance = '';

      for (let round = 1; round <= MAX_REWRITE_ROUNDS; round += 1) {
        // Writer
        const writerPrompt = `你是知乎答主"${TARGET_ACCOUNT_ZHIHU}"的写作代理。根据问题和研究摘要写知乎回答。

核心要求：
1. 观点必须前置，开篇直接给判断或切入问题本质
2. 用自然段落，不要用提纲式结构
3. 可以带个人判断和经验，但不要装全知专家
4. 数字和例子要服务判断，不要堆砌
5. 结尾落脚于现实建议或不确定性，不要喊口号
6. 字数约 800-1200 字

重要：只输出回答正文！不要输出 JSON、不要输出 Markdown 标题、不要输出 title/summary/fingerprint 等任何元数据字段。不要有任何前后缀说明。直接给正文段落。${rewriteGuidance ? '\n\n' + rewriteGuidance : ''}${t.writerSuffix ? '\n\n' + t.writerSuffix : ''}${t.examplesSuffix ? '\n\n' + t.examplesSuffix : ''}`;

        const writerInput = {
          questionTitle: topicCase.questionTitle,
          questionUrl: topicCase.questionUrl,
          researchSummary: topicCase.researchSummary,
          accountSoul: soulDoc.markdown,
        };

        const writerStart = Date.now();
        const rawDraft = await llmService.runPrompt('writer_agent' as PromptSetName, writerInput);
        const writerTime = Math.round((Date.now() - writerStart) / 1000);
        const draft = extractContent(rawDraft);
        console.log(`\n   ✅ Writer(R${round}): ${writerTime}s | ${draft.length} 字`);

        // Review
        const reviewStart = Date.now();
        const reviewResult = await reviewService.reviewContent(
          { content: draft, topicSummary: topicCase.researchSummary, pastContentFingerprints: [] },
          null,
          { accountLibraryContext: t.libraryContext, accountSoulMarkdown: soulDoc.markdown }
        );
        const reviewTime = Math.round((Date.now() - reviewStart) / 1000);
        const roundIssues = reviewResult.editorial.issues.length > 0
          ? reviewResult.editorial.issues
          : (reviewResult.quality?.issues ?? []);

        rounds.push({
          round,
          writerTime,
          reviewTime,
          decision: reviewResult.decision,
          overallScore: reviewResult.quality?.overallScore ?? 0,
          issues: roundIssues,
        });

        console.log(`   📋 Review(R${round}): ${reviewTime}s | 决策: ${reviewResult.decision}`);
        if (reviewResult.quality) {
          console.log(`   📊 综合分: ${reviewResult.quality.overallScore}/100 (及格: ${reviewResult.quality.passingScore})`);
          const dims = reviewResult.quality.dimensions;
          if (dims) {
            for (const [key, val] of Object.entries(dims)) {
              const d = val as { score?: number };
              if (d.score !== undefined) console.log(`      ${key}: ${d.score}`);
            }
          }
        }
        if (reviewResult.hardGate.issues.length > 0) {
          console.log(`   🚫 HardGate: ${reviewResult.hardGate.issues.join('; ')}`);
        }
        if (reviewResult.editorial.issues.length > 0) {
          console.log(`   ✏️ Editorial: ${reviewResult.editorial.issues.join('; ')}`);
        }

        finalDraft = draft;
        finalDecision = reviewResult.decision;
        finalOverallScore = reviewResult.quality?.overallScore ?? 0;
        finalDimensions = Object.fromEntries(
          Object.entries(reviewResult.quality?.dimensions || {}).map(([k, v]) => [k, { score: (v as any)?.score ?? 0 }])
        );
        finalStrengths = reviewResult.quality?.strengths ?? reviewResult.editorial.strengths ?? [];
        finalIssues = roundIssues;
        finalWriterTime = writerTime;
        finalReviewTime = reviewTime;

        if (reviewResult.decision === 'PASS') {
          break;
        }

        rewriteGuidance = [
          '## 上一轮 Review 未通过，请按以下问题重写',
          ...roundIssues.slice(0, 8).map((issue, idx) => `${idx + 1}. ${issue}`),
          '重写要求：必须保留主题核心观点，但逐条修复上述问题。输出格式仍然只能是正文段落。'
        ].join('\n');
      }

      results.push({
        label: t.label,
        description: t.description,
        draft: finalDraft,
        writerTime: finalWriterTime,
        reviewTime: finalReviewTime,
        decision: finalDecision,
        overallScore: finalOverallScore,
        dimensions: finalDimensions,
        strengths: finalStrengths,
        issues: finalIssues,
        rounds,
      });

      console.log(`\n   📄 最终草稿预览 (${finalDraft.length} 字):`);
      console.log('   ' + '-'.repeat(66));
      const preview = finalDraft.length > 400 ? finalDraft.slice(0, 400) + '\n   ... (省略) ...\n' : finalDraft;
      console.log('   ' + preview.split('\n').join('\n   '));
      console.log('   ' + '-'.repeat(66));
    }

    // 生成并追加当前题目的 Markdown 报告
    console.log('\n📝 生成当前题目报告并追加到 Markdown...');
    const mdSection = generateMarkdownReport(results, topicCase, topicIndex + 1);
    if (!mdSection.trim()) {
      throw new Error(`Empty markdown section generated for topic: ${topicCase.questionTitle}`);
    }
    await fs.appendFile(outputPath, `\n${'-'.repeat(80)}\n\n${mdSection}\n`, 'utf8');
    console.log(`✅ 已追加到: ${outputPath}`);
  }

  await pool.end();
}

function extractContent(raw: string): string {
  // 1. Try direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    if (parsed.content) {
      const c = parsed.content;
      // Unescape escaped newlines from JSON string
      return typeof c === 'string' ? c.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\') : String(c);
    }
    if (parsed.answer) {
      const a = parsed.answer;
      return typeof a === 'string' ? a.replace(/\\n/g, '\n') : String(a);
    }
    if (parsed.text) {
      const t = parsed.text;
      return typeof t === 'string' ? t.replace(/\\n/g, '\n') : String(t);
    }
  } catch { /* not direct JSON */ }

  // 2. Try markdown code fence
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      const parsed = JSON.parse(inner);
      if (parsed.content) {
        const c = parsed.content;
        return typeof c === 'string' ? c.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\') : String(c);
      }
      if (parsed.answer) return parsed.answer;
      if (parsed.text) return parsed.text;
    } catch { /* not JSON */ }
    return inner;
  }

  // 3. Try to find JSON object with content field
  const jsonMatch = raw.match(/\{[\s\S]*"content"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.content) {
        const c = parsed.content;
        return typeof c === 'string' ? c.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\') : String(c);
      }
    } catch { /* malformed */ }
  }

  // 4. Fallback: raw text
  return raw.trim();
}

function generateMarkdownReport(results: TestResult[], topicCase: TopicCase, seq: number): string {
  const dims = ['account_fit', 'zhihu_native', 'experience_realness', 'evidence_density',
    'structure_naturalness', 'ai_smell', 'promotion_restraint', 'freshness'];
  const dimLabels: Record<string, string> = {
    account_fit: '账户契合度', zhihu_native: '知乎原生感', experience_realness: '经验真实感',
    evidence_density: '证据密度', structure_naturalness: '结构自然度', ai_smell: '反 AI 痕迹',
    promotion_restraint: '推广克制度', freshness: '新鲜度',
  };

  const winner = results.reduce((a, b) => a.overallScore >= b.overallScore ? a : b);

  let md = `## 第 ${seq} 组题目 A/B/C 对比\n\n`;
  md += `### 测试配置\n\n`;
  md += `- **Topic**: ${topicCase.questionTitle}\n`;
  md += `- **Question URL**: ${topicCase.questionUrl}\n`;
  md += `- **Question Type**: ${topicCase.questionType ?? '未标注'}\n`;
  md += `- **账户**: 二牛是个老实人\n`;
  md += `- **时间**: ${new Date().toLocaleString('zh-CN')}\n`;
  md += `- **测试方法**: 每组独立调用 Writer → Review，全流程最多 ${MAX_REWRITE_ROUNDS} 轮重写直到通过\n\n`;
  md += `### 三组配置\n\n`;
  md += `| 组别 | 配置说明 |\n`;
  md += `|------|----------|\n`;
  for (const r of results) {
    md += `| **${r.label}** | ${r.description} |\n`;
  }
  md += `\n---\n\n`;

  // 基本指标
  md += `## 一、基本指标\n\n`;
  md += `| 指标 | A（无资产） | B（完整资产） | C（仅 Soul） |\n`;
  md += `|------|---|---|---|\n`;
  md += `| Writer 耗时 | ${results[0].writerTime}s | ${results[1].writerTime}s | ${results[2].writerTime}s |\n`;
  md += `| Review 耗时 | ${results[0].reviewTime}s | ${results[1].reviewTime}s | ${results[2].reviewTime}s |\n`;
  md += `| 重写轮次 | ${results[0].rounds.length} | ${results[1].rounds.length} | ${results[2].rounds.length} |\n`;
  md += `| 草稿字数 | ${results[0].draft.length} | ${results[1].draft.length} | ${results[2].draft.length} |\n`;
  md += `| Review 决策 | ${results[0].decision} | ${results[1].decision} | ${results[2].decision} |\n`;
  md += `| 综合评分 | **${results[0].overallScore}**/100 | **${results[1].overallScore}**/100 | **${results[2].overallScore}**/100 |\n`;
  md += `\n🏆 **胜者: ${winner.label} 组（${winner.overallScore} 分）**\n\n`;

  // 质量评分雷达
  md += `## 二、质量评分对比\n\n`;
  md += `| 维度 | A（无资产） | B（完整资产） | C（仅 Soul） |\n`;
  md += `|------|---|---|---|\n`;
  for (const d of dims) {
    const label = dimLabels[d] || d;
    const a = results[0].dimensions[d]?.score ?? 0;
    const b = results[1].dimensions[d]?.score ?? 0;
    const c = results[2].dimensions[d]?.score ?? 0;
    const max = Math.max(a, b, c);
    const aMark = a === max ? '**' : '';
    const bMark = b === max ? '**' : '';
    const cMark = c === max ? '**' : '';
    md += `| ${label} | ${aMark}${a}${aMark} | ${bMark}${b}${bMark} | ${cMark}${c}${cMark} |\n`;
  }
  md += `\n`;

  // 每组详细
  md += `---\n\n`;
  for (const r of results) {
    md += `## 三、${r.label} 组：${r.description}\n\n`;
    md += `### 评分摘要\n`;
    md += `- **综合分**: ${r.overallScore}/100\n`;
    md += `- **决策**: ${r.decision}\n`;
    md += `- **耗时**: Writer ${r.writerTime}s + Review ${r.reviewTime}s = ${r.writerTime + r.reviewTime}s\n`;
    md += `- **轮次**: ${r.rounds.length}\n`;
    md += `- **字数**: ${r.draft.length} 字\n`;
    md += `\n### 轮次记录\n`;
    for (const round of r.rounds) {
      md += `- R${round.round}: 决策=${round.decision}, 分数=${round.overallScore}, Writer=${round.writerTime}s, Review=${round.reviewTime}s\n`;
    }
    if (r.strengths.length > 0) {
      md += `\n### 优点\n`;
      for (const s of r.strengths) md += `- ${s}\n`;
    }
    if (r.issues.length > 0) {
      md += `\n### 问题\n`;
      for (const i of r.issues) md += `- ${i}\n`;
    }
    md += `\n### 完整草稿\n\n`;
    md += `\`\`\`\n${r.draft}\n\`\`\`\n\n`;
    md += `---\n\n`;
  }

  // 总结
  md += `## 四、综合结论\n\n`;
  md += `### 关键发现\n\n`;
  md += `1. **综合评分**: `;
  md += results.map(r => `${r.label}=${r.overallScore}`).join('，');
  md += `\n`;
  md += `2. **字数差异**: ${results[0].draft.length} → ${results[1].draft.length} → ${results[2].draft.length}\n`;
  md += `3. **耗时差异**: Writer 阶段 A/B/C 分别为 ${results[0].writerTime}s/${results[1].writerTime}s/${results[2].writerTime}s\n`;
  md += `4. **Review 决策**: A=${results[0].decision}, B=${results[1].decision}, C=${results[2].decision}\n\n`;

  md += `### 各维度胜者\n\n`;
  for (const d of dims) {
    const label = dimLabels[d] || d;
    const scores = results.map(r => ({ label: r.label, score: r.dimensions[d]?.score ?? 0 }));
    const best = scores.reduce((a, b) => a.score >= b.score ? a : b);
    md += `- ${label}: **${best.label}** (${best.score} 分)\n`;
  }

  return md;
}

async function loadTopicCases(pool: ReturnType<typeof getMysqlPool>, limit: number): Promise<TopicCase[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT
       tc.id,
       tc.question_title,
       tc.question_url,
       tc.question_type,
       tcard.summary_text AS topic_summary
     FROM topic_candidates tc
     LEFT JOIN topic_cards tcard ON tcard.id = (
       SELECT t2.id
       FROM topic_cards t2
       WHERE t2.topic_candidate_id = tc.id
       ORDER BY t2.id DESC
       LIMIT 1
     )
     WHERE tc.account_id = ?
       AND tc.question_title IS NOT NULL
       AND tc.question_url IS NOT NULL
       AND tc.question_url <> ''
     ORDER BY tc.created_at DESC
     LIMIT 30`,
    [TARGET_ACCOUNT_ID]
  );

  const selected: TopicCase[] = [];
  const usedType = new Set<string>();

  for (const row of rows) {
    const qType = row.question_type ? String(row.question_type) : null;
    if (qType && usedType.has(qType) && selected.length < limit) {
      continue;
    }
    selected.push({
      questionTitle: String(row.question_title),
      questionUrl: String(row.question_url),
      questionType: qType,
      researchSummary: String(row.topic_summary || buildFallbackSummary(String(row.question_title))),
    });
    if (qType) usedType.add(qType);
    if (selected.length >= limit) break;
  }

  if (selected.length < limit) {
    for (const row of rows) {
      const exists = selected.some((item) => item.questionUrl === String(row.question_url));
      if (exists) continue;
      selected.push({
        questionTitle: String(row.question_title),
        questionUrl: String(row.question_url),
        questionType: row.question_type ? String(row.question_type) : null,
        researchSummary: String(row.topic_summary || buildFallbackSummary(String(row.question_title))),
      });
      if (selected.length >= limit) break;
    }
  }

  if (selected.length === 0) {
    return [{
      questionTitle: '量化策略快速上线和深度优化如何权衡？',
      questionUrl: 'https://www.zhihu.com/question/2022867484454261513',
      questionType: 'fallback',
      researchSummary: RESEARCH_SUMMARY,
    }];
  }

  return selected.slice(0, limit);
}

function buildFallbackSummary(questionTitle: string): string {
  return `## 问题核心
- 主题：${questionTitle}
- 目标：给出可执行、可验证、可复盘的实操回答

## 回答要求
- 观点前置，避免空话
- 给出具体做法、边界条件和风险提示
- 结尾给现实可执行建议`;
}

main().catch(err => {
  console.error('💥', err);
  process.exit(1);
});
