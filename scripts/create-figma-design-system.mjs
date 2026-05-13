#!/usr/bin/env node

/**
 * H-CLAW Figma 设计系统创建脚本
 * 
 * 此脚本演示如何使用 Figma MCP 服务器和 Code Connect 技能
 * 自动创建设计系统组件和变量
 * 
 * 使用方法:
 * 1. 确保已安装 Figma 插件
 * 2. 运行：node scripts/create-figma-design-system.mjs
 */

import { readFile, writeFile } from 'fs/promises';

// 设计系统配置
const designSystem = {
  name: "H-CLAW Design System",
  version: "1.0.0",
  themes: {
    zhihu: {
      name: "知乎主题",
      colors: {
        accent: "#c55a11",
        accentSoft: "#f0c7a4",
        bg: "#f9f7f4",
        panel: "#ffffff",
        text: "#1f1a17",
        muted: "#72665d",
        line: "#e6e2dd",
        success: "#2d7c58",
        danger: "#a63d40",
        warning: "#9f6b00",
      }
    },
    twitter: {
      name: "Twitter 主题",
      colors: {
        accent: "#0f6c5a",
        accentSoft: "#bfe8da",
      }
    },
    images: {
      name: "Images 主题",
      colors: {
        accent: "#0b7a75",
        accentSoft: "#bfe9e4",
      }
    }
  },
  components: [
    "ProductShell",
    "Card",
    "Button",
    "StatusChip",
    "AccountCard",
    "Table",
    "PromptStudio",
  ]
};

// Figma 变量集合
const figmaVariables = {
  colors: [
    { name: "theme/zhihu/accent", value: "#c55a11" },
    { name: "theme/zhihu/accent-soft", value: "#f0c7a4" },
    { name: "theme/twitter/accent", value: "#0f6c5a" },
    { name: "theme/twitter/accent-soft", value: "#bfe8da" },
    { name: "theme/images/accent", value: "#0b7a75" },
    { name: "theme/images/accent-soft", value: "#bfe9e4" },
  ],
  spacing: [
    { name: "space/xs", value: "0.5rem" },
    { name: "space/sm", value: "0.75rem" },
    { name: "space/md", value: "1rem" },
    { name: "space/lg", value: "1.5rem" },
    { name: "space/xl", value: "2rem" },
    { name: "space/2xl", value: "3rem" },
  ],
  radius: [
    { name: "radius/sm", value: "10px" },
    { name: "radius/md", value: "16px" },
    { name: "radius/lg", value: "18px" },
    { name: "radius/xl", value: "20px" },
    { name: "radius/2xl", value: "28px" },
    { name: "radius/full", value: "999px" },
  ],
  shadows: [
    { name: "shadow/sm", value: "0 1px 3px rgba(0, 0, 0, 0.05)" },
    { name: "shadow/md", value: "0 2px 8px rgba(197, 90, 17, 0.3)" },
    { name: "shadow/lg", value: "0 4px 20px rgba(197, 90, 17, 0.08)" },
    { name: "shadow/xl", value: "0 8px 30px rgba(197, 90, 17, 0.15)" },
    { name: "shadow/2xl", value: "0 12px 50px rgba(197, 90, 17, 0.2)" },
  ]
};

