# Twitter 矩阵运营子系统 Agent 架构说明

文档版本：V0.7  
文档状态：与当前实现同步  
文档日期：2026-04-07  
负责人：二牛

---

## 一、这份文档现在只回答什么

这份文档只保留四件事：

1. 当前系统已经落地到什么程度。
2. 主任务链和热点链怎么跑。
3. MainAgent、WriterAgent、HotspotScoutAgent 的边界怎么分。
4. 前端有哪些可调开关会直接影响生成和发布。

不再展开历史演进，不写实现流水账。

---

## 二、当前已落地范围

截至 2026-04-07，和当前架构直接相关的已落地能力如下：

1. 主任务链已经跑通：`MainAgent -> ResearchAgent -> WriterAgent -> ReviewAgent -> MainAgent -> PublisherAgent`。
2. 热点链已经跑通：热点入库、评分、研究补充、任务创建、前端查看都可用。
3. `MainAgent` 已经前移到 `plan` 阶段，不再只是最终放行器。
4. `MainAgent` 已经能决定发布动作：`post / reply / quote`。
5. `MainAgent` 已经能决定内容类型和发布节奏，并读取账号级比例偏好。
6. `MainAgent` 已经能在选题阶段判断是否借热点，并从热点池选择可用热点。
7. `WriterAgent` 已支持两种模式：
   - `main_agent`：由 MainAgent 每轮生成 runtime writer prompt。
   - `database`：使用数据库里的账号级 Writer Prompt。
8. 账号页已经支持配置：
   - 数据库 Writer Prompt 开关
   - 发布风格比例
9. 发布执行层已经支持：
   - 原创发布
   - 回复
   - 引用转发
10. `watchlist` 的 `x_account` 仍然走 Playwright 登录态抓取，不依赖官方 X API。
11. 热点链当前默认仍以稳定性优先，不把 watchlist 一刀切改成无头默认。

---

## 三、两条核心链路

### 3.1 主任务链

当前主链路是：

`Task -> MainAgent(plan) -> ResearchAgent -> WriterAgent -> ReviewAgent -> MainAgent(draft_gate) -> PublisherAgent`

各阶段含义：

1. `plan`：MainAgent 决定这条任务该不该做、先不先 research、写单帖还是线程、发原创还是回复/引用、要不要借热点、Writer 本轮边界是什么。
2. `research`：ResearchAgent 只更新账号研究底座，不负责正文。
3. `writing`：WriterAgent 严格按 MainAgent 计划执行。
4. `review`：ReviewAgent 只做草稿审核，不做总控。
5. `draft_gate`：MainAgent 结合 Review 结果做最终放行、返工、延后或拦截。
6. `publish`：PublisherAgent 负责浏览器执行和结果回写。

### 3.2 热点链

当前热点链是：

`HotspotScoutAgent -> 热点池 -> 补充研究 -> 供 MainAgent 选题使用 / 手工转任务`

关键变化：

1. 热点不再只是“先转任务再使用”。
2. MainAgent 在 `plan` 阶段就可以直接参考热点池，决定这轮要不要蹭热点。
3. 如果决定借热点，MainAgent 只会选择对当前任务真正有帮助的热点 ID。
4. 热点池是全局运营资产，不是账号私有资产。

---

## 四、Agent 边界

### 4.1 MainAgent

定位：总控 Agent，先规划，再放行。

负责：

1. 判断任务是否继续推进。
2. 判断是否要先做 research。
3. 判断 `single` 还是 `thread`。
4. 判断发布动作是：
   - `post`
   - `reply`
   - `quote`
5. 判断本轮内容类型，模拟真人节奏，而不是固定一种语气反复发。
6. 判断是否需要借热点，以及选择哪些热点。
7. 如果是 `reply / quote`，判断是否存在合格的 `targetTweetUrl`。
8. 在数据库 Writer Prompt 关闭时，为 Writer 生成本轮 `runtimeWriterPrompt`。
9. 在草稿阶段做最终决策：
   - `approve_publish`
   - `revise`
   - `research`
   - `defer`
   - `block`

不负责：

1. 不直接写正文。
2. 不直接维护 research markdown。
3. 不直接执行浏览器发布。
4. 不直接常驻扫描热点。

### 4.2 WriterAgent

定位：执行型写作 Agent。

负责：

1. 按账号研究、MainAgent 计划、热点上下文和 revision instructions 生成草稿。
2. 严格执行本轮 `publishAction`、`contentStyle`、`preferredMode`。
3. 在需要时吸收热点上下文，但不机械复述热点池字段。

两种运行模式：

1. `main_agent`
   - 默认模式
   - 由 MainAgent 每轮生成 runtime writer prompt
2. `database`
   - 使用数据库里的账号级 Writer Prompt
   - 适合已经沉淀很稳定的账号

不负责：

1. 不决定是否发布。
2. 不决定是否重做 research。
3. 不输出审核结论。

### 4.3 ReviewAgent

定位：纯审核 Agent。

负责：

