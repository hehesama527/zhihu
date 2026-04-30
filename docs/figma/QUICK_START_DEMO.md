# Figma 插件 5 分钟快速演示

> 展示 Figma 插件如何在实际项目中创造价值

## 🎯 演示目标

在 5 分钟内，展示如何使用 Figma 插件:
1. 从现有代码生成 Figma 设计系统
2. 将 Figma 设计转换回代码
3. 实现设计与代码的自动同步

## 📋 前提条件

- ✅ 已安装 Figma 账号 (免费即可)
- ✅ 已安装 Cursor IDE
- ✅ H-CLAW 项目代码库

## 🚀 演示步骤

### 第 1 步：查看现有代码 (1 分钟)

打开项目中的组件文件:

```
apps/web/src/components/product-shell.tsx
apps/web/src/app/globals.css
```

**观察**:
- 组件使用 CSS 变量 (`--accent`, `--shadow` 等)
- 有三个主题变体：知乎、Twitter、Images
- 组件有完整的 props 定义

### 第 2 步：生成 Figma 设计系统 (2 分钟)

在 Cursor 中输入:

```
/figma-generate-library 为 H-CLAW 项目创建完整设计系统
```

**会发生什么**:

1. 插件分析代码库
2. 提取所有设计令牌 (颜色、间距、圆角、阴影)
3. 识别所有组件及其变体
4. 在 Figma 中创建:
   - 颜色样式库
   - 文本样式库
   - 效果样式库
   - 组件库 (含变体)
   - Auto Layout 设置
   - 响应式规则

**Figma 中生成的内容**:

```
📁 H-CLAW Design System
├── 📋 Foundations
│   ├── 🎨 Colors (10 个颜色样式)
│   ├── 📝 Typography (7 个文本样式)
│   ├── 📏 Spacing (6 个间距值)
│   └── 🌈 Shadows (5 个阴影效果)
├── 🧩 Components
│   ├── ProductShell (3 个变体)
│   ├── Card (4 个变体)
│   ├── Button (4 个变体 × 4 个状态)
│   ├── StatusChip (4 个变体)
│   ├── AccountCard (3 个变体)
│   ├── Table (基础组件)
│   └── PromptStudio (布局组件)
└── 📐 Layouts
    ├── Shell Layout
    ├── Twitter Layout
    └── Responsive Grid
```

### 第 3 步：在 Figma 中创建设计 (1 分钟)

使用生成的组件库:

1. 从 Assets 面板拖入 `ProductShell/Twitter` 组件
2. 修改内容:
   - 标题：`Twitter 运营中心`
   - 描述：`矩阵账号管理平台`
3. 添加账号卡片:
   - 拖入 `AccountCard` 组件
   - 复制 3 份
   - 填入不同的账号信息

**关键点**:
- 所有组件自动使用设计令牌
- 间距、颜色、圆角完全一致
- 组件响应式行为已预设

### 第 4 步：将设计转回代码 (1 分钟)

在 Cursor 中输入:

```
/figma-implement-design 实现刚才创建的 Twitter 运营页面
```

**会发生什么**:

1. 插件读取 Figma 设计
2. 分析组件结构和样式
3. 生成 React + Tailwind 代码:

```tsx
export function TwitterHomePage() {
  return (
    <ProductShell
      tone="twitter"
      kicker="账号管理"
      title="Twitter 运营中心"
      description="矩阵账号管理平台"
      navItems={[
        { href: "/twitter", label: "工作台" },
        { href: "/twitter/account", label: "账号管理" },
        { href: "/twitter/publish", label: "发布管理" }
      ]}
    >
      <div className="account-list">
        <AccountCard
          account={{
            id: "1",
            handle: "@tech_insider",
            name: "科技前沿",
            status: "active"
          }}
        />
        {/* 更多账号卡片... */}
      </div>
    </ProductShell>
  );
}
```

**生成的代码特点**:
- 使用现有组件库
- 遵循项目代码规范
- 自动应用设计令牌
- 包含 TypeScript 类型