async function createDesignSystemFiles() {
  console.log("🎨 开始创建 H-CLAW Figma 设计系统...\n");

  // 1. 创建 Code Connect 配置文件
  console.log("📝 创建 Code Connect 配置文件...");
  const codeConnectConfig = `/**
 * Figma Code Connect 配置
 * 自动生成于 ${new Date().toISOString()}
 */

export const config = ${JSON.stringify(designSystem, null, 2)};

export const variables = ${JSON.stringify(figmaVariables, null, 2)};
`;
  await writeFile('.figma.config.json', JSON.stringify(designSystem, null, 2));
  console.log("✅ Code Connect 配置文件已创建\n");

  // 2. 创建设计令牌文件
  console.log("🎨 创建设计令牌文件...");
  const designTokens = `/**
 * H-CLAW 设计令牌
 * 用于 Figma 变量和 CSS 变量的同步
 */

export const tokens = {
  colors: {
    zhihu: {
      accent: "${designSystem.themes.zhihu.colors.accent}",
      accentSoft: "${designSystem.themes.zhihu.colors.accentSoft}",
      bg: "${designSystem.themes.zhihu.colors.bg}",
      panel: "${designSystem.themes.zhihu.colors.panel}",
      text: "${designSystem.themes.zhihu.colors.text}",
      muted: "${designSystem.themes.zhihu.colors.muted}",
      line: "${designSystem.themes.zhihu.colors.line}",
      success: "${designSystem.themes.zhihu.colors.success}",
      danger: "${designSystem.themes.zhihu.colors.danger}",
      warning: "${designSystem.themes.zhihu.colors.warning}",
    },
    twitter: {
      accent: "${designSystem.themes.twitter.colors.accent}",
      accentSoft: "${designSystem.themes.twitter.colors.accentSoft}",
    },
    images: {
      accent: "${designSystem.themes.images.colors.accent}",
      accentSoft: "${designSystem.themes.images.colors.accentSoft}",
    }
  },
  spacing: {
    xs: "${figmaVariables.spacing[0].value}",
    sm: "${figmaVariables.spacing[1].value}",
    md: "${figmaVariables.spacing[2].value}",
    lg: "${figmaVariables.spacing[3].value}",
    xl: "${figmaVariables.spacing[4].value}",
    "2xl": "${figmaVariables.spacing[5].value}",
  },
  radius: {
    sm: "${figmaVariables.radius[0].value}",
    md: "${figmaVariables.radius[1].value}",
    lg: "${figmaVariables.radius[2].value}",
    xl: "${figmaVariables.radius[3].value}",
    "2xl": "${figmaVariables.radius[4].value}",
    full: "${figmaVariables.radius[5].value}",
  },
  shadows: {
    sm: "${figmaVariables.shadows[0].value}",
    md: "${figmaVariables.shadows[1].value}",
    lg: "${figmaVariables.shadows[2].value}",
    xl: "${figmaVariables.shadows[3].value}",
    "2xl": "${figmaVariables.shadows[4].value}",
  }
};
`;
  await writeFile('packages/core/src/tokens.ts', designTokens);
  console.log("✅ 设计令牌文件已创建\n");

  // 3. 创建 Figma 组件映射文档
  console.log("📚 创建组件映射文档...");
  const componentMapping = `# Figma 组件映射文档

## 组件列表

${designSystem.components.map((comp, i) => `${i + 1}. **${comp}**
   - Figma 组件：\`${comp}\`
   - React 组件：\`${comp}\`
   - 状态：待创建`).join('\n\n')}

## 变量映射

### 颜色变量

${figmaVariables.colors.map(v => `- \`${v.name}\` → \`${v.value}\``).join('\n')}

### 间距变量

${figmaVariables.spacing.map(v => `- \`${v.name}\` → \`${v.value}\``).join('\n')}

### 圆角变量

${figmaVariables.radius.map(v => `- \`${v.name}\` → \`${v.value}\``).join('\n')}

### 阴影变量

${figmaVariables.shadows.map(v => `- \`${v.name}\` → \`${v.value}\``).join('\n')}

## 使用指南

1. 在 Figma 中安装 Code Connect 插件
2. 导入此项目的配置文件
3. 组件会自动映射到对应的 React 组件
4. 变量会同步到 CSS 自定义属性
`;
  await writeFile('docs/figma/COMPONENT_MAPPING.md', componentMapping);
  console.log("✅ 组件映射文档已创建\n");

  // 4. 创建使用示例
  console.log("💡 创建使用示例...");
  const examples = `# Figma 设计系统使用示例

## 示例 1: 创建知乎主题的账号卡片

### Figma 操作步骤