1. 看草稿像不像这个账号会发的内容。
2. 看有没有明显风险、失真、重复或廉价感。
3. 给出清晰修改意见。

不负责：

1. 不做发布动作选择。
2. 不做节奏调度。
3. 不替 MainAgent 放行。

### 4.4 ResearchAgent

定位：账号长期 research 资产维护者。

负责：

1. 更新账号 research markdown。
2. 沉淀账号人设、受众、表达方式、边界。
3. 给 MainAgent 和 WriterAgent 提供稳定底座。

### 4.5 HotspotScoutAgent

定位：独立于主任务链的热点扫描与补充研究 Agent。

负责：

1. 扫描 RSS、市场、watchlist 等来源。
2. 标准化、去重、聚合、评分。
3. 维护热点池。
4. 为 MainAgent 提供可消费的热点候选。

### 4.6 PublisherAgent

定位：执行层。

负责：

1. 按 `publishPlan` 执行真实发布或 dry-run。
2. 支持原创发布、回复、引用转发。
3. 回写 tweet id、URL、发布时间和失败信息。

---

## 五、MainAgent 的新控制面

MainAgent 现在不是“最后看一眼”，而是本轮内容的总编排器。

### 5.1 发布动作判断

MainAgent 必须先判断本轮是：

1. 原创发布
2. 回复
3. 引用转发

判断原则：

1. 题目本身是独立观点，就优先 `post`。
2. 题目更适合借某条现成内容表达立场，就选 `quote`。
3. 题目本质是对某条推文的直接回应，就选 `reply`。
4. 如果没有合格的目标推文，不能硬输出 `reply / quote`。

### 5.2 发布节奏与内容类型

MainAgent 会结合账号的比例偏好，控制更像真人的发帖分布。

当前内容类型集合：

1. 碎碎念 `casual_note`
2. 小感悟 `small_insight`
3. 踩坑记录 `pitfall_log`
4. 工具提及 `tool_mention`
5. 行业吐槽 `industry_talk`
6. 互动问答 `interactive_qa`
7. 引用转发 `quote_repost`

默认偏好：

1. 碎碎念：30
2. 小感悟：25
3. 踩坑记录：15
4. 工具提及：15
5. 行业吐槽：10
6. 互动问答：5
7. 引用转发：5

这些值是偏好，不是死板配额。

核心逻辑保持不变：

1. 不是写文章，是发朋友圈。
2. 不是教育用户，是交朋友。
3. 不是硬广植入，是日常提及。

### 5.3 热点引用判断

MainAgent 在选题阶段就要判断：

1. 这条内容需不需要借热点。
2. 借热点是为了增强时效性，还是为了提供事实背景。
3. 如果需要，应该选哪几个热点，而不是机械全带。

规则：

1. 热点只能服务主题，不能绑架主题。
2. 不为了蹭而蹭。
3. 只有能提升判断质量或时效性的热点才值得进入 `selectedHotspotIds`。

### 5.4 Writer Prompt 来源开关

前端已有开关：

1. 开启：使用数据库里的账号 Writer Prompt
2. 关闭：由 MainAgent 每轮生成 runtime writer prompt

默认：关闭，也就是默认走 MainAgent runtime prompt。

设计原因：

1. 新账号和实验账号更适合 runtime prompt，边界更灵活。
2. 稳定账号可以切到数据库 Prompt，减少波动。
3. 这两个入口都要长期保留，不做一刀切。

---

## 六、前端当前可调项

账号页现在可以直接调以下内容：

1. 数据库 Writer Prompt 开关
2. 发布风格比例
3. 参考账号链接
4. 账户级补充 Prompt 审核
5. 登录验证

工作台现在需要重点看这些结果：

1. `mainAgentPlan`
2. `publishPlan`
3. `reviewResult`
4. `publishResult`

也就是说，运营侧已经可以看到：

1. MainAgent 为什么这么规划
2. 本轮动作是原创、回复还是引用
3. 本轮内容类型是什么
4. 是否借了热点
5. 是否命中了目标推文

---

## 七、当前测试建议

当前已经达到“可以做主链测试”的程度，但建议按下面顺序：

1. 先测账号配置是否保存正确：
   - Writer Prompt 开关
   - 风格比例
2. 再测任务规划：
   - `MainAgent plan` 是否产出动作、内容类型、热点选择、runtime prompt
3. 再测写作和审核：
   - Writer 是否遵守 `publishAction / contentStyle / hotspotContext`
4. 最后测发布：
   - 先 dry-run
   - 再在登录态稳定后测真实浏览器发布

当前建议：

1. 热点主链可以继续严测。
2. watchlist 继续保持有头默认，不在这一轮切成常驻无头默认。
3. 真机发布前先确认账号 `authStatus=ready`。

---

## 八、一句话结论

当前 X 子系统的 MainAgent 已经从“最终审核者”升级为“前置规划 + 最终放行”的总控 Agent；WriterAgent 变成执行层；热点池也已经进入选题阶段，而不是只在任务创建后才有用。
