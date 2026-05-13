// 手动运行单个任务，观察完整流�?

const X_API_BASE = 'http://127.0.0.1:8788';

// 使用第一个任�?
const taskId = '29fe216b-bc28-47cf-933c-f322c5db6510';

console.log('========================================');
console.log('  手动运行任务 - 观察完整流程');
console.log('========================================');
console.log('');

// 1. 先查询任务当前状�?
console.log('[步骤 1] 查询任务当前状�?..');
let response = await fetch(`${X_API_BASE}/tasks/${taskId}`);
let result = await response.json();
let task = result.task;

console.log(`  任务 ID: ${task.id}`);
console.log(`  标题�?{task.title}`);
console.log(`  当前状态：${task.status}`);
console.log('');

// 2. 重置任务状态（如果�?blocked�?
if (task.status === 'blocked') {
  console.log('[步骤 2] 重置任务状�?..');
  response = await fetch(`${X_API_BASE}/tasks/${taskId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'retry'
    })
  });
  result = await response.json();
  task = result.task;
  console.log(`  �?任务已重置，新状态：${task.status}`);
  console.log('');
}

// 3. 运行任务
console.log('[步骤 3] 运行任务...');
console.log('  这可能需要几分钟，因为要经过多个阶段...');
console.log('');

response = await fetch(`${X_API_BASE}/tasks/${taskId}/run-now`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
});

// 等待响应，这可能需要一些时�?
result = await response.json();
console.log('API 返回结果:', JSON.stringify(result, null, 2));
task = result.task?.task || result.task;

if (!task) {
  console.log('错误：无法获取任务结�?);
  process.exit(1);
}

console.log('�?任务运行完成!');
console.log('');

// 4. 查看最终结�?
console.log('[步骤 4] 查看最终结�?..');
console.log(`  最终状态：${task.status}`);
console.log(`  当前阶段�?{task.currentStage}`);

if (task.mainAgentPlan) {
  console.log('');
  console.log('  MainAgent 规划结果:');
  console.log(`    decision: ${task.mainAgentPlan.decision}`);
  console.log(`    reason: ${task.mainAgentPlan.reason}`);
  console.log(`    preferredMode: ${task.mainAgentPlan.preferredMode}`);
  console.log(`    publishAction: ${task.mainAgentPlan.publishAction}`);
  console.log(`    contentStyle: ${task.mainAgentPlan.contentStyle}`);
  console.log(`    shouldWrite: ${task.mainAgentPlan.shouldWrite}`);
  console.log(`    shouldPublish: ${task.mainAgentPlan.shouldPublish}`);
  
  if (task.mainAgentPlan.writerBrief) {
    console.log('');
    console.log('  Writer Brief:');
    console.log(`    angle: ${task.mainAgentPlan.writerBrief.angle}`);
    console.log(`    goal: ${task.mainAgentPlan.writerBrief.goal}`);
    console.log(`    mustInclude: ${task.mainAgentPlan.writerBrief.mustInclude.join(', ')}`);
    console.log(`    mustAvoid: ${task.mainAgentPlan.writerBrief.mustAvoid.join(', ')}`);
  }
}

if (task.draftPack) {
  console.log('');
  console.log('  草稿�?(Draft Pack):');
  console.log(`    summary: ${task.draftPack.summary}`);
  console.log(`    posts 数量�?{task.draftPack.posts.length}`);
  if (task.draftPack.posts.length > 0) {
    task.draftPack.posts.forEach((post, index) => {
      console.log(`    帖子 ${index + 1}:`);
      console.log(`      ${post}`);
      console.log('');
    });
  }
  console.log(`    notes: ${task.draftPack.notes.join(', ')}`);
}

if (task.reviewResult) {
  console.log('');
  console.log('  审核结果 (Review Result):');
  console.log(`    decision: ${task.reviewResult.decision}`);
  console.log(`    reason: ${task.reviewResult.reason}`);
  console.log(`    revisionInstructions: ${task.reviewResult.revisionInstructions.join(', ')}`);
}

if (task.failureReason) {
  console.log('');
  console.log(`  失败原因�?{task.failureReason}`);
}

console.log('');
console.log('========================================');
console.log('  流程说明');
console.log('========================================');
console.log('');
console.log('X 任务执行的完整流程如下：');
console.log('');
console.log('1. 任务创建 (Task Creation)');
console.log('   - 用户创建任务，填�?title, brief, goal');
console.log('   - 设置 preferredMode (single/thread)');
console.log('   - 任务状态：planned');
console.log('');
console.log('2. MainAgent 规划阶段 (Planning)');
console.log('   - MainAgent 分析任务，决定：');
console.log('     * 是否需�?research');
console.log('     * 发布动作 (post/reply/quote)');
console.log('     * 内容风格 (casual_note/small_insight �?');
console.log('     * 是否使用热点');
console.log('     * 生成 Writer Brief');
console.log('   - 任务状态：planned');
console.log('');
console.log('3. 研究阶段 (Research) - 可�?);
console.log('   - 如果 MainAgent 决定需�?research');
console.log('   - 更新账号 research 手册');
console.log('   - 任务状态：writing -> draft_ready');
console.log('');
console.log('4. 写作阶段 (Writing)');
console.log('   - Writer Agent 根据 MainAgent �?brief 写作');
console.log('   - 生成草稿�?(draftPack)');
console.log('   - 包含 summary �?posts 数组');
console.log('   - 任务状态：writing -> draft_ready');
console.log('');
console.log('5. 审核阶段 (Review)');
console.log('   - Review Agent 先审查草稿质�?);
console.log('   - MainAgent 做最终审核决�?);
console.log('   - 可能的决定：approve/revise/block');
console.log('   - 任务状态：under_review -> approved_to_publish / revision_required / blocked');
console.log('');
console.log('6. 发布阶段 (Publishing) - 可�?);
console.log('   - 如果审核通过且决定发�?);
console.log('   - Publish Agent 生成发布计划');
console.log('   - 浏览器自动化发布 (�?dry_run)');
console.log('   - 任务状态：publishing -> published');
console.log('');
console.log('注意�?);
console.log('- 如果审核不通过，会返回 revision_required，重新进入写作阶�?);
console.log('- 最�?3 次修订，超过�?block');
console.log('- 当前配置�?dry_run 模式，不会实际发�?);
console.log('');

