# Twitter 矩阵运营子系统 - 完成度验证与执行总览

**文档版本**: v1.0  
**创建日期**: 2026-04-12  
**整合来源**: 产品文档 v0.1、Agent 架构说明 V0.7、MVP 落地文档 v0.1、最近更新记录 v0.2  
**状态**: 已验证可执行

---

## 一、整体完成度评估

### 1.1 核心结论

截至 2026-04-12，系统已达到**"架构验证完成，端到端待收尾"**的状态：

- ✅ **M1 里程碑**（文档/框架/账户）：**已完成**
- ⚠️ **M2 里程碑**（Research 链路）：**部分完成**（simulated search，待外部搜索集成）
- ✅ **M3 里程碑**（Writer/MainAgent）：**已完成**
- ❌ **M4 里程碑**（Publisher/真实发布/通知）：**未完成**（缺少真实账号发布验证）

### 1.2 当前可执行能力

系统当前可直接执行以下完整流程：

1. ✅ 创建 Twitter/X 账号并管理定位信息
2. ✅ 生成账号研究 Markdown 文档（基于模拟搜索）
3. ✅ 前端查看和微调 research 文档
4. ✅ WriterAgent 基于 research 文档生成 Post Pack
5. ✅ MainAgent 审核草稿并给出修改意见
6. ✅ 状态流转和任务管理
7. ⚠️ 发布功能（dry-run 模式已通，真实发布待验证）
8. ⚠️ 飞书通知（接口已通，待配置 webhook）

---

## 二、系统架构总览

### 2.1 Agent 分工

| Agent | 定位 | 核心职责 | 完成状态 |
|-------|------|---------|---------|
| `MainAgent` | 全局控制器 | 任务规划、Research 触发、写作审核、发布决策、频率控制 | ✅ 已完成 |
| `ResearchSubAgent` | 知识生产者 | 账号研究、竞品分析、生成 research Markdown 文档 | ⚠️ 部分完成 |
| `WriterSubAgent` | 内容执行者 | 读取 research+prompt、生成 Post Pack、执行修改 | ✅ 已完成 |
| `PublisherSubAgent` | 发布执行者 | 执行发布、记录结果、发送通知 | ⚠️ 待真实验证 |
| `HotspotScoutAgent` | 热点扫描器 | RSS 扫描、热点去重、为 MainAgent 提供热点候选 | ✅ 已完成 |

### 2.2 核心流程

```
任务创建 → MainAgent(plan) → ResearchAgent → WriterAgent → ReviewAgent → 
MainAgent(draft_gate) → PublisherAgent → 发布结果
```

**热点流程**：
```
HotspotScoutAgent → 热点池 → MainAgent 选择使用/转人工
```

### 2.3 账号管理

- **账号模型**：支持 Twitter/X 账号创建、定位、目标受众、标签
- **授权状态**：`authStatus` 作为发布硬闸口（ready/not-ready）
- **Research 文档**：每个账号绑定独立的研究 Markdown 文档
- **前端功能**：账号管理、Research 查看/微调、Prompt 配置

---

## 三、已完成功能清单

### 3.1 基础设施

- ✅ 工程框架搭建（packages/x-core, apps/x-api, apps/x-worker）
- ✅ 目录边界定义（Twitter/X 独立于知乎系统）
- ✅ 环境配置（`.env.example` 包含 X_BROWSER_CHANNEL, X_BROWSER_PROXY_URL）
- ✅ 默认值统一：
  - 代理地址：`http://127.0.0.1:7890`
  - 浏览器：Microsoft Edge (msedge)

### 3.2 账号系统

- ✅ Twitter/X 账号模型（handle, name, bio, target_audience, tags）
- ✅ 账号定位信息管理
- ✅ 授权状态管理（`authStatus`）
- ✅ Research 文档与账号绑定
- ✅ 前端账号管理页面（`/twitter/account`）
- ✅ 简化创建流程（只需填写 handle，name 可选，自动使用@handle 作为默认名）

### 3.3 Research 系统

