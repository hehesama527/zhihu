/**
 * H-CLAW 设计系统 - Figma Code Connect 映射文件
 * 
 * 本文件定义了 Figma 组件与 React/Next.js 组件之间的映射关系
 * 用于实现设计与代码的自动同步
 */

import type { CodeConnectConfig } from "@figma/code-connect";

export const designSystemConfig: CodeConnectConfig = {
  name: "H-CLAW Design System",
  version: "1.0.0",
  description: "知乎/Twitter 矩阵运营子系统设计系统",
};

// ============ 颜色变量 ============

export const colors = {
  // 主色调 - 知乎风格
  zhihu: {
    accent: "#c55a11",
    accentSoft: "#f0c7a4",
    bg: "#f9f7f4",
    panel: "#ffffff",
    panelStrong: "#faf8f5",
    text: "#1f1a17",
    textLight: "#3d3630",
    muted: "#72665d",
    line: "#e6e2dd",
    success: "#2d7c58",
    danger: "#a63d40",
    warning: "#9f6b00",
  },
  // Twitter 风格
  twitter: {
    accent: "#0f6c5a",
    accentSoft: "#bfe8da",
    bg: "#f6f0e8",
  },
  // Images 子系统风格
  images: {
    accent: "#0b7a75",
    accentSoft: "#bfe9e4",
  },
};

// ============ 间距系统 ============

export const spacing = {
  xs: "0.5rem",   // 8px
  sm: "0.75rem",  // 12px
  md: "1rem",     // 16px
  lg: "1.5rem",   // 24px
  xl: "2rem",     // 32px
  "2xl": "3rem",  // 48px
};

// ============ 圆角系统 ============

export const radius = {
  sm: "10px",
  md: "16px",
  lg: "18px",
  xl: "20px",
  "2xl": "28px",
  full: "999px",
};

// ============ 字体系统 ============

export const typography = {
  fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  monoFontFamily: "'Monaco', 'Menlo', 'Courier New', monospace",
  sizes: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "0.95rem",
    lg: "1.25rem",
    xl: "1.7rem",
    "2xl": "2rem",
    "3xl": "2.5rem",
    "4xl": "4.2rem",
  },
  weights: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    extrabold: "800",
  },
};

// ============ 阴影系统 ============

export const shadows = {
  sm: "0 1px 3px rgba(0, 0, 0, 0.05)",
  md: "0 2px 8px rgba(197, 90, 17, 0.3)",
  lg: "0 4px 20px rgba(197, 90, 17, 0.08)",
  xl: "0 8px 30px rgba(197, 90, 17, 0.15)",
  "2xl": "0 12px 50px rgba(197, 90, 17, 0.2)",
  twitter: "0 18px 45px rgba(15, 108, 90, 0.12)",
  images: "0 18px 45px rgba(11, 122, 117, 0.12)",
};

// ============ 组件映射 ============

/**
 * ProductShell - 产品主布局组件
 * 
 * Figma 组件：Shell / Layout / Sidebar
 * 使用场景：所有产品页面的基础布局
 */
export const productShell = {
  figmaComponent: "Shell",
  reactComponent: "ProductShell",
  importPath: "@/components/product-shell",
  props: {
    tone: {
      type: "enum",
      values: ["zhihu", "twitter", "images"],
      description: "产品主题色调",
    },
    kicker: { type: "string", description: "副标题标签" },
    title: { type: "string", description: "主标题" },
    description: { type: "string", description: "产品描述" },
    navItems: {
      type: "array",
      itemShape: {
        href: "string",
        label: "string",
      },
      description: "导航项列表",
    },
    switchHref: { type: "string", description: "切换产品链接" },
    switchLabel: { type: "string", description: "切换产品标签" },
  },
  variants: [
    { name: "Default", props: { tone: "zhihu" } },
    { name: "Twitter", props: { tone: "twitter" } },
    { name: "Images", props: { tone: "images" } },
  ],
};

/**
 * Card - 卡片组件
 * 
 * Figma 组件：Card / Container
 * 使用场景：内容容器、数据展示
 */
export const card = {
  figmaComponent: "Card",
  reactComponent: "div",
  cssClass: "card",
  props: {
    variant: {
      type: "enum",
      values: ["default", "hover", "twitter", "images"],
      description: "卡片变体",
    },
    children: { type: "reactNode", description: "内容" },
  },
};

/**
 * Button - 按钮组件
 * 
 * Figma 组件：Button / Action
 * 使用场景：操作按钮、链接按钮
 */
export const button = {
  figmaComponent: "Button",
  reactComponent: "button",
  cssClass: "button",
  props: {
    variant: {
      type: "enum",
      values: ["primary", "ghost", "small", "danger"],
      description: "按钮样式",
    },
    disabled: { type: "boolean", description: "禁用状态" },
    children: { type: "reactNode", description: "按钮文本" },
  },
  variants: [
    {
      name: "Primary",
      props: { variant: "primary" },
      css: "background: linear-gradient(135deg, var(--accent) 0%, #a64a0e 100%);",
    },
    {
      name: "Ghost",
      props: { variant: "ghost" },
      css: "background: transparent; border: 1px solid var(--accent);",
    },
    {
      name: "Small",
      props: { variant: "small" },
      css: "padding: 0.5rem 1rem; font-size: 0.875rem;",
    },
  ],
};

/**
 * StatusChip - 状态标签组件
 * 
 * Figma 组件：Status / Badge / Chip
 * 使用场景：任务状态、审核状态、发布状态
 */
