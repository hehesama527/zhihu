"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountStatusView, PromptSetView } from "@zhihu-mvp/shared";
import { useEffect, useState, useTransition } from "react";
import { fetchClientResponse, getClientApiBaseUrl } from "../lib/http";
import { AccountSoulPanel } from "./account-soul-panel";
import { StatusChip } from "./status-chip";
import { ZhihuNoteAgentPanel } from "./zhihu-note-agent-panel";

type AccountPanelProps = {
  account: AccountStatusView | null;
  writerPromptSet: PromptSetView | null;
};

type RecoveryResponse = {
  ok?: boolean;
  blockedByLogin?: boolean;
  message?: string | null;
  resumedByWorker?: boolean;
  summary?: {
    blockedByLogin?: boolean;
    message?: string | null;
  } | null;
};

type ManualLoginStartResponse = {
  browserMode?: string | null;
  loginUrl?: string | null;
  preservedExistingPage?: boolean;
  message?: string | null;
};

export function AccountPanel({ account, writerPromptSet }: AccountPanelProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [draftName, setDraftName] = useState(account?.name ?? "");
  const [draftZhihuUserName, setDraftZhihuUserName] = useState(account?.zhihuUserName ?? "");
  const [draftRiskDomain, setDraftRiskDomain] = useState(account?.riskDomain ?? "");
  const [draftWriterPromptVersionId, setDraftWriterPromptVersionId] = useState<string>(
    account?.writerPromptVersionId ? String(account.writerPromptVersionId) : ""
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setDraftName(account?.name ?? "");
    setDraftZhihuUserName(account?.zhihuUserName ?? "");
    setDraftRiskDomain(account?.riskDomain ?? "");
    setDraftWriterPromptVersionId(account?.writerPromptVersionId ? String(account.writerPromptVersionId) : "");
  }, [account?.id, account?.name, account?.zhihuUserName, account?.riskDomain, account?.writerPromptVersionId]);

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
    const riskDomain = draftRiskDomain.trim();
    await call<{ ok?: boolean }>(
      `/accounts/${currentAccount.id}`,
      {
        name,
        zhihuUserName: zhihuUserName ? zhihuUserName : null,
        riskDomain: riskDomain ? riskDomain : null,
        writerPromptVersionId: draftWriterPromptVersionId ? Number(draftWriterPromptVersionId) : null
      },
      "PATCH"
    );

    router.refresh();
    setMessage("账号资料已更新。后续新建任务会自动固化当前账号绑定的写作提示词快照。");
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

    router.push(result.nextAccountId ? `/zhihu/account?accountId=${result.nextAccountId}` : "/zhihu/account");
    router.refresh();
  }

  async function startManualLogin(publishJobId?: number) {
    const payload = await call<ManualLoginStartResponse>("/account/manual-login/start", {
      accountId: currentAccount.id,
      ...(publishJobId ? { publishJobId } : {})
    });

    router.refresh();

    if (payload.preservedExistingPage) {
      setMessage(
        payload.message ??
          "系统已经保留原发布页面，请直接在那个浏览器窗口里处理安全验证或反爬挑战，不要再重复打开新的人工登录窗口。"
      );
      return;
    }

    const browserMode = payload.browserMode ?? "浏览器";
    const loginUrl = payload.loginUrl ?? "https://www.zhihu.com/signin";
    setMessage(
      payload.message ??
        `${browserMode} 登录窗口已打开。请在同一个浏览器档案里完成知乎登录，登录成功后先手动关闭这个窗口，等 2 到 3 秒再点击“登录成功，继续下一步”。为避免刚登录的会话丢失，系统不会再强制关闭浏览器。如果打开的是空白页，可以直接在地址栏粘贴：${loginUrl}`
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

    if (payload.resumedByWorker === false) {
      setMessage(
        payload.message ??
          "系统已记录你的人工处理结果。为避免关闭原页面，任务会在下一轮执行器继续推进；如果当前没有常驻执行器，可以手动触发一次执行队列。"
      );
      return;
    }

    setMessage(
      payload.message ??
        (publishJobId
          ? `任务 #${publishJobId} 已恢复，系统会从登录校验或安全锚点继续执行。`
          : "账号状态已恢复，系统会继续推进阻塞中的任务。")
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
            <p className="muted">浏览器档案目录：{currentAccount.profileDir ?? "未配置"}</p>
            <p className="muted">风险域：{currentAccount.riskDomain}</p>
            <p className="muted">风险状态：{currentAccount.coolingDown ? "冷却中" : "正常"}</p>
            <p className="muted">冷却截止：{formatTime(currentAccount.cooldownUntil)}</p>
            <p className="muted">最近风控时间：{formatTime(currentAccount.lastRiskAt)}</p>
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

        {currentAccount.coolingDown ? (
          <div className="card" style={{ marginTop: "1rem", borderColor: "rgba(196, 96, 0, 0.24)" }}>
            <div className="stack stack--tight">
              <strong>当前账号处于风控冷却期</strong>
              <p className="helper-text">
                系统会在冷却结束前暂停这个账号及同风险域账号的自动调度，避免一次异常继续放大到整组账号。
              </p>
              <p className="helper-text">冷却截止：{formatTime(currentAccount.cooldownUntil)}</p>
            </div>
          </div>
        ) : null}

        {currentAccount.profileDirWarning ? (
          <div className="card" style={{ marginTop: "1rem", borderColor: "rgba(168, 75, 47, 0.24)" }}>
            <div className="stack stack--tight">
              <strong>浏览器档案目录需要留意</strong>
              <p className="helper-text">{currentAccount.profileDirWarning}</p>
              <p className="helper-text">这类账号在正式测试前最好先重新确认一次绑定关系，必要时重建档案后再重新登录。</p>
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
        <p className="helper-text">当前前端请求的接口：{getClientApiBaseUrl()}</p>

        {message ? <p className="helper-text">{message}</p> : null}
      </div>

      <div className="card">
        <div className="stack stack--tight">
          <h3>账号资料</h3>
          <p className="helper-text">账号名称继续作为测试阶段的人设名来源。写作提示词绑定则决定这个账号后续新建任务使用哪一版写作提示词。</p>
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

          <label className="field">
            <span>写作提示词版本</span>
            <select value={draftWriterPromptVersionId} onChange={(event) => setDraftWriterPromptVersionId(event.target.value)}>
              <option value="">跟随当前全局生效版本</option>
              {writerPromptSet?.versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version} / {version.label} / {formatPromptVersionStatus(version.status)}
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
                ? ` 跟随全局生效版本：v${activeWriterPrompt.version} / ${activeWriterPrompt.label}`
                : " 暂无可用写作提示词"}
          </p>
          <p className="helper-text">风险域用于把共享环境的账号归到同一组；同组里一旦出现登录异常或冷却，自动调度会整组收敛。</p>
          <p className="helper-text">注意：这个绑定只影响之后新建的任务；已创建的任务会继续使用自己的提示词快照。</p>
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

      <AccountSoulPanel account={currentAccount} />

      <ZhihuNoteAgentPanel account={currentAccount} />

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
                        <Link href={`/zhihu/jobs/${job.id}`}>{job.title ?? `任务 #${job.id}`}</Link>
                        <span className="muted">#{job.id}</span>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={job.displayStatus} />
                    </td>
                    <td>{formatTime(job.scheduledAt)}</td>
                    <td>{formatCurrentStage(job.currentStage)}</td>
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

function formatPromptVersionStatus(value: string) {
  const map: Record<string, string> = {
    draft: "草稿",
    active: "生效中",
    archived: "已归档"
  };

  return map[value] ?? value;
}

function formatCurrentStage(value: string | null) {
  if (!value) {
    return "暂无";
  }

  const map: Record<string, string> = {
    queued: "排队中",
    topic_discovery: "选题发现",
    topic_agent: "选题代理",
    topic_review: "选题审核",
    writer: "写作代理",
    humanizing: "去 AI 味",
    review_hard_gate: "硬门槛审核",
    review_editorial: "编辑审核",
    review_publish: "发布审核",
    review_passed: "审核通过",
    login_checking: "登录检查中",
    publishing: "发布中",
    publish_verify: "发布校验",
    retry_waiting: "等待重试",
    manual_login_required: "需人工登录",
    published: "已发布",
    failed_terminal: "终态失败"
  };

  return map[value] ?? value;
}