- ✅ Research 文档模型（包含账号定位、受众、竞品分析、表达建议）
- ✅ Research 文档生成（当前为 simulated search）
- ✅ 前端 Research 查看页面
- ✅ 用户微调功能（人工修改可保存为下一版草稿的输入）
- ✅ 版本管理（记录修改时间和修改内容）

### 3.4 写作系统

- ✅ WriterAgent 读取 Research 文档
- ✅ WriterAgent 读取账号 Prompt 配置
- ✅ Post Pack 生成（包含长版、短版、开头备选、结尾备选、CTA）
- ✅ MainAgent runtime prompt 生成（支持两种模式：main_agent/database）
- ✅ 前端 Prompt Studio 配置
- ✅ 草稿生成和修改流程

### 3.5 审核与状态流转

- ✅ 完整状态机：
  ```
  planned → research_pending → researching → research_ready → 
  writing_pending → writing → draft_ready → under_review → 
  revision_required / approved_to_publish → publishing → published / publish_failed
  ```
- ✅ MainAgent 审核决策（approve/revise/re-research/block）
- ✅ 状态流转记录
- ✅ 失败原因记录

### 3.6 发布系统

- ✅ PublisherSubAgent 框架
- ✅ 发布模式支持：
  - 原创（post）
  - 回复（reply）
  - 引用转发（quote）
- ✅ 发布计划（publishPlan）结构
- ✅ Dry-run 模式（当前默认）
- ✅ 发布结果记录（tweet_id, URL, 时间戳）
- ✅ 前端发布任务页面（`/twitter/publish`）
- ✅ 前端发布历史页面（`/twitter/publish-history`）

### 3.7 前端功能

- ✅ Twitter 矩阵前端路由：
  - `/twitter` - 主页面
  - `/twitter/account` - 账号管理
  - `/twitter/drafts` - 草稿箱
  - `/twitter/publish` - 发布任务
  - `/twitter/publish-history` - 发布历史
  - `/twitter/prompts` - Prompt 工作室
  - `/twitter/hotspots` - 热点监控
  - `/twitter/watchlists` - 监控列表
- ✅ 数据对接（已替换 mock 数据，使用真实 API）
- ✅ 状态筛选和刷新功能
- ✅ 账号名称为空时的兜底显示（显示@handle）

### 3.8 热点系统

- ✅ HotspotScoutAgent RSS 扫描
- ✅ 热点去重和聚合
- ✅ 热点池维护
- ✅ MainAgent 热点选择（在 plan 阶段判断是否需要热点）
- ✅ 热点与任务绑定（selectedHotspotIds）

---

## 四、待完成/待验证功能

### 4.1 关键缺失

#### 4.1.1 Research 真实搜索集成
- **当前状态**：使用 simulated search（模拟搜索）
- **待完成**：
  - 集成真实外部搜索（Tavily/SerpAPI）
  - 验证搜索结果质量
  - 更新 ResearchSubAgent 提示词以使用真实数据

#### 4.1.2 真实账号发布验证
- **当前状态**：dry-run 模式，未真实发布
- **待完成**：
  - 配置真实 Twitter/X API 凭证
  - 执行端到端发布测试（至少 1 个账号成功发布）
  - 记录真实 tweet_id 和 URL
  - 验证发布频率控制

#### 4.1.3 飞书通知完整链路
- **当前状态**：接口已实现，webhook 已配置但未验证
- **待完成**：
  - 配置 `X_FEISHU_BOT_WEBHOOK_URL`
  - 验证发布成功通知
  - 验证发布失败通知
  - 验证账号异常通知

### 4.2 优化项

- ⚠️ Watchlist 默认源配置（当前需手动配置，建议改为常驻默认源）
- ⚠️ 账号发布频率的 LLM 判断优化（当前为固定规则）
- ⚠️ Research 文档更新策略（需明确触发条件）

---

## 五、执行验证清单

### 5.1 环境准备

**启动命令**（仅启动 Twitter 相关服务）：

```bash
# 1. 启动 X API
cd apps/x-api
pnpm dev

# 2. 启动 X Worker
cd apps/x-worker  
pnpm dev

# 3. 启动前端
cd apps/web
pnpm dev
```

