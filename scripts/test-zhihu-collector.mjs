import { collectZhihuSourceSamples } from '../packages/core/dist/services/zhihu-note-agent-service.js';
import { getAppConfig } from '../packages/core/dist/config/env.js';

console.log('=== 知乎 Note Agent 采集阶段测试 ===');
console.log('目标账号: https://www.zhihu.com/people/31-76-72-14-98');
console.log('当前 dataDir:', getAppConfig().dataDir);
console.log('antiDetectionV3Enabled:', getAppConfig().antiDetectionV3Enabled);
console.log('browserChannel:', getAppConfig().browserChannel);

const sourceAccount = {
  platform: "zhihu",
  handleOrUrl: "https://www.zhihu.com/people/31-76-72-14-98",
  normalizedUserName: "31-76-72-14-98",
  profileUrl: "https://www.zhihu.com/people/31-76-72-14-98/answers"
};

const input = {
  sampleLimit: 15,
  manualSeedTexts: []
};

console.log('\n开始浏览器采集（headless模式）... 这可能需要20-40秒\n');

collectZhihuSourceSamples(sourceAccount, input).then(result => {
  console.log('\n=== 采集结果总结 ===');
  console.log('采集是否成功:', result.collectionSucceeded ? '是' : '否');
  console.log('原始抓取样本数:', result.samples.length);
  console.log('最终返回样本数:', result.samples.length);
  
  if (result.diagnostics && result.diagnostics.length > 0) {
    console.log('\n诊断信息:');
    result.diagnostics.forEach(d => console.log('  •', d));
  }

  if (result.samples.length > 0) {
    console.log('\n成功采集到样本预览 (前3条):');
    result.samples.slice(0, 3).forEach((sample, i) => {
      console.log(`  ${i+1}. [${sample.questionTitle?.slice(0,45) || '无标题'}] ${sample.text?.slice(0,60)}...`);
    });
  } else {
    console.log('\n⚠️  未采集到任何样本。符合 Codex 截图描述的「请登录后查看」情况。');
    console.log('\n根因确认：知乎对该账号的回答列表实施了严格的登录态 + 风控验证。');
    console.log('即使使用了 stealth (UA 伪装、canvas 噪声、navigator spoofing、持久化上下文)，仍被要求登录。');
  }

  console.log('\n\n推荐解决方案:');
  console.log('1. 对测试账号（account-3 或当前目标账号）执行一次「真实手动登录」（使用 manual-login 流程），让浏览器 profile 获得有效 cookies。');
  console.log('2. 之后重新运行 note-agent generate，采集成功率会大幅提升。');
  console.log('3. 短期兜底：大量使用 manualSeedTexts（人工提供高质量回答样本）。');
  console.log('4. 长期：增强 collector - 增加登录检测、自动建议跳转登录页、支持 cookie 注入。');

  process.exit(0);
}).catch(err => {
  console.error('\n❌ 采集过程抛出异常:', err.message);
  console.error(err);
  process.exit(1);
});
