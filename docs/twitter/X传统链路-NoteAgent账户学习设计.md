# X Traditional Note Agent V2 账户学习代理设计

## 1. 目标与边界

### 1.1 目标

把传统链路里的 `note agent` 从“补 RAG 文档工具”重定义为“账户学习代理”。

V1 的目标不是替账户自动写内容，而是让目标账户 `A` 基于来源账户 `C` 的公开表达样本，沉淀出一套账户级资产，供传统链路后续的 `writer` / `review` 使用。

核心表达必须是：

- `A 学 C`
- 学的是表达方式、节奏、数字表达、开头收尾、判断方式
- 不是复制观点
- 不是复制人格
- 不是克隆内容

### 1.2 系统边界

- 只服务 `data-x-traditional`
- 不受 `main agent` 控制
- 必须人工手动触发
- 不影响 `hotspot`
- 不影响 `main`
- 不影响 `zhihu`

### 1.3 V1 默认策略

- 浏览器优先采样
- 单来源账户学习
- `soul` 只生成候选稿，不直接覆盖正式 `soul.md`
- 来源样本保存到目标账户 `A` 的账户级目录
- 原始学习样本只做 provenance 资产，不直接进入 writer/review 检索链

## 2. 使用场景

典型使用方式：

1. 操作员在传统链路工作台选择目标账户 `A`
2. 输入来源账户 `C` 的 handle 或 URL
3. 手动触发 Note Agent
4. 系统完成采样、风格提炼、账户资产草稿生成
5. 操作员审核草稿后，手动写回账户级资产

例子：

- `account_a` 学习 `https://x.com/PhyrexNi`

这表示让 `account_a` 学习其表达方式与风格特征，而不是继承其观点与立场。

## 3. API 设计

### 3.1 保留路由

- `POST /accounts/:id/note-agent/generate`
- `POST /accounts/:id/note-agent/apply`

其中：

- `:id` 永远表示目标账户 `A`
- 来源账户 `C` 通过 `generate` body 传入

### 3.2 Generate 请求体

V1 固定请求体：

```json
{
  "mode": "style_learning",
  "sourceAccount": {
    "platform": "x",
    "handleOrUrl": "https://x.com/PhyrexNi"
  },
  "collection": {
    "sampleSize": 40,
    "lookbackDays": 90,
    "includeReplies": false
  },
  "manualSeedTexts": [
    "可选的手动补充样本文本"
  ]
}
```

约束：

- `mode` 在 V1 只支持 `style_learning`
- `platform` 在 V1 固定为 `x`
- `sampleSize` 默认 `40`
- `lookbackDays` 默认 `90`
- `includeReplies` 默认 `false`
- `manualSeedTexts` 只作为 fallback，不取代浏览器采样主流程

### 3.3 Generate 返回结构

V2 draft 返回账户学习结果，不再是“4 份补全文档草稿”。

标准返回字段：

- `accountId`
- `accountKey`
- `matchedBy`
- `mode`
- `sourceAccount`
- `summary`
- `diagnostics`
- `operatorNotes`
- `collectionSummary`
- `phaseReports`
- `learnedStyleProfileMarkdown`
- `soulCandidateMarkdown`
- `styleRulesMarkdown`
- `numberExpressionRulesMarkdown`
- `reviewRubricMarkdown`
- `learnedSamplesJsonl`
- `sourceMapYaml`
- `samplePreview`
- `generatedAt`
- `sourcePaths`

说明：

- `sampleCollectionPlanMarkdown` 从 V2 标准 draft 中移除
- 旧文件如果历史上已经存在，不自动删除
- 但不再作为 note agent 标准输出和标准写回目标

### 3.4 Apply 语义

`apply` 只允许把学习结果写入目标账户 `A` 的账户级资产，不允许覆盖正式 `soul.md`。

V1 安全动作只包括：

- 写回账户级 RAG
- 保存 `soul_candidate.md`
- 保存 note-agent provenance 资产

明确禁止：

- 一键覆盖正式 `soul.md`

## 4. Phase 机制

一次学习任务固定拆成 4 个阶段：

1. `collect_source_samples`
2. `distill_style_profile`
3. `draft_account_assets`
4. `apply_account_assets`

### 4.1 阶段开始前必须重读文档

每个阶段开始前都重新读取，不依赖上一阶段的内存状态。

