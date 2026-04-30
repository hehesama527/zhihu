"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountListItem } from "@zhihu-mvp/shared";
import { useState, useTransition } from "react";
import { fetchClientResponse } from "../lib/http";
import { StatusChip } from "./status-chip";

type AccountRegistryProps = {
  accounts: AccountListItem[];
  selectedAccountId: number | null;
};

export function AccountRegistry({ accounts, selectedAccountId }: AccountRegistryProps) {
  const router = useRouter();
  const [draftName, setDraftName] = useState("");
  const [draftZhihuUserName, setDraftZhihuUserName] = useState("");
  const [draftRiskDomain, setDraftRiskDomain] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  async function call<T>(path: string, init?: RequestInit) {
    const { response, text, payload } = await fetchClientResponse(path, {
      ...init
    });

    if (!response.ok) {
      const errorMessage =
        typeof payload.error === "object" && payload.error && "message" in payload.error
          ? String((payload.error as { message?: unknown }).message ?? "")
          : text;
      throw new Error(errorMessage || "请求失败。");
    }

    return payload as T;
  }

  async function createAccount() {
    const name = draftName.trim();
    if (!name) {
      throw new Error("账号名称不能为空。");
    }

    const zhihuUserName = draftZhihuUserName.trim();
    const riskDomain = draftRiskDomain.trim();
    const payload = await call<{ ok?: boolean; account?: AccountListItem | null }>("/accounts", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name,
        zhihuUserName: zhihuUserName ? zhihuUserName : null,
        riskDomain: riskDomain ? riskDomain : null
      })
    });

    const createdAccountId = payload.account?.id ?? null;
    setDraftName("");
    setDraftZhihuUserName("");
    setDraftRiskDomain("");
    setMessage(createdAccountId ? `账号已创建：${name}。现在矩阵账号数会更新，你也可以直接切过去继续配置。` : "账号已创建。");
    router.push(createdAccountId ? `/zhihu/account?accountId=${createdAccountId}` : "/zhihu/account");
    router.refresh();
  }

  async function deleteAccount(account: AccountListItem) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`确定删除账号“${account.name}”吗？只有空账号才能删除，这个操作不可恢复。`)
    ) {
      return;
    }

    const payload = await call<{ ok?: boolean; cleanupWarning?: string | null; nextAccountId?: number | null }>(
      `/accounts/${account.id}`,
      {
        method: "DELETE"
      }
    );

    setMessage(payload.cleanupWarning ? `账号已删除。${payload.cleanupWarning}` : `账号已删除：${account.name}。`);

    const shouldResetView = account.id === selectedAccountId || accounts.length <= 1;
    if (shouldResetView) {
      router.push(payload.nextAccountId ? `/zhihu/account?accountId=${payload.nextAccountId}` : "/zhihu/account");
    }

    router.refresh();
  }

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h3>账号台账</h3>
          <p className="muted">当前矩阵里一共有 {accounts.length} 个账号。后面做账号级写作提示词绑定时，就是绑定这里的账号。只有空账号允许删除。</p>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>账号</th>
              <th>知乎账号</th>
              <th>风险域</th>
              <th>状态</th>
              <th>浏览器档案</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length ? (
              accounts.map((account) => {
                const active = account.id === selectedAccountId || (selectedAccountId === null && accounts[0]?.id === account.id);
                return (
                  <tr key={account.id}>
                    <td>
                      <div className="stack stack--tight">
                        <strong>{account.name}</strong>
                        <span className="muted">#{account.id}{active ? " / 当前视图" : ""}</span>
                      </div>
                    </td>
                    <td>{account.zhihuUserName ?? "未命名"}</td>
                    <td>
                      <div className="stack stack--tight">
                        <span>{account.riskDomain}</span>
                        <span className="muted">
                          {account.cooldownUntil ? `冷却到 ${formatTime(account.cooldownUntil)}` : "无冷却"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={account.status} />
                    </td>
                    <td>{account.profileDir ?? "未配置"}</td>
                    <td>
                      <div className="button-row">
                        <Link href={`/zhihu/account?accountId=${account.id}`} className="button button--ghost">
                          查看账号
                        </Link>
                        <button
                          className="button button--ghost button--danger"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              try {
                                await deleteAccount(account);
                              } catch (error) {
                                setMessage(error instanceof Error ? error.message : "删除账号失败。");
                              }
                            })
                          }
                        >
                          删除账号
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6}>当前还没有账号。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <div className="stack stack--tight">
          <h4>新增账号</h4>
          <p className="helper-text">新账号创建后会自动分配独立浏览器档案目录，后续再去做首次人工登录即可。</p>
        </div>

        <div className="grid grid--two" style={{ marginTop: "1rem" }}>
          <label className="field">
            <span>账号名称 / 人设名</span>
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="例如：二丫" />
          </label>

          <label className="field">
            <span>知乎账号名</span>
            <input
              value={draftZhihuUserName}
              onChange={(event) => setDraftZhihuUserName(event.target.value)}
              placeholder="例如：二丫聊副业"
            />
          </label>

          <label className="field">
            <span>风险域</span>
            <input
              value={draftRiskDomain}
              onChange={(event) => setDraftRiskDomain(event.target.value)}
              placeholder="例如：machine-a / group-1"
            />
          </label>
        </div>

        <p className="helper-text" style={{ marginTop: "0.8rem" }}>
          风险域用于标记共享环境里的账号分组；同组里一旦有账号触发登录异常或进入冷却，其余账号会被一起收敛。
        </p>

        <div className="button-row">
          <button
            className="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await createAccount();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "创建账号失败。");
                }
              })
            }
          >
            {pending ? "处理中..." : "新增账号"}
          </button>
        </div>

        {message ? (
          <p className="helper-text" style={{ marginTop: "0.8rem" }}>
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}
