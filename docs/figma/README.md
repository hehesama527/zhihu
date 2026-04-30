# Figma 插件使用指南

> 通过 Figma MCP 和 Code Connect 实现设计与代码的无缝同步

## 🎯 Figma 插件能为你做什么？

在这个知乎/Twitter 矩阵运营子系统中，Figma 插件可以帮助你:

1. **自动创建设计系统** - 从代码生成 Figma 组件和变量
2. **双向同步** - 设计变更自动反映到代码，代码变更自动更新设计
3. **组件映射** - Figma 组件直接对应 React 组件
4. **设计令牌管理** - 颜色、间距、圆角等统一管理和同步

## 📦 已安装的能力

### 1. Figma MCP Server
- 提供与 Figma API 的直接连接
- 支持创建文件、组件、变量等
- 支持读取设计系统配置

### 2. Figma 技能包

#### `figma-generate-design`
**用途**: 将代码页面转换为 Figma 设计  
**触发词**: "在 Figma 中创建这个页面"、"把这个组件推到 Figma"  
**示例**:
```
/figma-generate-design 创建 Twitter 运营主页
```

#### `figma-generate-library` 
**用途**: 从代码库构建完整的设计系统  
**触发词**: "创建设计系统"、"生成组件库"、"创建变量和令牌"  
**示例**:
```
/figma-generate-library 从当前代码生成设计系统
```

#### `figma-implement-design`
**用途**: 将 Figma 设计转换为生产代码  
**触发词**: "实现这个 Figma 设计"、"从 Figma 生成组件"  
**示例**:
```
/figma-implement-design https://figma.com/file/xxx
```

#### `figma-use`
**用途**: 在 Figma 文件中执行 JavaScript 操作  
**触发词**: 需要在 Figma 中创建/修改节点时自动调用  
**注意**: 这是其他技能的底层依赖，通常不直接调用

#### `figma-code-connect`
**用途**: 创建和维护 Code Connect 模板文件  
**触发词**: "设置 Code Connect"、"创建组件映射"  
**示例**:
```
/figma-code-connect 设置组件映射
```

#### `figma-create-design-system-rules`
**用途**: 生成项目特定的设计系统规则  
**触发词**: "创建设计系统规则"、"生成设计规范"  
**示例**:
```
/figma-create-design-system-rules 为项目创建设计规则
```

#### `figma-create-new-file`
**用途**: 创建新的 Figma 文件或 FigJam 白板  
**触发词**: "创建新文件"、"新建白板"  
**示例**:
```
/figma-create-new-file figjam 设计讨论白板
```

## 🚀 快速开始

### 方式 1: 使用脚本自动创建

我们已经提供了自动化脚本:

```bash
node scripts/create-figma-design-system.mjs
```

这会创建:
- ✅ Code Connect 配置文件
- ✅ 设计令牌 (TypeScript)
- ✅ 组件映射文档
- ✅ 使用示例
- ✅ Figma 设置指南

### 方式 2: 使用技能手动创建

在 Cursor 中输入:

```
/figma-generate-library 为 H-CLAW 项目创建完整的设计系统，包含知乎、Twitter、Images 三个主题
```

或者:

```
/figma-generate-design 创建 Twitter 运营子系统的主页面，包含侧边栏、账号列表、任务编辑器
```

### 方式 3: 使用 MCP 工具直接调用

如果需要更底层的控制，可以直接调用 MCP 工具:

```javascript
// 示例：创建新文件
CallMcpTool({
  server: "figma",
  toolName: "create_file",
  arguments: {
    name: "H-CLAW Design System",
    type: "design"
  }
})
```

## 📁 项目文件结构

```
h-claw/
├── .figma.ts                      # Code Connect 主配置文件
├── .figma.config.json            # 设计系统配置
├── docs/figma/
│   ├── README.md                 # 本文件
│   ├── DESIGN_SYSTEM.md          # 完整设计系统文档
│   ├── COMPONENT_MAPPING.md      # 组件映射说明
│   ├── USAGE_EXAMPLES.md         # 使用示例
│   └── FIGMA_SETUP_GUIDE.md      # Figma 设置指南
├── packages/core/src/
│   └── tokens.ts                 # 设计令牌 (TypeScript)
└── scripts/
    └── create-figma-design-system.mjs  # 自动化创建脚本
```

