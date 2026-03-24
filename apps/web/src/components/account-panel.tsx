"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountStatusView } from "@zhihu-mvp/shared";
import { useState, useTransition } from "react";
import { fetchClientResponse, getClientApiBaseUrl } from "../lib/http";
import { StatusChip } from "./status-chip";

type AccountPanelProps = {
  account: AccountStatusView | null;
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

export function AccountPanel({ account }: AccountPanelProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  if (!account) {
    return <p className="muted">还没有账号信息。</p>;
  }

  const currentAccount = account;

  async function call<T>(path: string, body: unknown) {
    const { response, text, payload } = await fetchClientResponse(path, {
      method: "POST",
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

  async function startManualLogin(publishJobId?: number) {
    const payload = await call<ManualLoginStartResponse>("/account/manual-login/start", {
      accountId: currentAccount.id,
      ...(publishJobId ? { publishJobId } : {})
    });

    router.refresh();

    const browserMode = payload.browserMode ?? "浏览器";
    const loginUrl = payload.loginUrl ?? "https://www.zhihu.com/signin";
    setMessage(
      `${browserMode} 登录窗口已打开。请在同一个 Profile 里完成知乎登录，然后点击“登录成功，继续下一步”。如果打开的是空白页，可以直接在地址栏粘贴：${loginUrl}`
    );
  }

  async function confirmRecovery(publishJobId?: number) {
    const payload = await call<RecoveryResponse>("/account/recovery/confirm", {
      accountId: currentAccount.id,
      ...(publishJobId ? { publishJobId } : {})
    });

    router.refresh();

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
