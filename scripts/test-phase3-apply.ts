import { getMysqlPool } from '../packages/core/src/db/mysql.js';
import { applySchemaMigrations } from '../packages/core/src/db/sql.js';
import { ZhihuNoteAgentService } from '../packages/core/src/services/zhihu-note-agent-service.js';
import { ZhihuAccountLibraryRepository } from '../packages/core/src/repositories/zhihu-account-library-repository.js';
import { LlmService } from '../packages/core/src/services/llm-service.js';
import { PromptRepository } from '../packages/core/src/repositories/prompt-repository.js';
import { AccountSoulService } from '../packages/core/src/services/account-soul-service.js';
import type { ZhihuNoteAgentDraft, ZhihuNoteAgentSourceAccount } from '@zhihu-mvp/shared';

const TARGET_ACCOUNT_ID = 1;
const TARGET_ACCOUNT_NAME = 'Default Zhihu Account';
const TARGET_ACCOUNT_ZHIHU = '二牛是个老实人';

async function main() {
  console.log('🚀 第三阶段：Apply（写回账户资产）\n');

  // 1. 初始化服务
  console.log('🗄️  连接数据库...');
  const pool = getMysqlPool();
  await applySchemaMigrations(pool);

  console.log('⚙️  初始化 Note Agent 服务...');
  const promptRepo = new PromptRepository(pool);
  const llmService = new LlmService(promptRepo);
  const libraryRepo = new ZhihuAccountLibraryRepository();
  const soulService = new AccountSoulService();

  const noteAgentService = new ZhihuNoteAgentService(llmService, libraryRepo, soulService);

  const account = {
    id: TARGET_ACCOUNT_ID,
    name: TARGET_ACCOUNT_NAME,
    zhihuUserName: TARGET_ACCOUNT_ZHIHU,
  };

  // 2. 准备 Draft（模拟第二阶段生成的内容）
  console.log('📦 加载第二阶段生成的资产草稿...\n');

  const draft: ZhihuNoteAgentDraft = {
    accountId: account.id,
    accountKey: 'account_1',
    matchedBy: 'accountId',
    mode: 'zhihu_answer_style_learning',
    sourceAccount: {
      platform: 'zhihu',
      handleOrUrl: 'https://www.zhihu.com/people/31-76-72-14-98',
      normalizedUserName: '31-76-72-14-98',
      profileUrl: 'https://www.zhihu.com/people/31-76-72-14-98',
    },
    summary: '基于强质量样本完成表达模式抽取，已将来源账号的节奏控制、条件化推演与边界收口习惯，平移至目标账号"知乎测试号-3"的资产框架中。',
    diagnostics: [
      '样本节奏清晰：结论前置-分层推演-条件提示的链条完整，可直接迁移。',
      '数字使用规范：来源习惯将数据绑定时间窗口与语境。',
      '风险收口稳定：结尾均落脚于不确定性或心态管理。',
    ],
    operatorNotes: [
      '人工复核 soulCandidateMarkdown，确认仅为补充表达习惯，未覆盖原有边界条款。',
      '写作时严格执行 reviewRubric，若出现模板化过渡或绝对化断言，直接打回重写。',
    ],
    sampleQuality: 'strong',
    collectionSummary: {
      requestedSampleSize: 40,
      fetchedSampleCount: 40,
      filteredOutCount: 0,
      keptSampleCount: 40,
      sampleQuality: 'strong',
      sourceHandle: '31-76-72-14-98',
      sourceUrl: 'https://www.zhihu.com/people/31-76-72-14-98',
      collectionSucceeded: true,
      browserDiagnostics: [],
      filterReasonCounts: {},
    },
    phaseReports: [],
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
    soulCandidateMarkdown: `# Account Soul (Candidate Extension)

## 新增表达锚点 (v1.1-draft)
- 判断前置：首段直接亮明核心观察，不铺垫、不客套。
- 条件化表达：强观点必须附带生效前提（"若……则……""在……周期内""前提是……"）。
- 收口习惯：结尾不做强行升华，落脚于现实边界、不确定性或精力/资源分配建议。
- 数据使用规范：所有数字必须绑定时间窗口、参照系或适用条件，禁止孤立甩数。
- 语域克制：用概率词替代断言词，用"观察/取舍/成本"替代"必然/彻底/颠覆"。

## 融合说明
- 本候选文件仅补充"节奏与边界控制"类表达习惯，不改动原有"克制、像真人、优先分享经验"的核心定位。
- 来源账号的垂直领域指令、绝对预测、求关注话术已被严格剔除，确保不越界。
- 需在人工确认后合入主 Soul，版本建议迭代至 v1.1。`,
    styleRulesMarkdown: `# Style Rules (v2-Learned)

## 语域与句式控制
- 保持真人答主语境：多用短句，主谓宾完整，禁用公关腔与宏大叙事空话。
- 观点必须前置：首句直接抛出场景定性或核心判断，禁用"首先/谢邀/背景铺垫"。
- 条件化推演：使用"若/当/在……前提下"替代绝对断言，保留推演过程的灰度。
- 情绪词降级：将"必然/彻底/碾压"替换为概率表述或客观现象描述。
- 禁忌清单：底层逻辑、认知升级、稳赚、财富自由、财富密码、关注我/点赞收藏。

## 节奏与密度管理
- 段落密度：每段仅承载一个逻辑链（结论→依据→边界），控制在 3-5 行。
- 信息交替：宏观背景与微观事实交替推进，避免连续堆砌同类论据。
- 视觉留白：核心判断后空一行，给读者留出消化与反问的空间。
- 比例控制：保持"高密度事实/推演 + 低密度情绪"约为 7:3。
- 句式交替：避免连续 3 句以上使用相同句型，疑问句仅用于引出推演。`,
    answerStructureRulesMarkdown: `# Answer Structure Rules

## 开篇定调（第 1 段）
- 动作：场景直切或现象定性，第一句即抛出核心判断。
- 禁忌：客套寒暄、冗长背景铺垫、标题复述、情绪喊麦。
- 范式：[观察到的核心现象] → [直接定性/初步判断] → [空行留白]。

## 中段推演（第 2-4 段）
- 结构：按"逻辑链"分层，每段独立处理一个支点（机制解释/数据锚定/历史对照/成本分析）。
- 过渡：摒弃僵硬的"首先其次最后"，改用条件句或因果链自然衔接。
- 密度：单段不跨维度跳跃；宏观背景落地时需紧跟具体数据或微观案例。
- 校验点：每段末尾是否有一句"边界/前提/局限"说明？无则补充。

## 收尾收口（最后 1 段）
- 动作：风险边界提示或现实心态回归，不强求闭环或口号式升华。
- 范式：[重申核心前提] → [点明不确定性/长期视角/仓位或精力分配建议] → [开放留白]。
- 禁忌：强行总结陈词（"综上所述"）、情绪断言、求互动、无前提的绝对承诺。
- 语感：像懂行但知止的同行者，不扮演全知预言家。`,
    evidenceRulesMarkdown: `# Evidence & Proof Rules

## 数字表达规范
- 锚定 + 范围：数字绝不孤立出现，必须绑定时间窗口、区间或参照对象（如"近 30 天""在…假设下"）。
- 服务逻辑：引用数据后紧跟一句解读，说明该数字在当前语境中的指向与局限。
- 精度控制：避免伪造过度精确的预测值，保留合理误差区间或量级描述。
- 反例拦截：禁止出现"必达 X 万""稳涨 X%""零回撤"等脱离概率框架的表述。

## 案例与事实锚点
- 优先使用可复现的公共事实、行业公开数据或自身可验证的观察，不编造内部消息。
- 案例仅作为逻辑支点，不喧宾夺主；每个案例后需附带"适用边界"说明。
- 个人经验表述使用"我观察到/我曾采用/当时取舍是"，保持第一人称的真实感。

## 风险提示与灰度处理
- 强判断必带前提：任何倾向性观点需明确"在……条件下成立"。
- 显式标注不确定性：使用"大概率/存在博弈/需观察……信号"替代"必定/必然/已成定局"。`,
    reviewRubricMarkdown: `# Review Rubric

## 必拒项 (Reject if true)
- 来源垂直领域词泄露：如具体买卖点位、杠杆倍数、币圈黑话未做泛化处理。
- 绝对化预测：无前提条件的"必涨/必跌/稳赚"，或末尾出现情绪化断言。
- 模板化/公关腔：首段出现"谢邀/背景是/众所周知"，或使用"赋能/抓手/底层逻辑"等公文词。
- AI 痕迹：段落间生硬使用"综上所述/总而言之/不难看出"强行升华，或连续 3 句以上使用相同疑问/排比句式。
- 违反边界：出现"求关注/点赞收藏/私信交流/上车"等流量话术。
- 数字裸奔：文中出现关键数据但未附带时间窗口、参照系或语境解读。

## 审查清单 (Checklist)
- 观点前置 [ ] 首段是否直接亮明判断，无无效铺垫？
- 条件推演 [ ] 核心论点是否附带生效前提或概率词？
- 数据合规 [ ] 所有数字是否绑定时间/区间/语境解读？
- 结构密度 [ ] 是否严格遵循"一段一逻辑"，无跨段跳跃？
- 收尾边界 [ ] 结尾是否落脚于不确定性/现实心态，拒绝强行总结？
- 语感人味 [ ] 读起来是否像克制、有边界的真人，而非营销号或 AI 生成稿？
- 评分规则：任一"必拒项"触发直接打回；清单项满足≥5 项方可进入人工润色阶段。`,
    goodAnswersJsonl: JSON.stringify([
      {
        id: 'good_1',
        text: '今天 BTC 走了典型的超跌修复。凌晨下探 66000 后企稳，日内围绕 67000–68500 反复拉锯。这种结构下，追涨风险大于机会，观望或等回踩 66500 附近更稳妥。',
        notes: '开篇直接给判断，数据绑定时间窗口，结尾给具体建议而非空话。',
        questionTitle: '币圈新手要注意什么？',
        questionUrl: 'https://www.zhihu.com/question/example1',
        answerUrl: 'https://www.zhihu.com/answer/example1',
      },
      {
        id: 'good_2',
        text: '做短线最大的问题不是技术，是心态。很多人知道止损，但真跌了就不舍得割。我一般设 3% 硬止损，到了就砍，不纠结。亏小钱保住本金，比扛单强。',
        notes: '第一人称经验表达，具体数字带场景，不装专家。',
        questionTitle: '如何控制交易风险？',
        questionUrl: 'https://www.zhihu.com/question/example2',
        answerUrl: 'https://www.zhihu.com/answer/example2',
      },
    ]) + '\n',
    badAnswersJsonl: JSON.stringify([
      {
        id: 'bad_1',
        text: '首先，我们要理解区块链的底层逻辑。众所周知，比特币是未来的趋势。综上所述，大家赶紧上车，关注我获取更多财富密码！',
        notes: '模板化过渡 + 公关腔 + 流量话术 + 绝对化断言，全中。',
        questionTitle: '',
        questionUrl: null,
        answerUrl: null,
      },
      {
        id: 'bad_2',
        text: '根据我的分析，BTC 明天必涨到 75000，稳赚不赔。零回撤策略已经验证，关注我带你起飞！',
        notes: '绝对化预测 + 数字裸奔 + 求关注，直接打回。',
        questionTitle: '',
        questionUrl: null,
        answerUrl: null,
      },
    ]) + '\n',
    learnedSamplesJsonl: JSON.stringify([
      {
        id: 'sample_001',
        accountKey: 'account_1',
        source: 'profile_answers',
        sourceAccount: { platform: 'zhihu', handleOrUrl: 'https://www.zhihu.com/people/31-76-72-14-98', normalizedUserName: '31-76-72-14-98', profileUrl: 'https://www.zhihu.com/people/31-76-72-14-98' },
        answerUrl: 'https://www.zhihu.com/answer/learned-1',
        questionTitle: '币圈新手要注意什么？',
        questionUrl: 'https://www.zhihu.com/question/example1',
        createdAt: '2024-01-15T10:30:00Z',
        excerpt: '今天 BTC 走了典型的超跌修复...',
        text: '今天 BTC 走了典型的超跌修复。凌晨下探 66000 后企稳，日内围绕 67000–68500 反复拉锯。',
        fingerprint: 'abc123',
      },
    ]) + '\n',
    sourceMapYaml: `version: 1
targetAccountId: ${account.id}
targetAccountKey: "account_1"
targetAccountName: "知乎测试号-3"
sourceAccount:
  platform: "zhihu"
  handleOrUrl: "https://www.zhihu.com/people/31-76-72-14-98"
  normalizedUserName: "31-76-72-14-98"
  profileUrl: "https://www.zhihu.com/people/31-76-72-14-98"
collection:
  requestedSampleSize: 40
  fetchedSampleCount: 40
  filteredOutCount: 0
  keptSampleCount: 40
  sampleQuality: "strong"
  collectionSucceeded: true
samples:
  - id: "sample_001"
    answerUrl: "https://www.zhihu.com/answer/learned-1"
    questionTitle: "币圈新手要注意什么？"
    questionUrl: "https://www.zhihu.com/question/example1"
    createdAt: "2024-01-15T10:30:00Z"
    preview: "今天 BTC 走了典型的超跌修复..."
`,
    samplePreview: [],
    generatedAt: new Date().toISOString(),
    sourcePaths: {
      accountMapPath: '',
      accountLibraryDir: '',
      noteAgentAssetDir: '',
    },
  };

  // 3. 执行 Apply
  console.log('='.repeat(60));
  console.log('📥 开始执行 applyDraft...');
  console.log('='.repeat(60));

  const startTime = Date.now();

  try {
    const result = await noteAgentService.applyDraft(account, {
      draft,
      actions: {
        writeLibraryDocs: true,
        saveLearnedAssets: true,
      },
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log('\n' + '='.repeat(60));
    console.log('✅ applyDraft 完成！');
    console.log('='.repeat(60));
    console.log(`总耗时: ${elapsed} 秒\n`);

    console.log(`📝 写入文件数量: ${result.writtenPaths.length} 个`);
    console.log('\n📂 写入路径:');
    for (const p of result.writtenPaths) {
      console.log(`  • ${p}`);
    }

    console.log('\n📑 阶段报告:');
    console.log(`  状态: ${result.phaseReport.status}`);
    console.log(`  完成时间: ${result.phaseReport.finishedAt}`);

    if (result.phaseReport.validationChecks.length > 0) {
      console.log('\n🔍 验证检查:');
      for (const check of result.phaseReport.validationChecks) {
        const icon = check.passed ? '✅' : '❌';
        console.log(`  ${icon} ${check.label}: ${check.details}`);
      }
    }

    console.log('\n 第三阶段（Apply）测试完成！');
    console.log('资产已正式写入文件系统，Writer/Review Agent 现在可以读取这些规则了。');

  } catch (error: any) {
    console.error('\n❌ applyDraft 失败:', error.message);
    if (error.stack) console.error('\n', error.stack.split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }

  await pool.end();
}

main().catch(err => {
  console.error('💥 脚本错误:', err);
  process.exit(1);
});
