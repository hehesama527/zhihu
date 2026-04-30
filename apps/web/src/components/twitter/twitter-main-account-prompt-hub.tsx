"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getTwitterAccountPromptPanel,
  getTwitterAccounts,
  type TwitterAccount,
  type TwitterAccountPromptPanel
} from "../../lib/twitter/api";

type MainAccountPromptCategory = "main" | "writing";

const CATEGORY_TITLES: Record<MainAccountPromptCategory, string> = {
  main: "Main Agent",
  writing: "Writer Agent"
};

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatVersionStatus(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    active: "生效中",
    archived: "已归档"
  };

  return labels[status] ?? status;
}

export function TwitterMainAccountPromptHub() {
  const [accounts, setAccounts] = useState<TwitterAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<MainAccountPromptCategory>("writing");
  const [panel, setPanel] = useState<TwitterAccountPromptPanel | null>(null);
  const [accountsError, setAccountsError] = useState("");
  const [panelError, setPanelError] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingPanel, setLoadingPanel] = useState(false);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;

  useEffect(() => {
    void refreshAccounts();
  }, []);

  useEffect(() => {
    if (!selectedAccountId) {
      setPanel(null);
      return;
    }

    void refreshPanel(selectedAccountId, selectedCategory);
  }, [selectedAccountId, selectedCategory]);

  async function refreshAccounts() {
    setLoadingAccounts(true);

    try {
      const nextAccounts = await getTwitterAccounts();
      setAccounts(nextAccounts);
      setSelectedAccountId((current) => {
        if (current && nextAccounts.some((item) => item.id === current)) {
          return current;
        }

        return nextAccounts[0]?.id ?? null;
      });
      setAccountsError("");
    } catch (error) {
      setAccounts([]);
      setSelectedAccountId(null);
      setAccountsError(error instanceof Error ? error.message : "加载主链路账户失败。");
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function refreshPanel(accountId: string, category: MainAccountPromptCategory) {
    setLoadingPanel(true);

    try {
      const data = await getTwitterAccountPromptPanel(accountId, category);
      setPanel(data.panel);
      setPanelError("");
    } catch (error) {
      setPanel(null);
      setPanelError(error instanceof Error ? error.message : "加载账户级 prompt 面板失败。");
    } finally {
      setLoadingPanel(false);
    }
  }

  return (
    <div className="stack">
      <section className="grid grid--two">
        <article className="card stack stack--tight">
          <h3>这个页面只看账户级绑定</h3>
          <p className="muted">这里不再混入传统链路编辑器，只看主链路 `main / writing` 的账户级绑定和账户自有版本。</p>
        </article>
        <article className="card stack stack--tight">
          <h3>边界说明</h3>
          <p className="muted">这里展示的是主链路后端已经暴露出来的账户级面板，不是传统链路。传统链路的全局编辑器已经单独拆到别的页面。</p>
        </article>
      </section>

      <article className="card stack stack--tight">
        <div className="card-header">
          <div>
            <h3>主链路账户级 Prompt 绑定</h3>
            <p className="muted">直接读取 `/x-api/accounts/:id/account-prompts/*` 的结果，以后端实际返回为准。</p>
          </div>
          <Link href="/twitter/account" className="button button--ghost">
            打开账户页
          </Link>
        </div>

        {accountsError ? (
          <div className="card" style={{ padding: "1rem" }}>
            <p className="helper-text">{accountsError}</p>
          </div>
        ) : null}

        <div className="grid grid--two">
          <label className="field">
            <span>主链路账户</span>
            <select
              value={selectedAccountId ?? ""}
              disabled={loadingAccounts || !accounts.length}
              onChange={(event) => setSelectedAccountId(event.target.value || null)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.handle}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>类别</span>
            <select
              value={selectedCategory}
              disabled={!selectedAccountId}
              onChange={(event) => setSelectedCategory(event.target.value as MainAccountPromptCategory)}
            >
              {Object.entries(CATEGORY_TITLES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loadingPanel ? <p className="helper-text">正在加载账户级 prompt 面板...</p> : null}

        {panelError ? (
          <div className="card" style={{ padding: "1rem" }}>
            <p className="helper-text">{panelError}</p>
          </div>
        ) : null}

        {selectedAccount && panel ? (
          <div className="grid grid--two">
            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>
                  @{selectedAccount.handle} / {CATEGORY_TITLES[selectedCategory]}
                </strong>
                <span className="helper-text">全局 Prompt Set：{panel.prompt.setName}</span>
                <span className="helper-text">
                  当前绑定版本：{panel.boundVersion ? `#${panel.boundVersion.id} / v${panel.boundVersion.version}` : "未绑定，走全局"}
                </span>
                <span className="helper-text">账户自有版本数：{panel.accountVersions.length}</span>
                <span className="helper-text">全局活跃版本：{panel.prompt.activeVersion ? `v${panel.prompt.activeVersion}` : "-"}</span>
              </div>
            </div>

            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>最近状态</strong>
                <span className="helper-text">Prompt 名称：{panel.prompt.name}</span>
                <span className="helper-text">最后测试：{formatDateTime(panel.prompt.lastTestedAt)}</span>
                <span className="helper-text">活跃标签：{panel.prompt.activeLabel ?? "-"}</span>
                <span className="helper-text">
                  当前作用方式：{panel.boundVersion || panel.accountVersions.length ? "账户级版本可用" : "当前直接使用全局版本"}
                </span>
              </div>
            </div>

            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>当前生效内容</strong>
                <pre>{panel.boundVersion?.content ?? panel.prompt.template}</pre>
              </div>
            </div>

            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>账户自有版本</strong>
                {panel.accountVersions.length ? (
                  <div className="log-list">
                    {panel.accountVersions.map((version) => (
                      <div key={version.id} className="catalog-list__item">
                        <div className="catalog-list__item-top">
                          <div>
                            <div className="catalog-list__item-subtitle">{version.label}</div>
                            <div className="catalog-list__item-caption">
                              #{version.id} / v{version.version} / {formatVersionStatus(version.status)}
                            </div>
                          </div>
                          {version.id === panel.boundVersionId ? <span className="mini-badge mini-badge--accent">已绑定</span> : null}
                        </div>
                        <div className="catalog-list__item-caption">{version.notes || "无备注"}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="helper-text">这个账户在当前类别下还没有账户自有版本。</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}
