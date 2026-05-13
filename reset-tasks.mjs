// 重置所有 blocked 的任务

const X_API_BASE = 'http://127.0.0.1:8788';

console.log('========================================');
console.log('  重置所有 blocked 任务');
console.log('========================================');
console.log('');

// 获取所有任务
const response = await fetch(`${X_API_BASE}/tasks`);
const result = await response.json();
const tasks = result.tasks;

console.log(`找到 ${tasks.length} 个任务`);
console.log('');

const blockedTasks = tasks.filter(t => t.status === 'blocked' || t.status.includes('failed'));
console.log(`需要重置 ${blockedTasks.length} 个失败的任务`);
console.log('');

for (const task of blockedTasks) {
  console.log(`重置任务：${task.id}`);
  console.log(`  标题：${task.title}`);
  console.log(`  当前状态：${task.status}`);
  
  const resetResponse = await fetch(`${X_API_BASE}/tasks/${task.id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'retry'
    })
  });
  
  const resetResult = await resetResponse.json();
  console.log(`  ✓ 重置成功，新状态：${resetResult.task.status}`);
  console.log('');
}

console.log('========================================');
console.log('  所有任务已重置完成');
console.log('========================================');
console.log('');
console.log('x-worker 将会自动处理这些任务...');
