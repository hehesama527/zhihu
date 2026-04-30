# X Traditional Account Configs

这套文件只服务于 `traditional` 传统链路。

目的：

- 把账号的 `Soul`、`Strategy`、`Goals` 从 agent prompt 里拆出来，改成可维护的配置资产。
- 先支持两个账号：`account_a` 和 `account_b`。
- 不影响现有 `X Main` 链路，也不影响知乎链路。

目录结构：

```text
data-x-traditional/account-configs/
├─ accounts/
│  ├─ account_a/
│  │  ├─ soul.md
│  │  ├─ strategy.yaml
│  │  └─ goals.yaml
│  └─ account_b/
│     ├─ soul.md
│     ├─ strategy.yaml
│     └─ goals.yaml
└─ global/
   └─ matrix_rules.yaml
```

每个文件的职责：

- `soul.md`
  定义这个账号是谁、怎么说话、什么表达应该避免。

- `strategy.yaml`
  定义这个账号发什么、为什么发、什么题适合它、什么题不适合它。

- `goals.yaml`
  定义当前阶段目标、最近 14 天重点、衡量优先级。

- `matrix_rules.yaml`
  定义两个账号在传统链路里的分工规则，避免撞题和同质化。

建议的读取顺序：

1. `Main` 读取：`matrix_rules + strategy + goals + soul + runtime context`
2. `Writer` 读取：`soul + strategy + main_plan + research`
3. `Review` 读取：`soul + strategy + goals + draft`

当前状态：

- 这里只是第一版配置草稿，还没有接进传统链路代码。
- 后续如果你确认字段和表达方式，再把这些文件接入 `x-traditional` 的读取流程。
- 如果账号增加到 4 个以上，再考虑拆额外的 `boundaries.yaml` 或 `strategy_templates/`。