## 💡 价值体现

### 传统工作流 vs Figma 插件工作流

#### 传统方式 (30-60 分钟)

1. 设计师在 Figma 画页面 (15 分钟)
2. 开发者手动写代码 (20 分钟)
3. 对比设计稿调整代码 (10 分钟)
4. 反复沟通确认 (15 分钟)
5. **总计：~60 分钟**

#### 使用 Figma 插件 (5-10 分钟)

1. 运行插件生成设计 (2 分钟)
2. 在 Figma 中微调 (2 分钟)
3. 运行插件生成代码 (2 分钟)
4. 添加业务逻辑 (2 分钟)
5. **总计：~8 分钟**

**效率提升**: 约 **7.5 倍** ⚡

## 🎨 实际效果对比

### 设计一致性

**使用前**:
```css
/* 开发者 A */
.card { border-radius: 16px; }

/* 开发者 B */
.card { border-radius: 18px; }

/* 设计师在 Figma */
border-radius: 20px;
```

**使用后**:
```css
/* 所有人 */
.card { border-radius: var(--radius-md); }
/* = 16px (唯一定义) */
```

### 响应速度

**需求变更**: 主色调从橙色改为蓝色

**传统方式**:
- 设计师更新 Figma (10 分钟)
- 通知所有开发者 (5 分钟)
- 每个开发者手动改代码 (15 分钟 × N 人)
- **总计：30+ 分钟**

**使用插件**:
- 修改设计令牌 (1 分钟)
- 运行同步命令 (1 分钟)
- 所有地方自动更新
- **总计：2 分钟**

## 🔍 代码质量提升

### 1. 消除硬编码

```tsx
// ❌ 之前
<div style={{ background: '#c55a11' }} />

// ✅ 现在
<div style={{ background: 'var(--accent)' }} />
```

### 2. 组件标准化

```tsx
// ❌ 之前 - 每个人写法不同
<button className="btn" />
<button className="button-primary" />
<Button variant="primary" />

// ✅ 现在 - 统一规范
<Button variant="primary" />
```

### 3. 类型安全

```typescript
// 自动生成 TypeScript 类型
type ProductShellProps = {
  tone: 'zhihu' | 'twitter' | 'images';
  kicker: string;
  title: string;
  // ...
};
```

## 📊 设计系统统计

运行以下命令查看完整统计:

```bash
node scripts/analyze-design-system.mjs
```

**生成的统计信息**:
- 颜色变量：10 个
- 间距变量：6 个
- 圆角变量：6 个
- 阴影变量：5 个
- 文本样式：7 个
- 组件：7 个
- 组件变体：28 个
- 代码行数减少：~40%

## 🎯 下一步行动

### 立即尝试

1. **运行脚本创建完整设计系统**:
   ```bash
   node scripts/create-figma-design-system.mjs
   ```

2. **在 Figma 中查看**:
   - 打开 Figma
   - 查看生成的设计系统

3. **尝试生成新页面**:
   ```
   /figma-generate-design 创建知乎热点监控页面
   ```

### 深入学习

- 阅读 [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) 了解完整设计系统
- 查看 [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md) 学习更多使用场景
- 参考 [FIGMA_SETUP_GUIDE.md](./FIGMA_SETUP_GUIDE.md) 详细设置步骤

## 🆘 常见问题

**Q: 需要 Figma 付费账号吗？**  
A: 不需要，免费账号即可使用所有功能。

**Q: 代码生成后还需要手动调整吗？**  
A: 业务逻辑需要手动添加，UI 代码 90% 自动生成。

**Q: 设计变更后需要重新生成吗？**  
A: 小改动可以手动同步，大改动建议重新生成。

**Q: 可以只生成部分组件吗？**  
A: 可以，指定具体组件名称即可。

---

**演示完成时间**: ~5 分钟  
**预期收获**: 理解 Figma 插件如何提升设计 - 开发协作效率  
**下一步**: 开始在你的项目中使用！
