// 检查任务当前状态

const X_API_BASE = 'http://127.0.0.1:8788';

const taskId = '9fd966d7-eaa5-407a-84e8-4bbee586387a';

console.log('查询任务状态...');
const response = await fetch(`${X_API_BASE}/tasks/${taskId}`);
const result = await response.json();
const task = result.task;

console.log('');
console.log('========================================');
console.log(`任务：${task.title}`);
console.log('========================================');
console.log('');
console.log(`状态：${task.status}`);
console.log(`当前阶段：${task.currentStage}`);
console.log(`修订次数：${task.revisionCount}`);
console.log('');

if (task.mainAgentPlan) {
  console.log('MainAgent 决策:');
  console.log(`  decision: ${task.mainAgentPlan.decision}`);
  console.log(`  reason: ${task.mainAgentPlan.reason.substring(0, 150)}...`);
  console.log(`  preferredMode: ${task.mainAgentPlan.preferredMode}`);
  console.log(`  publishAction: ${task.mainAgentPlan.publishAction}`);
  console.log(`  contentStyle: ${task.mainAgentPlan.contentStyle}`);
  console.log('');
}

if (task.draftPack && task.draftPack.posts.length > 0) {
  console.log(`草稿包 (${task.draftPack.posts.length} 条帖子):`);
  console.log(`  summary: ${task.draftPack.summary}`);
  console.log('');
  task.draftPack.posts.forEach((post, i) => {
    console.log(`  帖子 ${i + 1}:`);
    console.log(`    ${post.substring(0, 200)}...`);
    console.log('');
  });
}

if (task.reviewResult) {
  console.log('审核结果:');
  console.log(`  decision: ${task.reviewResult.decision}`);
  console.log(`  reason: ${task.reviewResult.reason}`);
  console.log('');
}

if (task.failureReason) {
  console.log(`失败原因：${task.failureReason}`);
  console.log('');
}

// 列出所有任务的状态
console.log('========================================');
console.log('所有任务状态:');
console.log('========================================');
console.log('');

const allTasksResponse = await fetch(`${X_API_BASE}/tasks`);
const allTasksResult = await allTasksResponse.json();
const allTasks = allTasksResult.tasks;

for (const t of allTasks) {
  console.log(`${t.id.substring(0, 8)}... - ${t.status.padEnd(20)} - ${t.title}`);
}
