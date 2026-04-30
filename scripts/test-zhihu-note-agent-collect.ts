import { collectZhihuSourceSamples } from '../packages/core/src/services/zhihu-note-agent-service.js';
import { getAppConfig } from '../packages/core/src/config/env.js';

async function testCollection() {
  console.log('🚀 开始测试知乎 Note Agent 采集阶段 - 有头模式（headless: false）\n');
  console.log('目标账号: https://www.zhihu.com/people/31-76-72-14-98');
  console.log('模式: 有头浏览器 + 新独立 Profile + 更强拟人行为\n');

  const config = getAppConfig();
  console.log('配置信息:');
  console.log('  - dataDir:', config.dataDir);
  console.log('  - browserChannel:', config.browserChannel);
  console.log('  - antiDetectionV3Enabled:', config.antiDetectionV3Enabled || false);
  console.log('');

  const sourceAccount = {
    platform: 'zhihu' as const,
    handleOrUrl: 'https://www.zhihu.com/people/31-76-72-14-98',
    normalizedUserName: '31-76-72-14-98',
    profileUrl: 'https://www.zhihu.com/people/31-76-72-14-98/answers'
  };

  const input = {
    sampleLimit: 15,
    manualSeedTexts: [] as string[]
  };

  console.log('⏳ 正在启动【有头浏览器】进行采集（窗口会弹出）...\n');
  console.log('请不要关闭弹出的浏览器窗口，让它自动完成滚动和采集。\n');

  const startTime = Date.now();

  try {
    const result = await collectZhihuSourceSamples(sourceAccount, input);

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log('\n' + '='.repeat(70));
    console.log('🎯 采集测试结果（有头模式）');
    console.log('='.repeat(70));
    console.log(`采集耗时: ${elapsed} 秒`);
    console.log(`采集是否成功: ${result.collectionSucceeded ? '✅ 成功' : '❌ 失败'}`);
    console.log(`最终有效样本数量: ${result.samples.length} 条\n`);

    if (result.diagnostics.length > 0) {
      console.log('📋 详细诊断信息:');
      result.diagnostics.forEach((diag, i) => console.log(`   ${i+1}. ${diag}`));
      console.log('');
    }

    if (result.samples.length > 0) {
      console.log('📄 成功采集的样本预览:');
      result.samples.slice(0, 5).forEach((sample, i) => {
        const title = (sample.questionTitle || '无标题').slice(0, 65);
        const excerpt = sample.text ? sample.text.slice(0, 85) + '...' : '(无正文)';
        console.log(`   ${i+1}. ${title}`);
        console.log(`      ${excerpt}\n`);
      });
      console.log('\n✅ 采集成功！可以继续测试 generateDraft 完整流程了。');
    } else {
      console.log('⚠️  仍然未能采集到有效回答样本。');
      console.log('可能原因分析：');
      console.log('  • 该账号回答列表风控极强（即使有头 + 登录态也难绕过）');
      console.log('  • 知乎可能要求更高的行为模拟（鼠标轨迹、停留时间、点击等）');
      console.log('  • 该特定账号的回答可能被隐藏或数量极少');
      console.log('\n建议：');
      console.log('  1. 使用 manualSeedTexts 大量提供人工样本（推荐立即尝试）');
      console.log('  2. 换一个回答数量多、较活跃的知乎账号再测');
      console.log('  3. 进一步强化采集器的拟人化行为（可继续优化）');
    }

  } catch (error: any) {
    console.error('\n❌ 测试过程抛出异常:', error.message);
    if (error.stack) console.error('\n', error.stack.split('\n').slice(0, 8).join('\n'));
  }

  console.log('\n测试结束。');
  console.log('你可以关闭刚才弹出的浏览器窗口了。');
}

testCollection();
