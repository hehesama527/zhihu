# 前端优化方案

**版本**: v1.0  
**日期**: 2026-04-21  
**范围**: 仅前端优化，不新增后端功能

---

## 一、现有系统概览

### 1.1 技术栈
- **框架**: Next.js 15.2 + React 19
- **样式**: 原生 CSS（基于 `.card`、`.stack`、`.button` 等 BEM 类）
- **数据流**: 直接 fetch API + Server Components
- **部署**: 本地开发环境，API 端口 8787

### 1.2 现有页面结构

```
apps/web/src/app/
├── (zhihu)/                    # 知乎主业务
│   └── zhihu/
│       ├── page.tsx            # Dashboard 首页
│       ├── account/            # 账号管理/恢复
│       ├── jobs/[id]/          # 任务详情
│       ├── ops/                # Ops 事件列表
│       ├── ops/[id]/           # Ops 事件详情
│       ├── prompts/            # Prompt 工作室
│       ├── publish-jobs/       # 发布任务列表
│       ├── schedule/           # 排班管理
│       └── topics/             # 选题列表
│
├── (twitter)/                  # X/Twitter 业务（独立）
│   └── twitter/
│       ├── page.tsx            # X Dashboard
│       ├── account/            # 账号管理
│       ├── drafts/             # 草稿管理
│       ├── hotspots/           # 热点追踪
│       ├── login/              # 登录
│       ├── prompts/            # Prompt 管理
│       ├── publish/            # 发布管理
│       ├── publish-history/    # 发布历史
│       ├── traditional/        # Traditional 模式
│       └── watchlists/         # 关注列表
│
├── images/                     # 图片资源管理
│   ├── page.tsx                # 图片库首页
│   ├── library/                # 库浏览
│   ├── import/                 # 导入管理
│   ├── review/                 # 审核台
│   ├── usage/                  # 使用记录
│   └── [id]/                   # 图片详情
│
└── hotspots/                   # 热点管理
    ├── page.tsx                # 热点列表
    └── watchlists/             # 关注列表
```

### 1.3 现有组件清单

| 组件文件 | 功能 |
|---------|------|
| `account-panel.tsx` | 账号状态面板、人工登录/恢复流程 |
| `account-registry.tsx` | 账号选择器 |
| `account-soul-panel.tsx` | 账号 Soul 文档编辑器 |
| `ops-scan-panel.tsx` | Ops 手动扫描 |
| `prompt-studio.tsx` | Prompt 版本管理、测试 |
| `writer-account-prompt-lab.tsx` | Writer 账号提示词实验室 |
| `retry-job-button.tsx` | 任务重试按钮 |
| `status-chip.tsx` | 状态标签芯片 |
| `worker-panel.tsx` | Worker 执行面板 |

### 1.4 API 接口清单（现有，不新增）

| 类别 | 端点 | 用途 |
|------|------|------|
| **账号** | GET/PATCH/DELETE /accounts/:id | 账号 CRUD |
| **账号** | GET /account/status | 账号状态 |
| **账号** | POST /account/manual-login/start | 人工登录 |
| **账号** | POST /account/recovery/confirm | 恢复确认 |
| **账号** | GET/PUT /accounts/:id/soul | Soul 文档 |
| **任务** | GET /jobs | 任务列表 |
| **任务** | GET /jobs/:id | 任务详情 |
| **任务** | GET /jobs/:id/publish-attempts | 发布尝试 |
| **任务** | GET /jobs/:id/artifacts | 产物列表 |
| **任务** | GET /jobs/:id/tool-traces | 工具追踪 |
| **任务** | GET /jobs/:id/skill-runs | 技能执行 |
| **任务** | POST /jobs/:id/retry | 重试 |
| **任务** | POST /jobs/:id/reselect-topic | 重选 |
| **任务** | POST /jobs/:id/run-now | 立即执行 |
| **任务** | PATCH /jobs/:id/schedule | 改期 |
| **任务** | POST /jobs | 创建 |
| **发布** | GET /publish-jobs | 发布任务列表 |
| **排班** | GET /schedule/today | 今日排班 |
| **排班** | GET /schedule/week | 本周排班 |
| **选题** | GET /topics | 选题列表 |
| **选题** | GET /topics/batch-plan | 批次计划 |
| **选题** | GET /drafts | 草稿列表 |
| **Prompt** | GET /prompt-sets | Prompt 集合 |
| **Prompt** | GET /prompt-sets/:name | 单个集合 |
| **Prompt** | POST /prompt-sets/:name/drafts | 创建草稿 |
| **Prompt** | PATCH /prompt-versions/:id | 更新草稿 |
| **Prompt** | POST /prompt-versions/:id/activate | 激活 |
| **Prompt** | POST /prompt-versions/:id/rollback-target | 回滚 |
| **Prompt** | POST /prompt-versions/:id/test | 测试 |
| **Dashboard** | GET /dashboard/summary | 总览摘要 |
| **Ops** | GET /ops/summary | Ops 摘要 |
| **Ops** | GET /ops/incidents | 事件列表 |
| **Ops** | GET /ops/incidents/:id | 事件详情 |
| **Ops** | POST /ops/scan | 执行扫描 |
| **Worker** | POST /worker/tick | Tick 触发 |