固定读取范围：

- 全局文档：`data-x-traditional/rag/README.md`
- 目标账户文档：
  - `soul.md`
  - `strategy.yaml`
  - `goals.yaml`
  - `boundaries.yaml`（如果存在）
- 现有账户级 RAG：
  - `style_rules.md`
  - `number_expression_rules.md`
  - `review_rubric.md`
- 现有 note-agent 资产：
  - `source_map.yaml`
  - `learned_style_profile.md`
  - `learned_samples.jsonl`

### 4.2 阶段结束后必须验证

每个阶段结束后都要写出验证结果到 `phaseReports`。

每条 `phaseReport` 至少包含：

- `phase`
- `status`
- `startedAt`
- `finishedAt`
- `inputsRead`
- `validationChecks`
- `diagnostics`

其中 `inputsRead` 必须体现：

- 读了哪些文档
- 哪些文档缺失

`validationChecks` 必须体现：

- 做了哪些校验
- 每项校验是否通过
- 是否存在 warning

### 4.3 V1 固定校验规则

#### collect_source_samples

必须校验：

- 样本数量是否足够
- 是否完成去重
- 默认不含 replies
- 是否存在明显空样本

#### distill_style_profile

必须产出：

- 可学特征
- 不可学特征
- 数字表达
- 开头方式
- 收尾方式

#### draft_account_assets

必须产出：

- `soulCandidate`
- `style_rules`
- `number_expression_rules`
- `review_rubric`

#### apply_account_assets

必须校验：

- 目标账户是否匹配
- 写入路径是否匹配
- 写回后是否重新读取且确认非空

## 5. 文件落点

### 5.1 账户配置目录

固定输出：

- `data-x-traditional/account-configs/accounts/<accountKey>/soul_candidate.md`

约束：

- V1 不自动写正式 `soul.md`

### 5.2 账户级 RAG 目录

固定输出：

- `data-x-traditional/rag/accounts/<accountKey>/style_rules.md`
- `data-x-traditional/rag/accounts/<accountKey>/number_expression_rules.md`
- `data-x-traditional/rag/accounts/<accountKey>/review_rubric.md`

### 5.3 Note Agent 资产目录

新增目录：

- `data-x-traditional/rag/accounts/<accountKey>/note-agent/learned_style_profile.md`
- `data-x-traditional/rag/accounts/<accountKey>/note-agent/learned_samples.jsonl`
- `data-x-traditional/rag/accounts/<accountKey>/note-agent/source_map.yaml`
- `data-x-traditional/rag/accounts/<accountKey>/note-agent/last_run.json`

### 5.4 文件归属约束

- 所有这些文件都属于目标账户 `A`
- 来源账户 `C` 只出现在 `source_map.yaml` 和 run metadata 中
- `learned_samples.jsonl` 在 V1 只做可追溯资产，不直接进入 writer/review 检索链
- writer/review 仍然只读取正式 RAG 文档和现有样本库，不直接读取原始学习样本

## 6. 后端实现方案

主改动落在：

- `packages/x-traditional-core/src/services/x-traditional-note-agent-service.ts`

### 6.1 服务职责

`XTraditionalNoteAgentService` 改成 “采样 -> 提炼 -> 草稿 -> 应用” 的 orchestrator。

核心职责：

- 读取目标账户上下文
- 采集来源账户公开样本
- 清洗与过滤样本
- 驱动 LLM 提炼风格
- 输出账户级资产草稿
- 安全写回目标账户目录

### 6.2 Collector

优先复用 `x-core` 的 timeline collector。

需要对传统链路开放的能力包括：

- `collectAccountTimeline`
- `extractHandleFromLink`
- `normalizeProfileUrl`
- `XBrowserRuntime`

实现要求：

- 不新造一套独立浏览器采样逻辑
- 不改动 `hotspot` / `main` / `zhihu` 的运行路径

### 6.3 采样默认策略

浏览器采样目标：

- 来源账户公开 timeline

默认规则：

- `sampleSize = 40`
- `lookbackDays = 90`
- `includeReplies = false`
- 去掉 repost
- 去掉空文本
- 去掉明显碎片样本

### 6.4 浏览器受限时的 fallback

如果浏览器采样被 X 限制：

- `generate` 不直接失败终止
- 返回带 diagnostics 的 draft
- 允许结合 `manualSeedTexts` 继续生成

