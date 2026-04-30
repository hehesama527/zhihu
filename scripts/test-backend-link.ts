// 后端链路测试脚本
// 测试 Note Agent 风格学习功能

import { XTraditionalWorkspaceRepository } from '@zhihu-mvp/x-traditional-core';
import { XAccountSoulService } from '@zhihu-mvp/x-core';
import { XTraditionalNoteAgentService, XTraditionalLlmService } from '@zhihu-mvp/x-traditional-core';

async function testBackendLink() {
  console.log('=====================================');
  console.log('X Traditional 后端链路测试');
  console.log('=====================================\n');

  try {
    // 1. 初始化服务
    console.log('1️⃣  初始化服务...');
    const repository = new XTraditionalWorkspaceRepository();
    const llmService = new XTraditionalLlmService();
    const noteAgentService = new XTraditionalNoteAgentService(llmService);
    const accountSoulService = new XAccountSoulService(repository);

    await repository.ensureReady();
    console.log('   ✅ 数据库连接正常\n');

    // 2. 获取测试账户
    console.log('2️⃣  获取测试账户...');
    const accounts = await repository.listAccounts();
    console.log(`   ✅ 找到 ${accounts.length} 个账户`);
    
    const testAccount = accounts.find(a => a.id === 'trad-account-a');
    if (!testAccount) {
      throw new Error('测试账户 trad-account-a 不存在');
    }
    console.log(`   ✅ 测试账户：@${testAccount.handle}\n`);

    // 3. 获取账户 Soul
    console.log('3️⃣  获取账户 Soul 文档...');
    const soulDoc = await accountSoulService.ensureSoulDocument(testAccount);
    console.log(`   ✅ Soul 版本：v${soulDoc.version}`);
    console.log(`   ✅ 核心身份：${soulDoc.coreIdentity.substring(0, 50)}...\n`);

    // 4. 测试 Note Agent 生成（使用手工样本）
    console.log('4️⃣  测试 Note Agent 风格学习...');
    console.log('   📌 参考账户：https://x.com/LuYao_Trader');
    console.log('   📝 使用手工样本（跳过浏览器采集）\n');

    const generateInput = {
      mode: 'style_learning' as const,
      sourceAccount: {
        platform: 'x' as const,
        handleOrUrl: 'https://x.com/LuYao_Trader',
      },
      collection: {
        sampleSize: 5,
        lookbackDays: 7,
        includeReplies: false,
      },
      manualSeedTexts: [
        '币圈最大的陷阱就是看到别人赚钱，就以为自己也能赚。市场永远不缺机会，缺的是耐心等待机会的人。',
        '交易不是比谁更聪明，而是比谁更自律。制定计划，执行计划，就这么简单。',
        '很多人问我怎么判断底部，我的答案很简单：没人敢说话的时候，就是机会。',
        '止损不是承认失败，而是保护自己继续游戏的权利。',
        '市场从不会按你的剧本走，但你可以准备多个剧本应对市场。',
      ],
    };

    console.log('   ⏳ 正在调用 LLM 进行风格分析...\n');
    
    const startTime = Date.now();
    const draft = await noteAgentService.generateDraft(testAccount, generateInput);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log('   ✅ 生成成功！\n');

    // 5. 显示结果
    console.log('=====================================');
    console.log('学习结果');
    console.log('=====================================\n');

    console.log('📊 样本采集:');
    console.log(`   总样本数：${draft.collectionSummary.collectedSampleCount} 条`);
    console.log(`   手工补样：${draft.collectionSummary.manualSeedCount} 条`);
    console.log(`   浏览器采样：${draft.collectionSummary.browserCollectionSucceeded ? '成功' : '受限'}\n`);

    console.log('📖 风格总结:');
    console.log(`   ${draft.summary}\n`);

    console.log('🎯 学习到的风格特征:');
    console.log(`   ${draft.learnedStyleProfileMarkdown.substring(0, 200)}...\n`);

    console.log('⏰ 性能统计:');
    console.log(`   总耗时：${elapsed} 秒`);
    console.log(`   生成时间：${draft.generatedAt}\n`);

    console.log('=====================================');
    console.log('✅ 后端链路测试通过！');
    console.log('=====================================\n');

    // 6. 保存结果
    const fs = await import('fs');
    const path = await import('path');
    const resultPath = path.join(process.cwd(), 'backend-test-result.json');
    fs.writeFileSync(resultPath, JSON.stringify(draft, null, 2), 'utf-8');
    console.log(`📄 完整结果已保存到：${resultPath}\n`);

  } catch (error) {
    console.error('\n❌ 测试失败:');
    console.error(error);
    process.exit(1);
  }
}

testBackendLink();