---

## 二、优化方案（按优先级）

### P0 - 核心体验优化（立即执行）

#### 2.1 Dashboard 信息密度优化
**位置**: `/zhihu/page.tsx`  
**问题**: 当前 Dashboard 信息展示过于分散  
**方案**:
- 将 `metrics` 指标做成卡片式概览（4 列网格）
- `recentJobs` 改为紧凑表格，增加状态筛选
- `recentTopics` 增加状态标签和快速操作
- 添加「今日概览」横幅（已发布/失败/待处理计数）

**改动文件**:
- `apps/web/src/app/(zhihu)/zhihu/page.tsx`
- 新增组件 `apps/web/src/components/dashboard-metrics.tsx`

---

#### 2.2 任务列表状态筛选器
**位置**: `/zhihu/jobs/[id]/page.tsx`（列表页）、`/zhihu/publish-jobs/page.tsx`  
**问题**: 无法快速筛选特定状态的任务  
**方案**:
- 添加状态筛选 Tab：全部 | 排队中 | 发布中 | 需人工 | 已发布 | 失败
- 添加「只显示我的账号」切换（多账号场景）
- 添加批量操作栏（选中后批量重试/改期）

**改动文件**:
- `apps/web/src/app/(zhihu)/zhihu/publish-jobs/page.tsx`
- 新增组件 `apps/web/src/components/job-filters.tsx`

---

#### 2.3 任务详情页时间线视图
**位置**: `/zhihu/jobs/[id]/page.tsx`  
**问题**: 任务推进过程不直观  
**方案**:
- 将 `currentStage` 历史可视化为横向时间线
- 每个节点显示：阶段名、时间戳、持续时长
- 失败节点高亮显示，点击展开错误详情
- 成功节点显示绿色勾选

**改动文件**:
- `apps/web/src/app/(zhihu)/zhihu/jobs/[id]/page.tsx`
- 新增组件 `apps/web/src/components/job-timeline.tsx`

---

#### 2.4 产物/截图内嵌预览
**位置**: `/zhihu/jobs/[id]/page.tsx`  
**问题**: 产物只显示路径，需要点开才能看  
**方案**:
- 截图类 artifact 直接显示缩略图
- 点击放大到模态框
- 支持左右切换查看多个产物
- Tool Trace 增加 JSON 格式化展示

**改动文件**:
- `apps/web/src/app/(zhihu)/zhihu/jobs/[id]/page.tsx`
- 新增组件 `apps/web/src/components/artifact-preview.tsx`

---

#### 2.5 账号面板状态可视化
**位置**: `/zhihu/account/page.tsx`  
**问题**: 状态信息分散，不够直观  
**方案**:
- 用不同颜色区分状态：
  - 🟢 `active` - 正常
  - 🟡 `manual_login_required` - 需人工
  - 🟠 `session_expired` - 会话过期
  - 🔴 `cooling_down` - 冷却中
- 将 `recoveryRequired` 警告提到顶部横幅
- 将 `blockedJobs` 改为可折叠面板

**改动文件**:
- `apps/web/src/components/account-panel.tsx`
- `apps/web/src/components/status-chip.tsx`（增强）

---

#### 2.6 Prompt 编辑器增强
**位置**: `/zhihu/prompts/page.tsx`  
**问题**: 大段提示词文本难以编辑和对比  
**方案**:
- 引入简单的语法高亮（基于关键词着色）
- 添加「对比模式」：草稿 vs 生效版本 diff
- 添加「字数统计」和「最后修改时间」
- 测试输入/输出分栏展示

**改动文件**:
- `apps/web/src/components/prompt-studio.tsx`
- 新增工具函数 `apps/web/src/lib/prompt-highlight.ts`

---

### P1 - 效率工具（后续迭代）

#### 2.7 排班日历视图
**位置**: 新建 `/zhihu/schedule/calendar`  
**方案**:
- 用 CSS Grid 实现周日历视图
- 横轴：周一至周日，纵轴：时间槽
- 已占用时段显示任务标题
- 空闲时段点击可快速创建任务

**改动文件**:
- 新建页面 `apps/web/src/app/(zhihu)/zhihu/schedule/calendar/page.tsx`
- 新增组件 `apps/web/src/components/schedule-calendar.tsx`

---

