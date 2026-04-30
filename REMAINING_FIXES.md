# Twitter/X MVP 修复剩余工作清单

## 已完成的工作 ✅

1. ✅ x-core 类型定义和仓储方法（Prompt 相关）
2. ✅ XBrowserRuntime 导出和 verifyLogin 方法
3. ✅ x-api 所有后端接口（Prompt、登录、审核、发布控制）
4. ✅ web/src/lib/twitter/api.ts client helpers
5. ✅ 登录页真实登录逻辑
6. ✅ 草稿页账号名称显示 + 审核按钮逻辑

## 待完成的工作 📋

### 发布页修复 (apps/web/src/app/(twitter)/twitter/publish/page.tsx)

需要修改：
1. 导入 `getTwitterAccounts` 和 `runTwitterTask`
2. 在 loadTasks 中获取账号列表并映射名称
3. 添加 `handlePublishAction` 函数
4. 修改按钮绑定点击事件
5. 添加错误状态显示

### 发布历史页修复 (apps/web/src/app/(twitter)/twitter/publish-history/page.tsx)

需要修改：
1. 导入 `getTwitterAccounts`
2. 在 loadRecords 中获取账号列表并映射名称
3. 移除硬编码的 `账号-${id.slice(0, 6)}`

### Prompt 页面修复

#### 列表页 (apps/web/src/app/(twitter)/twitter/prompts/page.tsx)
1. 移除 MOCK_PROMPTS
2. 添加 useEffect 加载真实数据
3. 使用 `getTwitterPrompts()` API

#### 编辑页 (apps/web/src/app/(twitter)/twitter/prompts/[id]/edit/page.tsx)
1. 移除 MOCK_PROMPT
2. 修改 loadPrompt 使用 `getTwitterPrompt(id)`
3. 修改 handleSubmit 使用 `updateTwitterPrompt()`

#### 测试页 (apps/web/src/app/(twitter)/twitter/prompts/[id]/test/page.tsx)
1. 修改 handleTest 使用 `testTwitterPrompt(id, input)`

#### 新建页 (apps/web/src/app/(twitter)/twitter/prompts/new/page.tsx)
1. 修改 handleSubmit 使用 `createTwitterPrompt()`

## 快速修复命令

完成代码修改后运行：

```bash
# 类型检查
npm run typecheck

# 构建 x-api
npm run build -w @zhihu-mvp/x-api

# 构建 web
npm run build -w @zhihu-mvp/web
```

## 验证步骤

1. 访问 `/twitter/login` - 验证账号选择和登录
2. 访问 `/twitter/drafts` - 验证账号名称显示和审核按钮
3. 访问 `/twitter/publish` - 验证账号名称显示和发布按钮
4. 访问 `/twitter/publish-history` - 验证账号名称显示
5. 访问 `/twitter/prompts` - 验证 Prompt 列表（应为空或真实数据）
6. 访问 `/twitter/prompts/new` - 验证创建 Prompt
7. 访问 `/twitter/prompts/[id]/edit` - 验证编辑 Prompt
8. 访问 `/twitter/prompts/[id]/test` - 验证测试 Prompt

