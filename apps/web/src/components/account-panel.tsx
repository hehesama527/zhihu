"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountStatusView, PromptSetView } from "@zhihu-mvp/shared";
import { useEffect, useState, useTransition } from "react";
import { fetchClientResponse, getClientApiBaseUrl } from "../lib/http";
import { StatusChip } from "./status-chip";

type AccountPanelProps = {
  account: AccountStatusView | null;
  writerPromptSet: PromptSetView | null;
};

type RecoveryResponse = {
  ok?: boolean;
  blockedByLogin?: boolean;
  message?: string | null;
  summary?: {
    blockedByLogin?: boolean;
    message?: string | null;
  } | null;
};

type ManualLoginStartResponse = {
  browserMode?: string | null;
  loginUrl?: string | null;
};

export function AccountPanel({ account, writerPromptSet }: AccountPanelProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [draftName, setDraftName] = useState(account?.name ?? "");
  const [draftZhihuUserName, setDraftZhihuUserName] = useState(account?.zhihuUserName ?? "");
  const [draftWriterPromptVersionId, setDraftWriterPromptVersionId] = useState<string>(
    account?.writerPromptVersionId ? String(account.writerPromptVersionId) : ""
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setDraftName(account?.name ?? "");
    setDraftZhihuUserName(account?.zhihuUserName ?? "");
    setDraftWriterPromptVersionId(account?.writerPromptVersionId ? String(account.writerPromptVersionId) : "");
  }, [account?.id, account?.name, account?.zhihuUserName, account?.writerPromptVersionId]);

  if (!account) {
    return <p className="muted">还没有账号信息。</p>;
  }

  const currentAccount = account;

  async function call<T>(path: string, body: unknown, method = "POST") {
    const { response, text, payload } = await fetchClientResponse(path, {
      method,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
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

  async function saveAccountProfile() {
    const name = draftName.trim();
    if (!name) {
      throw new Error("账号名称不能为空。");
    }

    const zhihuUserName = draftZhihuUserName.trim();
    await call<{ ok?: boolean }>(
      `/accounts/${currentAccount.id}`,
      {
        name,
        zhihuUserName: zhihuUserName ? zhihuUserName : null,
        writerPromptVersionId: draftWriterPromptVersionId ? Number(draftWriterPromptVersionId) : null
      },
      "PATCH"
    );

    router.refresh();
    setMessage("账号资料已更新。后续新建 job 会自动固化当前账号绑定的 Writer Prompt 快照。");
  }

  async function deleteCurrentAccount() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`确定删除账号“${currentAccount.name}”吗？只有空账号才能删除，这个操作不可恢复。`)
    ) {
      return;
    }

    const { response, text, payload } = await fetchClientResponse(`/accounts/${currentAccount.id}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const errorMessage =
        typeof payload.error === "object" && payload.error && "message" in payload.error
          ? String((payload.error as { message?: unknown }).message ?? "")
          : text;
      throw new Error(errorMessage || "删除账号失败。");
    }

    const result = payload as {
      ok?: boolean;
      nextAccountId?: number | null;
    };

    router.push(result.nextAccountId ? `/account?accountId=${result.nextAccountId}` : "/account");
    router.refresh();
  }

  async function startManualLogin(publishJobId?: number) {
    const payload = await call<ManualLoginStartResponse>("/account/manual-login/start", {
      accountId: currentAccount.id,
      ...(publishJobId ? { publishJobId } : {})
    });

    router.refresh();

    const browserMode = payload.browserMode ?? "浏览器";
    const loginUrl = payload.loginUrl ?? "https://www.zhihu.com/signin";
    setMessage(
      `${browserMode} 登录窗口已打开。请在同一个 Profile 里完成知乎登录，登录成功后先手动关闭这个窗口，等 2 到 3 秒再点击“登录成功，继续下一步”。为避免刚登录的会话丢失，系统不会再强制关闭浏览器。如果打开的是空白页，可以直接在地址栏粘贴：${loginUrl}`
    );
  }

  async function confirmRecovery(publishJobId?: number) {
    const payload = await call<RecoveryResponse>("/account/recovery/confirm", {
      accountId: currentAccount.id,
      ...(publishJobId ? { publishJobId } : {})
    });

    router.refresh();

    if (payload.ok === false) {
      setMessage(payload.message ?? "确认恢复失败。");
      return;
    }

    if (payload.blockedByLogin || payload.summary?.blockedByLogin) {
      setMessage(payload.message ?? payload.summary?.message ?? "系统复检后仍未检测到知乎登录态，请先手动登录。");
      return;
    }

    setMessage(
      publishJobId
        ? `任务 #${publishJobId} 已恢复，系统会从登录校验或安全锚点继续执行。`
        : "账号状态已恢复，系统会继续推进阻塞中的任务。"
    );
  }

  const selectedWriterPrompt =
    writerPromptSet?.versions.find((version) => version.id === Number(draftWriterPromptVersionId || "0")) ?? null;
  const activeWriterPrompt =
    writerPromptSet?.versions.find((version) => version.id === writerPromptSet.activeVersionId) ?? null;

  return (
    <div className="stack">
      <div className="card">
        <div className="inline-row">
          <div>
            <h2>{currentAccount.name}</h2>
            <p className="muted">知乎账号：{currentAccount.zhihuUserName ?? "未命名"}</p>
            <p className="muted">Profile 目录：{currentAccount.profileDir ?? "未配置"}</p>
            <p className="muted">最近登录检查：{formatTime(currentAccount.lastLoginCheckAt)}</p>
            <p className="muted">最近发布时间：{formatTime(currentAccount.lastPublishAt)}</p>
            <p className="muted">恢复入口：{currentAccount.returnUrl ?? "暂无"}</p>
          </div>
          <StatusChip status={currentAccount.status} />
        </div>

        {currentAccount.recoveryRequired ? (
          <div className="card" style={{ marginTop: "1rem", borderColor: "rgba(159, 107, 0, 0.28)" }}>
            <div className="stack stack--tight">
              <strong>当前需要恢复登录</strong>
              <p className="helper-text">{currentAccount.recoveryReason ?? "系统检测到账号需要重新确认登录状态。"}</p>
              <p className="helper-text">恢复后系统会先做一次真实会话检查，通过后才会继续推进任务。</p>
            </div>
          </div>
        ) : null}

        {currentAccount.profileDirWarning ? (
          <div className="card" style={{ marginTop: "1rem", borderColor: "rgba(168, 75, 47, 0.24)" }}>
            <div className="stack stack--tight">
              <strong>Profile 目录需要留意</strong>
              <p className="helper-text">{currentAccount.profileDirWarning}</p>
              <p className="helper-text">这类账号在正式测试前最好先重新确认一次绑定关系，必要时重建 Profile 后再重新登录。</p>
            </div>
          </div>
        ) : null}

        <div className="button-row" style={{ marginTop: "1rem" }}>
          <button
            className="button button--ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await startManualLogin();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "开始人工登录失败。");
                }
              })
            }
          >
            {pending ? "处理中..." : "开始人工登录"}
          </button>

          <button
            className="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await confirmRecovery();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "确认恢复失败。");
                }
              })
            }
          >
            {pending ? "处理中..." : "登录成功，继续下一步"}
          </button>
        </div>

        <p className="helper-text" style={{ marginTop: "0.8rem" }}>
          系统会优先复用已保存的登录信息，只有检测到登录失效、挑战页或风控页时，才会要求人工介入。
        </p>
        <p className="helper-text">当前前端请求的 API：{getClientApiBaseUrl()}</p>

        {message ? <p className="helper-text">{message}</p> : null}
      </div>

      <div className="card">
        <div className="stack stack--tight">
          <h3>账号资料</h3>
          <p className="helper-text">
            账号名称继续作为测试阶段的人设名来源。Writer Prompt 绑定则决定这个账号后续新建 job 使用哪一版写作
            Prompt。
          </p>
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
            <span>Writer Prompt 版本</span>
            <select value={draftWriterPromptVersionId} onChange={(event) => setDraftWriterPromptVersionId(event.target.value)}>
              <option value="">跟随当前全局生效版本</option>
              {writerPromptSet?.versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version} / {version.label} / {version.status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="stack stack--tight">
          <p className="helper-text">
            当前绑定：
            {selectedWriterPrompt
              ? ` v${selectedWriterPrompt.version} / ${selectedWriterPrompt.label}`
              : activeWriterPrompt
                ? ` 跟随全局 active：v${activeWriterPrompt.version} / ${activeWriterPrompt.label}`
                : " 暂无可用 Writer Prompt"}
          </p>
          <p className="helper-text">注意：这个绑定只影响之后新建的 job；已创建的 job 会继续使用自己的 Prompt 快照。</p>
        </div>

        <div className="button-row">
          <button
            className="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await saveAccountProfile();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "保存账号资料失败。");
                }
              })
            }
          >
            {pending ? "处理中..." : "保存账号资料"}
          </button>

          <button
            className="button button--ghost button--danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await deleteCurrentAccount();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "删除账号失败。");
                }
              })
            }
          >
            {pending ? "处理中..." : "删除当前账号"}
          </button>
        </div>

        <p className="helper-text">删除规则：只有还没有任务、题目候选和历史回答记录的空账号才允许删除。</p>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>登录阻塞中的任务</h3>
            <p className="muted">只有登录相关问题允许人工介入，恢复成功后会自动从断点继续。</p>
          </div>
        </div>

        {currentAccount.blockedJobs.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>计划时间</th>
                  <th>恢复锚点</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {currentAccount.blockedJobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="stack stack--tight">
                        <Link href={`/jobs/${job.id}`}>{job.title ?? `任务 #${job.id}`}</Link>
                        <span className="muted">#{job.id}</span>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={job.displayStatus} />
                    </td>
                    <td>{formatTime(job.scheduledAt)}</td>
                    <td>{job.currentStage ?? "暂无"}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button button--ghost"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              try {
                                await startManualLogin(job.id);
                              } catch (error) {
                                setMessage(error instanceof Error ? error.message : "开始人工登录失败。");
                              }
                            })
                          }
                        >
                          开始登录
                        </button>

                        <button
                          className="button button--ghost"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              try {
                                await confirmRecovery(job.id);
                              } catch (error) {
                                setMessage(error instanceof Error ? error.message : "任务恢复失败。");
                              }
                            })
                          }
                        >
                          登录成功，继续该任务
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">当前没有被登录阻塞的任务。</p>
        )}
      </div>
    </div>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}
