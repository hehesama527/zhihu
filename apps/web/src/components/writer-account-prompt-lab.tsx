"use client";

import type { AccountListItem, PromptSetView, PromptVersionSummary } from "@zhihu-mvp/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { fetchClientResponse, getClientApiBaseUrl } from "../lib/http";
import {
  buildEffectiveWriterPrompt,
  buildWriterPromptSuffixPreview,
  formatPromptVersion,
  getActiveWriterPromptVersion,
  getBoundWriterPromptVersion,
  getEffectiveWriterPromptVersion,
  summarizePrompt
} from "../lib/writer-prompt-preview";

type WriterAccountPromptLabProps = {
  accounts: AccountListItem[];
  writerPromptSet: PromptSetView | null;
};

export function WriterAccountPromptLab({ accounts, writerPromptSet }: WriterAccountPromptLabProps) {
  const router = useRouter();
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(accounts[0]?.id ?? null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [result, setResult] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!accounts.length) {
      setSelectedAccountId(null);
      return;
    }

    if (!accounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(accounts[0]?.id ?? null);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null,
    [accounts, selectedAccountId]
  );
  const activeWriterVersion = useMemo(() => getActiveWriterPromptVersion(writerPromptSet), [writerPromptSet]);
  const boundWriterVersion = useMemo(
    () => getBoundWriterPromptVersion(selectedAccount, writerPromptSet),
    [selectedAccount, writerPromptSet]
  );
  const effectiveWriterVersion = useMemo(
    () => getEffectiveWriterPromptVersion(selectedAccount, writerPromptSet),
    [selectedAccount, writerPromptSet]
  );
  const runtimeSuffix = useMemo(() => buildWriterPromptSuffixPreview(selectedAccount), [selectedAccount]);

  useEffect(() => {
    if (!selectedAccount) {
      setDraftLabel("");
      setDraftNotes("");
      setDraftContent("");
      return;
    }

    const sourceVersion = effectiveWriterVersion;
    setDraftLabel(buildAccountDraftLabel(selectedAccount, sourceVersion, selectedAccount.writerPromptVersionId != null));
    setDraftNotes(buildAccountDraftNotes(selectedAccount, sourceVersion, selectedAccount.writerPromptVersionId != null));
    setDraftContent(sourceVersion?.content ?? writerPromptSet?.activeContent ?? "");
  }, [
    selectedAccount,
    effectiveWriterVersion,
    writerPromptSet?.activeContent,
    writerPromptSet?.activeVersionId
  ]);

  const boundVersionMissing = Boolean(selectedAccount?.writerPromptVersionId && !boundWriterVersion);
  const canUpdateBoundDraft = Boolean(
    selectedAccount?.writerPromptVersionId &&
      boundWriterVersion &&
      boundWriterVersion.id === selectedAccount.writerPromptVersionId &&
      boundWriterVersion.status === "draft"
  );

  async function runRequest<T>(path: string, options?: RequestInit) {
    const { response, text, payload } = await fetchClientResponse(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options?.headers ?? {})
      }
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

  if (!writerPromptSet) {
    return (
      <section className="stack">
        <div className="card">
          <div className="stack stack--tight">
            <h3>账号级 Writer Prompt</h3>
            <p className="muted">还没有可用的 Writer Prompt 版本，暂时无法按人查看或微调。</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="card">
        <div className="stack stack--tight">
          <h3>账号级 Writer Prompt</h3>
          <p className="muted">
            这里按人查看当前生效的写作 Prompt。你可以从当前版本复制出一个账号专属草稿，微调后直接绑定到这个人。
          </p>
          <p className="muted">
            当前前端请求的 API：{getClientApiBaseUrl()}。只有之后新建的 job 会使用新的账号 Prompt，已创建的 job 仍会继续使用自己的快照。
          </p>
        </div>
      </div>

      {accounts.length ? (
        <div className="persona-prompt-layout">
          <aside className="persona-account-list">
            {accounts.map((account) => {
              const version = getEffectiveWriterPromptVersion(account, writerPromptSet);
              const isActive = account.id === selectedAccount?.id;
              const bindingMode = account.writerPromptVersionId ? "账号专属" : "跟随全局";
              const previewText = buildEffectiveWriterPrompt(version?.content ?? "", account);

              return (
                <button
                  key={account.id}
                  className={`persona-account-card ${isActive ? "persona-account-card--active" : ""}`}
                  onClick={() => {
                    setSelectedAccountId(account.id);
                    setResult("");
                  }}
                >
                  <div className="card-header">
                    <strong>{account.name}</strong>
                    <span className={`mini-badge ${account.writerPromptVersionId ? "mini-badge--accent" : ""}`}>
                      {bindingMode}
                    </span>
                  </div>
                  <small>{account.zhihuUserName ?? "未填写知乎账号名"}</small>
                  <p className="muted">{formatPromptVersion(version)}</p>
                  <p className="persona-account-card__snippet">{summarizePrompt(previewText)}</p>
                </button>
              );
            })}
          </aside>

          <div className="stack">
            <div className="card">
              <div className="card-header">
                <div>
                  <h3>{selectedAccount?.name ?? "请选择账号"}</h3>
                  <p className="muted">
                    当前绑定：
                    {selectedAccount?.writerPromptVersionId
                      ? `账号专属版本 #${selectedAccount.writerPromptVersionId}`
                      : "跟随全局 active Writer Prompt"}
                  </p>
                  <p className="muted">当前解析结果：{formatPromptVersion(effectiveWriterVersion)}</p>
                </div>
              </div>

              {boundVersionMissing ? (
                <div className="card" style={{ marginTop: "1rem", borderColor: "rgba(168, 75, 47, 0.24)" }}>
                  <div className="stack stack--tight">
                    <strong>账号绑定版本不存在</strong>
                    <p className="helper-text">
                      这个账号当前绑定的是版本 #{selectedAccount?.writerPromptVersionId}，但版本库里找不到它。下面的编辑器先回退展示全局 active 版本，建议你重新保存一版账号专属草稿并绑定。
                    </p>
                  </div>
                </div>
              ) : null}

              {!canUpdateBoundDraft && selectedAccount?.writerPromptVersionId ? (
                <p className="helper-text" style={{ marginTop: "0.8rem" }}>
                  当前绑定的不是草稿版本，不能直接覆盖编辑。想微调时请使用“另存为账号专属草稿并绑定”，这样不会破坏已有版本记录。
                </p>
              ) : null}

              <div className="grid grid--two" style={{ marginTop: "1rem" }}>
                <label className="field">
                  <span>草稿标签</span>
                  <input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} />
                </label>

                <label className="field">
                  <span>备注</span>
                  <input value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
                </label>
              </div>

              <label className="field">
                <span>这个人的 Writer Prompt 基线内容</span>
                <textarea rows={18} value={draftContent} onChange={(event) => setDraftContent(event.target.value)} />
              </label>

              <div className="button-row">
                <button
                  className="button"
                  disabled={pending || !selectedAccount || !draftLabel.trim() || !draftContent.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      if (!selectedAccount) {
                        return;
                      }

                      try {
                        const draft = await runRequest<{ promptVersionId: number }>(`/prompt-sets/writer_agent/drafts`, {
                          method: "POST",
                          body: JSON.stringify({
                            label: draftLabel.trim(),
                            notes: draftNotes.trim(),
                            content: draftContent
                          })
                        });

                        await runRequest<{ ok: true }>(`/accounts/${selectedAccount.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            writerPromptVersionId: draft.promptVersionId
                          })
                        });

                        router.refresh();
                        setResult(
                          `已为 ${selectedAccount.name} 创建账号专属 Writer Prompt 草稿，并绑定到版本 #${draft.promptVersionId}。`
                        );
                      } catch (error) {
                        setResult(error instanceof Error ? error.message : "保存账号专属 Prompt 失败。");
                      }
                    })
                  }
                >
                  {pending ? "处理中..." : "另存为账号专属草稿并绑定"}
                </button>

                <button
                  className="button button--ghost"
                  disabled={pending || !selectedAccount || !canUpdateBoundDraft}
                  onClick={() =>
                    startTransition(async () => {
                      if (!selectedAccount?.writerPromptVersionId) {
                        return;
                      }

                      try {
                        await runRequest<{ ok: true }>(`/prompt-versions/${selectedAccount.writerPromptVersionId}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            label: draftLabel.trim(),
                            notes: draftNotes.trim(),
                            content: draftContent
                          })
                        });

                        router.refresh();
                        setResult(`已更新 ${selectedAccount.name} 当前绑定的 Writer Prompt 草稿。`);
                      } catch (error) {
                        setResult(error instanceof Error ? error.message : "更新账号专属草稿失败。");
                      }
                    })
                  }
                >
                  更新当前绑定草稿
                </button>

                <button
                  className="button button--ghost"
                  disabled={pending || !selectedAccount?.writerPromptVersionId}
                  onClick={() =>
                    startTransition(async () => {
                      if (!selectedAccount) {
                        return;
                      }

                      try {
                        await runRequest<{ ok: true }>(`/accounts/${selectedAccount.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            writerPromptVersionId: null
                          })
                        });

                        router.refresh();
                        setResult(`已将 ${selectedAccount.name} 改回跟随全局 active Writer Prompt。`);
                      } catch (error) {
                        setResult(error instanceof Error ? error.message : "切回全局 Prompt 失败。");
                      }
                    })
                  }
                >
                  改回跟随全局
                </button>
              </div>
            </div>

            <div className="prompt-preview-grid">
              <div className="card">
                <div className="stack stack--tight">
                  <h4>运行时补充上下文</h4>
                  <p className="muted">这段内容会在真正调用模型时拼接到 Writer Prompt 后面，用来告诉模型当前是哪个人设在写。</p>
                </div>
                <pre className="prompt-preview-shell">{runtimeSuffix ?? "当前账号没有额外的人设补充上下文。"}</pre>
              </div>

              <div className="card">
                <div className="stack stack--tight">
                  <h4>模型实际看到的完整 Prompt</h4>
                  <p className="muted">右侧预览会实时反映你在编辑器里做的微调，方便你确认这个人最终会收到什么 Prompt。</p>
                </div>
                <pre className="prompt-preview-shell">
                  {buildEffectiveWriterPrompt(draftContent, selectedAccount) || "暂无 Prompt 内容"}
                </pre>
              </div>
            </div>

            <div className="card">
              <h4>执行反馈</h4>
              <pre>{result || "这里会显示账号专属 Prompt 的创建、绑定、更新结果。"}</pre>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="muted">还没有账号，先去账号页创建至少一个人设账号后再做 Prompt 微调。</p>
        </div>
      )}
    </section>
  );
}

function buildAccountDraftLabel(
  account: AccountListItem,
  sourceVersion: PromptVersionSummary | null,
  hasDedicatedBinding: boolean
) {
  if (hasDedicatedBinding && sourceVersion) {
    return sourceVersion.label;
  }

  const versionTag = sourceVersion ? `v${sourceVersion.version}` : "当前版本";
  return `${account.name} 专属 Writer Prompt（基于 ${versionTag}）`;
}

function buildAccountDraftNotes(
  account: AccountListItem,
  sourceVersion: PromptVersionSummary | null,
  hasDedicatedBinding: boolean
) {
  if (hasDedicatedBinding && sourceVersion) {
    return sourceVersion.notes;
  }

  const baseLabel = sourceVersion ? `基于 ${sourceVersion.label}` : "基于当前生效版本";
  return `${account.name} 的账号专属微调稿，${baseLabel}。`;
}
