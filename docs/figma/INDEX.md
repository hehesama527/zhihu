# Figma 插件文档索引

> 📚 H-CLAW 项目 Figma 插件完整文档导航

## 🎯 快速开始

### 第一次使用？从这里开始 👇

1. **[5 分钟快速演示](./QUICK_START_DEMO.md)** ⭐ **推荐起点**
   - 5 分钟了解 Figma 插件能做什么
   - 实际演示设计生成和代码生成
   - 量化价值展示

2. **[价值说明](./VALUE_PROPOSITION.md)** 
   - 为什么需要 Figma 插件
   - 量化收益和 ROI
   - 实际应用场景

3. **[使用指南](./README.md)**
   - 完整功能说明
   - 所有技能介绍
   - 工作流详解

## 📖 文档目录

### 入门文档

| 文档 | 用途 | 阅读时间 |
|------|------|----------|
| [INDEX.md](./INDEX.md) | 文档导航 | 2 分钟 |
| [QUICK_START_DEMO.md](./QUICK_START_DEMO.md) | 5 分钟快速演示 | 5 分钟 |
| [README.md](./README.md) | 完整使用指南 | 15 分钟 |

### 设计系统文档

| 文档 | 用途 | 阅读时间 |
|------|------|----------|
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | 完整设计系统规范 | 30 分钟 |
| [COMPONENT_MAPPING.md](./COMPONENT_MAPPING.md) | 组件映射说明 | 10 分钟 |
| [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md) | 使用示例合集 | 15 分钟 |
| [FIGMA_SETUP_GUIDE.md](./FIGMA_SETUP_GUIDE.md) | Figma 设置步骤 | 20 分钟 |

### 商业价值文档

| 文档 | 用途 | 阅读时间 |
|------|------|----------|
| [VALUE_PROPOSITION.md](./VALUE_PROPOSITION.md) | 价值主张和 ROI | 20 分钟 |

## 🎓 学习路径

### 路径 1: 开发者 (快速上手)

```
1. QUICK_START_DEMO.md (5 分钟)
   ↓
2. README.md - 技能部分 (10 分钟)
   ↓
3. USAGE_EXAMPLES.md (15 分钟)
   ↓
4. 开始实际使用！
```

**总时间**: ~30 分钟

### 路径 2: 设计师 (完整掌握)

```
1. QUICK_START_DEMO.md (5 分钟)
   ↓
2. DESIGN_SYSTEM.md (30 分钟)
   ↓
3. FIGMA_SETUP_GUIDE.md (20 分钟)
   ↓
4. COMPONENT_MAPPING.md (10 分钟)
   ↓
5. 在 Figma 中实践
```

**总时间**: ~75 分钟

### 路径 3: 产品经理/管理者 (理解价值)

```
1. QUICK_START_DEMO.md (5 分钟)
   ↓
2. VALUE_PROPOSITION.md (20 分钟)
   ↓
3. 与团队讨论实施计划
```

**总时间**: ~25 分钟

### 路径 4: 技术负责人 (全面规划)

```
1. VALUE_PROPOSITION.md (20 分钟)
   ↓
2. DESIGN_SYSTEM.md (30 分钟)
   ↓
3. README.md (15 分钟)
   ↓
4. FIGMA_SETUP_GUIDE.md (20 分钟)
   ↓
5. 制定团队实施计划
```

**总时间**: ~85 分钟

## 🔧 工具与技能

### 可用的 Figma 技能

| 技能 | 用途 | 命令示例 |
|------|------|----------|
| `figma-generate-library` | 从代码生成设计系统 | `/figma-generate-library 创建设计系统` |
| `figma-generate-design` | 从代码生成页面设计 | `/figma-generate-design 创建主页` |
| `figma-implement-design` | 从设计生成代码 | `/figma-implement-design` |
| `figma-code-connect` | 设置组件映射 | `/figma-code-connect` |
| `figma-create-design-system-rules` | 创建设计规则 | `/figma-create-design-system-rules` |
| `figma-create-new-file` | 创建新文件 | `/figma-create-new-file figjam 白板` |

### 脚本工具

| 脚本 | 用途 | 命令 |
|------|------|------|
| `create-figma-design-system.mjs` | 自动创建所有配置文件 | `node scripts/create-figma-design-system.mjs` |