## 🎨 设计系统概览

### 三个产品主题

1. **知乎主题** - 温暖橙棕色调
   - 主色：`#c55a11`
   - 风格：专业、温暖、可读性强

2. **Twitter 主题** - 清新青绿色调
   - 主色：`#0f6c5a`
   - 风格：现代、清爽、科技感

3. **Images 子系统** - 专业蓝绿色调
   - 主色：`#0b7a75`
   - 风格：简洁、专业、视觉导向

### 核心组件

- `ProductShell` - 产品主布局
- `Card` - 卡片容器
- `Button` - 按钮
- `StatusChip` - 状态标签
- `AccountCard` - 账号卡片
- `Table` - 数据表格
- `PromptStudio` - 提示词工作室

## 💡 实际使用场景

### 场景 1: 新产品页面设计

**需求**: 为 Twitter 热点监控功能创建新页面

**步骤**:
1. 在代码中创建 React 组件框架
2. 运行：`/figma-generate-design 创建 Twitter 热点监控页面`
3. Figma 中自动生成完整设计
4. 在 Figma 中微调视觉效果
5. 设计确认后，自动生成最终代码

### 场景 2: 设计系统更新

**需求**: 更新主色调从橙色改为蓝色

**步骤**:
1. 修改 `packages/core/src/tokens.ts` 中的颜色值
2. 运行：`/figma-generate-library 更新设计系统颜色`
3. Figma 中所有组件自动更新颜色
4. 所有使用设计令牌的代码自动更新

### 场景 3: 新组件开发

**需求**: 创建新的"热点趋势图"组件

**步骤**:
1. 在 Figma 中设计组件原型
2. 运行：`/figma-implement-design 实现热点趋势图组件`
3. 自动生成 React 组件代码
4. 添加业务逻辑和数据绑定

## 🔧 Code Connect 配置

Code Connect 是 Figma 的插件，用于连接设计与代码。

### 配置文件

`.figma.ts` 包含:
- 组件映射关系
- 属性对应规则
- 变体定义
- 使用示例

### 设置步骤

1. 在 Figma 安装 Code Connect 插件
2. 运行插件，导入 `.figma.ts`
3. 组件自动映射完成

## 📊 工作流

```
┌─────────────┐                    ┌─────────────┐
│   Figma     │                    │   Code      │
│   Design    │                    │   Base      │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  figma-generate-library          │
       │  (创建设计系统)                   │
       │◄─────────────────────────────────│
       │                                  │
       │  figma-implement-design          │
       │  (实现设计)                       │
       │─────────────────────────────────►│
       │                                  │
       │  Code Connect 同步                │
       │  (自动双向同步)                   │
       │◄──────────────────────────────►│
       │                                  │
```

## ✅ 最佳实践

### 1. 始终使用设计令牌

```css
/* ✅ 好 */
background: var(--accent);

/* ❌ 避免 */
background: #c55a11;
```

### 2. 使用组件变体

```tsx
/* ✅ 好 */
<Button variant="primary" />
<Button variant="ghost" />

/* ❌ 避免 */
<button className="custom-button" />
```

### 3. 保持设计与代码同步

- 设计变更后立即运行同步
- 代码变更后更新 Figma
- 定期审查设计系统

### 4. 使用语义化命名

```
✅ Theme/Zhihu/Accent
❌ Color1, Color2, OrangeColor
```

## 📚 更多资源

- [Figma 官方文档](https://help.figma.com/)
- [Code Connect 文档](https://www.figma.com/code-connect/)
- [设计系统文档](./DESIGN_SYSTEM.md)
- [组件映射](./COMPONENT_MAPPING.md)
- [使用示例](./USAGE_EXAMPLES.md)
- [设置指南](./FIGMA_SETUP_GUIDE.md)

## 🆘 获取帮助

遇到问题时:

1. 查看 `docs/figma/FIGMA_SETUP_GUIDE.md`
2. 检查 Code Connect 配置是否正确
3. 确认 Figma 插件已正确安装
4. 查看控制台错误信息

---

**最后更新**: 2026-04-12  
**版本**: 1.0.0  
**维护**: H-CLAW 团队
