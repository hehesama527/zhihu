import Link from "next/link";
import type { AccountListItem } from "@zhihu-mvp/shared";
import { StatusChip } from "./status-chip";

type AccountSwitcherProps = {
  accounts: AccountListItem[];
  selectedAccountId: number | null;
  basePath: string;
  title?: string;
  description?: string;
};

export function AccountSwitcher({
  accounts,
  selectedAccountId,
  basePath,
  title = "账号切换",
  description = "切到不同账号视图后，当前账号状态、恢复入口和新建任务动作都会跟着切换。"
}: AccountSwitcherProps) {
  if (!accounts.length) {
    return (
      <div className="card">
        <div className="stack stack--tight">
          <h3>{title}</h3>
          <p className="muted">当前还没有可切换的账号。</p>
        </div>
      </div>
    );
  }

  return (
    <section className="card">
      <div className="stack stack--tight">
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </div>

      <div className="account-switcher-grid" style={{ marginTop: "1rem" }}>
        {accounts.map((account) => {
          const active = selectedAccountId === account.id || (selectedAccountId === null && accounts[0]?.id === account.id);
          return (
            <Link
              key={account.id}
              href={`${basePath}?accountId=${account.id}`}
              className={`account-switcher-card${active ? " account-switcher-card--active" : ""}`}
            >
              <div className="inline-row">
                <strong>{account.name}</strong>
                <StatusChip status={account.status} />
              </div>
              <p className="muted">{account.zhihuUserName ?? "未命名知乎账号"}</p>
              <p className="helper-text">最近发布：{formatTime(account.lastPublishAt)}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}
