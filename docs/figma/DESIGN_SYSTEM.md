# H-CLAW 设计系统文档

> 通过 Figma Code Connect 实现设计与代码的自动同步

## 📋 概述

本设计系统服务于知乎/Twitter 矩阵运营子系统，包含三个产品主题:
- **知乎主题** - 温暖的橙棕色调 (#c55a11)
- **Twitter 主题** - 清新的青绿色调 (#0f6c5a)  
- **Images 子系统** - 专业的蓝绿色调 (#0b7a75)

## 🎨 设计令牌

### 颜色系统

#### 知乎主题 (Zhihu)

```
--accent: #c55a11        # 主色调 - 活力橙色
--accent-soft: #f0c7a4   # 柔和强调色
--bg: #f9f7f4           # 背景色
--panel: #ffffff        # 面板背景
--text: #1f1a17         # 主文本
--muted: #72665d        # 次要文本
--success: #2d7c58      # 成功状态
--danger: #a63d40       # 错误状态
--warning: #9f6b00      # 警告状态
```

#### Twitter 主题

```
--accent: #0f6c5a       # 主色调 - 青绿色
--accent-soft: #bfe8da  # 柔和强调色
```

#### Images 子系统

```
--accent: #0b7a75       # 主色调 - 蓝绿色
--accent-soft: #bfe9e4  # 柔和强调色
```

### 间距系统

| Token | 值 | 像素 |
|-------|-----|------|
| `--space-xs` | 0.5rem | 8px |
| `--space-sm` | 0.75rem | 12px |
| `--space-md` | 1rem | 16px |
| `--space-lg` | 1.5rem | 24px |
| `--space-xl` | 2rem | 32px |
| `--space-2xl` | 3rem | 48px |

### 圆角系统

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--radius-sm` | 10px | 小按钮、输入框 |
| `--radius-md` | 16px | 卡片、表格 |
| `--radius-lg` | 18px | 大卡片、模态框 |
| `--radius-xl` | 20px | 特殊容器 |
| `--radius-2xl` | 28px | 工作区卡片 |
| `--radius-full` | 999px | 圆形徽章、标签 |

### 阴影系统

```css
/* 知乎主题阴影 */
--shadow: 0 4px 20px rgba(197, 90, 17, 0.08);

/* Twitter 主题阴影 */
--shadow-twitter: 0 18px 45px rgba(15, 108, 90, 0.12);

/* Images 主题阴影 */
--shadow-images: 0 18px 45px rgba(11, 122, 117, 0.12);
```

### 字体系统

```css
font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
font-family-mono: "Monaco", "Menlo", "Courier New", monospace;

/* 字号 */
--text-xs: 0.75rem    /* 12px - 徽章、标签 */
--text-sm: 0.875rem   /* 14px - 次要文本 */
--text-base: 0.95rem  /* 15px - 正文 */
--text-lg: 1.25rem    /* 20px - 小标题 */
--text-xl: 1.7rem     /* 27px - 中标题 */
--text-2xl: 2rem      /* 32px - 大标题 */
--text-4xl: 4.2rem    /* 67px - 英雄区标题 */

/* 字重 */
--font-normal: 400
--font-medium: 500
--font-semibold: 600
--font-bold: 700
--font-extrabold: 800
```

## 🧩 组件库

### 1. ProductShell - 产品主布局

**Figma 组件**: `Shell/Layout`  
**React 组件**: `ProductShell`  
**使用场景**: 所有产品页面的基础布局框架

**属性**:
- `tone`: "zhihu" | "twitter" | "images" - 主题色调
- `kicker`: string - 副标题标签
- `title`: string - 主标题
- `description`: string - 产品描述
- `navItems`: Array<{href, label}> - 导航项
- `switchHref`: string - 切换产品链接
- `switchLabel`: string - 切换产品标签

**Figma 变体**:
- Shell/Zhihu
- Shell/Twitter
- Shell/Images

### 2. Card - 卡片容器

**Figma 组件**: `Card/Container`  
**CSS 类**: `.card`

**变体**:
- Default - 标准卡片
- Hover - 带悬停效果
- Twitter - Twitter 主题
- Images - Images 主题

**样式特征**:
```css
padding: 1.5rem;
border-radius: var(--radius);
background: linear-gradient(135deg, var(--panel) 0%, var(--panel-strong) 100%);
border: 1px solid var(--line);
box-shadow: var(--shadow);
backdrop-filter: blur(18px);
```

### 3. Button - 按钮

**Figma 组件**: `Button/Action`  
**CSS 类**: `.button`

**变体**:
- **Primary**: 渐变背景，主操作
- **Ghost**: 透明背景，边框样式
- **Small**: 小尺寸按钮
- **Danger**: 危险操作

**状态**:
- Default
- Hover (translateY(-1px), 增强阴影)
- Active
- Disabled (opacity: 0.6)

### 4. StatusChip - 状态标签

**Figma 组件**: `Status/Badge/Chip`  
**CSS 类**: `.status-chip`

**状态映射**:

| 状态类型 | CSS 类 | 颜色 | 使用场景 |
|---------|--------|------|----------|
| 成功 | `status-chip--published` | 绿色 | 已发布、已通过、就绪 |
| 错误 | `status-chip--failed` | 红色 | 失败、拒绝、错误 |
| 警告 | `status-chip--paused` | 橙色 | 暂停、需登录、高风险 |
| 信息 | `status-chip--in-progress` | 蓝色 | 进行中、审核中 |

### 5. AccountCard - 账号卡片

**Figma 组件**: `Account/Profile Card`  
**CSS 类**: `.account-card`

**状态**:
- Default
- Hover (translateY(-2px), 边框高亮)
- Active (选中状态)

**内容结构**:
```
AccountCard
├── Header (账号名 + 状态标签)
├── Snippet (账号简介)
└── Meta (可选 - 粉丝数、发文数等)
```

### 6. Table - 数据表格

**Figma 组件**: `Table/Data Grid`  
**CSS 类**: `.table`

**特征**:
- 表头渐变背景
- 行悬停高亮效果
- 底部边框渐变消失
- 响应式包装容器

### 7. PromptStudio - 提示词工作室

**Figma 组件**: `Prompt Editor/Studio`  
**CSS 类**: `.prompt-studio`

**布局**:
```
PromptStudio (双栏布局)
├── Sidebar (版本列表、账号选择)
└── Editor (提示词编辑区、预览区)
```

## 📐 布局系统

### Grid 系统

```css
/* 双栏布局 */
.grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* 三栏布局 */
.grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

/* 四栏布局 */
.grid--four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

/* 响应式断点 */
@media (max-width: 980px) {
  .grid--two, .grid--three, .grid--four {
    grid-template-columns: 1fr;
  }
}
```

### 经典布局模式

#### Shell 布局 (侧边栏 + 内容区)
```css
.shell {
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 100vh;
}
```

#### Twitter 工作室布局
```css
.twitter-layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 1rem;
}
```

#### 提示词工作室布局
```css
.prompt-studio {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 1rem;
}
```

## 🎭 动画与交互

### 过渡效果

```css
/* 快速过渡 - 160ms */
transition: transform 160ms ease, border-color 160ms ease;

/* 标准过渡 - 180ms */
transition: all 180ms ease;

/* 慢速过渡 - 200ms cubic-bezier */
transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
```

### 悬停效果

**卡片悬停**:
```css
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 30px rgba(197, 90, 17, 0.15);
}
```

**按钮悬停**:
```css
.button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(197, 90, 17, 0.4);
}
```

**导航项悬停**:
```css
.nav a:hover {
  transform: translateX(4px);
  border-color: rgba(197, 90, 17, 0.2);
  background: rgba(255, 255, 255, 0.75);
}
```

## 🔧 Figma Code Connect 使用指南

### 1. 设置 Code Connect

在 Figma 中安装 Code Connect 插件后，导入 `.figma.ts` 配置文件。

### 2. 组件映射

插件会自动将 Figma 组件映射到对应的 React 组件:

```
Figma Component          →  React Component
─────────────────────────────────────────────
Shell                    →  ProductShell
Card                     →  div.card
Button                   →  button.button
StatusChip               →  span.status-chip
AccountCard              →  button.account-card
Table                    →  table.table
PromptStudio             →  div.prompt-studio
```

### 3. 变量同步

Figma 变量会自动同步到 CSS 变量:

```
Figma Variable              →  CSS Variable
──────────────────────────────────────────────
theme/zhihu/accent         →  --accent (知乎)
theme/twitter/accent       →  --accent (Twitter)
space/md                   →  --space-md
radius/lg                  →  --radius-lg
shadow/lg                  →  --shadow
```

### 4. 设计审查清单

在将设计从 Figma 导出到代码前，请检查:

- [ ] 所有颜色使用设计令牌而非硬编码值
- [ ] 间距符合间距系统 (8px 倍数)
- [ ] 圆角使用标准圆角令牌
- [ ] 字体大小和字重符合字体系统
- [ ] 阴影使用预定义阴影令牌
- [ ] 组件使用正确的变体
- [ ] 响应式行为已定义
- [ ] 悬停和交互状态已设计
- [ ] 可访问性对比度符合 WCAG AA 标准

## 📱 响应式设计

### 断点

| 断点 | 宽度 | 布局调整 |
|------|------|----------|
| Mobile | < 720px | 单栏布局 |
| Tablet | 720px - 980px | 双栏布局 |
| Desktop | > 980px | 多栏布局 |

### 响应式模式

```css
/* 桌面端 (> 980px) */
.shell {
  grid-template-columns: 280px 1fr;
}

/* 移动端 (< 980px) */
@media (max-width: 980px) {
  .shell {
    grid-template-columns: 1fr;
  }
  
  .sidebar {
    border-right: none;
    border-bottom: 1px solid var(--line);
  }
}
```

## 🎯 最佳实践

### 1. 使用语义化类名

```css
/* ✅ 好 */
<div className="card card--twitter">
  <h3>账号名称</h3>
</div>

/* ❌ 避免 */
<div className="blue-box">
  <h3>账号名称</h3>
</div>
```

### 2. 使用设计令牌

```css
/* ✅ 好 */
.card {
  background: var(--panel);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
}

/* ❌ 避免 */
.card {
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}
```

### 3. 保持一致的间距

```css
/* ✅ 好 - 使用间距令牌 */
.card {
  padding: var(--space-lg);
  gap: var(--space-md);
}

/* ❌ 避免 - 硬编码值 */
.card {
  padding: 24px;
  gap: 16px;
}
```

## 📚 资源链接

- [Figma 设计文件](#) (待创建)
- [Storybook 组件文档](#) (待创建)
- [代码示例仓库](h:\claw\apps\web\src\components)

---

*最后更新：2026-04-12*  
*版本：1.0.0*