### 6.5 Prompt 重写要求

`x_traditional_note_agent` 的默认 prompt 必须重写：

- 输入从“补齐文档”改成“目标账户 + 来源账户 + 样本 + 现有账户资产”
- 输出从 4 个 markdown 改成：
  - `style profile`
  - `soul candidate`
  - `style_rules`
  - `number_expression_rules`
  - `review_rubric`
  - provenance 元信息

Prompt 必须明确禁止：

- 复制观点
- 复制口头禅
- 复制具体内容
- 把来源账户人格直接迁移给目标账户

## 7. 前端实现方案

前端继续放在传统链路工作台，不新开独立产品页。

主改动落在：

- `apps/web/src/components/twitter/twitter-traditional-studio.tsx`

### 7.1 页面结构

Note Agent 面板改成 5 段式流程：

1. `目标账户确认`
2. `来源账户配置`
3. `采样与 Phase 状态`
4. `学习结果草稿`
5. `写回账户资产`

### 7.2 页面约束

- 页面级“目标账户”选择器保持不变
- Note Agent 默认作用于当前选中的目标账户 `A`
- 不新增独立产品页

### 7.3 来源账户配置区

提供以下输入：

- 来源 X 账户 `handle / URL`
- `sampleSize`
- `lookbackDays`
- `includeReplies` 开关
- 可选“手动补充样本”多行输入

### 7.4 采样和结果展示

必须展示：

- 来源账户
- 样本预览列表
- phase 状态
- 每个 phase 开始前读取了哪些文档
- 每个 phase 结束后做了哪些校验
- 每个 phase 的 diagnostics

默认不应该把整块 JSONL 直接摊开在页面主视觉里。

### 7.5 草稿编辑区

必须展示并允许调整：

- `soul_candidate.md`
- `style_rules.md`
- `number_expression_rules.md`
- `review_rubric.md`
- `learned_style_profile.md`

默认折叠展示：

- `learned_samples.jsonl`
- `source_map.yaml`

### 7.6 写回区

只提供安全动作：

- `写回账户级 RAG`
- `保存 soul 候选稿`

不提供：

- “一键覆盖 soul.md”

## 8. 数据与验证要求

### 8.1 后端与类型

必须满足：

- `x-traditional-core` / `x-traditional-api` / `web` typecheck 通过
- `generate` 在单来源模式下返回新 draft 结构
- `apply` 对 accountId/accountKey 不匹配直接报错
- `apply` 写回后重新读取目标路径并验证非空
- `sampleCollectionPlanMarkdown` 不再是标准返回字段

### 8.2 采样与阶段验证

验收用例：

- `account_a <- PhyrexNi` 跑一轮

期望：

- 采样阶段能抓到可用样本
- 默认不含 replies
- `phaseReports` 至少包含 3 个 generate 阶段
- 每个阶段都记录 `inputsRead` 与 `validationChecks`

模拟浏览器抓取受限时：

- 返回 warning diagnostics
- 仍允许靠 `manualSeedTexts` 生成草稿

### 8.3 前端流程

期望：

- 进入传统链路页面后，切换账户会自动绑定当前目标账户
- 输入来源账户 URL 后可以直接生成草稿
- 页面能看到来源账户、样本预览、phase 状态、`soul candidate` 与 3 份正式规则文档
- Apply 后展示写回路径
- 页面不出现覆盖正式 `soul.md` 的按钮

## 9. 与现有链路的兼容性要求

- 传统 `writer/review` 仍按原链路工作
- `hotspot` 不受影响
- `main` 不受影响
- `zhihu` 不受影响
- Note Agent 只是给目标账户补充账户级资产，不改变主运行链路

## 10. V1 非目标

以下内容不纳入 V1：

- 多来源账户联合学习
- 自动覆盖正式 `soul.md`
- 让 writer/review 直接检索原始学习样本
- 自动判定热点过期
- 自动把来源账户人格整体迁移给目标账户
- 独立的新产品页

## 11. 参考来源账户说明

V1 的参考测试来源账户：

- `https://x.com/PhyrexNi`

可以作为测试来源的风格假设：

- 偏数据解释型
- 偏条件判断型
- 会强调风险边界

但实现时必须以真实采样结果为准，不能把外部索引摘要当成正式训练数据。