export const statusChip = {
  figmaComponent: "StatusChip",
  reactComponent: "span",
  cssClass: "status-chip",
  props: {
    status: {
      type: "enum",
      values: [
        "success", // published, review-passed, ready
        "error",   // failed, rejected
        "warning", // manual-login-required, paused
        "info",    // in-progress, reviewing
      ],
      description: "状态类型",
    },
    children: { type: "string", description: "状态文本" },
  },
  statusMapping: {
    success: ["published", "review-passed", "ready-to-publish", "ready", "resolved", "low"],
    error: ["failed", "failed-terminal", "publish-failed", "review-rejected", "browser-error", "proxy-error", "critical"],
    warning: ["manual-login-required", "paused", "login-required", "session-expired", "challenge-required", "skipped", "high", "open"],
    info: ["in-progress", "research-pending", "researching", "writing", "under-review", "revision-required", "publishing", "medium"],
  },
};

/**
 * Table - 表格组件
 * 
 * Figma 组件：Table / Data Grid
 * 使用场景：数据列表、任务列表、账号列表
 */
export const table = {
  figmaComponent: "Table",
  reactComponent: "table",
  cssClass: "table",
  props: {
    columns: { type: "array", description: "列定义" },
    data: { type: "array", description: "数据数组" },
    sortable: { type: "boolean", description: "是否可排序" },
  },
};

/**
 * AccountCard - 账号卡片组件
 * 
 * Figma 组件：Account / Profile Card
 * 使用场景：账号选择器、账号管理
 */
export const accountCard = {
  figmaComponent: "AccountCard",
  reactComponent: "button",
  cssClass: "account-card",
  props: {
    account: {
      type: "object",
      shape: {
        id: "string",
        name: "string",
        handle: "string",
        status: "string",
      },
      description: "账号信息",
    },
    isActive: { type: "boolean", description: "是否选中" },
    onClick: { type: "function", description: "点击回调" },
  },
};

/**
 * PromptStudio - 提示词工作室组件
 * 
 * Figma 组件：Prompt Editor / Studio
 * 使用场景：提示词编辑、版本管理、测试
 */
export const promptStudio = {
  figmaComponent: "PromptStudio",
  reactComponent: "div",
  cssClass: "prompt-studio",
  props: {
    promptId: { type: "string", description: "提示词 ID" },
    versions: { type: "array", description: "版本列表" },
    activeVersion: { type: "number", description: "当前版本" },
  },
};

// ============ 布局系统 ============

export const layouts = {
  shell: {
    gridTemplateColumns: "280px 1fr",
    minHeight: "100vh",
  },
  grid: {
    two: "repeat(2, minmax(0, 1fr))",
    three: "repeat(3, minmax(0, 1fr))",
    four: "repeat(4, minmax(0, 1fr))",
  },
  responsive: {
    breakpoint: "980px",
    mobileLayout: "1fr",
  },
};

// ============ 动画与过渡 ============

export const transitions = {
  fast: "160ms ease",
  normal: "180ms ease",
  slow: "200ms cubic-bezier(0.4, 0, 0.2, 1)",
  hover: {
    transform: "translateY(-2px)",
    boxShadow: "0 8px 30px rgba(197, 90, 17, 0.15)",
  },
};

// ============ Figma 变量导出 ============

export const figmaVariables = {
  colors: {
    "theme/zhihu/accent": colors.zhihu.accent,
    "theme/zhihu/accent-soft": colors.zhihu.accentSoft,
    "theme/twitter/accent": colors.twitter.accent,
    "theme/twitter/accent-soft": colors.twitter.accentSoft,
    "theme/images/accent": colors.images.accent,
    "theme/images/accent-soft": colors.images.accentSoft,
  },
  spacing: {
    "space/xs": spacing.xs,
    "space/sm": spacing.sm,
    "space/md": spacing.md,
    "space/lg": spacing.lg,
    "space/xl": spacing.xl,
    "space/2xl": spacing["2xl"],
  },
  radius: {
    "radius/sm": radius.sm,
    "radius/md": radius.md,
    "radius/lg": radius.lg,
    "radius/xl": radius.xl,
    "radius/2xl": radius["2xl"],
    "radius/full": radius.full,
  },
  shadows: {
    "shadow/sm": shadows.sm,
    "shadow/md": shadows.md,
    "shadow/lg": shadows.lg,
    "shadow/xl": shadows.xl,
    "shadow/2xl": shadows["2xl"],
  },
};

// ============ 使用示例 ============

/**
 * 示例：在 Figma 中创建一个 Twitter 风格的账号卡片
 * 
 * 1. 使用 AccountCard 组件
 * 2. 应用 Twitter 主题色
 * 3. 设置 hover 状态
 * 
 * Figma 操作:
 * - 选择 AccountCard 组件
 * - 设置 variant="twitter"
 * - 绑定账号数据
 * - 添加 hover 交互效果
 */
export const usageExamples = {
  accountCard: `
<ProductShell tone="twitter" kicker="账号管理" title="Twitter 运营" description="矩阵账号管理平台">
  <div className="account-list">
    <button className="account-card account-card--active">
      <div className="account-card__header">
        <h3>@example_user</h3>
        <span className="status-chip status-chip--success">Active</span>
      </div>
      <p className="account-card__snippet">账号简介...</p>
    </button>
  </div>
</ProductShell>
  `,
  statusBadge: `
<span className="status-chip status-chip--published">已发布</span>
<span className="status-chip status-chip--in-progress">进行中</span>
<span className="status-chip status-chip--failed">失败</span>
  `,
  buttonGroup: `
<div className="button-row">
  <button className="button">主要操作</button>
  <button className="button button--ghost">次要操作</button>
  <button className="button button--small">小型按钮</button>
</div>
  `,
};

export default designSystemConfig;
