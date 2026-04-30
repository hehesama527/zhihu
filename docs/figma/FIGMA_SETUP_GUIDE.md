# 在 Figma 中创建 H-CLAW 设计系统

## 前提条件

1. 安装 Figma 桌面应用或打开 figma.com
2. 安装 Code Connect 插件
3. 安装 MCP Server for Figma (如已配置)

## 步骤 1: 创建设计系统文件

1. 在 Figma 中创建新文件: `H-CLAW Design System`
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

1. 创建颜色样式组 `Theme/Zhihu`:
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

2. 创建颜色样式组 `Theme/Twitter`:
   - Accent: #0f6c5a
   - Accent Soft: #bfe8da

3. 创建颜色样式组 `Theme/Images`:
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
2. 导入配置文件：`.figma.config.json`
3. 映射组件:
   - 选择 Figma 组件
   - 关联 React 组件路径
   - 设置属性映射

## 步骤 7: 导出设计令牌

使用 Tokens Studio 插件或手动导出:

1. 选择所有颜色样式
2. 导出为 JSON
3. 保存到 `packages/core/src/tokens.ts`

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