**不启动**：
- ❌ 知乎后端（生产环境）
- ❌ 运维 Agent

**环境变量检查**：
```bash
# .env 或 .env.local
X_BROWSER_CHANNEL=msedge
X_BROWSER_PROXY_URL=http://127.0.0.1:7890
X_FEISHU_BOT_WEBHOOK_URL=<待配置>
```

### 5.2 端到端测试流程

#### 测试 A：标准成功链路

**目标**：验证从 Research 到发布的完整流程

**步骤**：
1. 创建一个测试账号（只需填写 handle，如 `@testaccount`）
2. 为该账号生成 research 文档
3. 在前端查看并微调 research 文档（添加 1-2 条人工备注）
4. 创建写作任务
5. WriterAgent 生成草稿
6. MainAgent 审核通过（无需修改）
7. 执行发布（当前为 dry-run）
8. 检查发布结果（应有 tweet_id 和 URL 占位符）
9. 检查飞书通知（待配置 webhook）

**通过标准**：
- ✅ 全流程无人工干预
- ✅ 系统记录完整状态流转
- ✅ 发布结果可查询
- ✅ 草稿使用了用户微调后的 research 文档

#### 测试 B：修改链路

**目标**：验证 MainAgent 修改意见有效性

**步骤**：
1. WriterAgent 生成初始草稿
2. MainAgent 给出修改意见（如"增加钩子"、"缩短长度"）
3. WriterAgent 执行修改
4. MainAgent 再次审核

**通过标准**：
- ✅ 修改意见具体可执行
- ✅ 修改后草稿有明显改进
- ✅ 修改意见参考了账号定位

#### 测试 C：失败处理链路

**目标**：验证失败可感知和可定位

**步骤**：
1. 模拟发布失败（如关闭代理）
2. 检查系统状态
3. 检查错误通知

**通过标准**：
- ✅ 状态变为 `publish_failed` 或 `blocked`
- ✅ 系统记录失败原因（非"未知错误"）
- ✅ 发送失败通知

### 5.3 前端验证点

**账号管理页** (`/twitter/account`)：
- [ ] 创建账号时只需填写 handle
- [ ] name 为空时显示为 `@handle`
- [ ] 可配置 Writer Prompt 开关
- [ ] 可查看账号 research 文档

**草稿箱** (`/twitter/drafts`)：
- [ ] 显示真实草稿数据（非 mock）
- [ ] 状态筛选可用（待审核/已通过/需修改/已拒绝）
- [ ] 刷新按钮可更新数据

**发布任务** (`/twitter/publish`)：
- [ ] 显示真实发布任务
- [ ] 状态筛选可用（发布中/已发布/失败/待发布）
- [ ] 可查看发布计划详情

**发布历史** (`/twitter/publish-history`)：
- [ ] 显示已发布记录
- [ ] 可点击 URL 跳转
- [ ] 可按账号筛选

---

## 六、关键技术决策

### 6.1 LLM 优先原则

系统优先使用 LLM 处理以下任务：
- Research 文档生成
- 竞品账号分析
- 写作风格迁移
- 内容审核
- 发布频率判断
- 短内容 vs 长线程判断

**硬编码兜底**仅用于：
- 账号授权状态
- API 调用结果
- 状态流转合法性
- 持久化存储
- 通知发送

### 6.2 Post Pack 数据结构

一条内容不是单篇推文，而是一组运营素材：

```typescript
interface PostPack {
  longVersion: string;      // 长版（thread）
  shortVersion: string;     // 短版（single post）
  hookOptions: string[];    // 开头备选
  ctaOptions: string[];     // 结尾备选
  hashtags: string[];       // 标签建议
  notes: string;            // 发布备注
}
```

**发布策略**：
- 默认发短版
- 同一话题可拆分为多条短内容分开发
- 强内容默认发长线程

### 6.3 Writer Prompt 双模式

1. **main_agent 模式**（默认）：
   - MainAgent 每次生成 runtime writer prompt
   - 适合新账号、实验性账号
   - 边界更灵活

2. **database 模式**：
   - 使用数据库存储的账号 Writer Prompt
   - 适合成熟稳定账号
   - 减少重复生成