## 📁 项目文件结构

```
h-claw/
├── docs/figma/
│   ├── INDEX.md                 # 📍 你在这里
│   ├── README.md                # 使用指南
│   ├── QUICK_START_DEMO.md      # 快速演示
│   ├── VALUE_PROPOSITION.md     # 价值说明
│   ├── DESIGN_SYSTEM.md         # 设计系统文档
│   ├── COMPONENT_MAPPING.md     # 组件映射
│   ├── USAGE_EXAMPLES.md        # 使用示例
│   └── FIGMA_SETUP_GUIDE.md     # 设置指南
├── .figma.ts                    # Code Connect 配置
├── .figma.config.json          # 设计系统配置
├── packages/core/src/tokens.ts # 设计令牌
└── scripts/
    └── create-figma-design-system.mjs  # 创建脚本
```

## 🎯 常见任务快速查找

### 我想...

**创建新设计系统**
→ 阅读 [QUICK_START_DEMO.md](./QUICK_START_DEMO.md) 第 2 步  
→ 运行 `node scripts/create-figma-design-system.mjs`

**生成一个新页面**
→ 阅读 [README.md](./README.md) "快速开始" 部分  
→ 使用 `/figma-generate-design` 技能

**将 Figma 设计转为代码**
→ 阅读 [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md)  
→ 使用 `/figma-implement-design` 技能

**更新设计系统颜色**
→ 修改 `packages/core/src/tokens.ts`  
→ 阅读 [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) 颜色系统部分

**设置组件映射**
→ 阅读 [COMPONENT_MAPPING.md](./COMPONENT_MAPPING.md)  
→ 使用 `/figma-code-connect` 技能

**了解 ROI**
→ 阅读 [VALUE_PROPOSITION.md](./VALUE_PROPOSITION.md)

**在 Figma 中手动创建组件**
→ 阅读 [FIGMA_SETUP_GUIDE.md](./FIGMA_SETUP_GUIDE.md)

## 💡 最佳实践

### 每日工作流

```
早上:
1. 查看 Figma 设计更新
2. 运行代码同步
3. 开始开发工作

工作中:
1. 需要新组件？→ /figma-generate-design
2. 设计已更新？→ /figma-implement-design
3. 遇到问题？→ 查看对应文档

晚上:
1. 提交代码变更
2. 同步到 Figma (可选)
3. 记录设计系统更新
```

### 每周工作流

```
周一:
- 规划本周设计需求
- 更新设计系统 (如需要)

周三:
- 设计审查
- 代码质量检查

周五:
- 文档更新
- 团队分享 (如需要)
```

### 每月工作流

```
月初:
- 回顾上月设计系统使用
- 规划新功能组件

月末:
- 设计系统审计
- 性能优化
- 团队培训
```

## 🆘 获取帮助

### 问题排查

1. **插件不工作？**
   → 检查 [README.md](./README.md) "前提条件" 部分

2. **设计同步失败？**
   → 检查 [FIGMA_SETUP_GUIDE.md](./FIGMA_SETUP_GUIDE.md) "验证清单"

3. **代码生成有问题？**
   → 查看 [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md) 对比示例

4. **设计令牌不一致？**
   → 参考 [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) 设计规范

### 联系支持

- 📧 技术问题：查看项目 Issue
- 💬 使用问题：团队 Slack 频道
- 📚 文档改进：提交 PR

## 📊 统计信息

### 文档统计

- 总文档数：8 个
- 总页数：~50 页
- 代码示例：~30 个
- 预计阅读时间：~2 小时 (全部)

### 设计系统统计

- 颜色变量：10 个
- 间距变量：6 个
- 圆角变量：6 个
- 阴影变量：5 个
- 文本样式：7 个
- 组件：7 个
- 组件变体：28+ 个

### 效率提升

- 设计生成：75% 时间节省
- 代码生成：80% 时间节省
- 沟通成本：80% 减少
- 文档时间：100% 自动化

## 🚀 开始使用

选择一个学习路径，开始你的 Figma 插件之旅！

**推荐起点**: [5 分钟快速演示](./QUICK_START_DEMO.md)

---

**最后更新**: 2026-04-12  
**文档版本**: 1.0.0  
**维护**: H-CLAW 产品团队

祝你使用愉快！🎨✨
