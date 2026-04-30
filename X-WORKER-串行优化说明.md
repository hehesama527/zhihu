# X Worker 串行执行优化说明

## 已完成的修改

### 1. 增加修订次数限制 ✅

**文件**: `packages/x-core/src/services/x-worker-runner.ts`

```typescript
const MAX_REVIEW_REVISIONS = 5;  // 从 3 次增加到 5 次
```

**效果**: 任务在审核阶段最多可以进行 5 次修订，而不是之前的 3 次。这给了任务更多的容错空间，特别是当 LLM 输出质量不稳定时。

---

### 2. Worker 任务串行执行 ✅

**文件**: `packages/x-core/src/services/x-worker-runner.ts`

**修改内容**:
```typescript
async tick(limit = 5): Promise<XWorkerTickSummary> {
  // ... 省略部分代码 ...
  
  for (const task of tasks) {
    if (summary.processedTaskIds.length >= limit) {
      break;
    }

    if (task.status === "published" || task.status === "blocked") {
      continue;
    }

    // 串行执行：在每个任务之间增加小延迟，避免 429 限流
    if (summary.processedTaskIds.length > 0) {
      await this.sleep(2000); // 2 秒间隔
    }

    const result = await this.runTaskNow(task.id);
    // ... 省略部分代码 ...
  }
  
  return summary;
}

private sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**效果**: 
- 每个任务处理完成后再处理下一个任务
- 任务之间有 2 秒的间隔
- 避免了多个任务同时调用 LLM API 导致的并发问题

---

### 3. LLM 服务 429 重试机制 ✅

**文件**: `packages/x-core/src/services/x-llm-service.ts`

**修改内容**:
```typescript
async runPrompt(systemPromptOrSetName: string, input: unknown, options?: PromptRunOptions) {
  // 429 重试机制：最多重试 5 次，指数退避
  const maxRetries = 5;
  const baseDelayMs = 5000; // 5 秒基础延迟
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // ... LLM 调用代码 ...
      return text;
    } catch (error: any) {
      const isRateLimitError = error?.status === 429 || error?.error?.code === 429;
      
      if (isRateLimitError && attempt < maxRetries) {
        // 指数退避：5s, 10s, 20s, 40s, 80s
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.log(`[x-llm] 429 rate limit hit, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await this.sleep(delayMs);
        continue;
      }
      
      throw error;
    }
  }

  throw new Error("X LLM request failed after all retries.");
}

private sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**效果**:
- 每个 LLM 调用遇到 429 错误时自动重试
- 指数退避策略：5s → 10s → 20s → 40s → 80s
- 最多重试 5 次，总等待时间可达 155 秒
- 详细的日志输出，便于监控重试情况

---

## 整体执行流程

### 串行执行保障

```
Worker Tick (每 45 秒)
  ↓
任务 1
  ├─ MainAgent LLM 调用 (有 429 重试)
  ├─ Writer LLM 调用 (有 429 重试)
  ├─ ReviewAgent LLM 调用 (有 429 重试)
  └─ 等待 2 秒
  ↓
任务 2
  ├─ MainAgent LLM 调用 (有 429 重试)
  ├─ Writer LLM 调用 (有 429 重试)
  ├─ ReviewAgent LLM 调用 (有 429 重试)
  └─ 等待 2 秒
  ↓
任务 3
  ...
```

### 三层防护机制

1. **第一层**: Worker 任务串行执行（任务间隔 2 秒）
2. **第二层**: LLM 调用 429 自动重试（最多 5 次，指数退避）
3. **第三层**: 审核修订次数增加（最多 5 次）

---

## 预期效果

### 优点
- ✅ 大幅降低 429 错误发生率
- ✅ 即使遇到 429 也能自动恢复
- ✅ 任务有更多的修订机会
- ✅ 代码改动最小化，保持原有架构

### 可能的缺点
- ⚠️ 整体执行时间变长（每个任务最多可能增加 155 秒的重试时间）
- ⚠️ 单个 worker tick 周期内能处理的任务数量减少

### 建议配置
- `WORKER_INTERVAL_MS`: 建议设置为 90000 (90 秒) 或更长，给任务执行留出足够时间
- `limit`: 每次 tick 处理的任务数量建议设置为 3-5 个

---

## 测试方法

1. 创建多个测试任务
2. 启动 x-worker
3. 观察日志中的 `[x-llm] 429 rate limit hit` 消息
4. 检查任务是否最终能成功完成

```bash
# 启动服务
npm run dev -w @zhihu-mvp/x-api
npm run dev -w @zhihu-mvp/x-worker

# 查看日志
# 在终端中观察 [x-worker] 和 [x-llm] 开头的日志
```

---

## 监控指标

### 成功指标
- 任务状态能从 `planned` → `writing` → `draft_ready` → `approved_to_publish` → `published`
- 429 错误日志减少
- 任务失败率降低

### 需要调整的指标
- 如果仍然频繁 429：增加 `baseDelayMs` 或 `maxRetries`
- 如果任务执行太慢：减少 `limit` 或增加 `WORKER_INTERVAL_MS`
- 如果修订次数经常用完：检查 LLM 输出质量或调整 prompt

---

## 后续优化建议

1. **动态调整延迟**: 根据 429 错误频率动态调整 `baseDelayMs`
2. **任务优先级**: 支持任务优先级队列，优先处理重要任务
3. **LLM 负载均衡**: 支持多个 LLM API key 轮换
4. **结果缓存**: 对相同的 prompt 缓存 LLM 响应

---

**修改时间**: 2026-04-12
**修改者**: AI Assistant
