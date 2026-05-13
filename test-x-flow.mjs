// X 流程测试脚本 - 创建账号和 5 个不同的测试任务
// 不实际发布，只走到写作完成

const X_API_BASE = 'http://127.0.0.1:8788';

console.log('========================================');
console.log('  X 流程测试 - 创建账号和任务');
console.log('========================================');
console.log('');

// 1. 创建测试账号
console.log('[1/6] 创建测试账号...');
const accountPayload = {
  handle: 'crypto_trader_zh',
  name: '加密交易手记',
  persona: '一个专注于币圈交易的老手，分享实战经验和踩坑记录',
  targetAudience: '币圈新手和有一定经验的交易者',
  styleGuide: '碎碎念风格，像朋友圈，不要教育用户，分享个人经验为主',
  learningTargets: [],
  manualNotes: '测试账号，用于验证 X 流程',
  status: 'active',
  writerPromptSource: 'main_agent',
  publishStyleRatios: {
    casualNote: 40,
    smallInsight: 25,
    pitfallLog: 15,
    toolMention: 10,
    industryTalk: 5,
    interactiveQa: 3,
    quoteRepost: 2
  }
};

const accountResponse = await fetch(`${X_API_BASE}/accounts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(accountPayload)
});
const accountResult = await accountResponse.json();
const accountId = accountResult.account.id;
console.log(`✓ 账号创建成功：@${accountResult.account.handle} (ID: ${accountId})`);
console.log('');

// 2. 创建 5 个不同的测试任务
const tasks = [
  {
    title: '新手最容易犯的 5 个交易错误',
    brief: '分享新手在币圈交易中最容易犯的错误，帮助读者避坑',
    goal: '让新手读者产生共鸣，同时感受到作者的经验价值',
    preferredMode: 'thread',
    forceResearch: false
  },
  {
    title: '今天止盈了一笔，聊聊我的止盈策略',
    brief: '分享最近一次成功的止盈操作，以及背后的思考逻辑',
    goal: '展示交易策略的实战应用，不炫耀，重点在思考过程',
    preferredMode: 'single',
    forceResearch: false
  },
  {
    title: '如何判断趋势和震荡？我的两个简单方法',
    brief: '分享判断市场状态的实用方法，不需要复杂指标',
    goal: '提供可立即使用的交易技巧，降低学习门槛',
    preferredMode: 'thread',
    forceResearch: false
  },
  {
    title: '回测了一个策略，结果有点意外',
    brief: '分享策略回测的过程和发现，可能反直觉',
    goal: '用数据说话，但不过度堆数字，重点在洞察',
    preferredMode: 'single',
    forceResearch: false
  },
  {
    title: '为什么我不建议新手用高杠杆？',
    brief: '从个人经验出发，讲述高杠杆的风险和教训',
    goal: '用真实经历警示风险，避免说教感',
    preferredMode: 'single',
    forceResearch: false
  }
];

console.log('[2/6] 创建 5 个测试任务...');
console.log('');

const createdTasks = [];
for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i];
  const taskPayload = {
    accountId: accountId,
    title: task.title,
    brief: task.brief,
    goal: task.goal,
    preferredMode: task.preferredMode,
    forceResearch: task.forceResearch
  };
  
  console.log(`  创建任务 ${i + 1}/5: ${task.title}`);
  const taskResponse = await fetch(`${X_API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(taskPayload)
  });
  const taskResult = await taskResponse.json();
  createdTasks.push(taskResult.task);
  console.log(`  ✓ 任务创建成功 (ID: ${taskResult.task.id})`);
}

console.log('');
console.log('✓ 所有任务创建成功!');
console.log('');

// 3. 输出任务摘要
console.log('========================================');
console.log('  任务摘要');
console.log('========================================');
console.log('');

for (const task of createdTasks) {
  console.log(`任务 ID: ${task.id}`);
  console.log(`  标题：${task.title}`);
  console.log(`  模式：${task.preferredMode}`);
  console.log(`  状态：${task.status}`);
  console.log('');
}

console.log('========================================');
console.log('  下一步操作');
console.log('========================================');
console.log('');
console.log('现在可以使用以下命令运行任务：');
console.log('');
for (const task of createdTasks) {
  console.log(`  curl -X POST http://127.0.0.1:8788/tasks/${task.id}/run-now`);
}
console.log('');
console.log('或者启动 x-worker 自动处理这些任务：');
console.log('  npm run dev -w @zhihu-mvp/x-worker');
console.log('');

// 保存任务 ID 到文件，方便后续使用
import { writeFileSync } from 'node:fs';
writeFileSync('./test-tasks.json', JSON.stringify(createdTasks, null, 2), 'utf8');
console.log('✓ 任务信息已保存到 test-tasks.json');
console.log('');