### 6.4 发布模式

MainAgent 可决策三种发布类型：
- `post`：原创内容
- `reply`：回复他人推文
- `quote`：引用转发

**决策依据**：
- 任务目标是输出观点 → `post`
- 目标是借势某个推文 → `quote`
- 目标是直接互动 → `reply`
- 无合适目标推文 → 不强行 `reply/quote`

---

## 七、下一步行动

### 7.1 立即执行（P0）

1. **集成真实搜索**（1-2 天）
   - 接入 Tavily/SerpAPI
   - 更新 ResearchSubAgent prompt
   - 验证搜索结果质量

2. **真实发布验证**（1 天）
   - 配置 Twitter API 凭证
   - 执行至少 1 次真实发布
   - 记录 tweet_id 和 URL

3. **飞书通知验证**（0.5 天）
   - 配置 webhook URL
   - 验证成功/失败通知

### 7.2 短期优化（P1）

1. Watchlist 默认源配置
2. Research 文档更新策略明确
3. 发布频率 LLM 判断优化
4. 多账号批量操作支持

### 7.3 中期规划（P2）

1. 定时任务调度
2. 发布效果数据分析
3. Research 文档自动刷新
4. 跨平台统一运营

---

## 八、风险与注意事项

### 8.1 技术风险

- **搜索质量**：simulated search 与真实搜索差距待验证
- **API 稳定性**：Twitter API 调用频率限制和错误处理
- **浏览器指纹**：Playwright 方案的反检测能力

### 8.2 运营风险

- **内容同质化**：不同账号内容差异度不足
- **Research 过度更新**：导致账号风格漂移
- **Agent 人格分裂**：同一账号表达不一致

### 8.3 规避策略

1. Research 文档更新频率控制（建议每周不超过 1 次）
2. 账号定位变更时需明确标注
3. 发布前必须通过 MainAgent 审核
4. 避免过早推广到多账号

---

## 九、文档使用说明

### 9.1 给执行者

本文档包含：
- ✅ 系统当前能力清单
- ✅ 端到端测试流程
- ✅ 环境配置说明
- ✅ 验证检查点

**使用建议**：
1. 按"五、执行验证清单"逐步测试
2. 遇到问题先查"四、待完成/待验证功能"
3. 技术细节参考原文档（产品文档、Agent 架构说明）

### 9.2 给验证者

**验证重点**：
1. 端到端流程是否真正跑通（至少 1 个账号成功发布）
2. Research 文档是否有实际价值（非空泛模板）
3. MainAgent 审核意见是否可执行
4. 失败场景是否可感知和可定位

**验证方法**：
- 按"测试 A/B/C"执行
- 检查前端各页面数据真实性
- 查看数据库状态流转记录

### 9.3 给后续开发者

**架构参考**：
- Agent 边界定义见原文档"Agent 架构说明"
- 数据模型定义见 `packages/x-core/src/schemas.ts`
- 状态机定义见 `packages/x-core/src/types.ts`

**扩展建议**：
- 新增 Agent 需明确权责边界
- 避免绕过 MainAgent 直接发布
- Research 文档格式变更需向后兼容

---

## 十、总结

### 10.1 已完成

- ✅ 系统架构设计和实现
- ✅ Agent 分工和协作流程
- ✅ 账号管理和 Research 系统
- ✅ 写作和审核流程
- ✅ 前端数据对接
- ✅ 状态机和任务管理

### 10.2 待收尾

- ⚠️ 真实搜索集成（simulated → real）
- ⚠️ 真实发布验证（dry-run → production）
- ⚠️ 飞书通知验证（接口→实际通知）

### 10.3 最终判断

**当前系统状态**：架构验证完成，端到端待收尾

**MVP 完成标准**：需完成 M4 里程碑（真实账号发布 + 真实通知）

**预计收尾时间**：2-3 天（假设外部 API 配置顺利）

---

**文档维护**：本整合文档应随系统迭代更新，重大变更需同步更新"完成度评估"和"待完成功能"章节。

**最后更新**：2026-04-12