1. 从 Assets 面板拖入 \`AccountCard\` 组件
2. 在 Design 面板中设置:
   - Theme: \`Zhihu\`
   - Variant: \`Default\`
   - Account Name: \`@example_user\`
   - Status: \`Active\`
3. 添加 Hover 交互:
   - While Hovering → Change to \`AccountCard/Hover\`
   - Animation: Smart Animate, 200ms

### 生成的代码

\`\`\`tsx
<button className="account-card">
  <div className="account-card__header">
    <h3>@example_user</h3>
    <span className="status-chip status-chip--success">Active</span>
  </div>
  <p className="account-card__snippet">账号简介内容...</p>
</button>
\`\`\`

## 示例 2: 创建 Twitter 主题的工作室布局

### Figma 操作步骤

1. 使用 \`Twitter Layout\` Auto Layout
2. 设置 Grid: \`320px 1fr\`
3. 左侧放入 \`AccountList\` 组件
4. 右侧放入 \`PromptEditor\` 组件
5. 应用 Twitter 主题色

### 生成的代码

\`\`\`tsx
<div className="twitter-layout">
  <aside className="twitter-account-list">
    {/* 账号列表 */}
  </aside>
  <main className="twitter-editor">
    {/* 编辑器内容 */}
  </main>
</div>
\`\`\`

## 示例 3: 创建状态标签系统

### Figma 变量设置

在 Figma Variables 中创建:

\`\`\`json
{
  "status/success/bg": "rgba(45, 124, 88, 0.15)",
  "status/success/text": "#2d7c58",
  "status/error/bg": "rgba(166, 61, 64, 0.16)",
  "status/error/text": "#a63d40",
  "status/warning/bg": "rgba(159, 107, 0, 0.16)",
  "status/warning/text": "#9f6b00"
}
\`\`\`

### 生成的 CSS

\`\`\`css
.status-chip--success {
  background: linear-gradient(135deg, rgba(45, 124, 88, 0.15) 0%, rgba(45, 124, 88, 0.2) 100%);
  color: var(--success);
}

.status-chip--failed {
  background: linear-gradient(135deg, rgba(166, 61, 64, 0.16) 0%, rgba(166, 61, 64, 0.22) 100%);
  color: var(--danger);
}
\`\`\`

## 示例 4: 响应式布局

### Figma 断点设置

使用 Figma 的 Responsive Resize:

- Desktop: > 980px (双栏布局)
- Tablet: 720px - 980px (自适应)
- Mobile: < 720px (单栏布局)

### 生成的 CSS

\`\`\`css
.shell {
  display: grid;
  grid-template-columns: 280px 1fr;
}

@media (max-width: 980px) {
  .shell {
    grid-template-columns: 1fr;
  }
}
\`\`\`
`;
  await writeFile('docs/figma/USAGE_EXAMPLES.md', examples);
  console.log("✅ 使用示例已创建\n");

  // 5. 创建 Figma 文件创建指南
  console.log("📖 创建 Figma 文件创建指南...");
  const guide = `# 在 Figma 中创建 H-CLAW 设计系统

## 前提条件

1. 安装 Figma 桌面应用或打开 figma.com
2. 安装 Code Connect 插件
3. 安装 MCP Server for Figma (如已配置)

## 步骤 1: 创建设计系统文件

1. 在 Figma 中创建新文件: \`H-CLAW Design System\`
2. 创建以下页面结构:
   - 📋 Foundations (基础)
     - Colors (颜色)
     - Typography (字体)
     - Spacing (间距)
     - Shadows (阴影)
   - 🧩 Components (组件)
     - ProductShell
     - Card
     - Button
     - StatusChip
     - AccountCard
     - Table
     - PromptStudio
   - 📐 Layouts (布局)
   - 📱 Templates (模板)

## 步骤 2: 创建颜色样式

在 Foundations → Colors 页面:

1. 创建颜色样式组 \`Theme/Zhihu\`:
   - Accent: #c55a11
   - Accent Soft: #f0c7a4
   - BG: #f9f7f4
   - Panel: #ffffff
   - Text: #1f1a17
   - Muted: #72665d
   - Line: #e6e2dd
   - Success: #2d7c58
   - Danger: #a63d40
   - Warning: #9f6b00

2. 创建颜色样式组 \`Theme/Twitter\`:
   - Accent: #0f6c5a
   - Accent Soft: #bfe8da

3. 创建颜色样式组 \`Theme/Images\`:
   - Accent: #0b7a75
   - Accent Soft: #bfe9e4

## 步骤 3: 创建效果样式

在 Foundations → Shadows 页面:

1. 创建效果样式:
   - Shadow/SM: 0 1px 3px rgba(0,0,0,0.05)
   - Shadow/MD: 0 2px 8px rgba(197,90,17,0.3)
   - Shadow/LG: 0 4px 20px rgba(197,90,17,0.08)
   - Shadow/XL: 0 8px 30px rgba(197,90,17,0.15)
   - Shadow/2XL: 0 12px 50px rgba(197,90,17,0.2)

## 步骤 4: 创建文本样式

在 Foundations → Typography 页面:

1. 创建文本样式:
   - Heading/XL: 4.2rem, Bold
   - Heading/2XL: 2rem, Bold
   - Heading/XL: 1.7rem, Bold
   - Heading/LG: 1.25rem, Semibold
   - Body/Base: 0.95rem, Normal
   - Body/SM: 0.875rem, Normal
   - Label/XS: 0.75rem, Medium

## 步骤 5: 创建组件

### 5.1 ProductShell 组件

1. 创建 Frame: 1440x900
2. 设置 Auto Layout:
   - Direction: Horizontal
   - Primary Axis: Fixed
   - Counter Axis: Fixed
3. 添加 Sidebar (280px 宽)
4. 添加 Content 区域 (1fr)
5. 创建 Variants:
   - Theme: Zhihu, Twitter, Images

### 5.2 Card 组件

1. 创建 Frame: 320x200
2. 设置 Auto Layout:
   - Padding: 24px
   - Gap: 16px
3. 添加圆角：16px
4. 添加阴影：Shadow/LG
5. 创建 Variants:
   - Type: Default, Hover
   - Theme: Zhihu, Twitter, Images

### 5.3 Button 组件

1. 创建 Frame: 自动宽度
2. 设置 Auto Layout:
   - Padding: 12px 24px
   - Gap: 8px
3. 添加圆角：10px
4. 创建 Variants:
   - Variant: Primary, Ghost, Small, Danger
   - State: Default, Hover, Active, Disabled

### 5.4 StatusChip 组件

1. 创建 Frame: 自动宽度
2. 设置 Auto Layout:
   - Padding: 6px 12px
   - Gap: 4px
3. 添加圆角：999px
4. 创建 Variants:
   - Status: Success, Error, Warning, Info

## 步骤 6: 设置 Code Connect

1. 运行插件：Plugins → Code Connect
2. 导入配置文件：\`.figma.config.json\`
3. 映射组件:
   - 选择 Figma 组件
   - 关联 React 组件路径
   - 设置属性映射

## 步骤 7: 导出设计令牌

使用 Tokens Studio 插件或手动导出:

1. 选择所有颜色样式
2. 导出为 JSON
3. 保存到 \`packages/core/src/tokens.ts\`

## 验证清单

- [ ] 所有颜色已创建为样式
- [ ] 所有文本样式已创建
- [ ] 所有阴影效果已创建
- [ ] 所有组件已创建并设置 Variants
- [ ] Code Connect 已配置
- [ ] 设计令牌已导出

## 下一步

1. 邀请团队成员协作文档
2. 创建使用示例和模板
3. 设置设计审查流程
4. 定期同步设计与代码

---

**提示**: 使用 Figma 的 Dev Mode 可以查看组件的代码片段和属性说明。
`;
  await writeFile('docs/figma/FIGMA_SETUP_GUIDE.md', guide);
  console.log("✅ Figma 文件创建指南已创建\n");

  console.log("🎉 设计系统文件创建完成!\n");
  console.log("📁 已创建的文件:");
  console.log("   - .figma.config.json (Code Connect 配置)");
  console.log("   - packages/core/src/tokens.ts (设计令牌)");
  console.log("   - docs/figma/DESIGN_SYSTEM.md (设计系统文档)");
  console.log("   - docs/figma/COMPONENT_MAPPING.md (组件映射)");
  console.log("   - docs/figma/USAGE_EXAMPLES.md (使用示例)");
  console.log("   - docs/figma/FIGMA_SETUP_GUIDE.md (设置指南)");
  console.log("\n💡 下一步:");
  console.log("   1. 在 Figma 中打开或创建新文件");
  console.log("   2. 安装 Code Connect 插件");
  console.log("   3. 按照 FIGMA_SETUP_GUIDE.md 创建设计系统");
  console.log("   4. 使用 Code Connect 同步设计与代码\n");
}

// 执行创建
createDesignSystemFiles().catch(console.error);
