# Figma 设计系统使用示例

## 示例 1: 创建知乎主题的账号卡片

### Figma 操作步骤

1. 从 Assets 面板拖入 `AccountCard` 组件
2. 在 Design 面板中设置:
   - Theme: `Zhihu`
   - Variant: `Default`
   - Account Name: `@example_user`
   - Status: `Active`
3. 添加 Hover 交互:
   - While Hovering → Change to `AccountCard/Hover`
   - Animation: Smart Animate, 200ms

### 生成的代码

```tsx
<button className="account-card">
  <div className="account-card__header">
    <h3>@example_user</h3>
    <span className="status-chip status-chip--success">Active</span>
  </div>
  <p className="account-card__snippet">账号简介内容...</p>
</button>
```

## 示例 2: 创建 Twitter 主题的工作室布局

### Figma 操作步骤

1. 使用 `Twitter Layout` Auto Layout
2. 设置 Grid: `320px 1fr`
3. 左侧放入 `AccountList` 组件
4. 右侧放入 `PromptEditor` 组件
5. 应用 Twitter 主题色

### 生成的代码

```tsx
<div className="twitter-layout">
  <aside className="twitter-account-list">
    {/* 账号列表 */}
  </aside>
  <main className="twitter-editor">
    {/* 编辑器内容 */}
  </main>
</div>
```

## 示例 3: 创建状态标签系统

### Figma 变量设置

在 Figma Variables 中创建:

```json
{
  "status/success/bg": "rgba(45, 124, 88, 0.15)",
  "status/success/text": "#2d7c58",
  "status/error/bg": "rgba(166, 61, 64, 0.16)",
  "status/error/text": "#a63d40",
  "status/warning/bg": "rgba(159, 107, 0, 0.16)",
  "status/warning/text": "#9f6b00"
}
```

### 生成的 CSS

```css
.status-chip--success {
  background: linear-gradient(135deg, rgba(45, 124, 88, 0.15) 0%, rgba(45, 124, 88, 0.2) 100%);
  color: var(--success);
}

.status-chip--failed {
  background: linear-gradient(135deg, rgba(166, 61, 64, 0.16) 0%, rgba(166, 61, 64, 0.22) 100%);
  color: var(--danger);
}
```

## 示例 4: 响应式布局

### Figma 断点设置

使用 Figma 的 Responsive Resize:

- Desktop: > 980px (双栏布局)
- Tablet: 720px - 980px (自适应)
- Mobile: < 720px (单栏布局)

### 生成的 CSS

```css
.shell {
  display: grid;
  grid-template-columns: 280px 1fr;
}

@media (max-width: 980px) {
  .shell {
    grid-template-columns: 1fr;
  }
}
```