#### 2.8 任务日志流
**位置**: `/zhihu/jobs/[id]/page.tsx`  
**方案**:
- 轮询 `tool-traces` 和 `skill-runs` 接口
- 实时追加日志到滚动区域
- 支持按阶段筛选日志
- 支持一键复制错误日志

**改动文件**:
- `apps/web/src/app/(zhihu)/zhihu/jobs/[id]/page.tsx`
- 新增组件 `apps/web/src/components/job-logs.tsx`

---

#### 2.9 Ops 事件诊断集成
**位置**: `/zhihu/ops/[id]/page.tsx`  
**方案**:
- 在事件详情页直接显示 AI 诊断结果
- 分栏展示：根因 | 关键证据 | 建议操作
- 添加「一键重试」和「标记已处理」按钮

**改动文件**:
- `apps/web/src/app/(zhihu)/zhihu/ops/[id]/page.tsx`

---

#### 2.10 全局账号选择器
**位置**: 顶部导航栏  
**方案**:
- 在 Layout 顶部添加账号下拉选择
- 切换后刷新当前页面内容
- 记住最近选择的账号

**改动文件**:
- `apps/web/src/app/(zhihu)/layout.tsx`
- 复用 `apps/web/src/components/account-registry.tsx`

---

### P2 - 高级功能（按需实现）

#### 2.11 浏览器调试台（Playwright MCP 集成）
**位置**: 新建 `/zhihu/browser-debug`  
**方案**:
- 使用 Playwright MCP 在无头模式下打开浏览器
- 显示页面截图
- 提供简单操作：导航、点击、截图
- 用于调试发布流程

**改动文件**:
- 新建页面 `apps/web/src/app/(zhihu)/zhihu/browser-debug/page.tsx`
- 新增组件 `apps/web/src/components/browser-debug-panel.tsx`

---

#### 2.12 批量操作工具栏
**位置**: 任务列表页  
**方案**:
- 多选复选框
- 批量重试、批量改期、批量删除
- 操作前确认对话框

**改动文件**:
- `apps/web/src/app/(zhihu)/zhihu/publish-jobs/page.tsx`
- 新增组件 `apps/web/src/components/batch-actions.tsx`

---

### P3 - 体验打磨（有空再做）

| 优化点 | 位置 | 方案 |
|--------|------|------|
| Toast 通知 | 全局 | 替代 `helper-text` 文本提示 |
| 错误边界 | 全局 | API 失败时显示降级 UI |
| 面包屑导航 | 深层页面 | 显示路径：首页 > 任务 > #123 |
| 表单草稿箱 | 编辑页 | localStorage 自动保存 |
| 列表分页 | 所有列表 | 服务端分页 + 页码器 |
| 暗黑模式 | 全局 | CSS 变量切换 |
| 快捷键 | 全局 | 如 `Ctrl+S` 保存、`Ctrl+K` 搜索 |

---

## 三、实施顺序建议

### 第一阶段（P0，预计 2-3 天）
1. ✅ Dashboard 信息密度优化
2. ✅ 任务列表状态筛选器
3. ✅ 任务详情页时间线视图
4. ✅ 产物内嵌预览
5. ✅ 账号面板状态可视化
6. ✅ Prompt 编辑器增强

### 第二阶段（P1，预计 2-3 天）
1. 排班日历视图
2. 任务日志流
3. Ops 诊断集成
4. 全局账号选择器

### 第三阶段（P2+，按需）
1. 浏览器调试台
2. 批量操作
3. P3 体验打磨

---

## 四、技术约束

1. **不新增后端接口** - 所有优化基于现有 API
2. **不引入重型依赖** - 保持轻量，不引入大型 UI 库
3. **兼容现有样式** - 继续使用 `.card`、`.stack`、`.button` 等现有类
4. **保持 SSR 友好** - 关键数据仍用 Server Components 获取
5. **无头浏览器** - Playwright MCP 使用无头模式，不影响用户操作

---

## 五、风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 轮询频率过高 | API 压力大 | 限制轮询间隔≥5s，页面不可见时停止 |
| 大列表性能 | 千条任务卡顿 | 虚拟滚动/分页加载 |
| MCP 集成复杂度 | 调试困难 | 先做功能验证，再集成到 UI |
| 样式冲突 | 破坏现有布局 | 小步提交，每次改动后验证 |

---

## 六、验收标准

### 功能验收
- [ ] Dashboard 指标卡片正常显示
- [ ] 任务状态筛选器工作正常
- [ ] 时间线视图准确反映阶段流转
- [ ] 截图产物内嵌预览正常
- [ ] 账号状态标签颜色正确
- [ ] Prompt 编辑器语法高亮正常

### 体验验收
- [ ] 页面加载时间 < 2s
- [ ] 状态切换无闪烁
- [ ] 错误提示清晰可执行
- [ ] 移动端基本可用（响应式）
