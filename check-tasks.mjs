// 检查任务状态

const X_API_BASE = 'http://127.0.0.1:8788';

const taskIds = [
  '29fe216b-bc28-47cf-933c-f322c5db6510',
  'dd474104-4d6f-443d-998f-3824603298bc',
  'f90aab52-6b51-4777-8a94-4e50d9f49015',
  '6f734906-2a72-44f2-93a5-92a334e8cbf7',
  '9fd966d7-eaa5-407a-84e8-4bbee586387a'
];

console.log('========================================');
console.log('  任务状态详情');
console.log('========================================');
console.log('');

for (const taskId of taskIds) {
  console.log(`查询任务：${taskId}`);
  const response = await fetch(`${X_API_BASE}/tasks/${taskId}`);
  const result = await response.json();
  const task = result.task;
  
  console.log(`  标题：${task.title}`);
  console.log(`  状态：${task.status}`);
  console.log(`  当前阶段：${task.currentStage}`);
  console.log(`  模式：${task.preferredMode}`);
  
  if (task.mainAgentPlan) {
    console.log(`  MainAgent 决策:`);
    console.log(`    - decision: ${task.mainAgentPlan.decision}`);
    console.log(`    - reason: ${task.mainAgentPlan.reason.substring(0, 100)}...`);
    console.log(`    - preferredMode: ${task.mainAgentPlan.preferredMode}`);
    console.log(`    - publishAction: ${task.mainAgentPlan.publishAction}`);
    console.log(`    - contentStyle: ${task.mainAgentPlan.contentStyle}`);
    console.log(`    - shouldResearch: ${task.mainAgentPlan.shouldResearch}`);
    console.log(`    - shouldWrite: ${task.mainAgentPlan.shouldWrite}`);
    console.log(`    - shouldPublish: ${task.mainAgentPlan.shouldPublish}`);
  }
  
  if (task.draftPack) {
    console.log(`  草稿包:`);
    console.log(`    - summary: ${task.draftPack.summary.substring(0, 100)}...`);
    console.log(`    - posts 数量：${task.draftPack.posts.length}`);
    if (task.draftPack.posts.length > 0) {
      console.log(`    - 第 1 条:`);
      console.log(`      ${task.draftPack.posts[0].substring(0, 150)}...`);
    }
  }
  
  if (task.reviewResult) {
    console.log(`  审核结果:`);
    console.log(`    - decision: ${task.reviewResult.decision}`);
    console.log(`    - reason: ${task.reviewResult.reason.substring(0, 100)}...`);
  }
  
  if (task.failureReason) {
    console.log(`  失败原因：${task.failureReason}`);
  }
  
  console.log('');
}

console.log('========================================');
