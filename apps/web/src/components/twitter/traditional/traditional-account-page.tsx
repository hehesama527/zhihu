"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type {
  SaveTwitterAccountSoulInput,
  TwitterAccount,
  TwitterAccountSoulDocument
} from "../../../lib/twitter/api";
import {
  getTwitterTraditionalAccountSoul,
  getTwitterTraditionalAccounts,
  saveTwitterTraditionalAccountSoul
} from "../../../lib/twitter/traditional-api";
import { StatusChip } from "../../status-chip";

type FeedbackState =
  | {
      tone: "success" | "error";
      text: string;
    }
  | null;

type SoulFormState = {
  coreIdentity: string;
  targetReader: string;
  voiceTraitsText: string;
  worldviewText: string;
  proofAnchorsText: string;
  signatureMovesText: string;
  productMentionPolicyText: string;
  hardBoundariesText: string;
  tabooLexiconText: string;
  exemplarLinesText: string;
  updateReason: string;
};

const DEFAULT_SOUL_FORM: SoulFormState = {
  coreIdentity: "",
  targetReader: "",
  voiceTraitsText: "",
  worldviewText: "",
  proofAnchorsText: "",
  signatureMovesText: "",
  productMentionPolicyText: "",
  hardBoundariesText: "",
  tabooLexiconText: "",
  exemplarLinesText: "",
  updateReason: "manual_edit"
};

export function TraditionalAccountPage() {
  const [accounts, setAccounts] = useState<TwitterAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [soulDocument, setSoulDocument] = useState<TwitterAccountSoulDocument | null>(null);
  const [soulForm, setSoulForm] = useState<SoulFormState>(DEFAULT_SOUL_FORM);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [soulLoading, setSoulLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [pending, startTransition] = useTransition();

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;
  const persistedSoulForm = buildSoulForm(soulDocument);
  const hasUnsavedChanges = JSON.stringify(persistedSoulForm) !== JSON.stringify(soulForm);
  const soulPreviewMarkdown = buildSoulPreviewMarkdown(selectedAccount, soulForm);

  useEffect(() => {
    void loadAccounts();
  }, []);

  useEffect(() => {
    if (!selectedAccountId) {
      setSoulDocument(null);
      setSoulForm({ ...DEFAULT_SOUL_FORM });
      setSoulLoading(false);
      return;
    }

    let cancelled = false;
    setSoulLoading(true);

    void getTwitterTraditionalAccountSoul(selectedAccountId)
      .then((document) => {
        if (cancelled) {
          return;
        }

        setSoulDocument(document);
        setSoulForm(buildSoulForm(document));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSoulDocument(null);
        setSoulForm({ ...DEFAULT_SOUL_FORM });
        setFeedback({
          tone: "error",
          text: buildErrorMessage(error, "加载账户定位失败，请稍后重试。")
        });
      })
      .finally(() => {
        if (!cancelled) {
          setSoulLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  async function loadAccounts(preferredAccountId?: string | null) {
    setAccountsLoading(true);

    try {
      const loadedAccounts = await getTwitterTraditionalAccounts();
      const nextSelectedAccountId = pickSelectedAccountId(
        loadedAccounts,
        preferredAccountId ?? selectedAccountId
      );

      setAccounts(loadedAccounts);
      setSelectedAccountId(nextSelectedAccountId);

      if (!nextSelectedAccountId) {
        setSoulDocument(null);
        setSoulForm({ ...DEFAULT_SOUL_FORM });
      }
    } catch (error) {
      setFeedback({
        tone: "error",
        text: buildErrorMessage(error, "加载传统链路账户列表失败。")
      });
    } finally {
      setAccountsLoading(false);
    }
  }

  function updateSoulForm<K extends keyof SoulFormState>(key: K, value: SoulFormState[K]) {
    setSoulForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function runAction(action: () => Promise<void>) {
    setFeedback(null);
    startTransition(() => {
      void action().catch((error) => {
        setFeedback({
          tone: "error",
          text: buildErrorMessage(error, "账户定位操作失败，请检查后重试。")
        });
      });
    });
  }

  function handleSaveSoul() {
    runAction(async () => {
      if (!selectedAccountId || !selectedAccount) {
        return;
      }

      const nextDocument = await saveTwitterTraditionalAccountSoul(
        selectedAccountId,
        buildSoulInput(soulForm)
      );

      setSoulDocument(nextDocument);
      setSoulForm(buildSoulForm(nextDocument));
      setFeedback({
        tone: "success",
        text: `已保存 @${selectedAccount.handle} 的账户定位，当前 Soul 版本 v${nextDocument.version}。`
      });
    });
  }

  function handleResetSoul() {
    setSoulForm(buildSoulForm(soulDocument));
    setFeedback(null);
  }

  return (
    <div className="stack">
      <section className="page-header">
        <div className="stack stack--tight">
          <div className="inline-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <span className="mini-badge mini-badge--accent">X Traditional</span>
            <span className="mini-badge">账户定位</span>
            <span className="mini-badge">{accounts.length} 个账户</span>
          </div>
          <div>
            <h2>账户定位</h2>
            <p className="muted">
              把这个账号是谁、写给谁、如何表达、哪些话不能说固定下来，让传统链路的
              写作 / 审核环节使用同一份账户底稿。
            </p>
          </div>
        </div>

        <div className="button-row">
          <Link className="button button--ghost" href="/twitter/traditional">
            返回传统工作台
          </Link>
          <Link className="button button--ghost" href="/twitter/account">
            打开账户基础配置
          </Link>
          <button
            className="button"
            disabled={pending || accountsLoading}
            onClick={() => runAction(() => loadAccounts(selectedAccountId))}
          >
            {pending || accountsLoading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </section>

      {feedback ? (
        <div className="card" style={{ padding: "1rem" }}>
          <div className="inline-row" style={{ alignItems: "flex-start" }}>
            <span className={`mini-badge ${feedback.tone === "error" ? "mini-badge--accent" : ""}`}>
              {feedback.tone === "error" ? "处理失败" : "已更新"}
            </span>
            <p className="helper-text" style={{ margin: 0 }}>
              {feedback.text}
            </p>
          </div>
        </div>
      ) : null}

      <section className="grid grid--two" style={{ alignItems: "start" }}>
        <article className="card" style={{ gridColumn: "span 2" }}>
          <div className="stack">
            <div className="card-header">
              <div>
                <h3>账户列表</h3>
                <p className="muted">选择一个传统链路账号，查看当前定位摘要并维护 Soul。</p>
              </div>
              <span className="mini-badge">{accounts.length} 个账户</span>
            </div>

            <div className="stack" style={{ gap: "0.75rem" }}>
              <div className="field">
                <input
                  type="text"
                  placeholder="搜索账户名称或标识..."
                  disabled={accountsLoading || accounts.length === 0}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="account-list" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {accountsLoading ? (
                  <div className="empty-state" style={{ padding: "2rem 0" }}>
                    <p className="muted">正在加载账户...</p>
                  </div>
                ) : accounts.length ? (
                  accounts.map((account) => {
                    const isActive = account.id === selectedAccountId;

                    return (
                      <button
                        key={account.id}
                        className={`account-card ${isActive ? "account-card--active" : ""}`}
                        disabled={pending}
                        onClick={() => {
                          setFeedback(null);
                          setSelectedAccountId(account.id);
                        }}
                        style={{
                          textAlign: "left",
                          padding: "1rem",
                          transition: "all 0.2s ease"
                        }}
                      >
                        <div className="inline-row" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
                          <strong style={{ fontSize: "0.95rem" }}>
                            {account.name || `@${account.handle}`}
                          </strong>
                          <div className="inline-row" style={{ gap: "0.5rem" }}>
                            <StatusChip status={account.status} />
                            <StatusChip status={account.authStatus ?? "unknown"} />
                          </div>
                        </div>
                        <small className="muted" style={{ display: "block", marginBottom: "0.5rem" }}>
                          @{account.handle}
                        </small>
                        <p className="account-card__snippet" style={{ margin: "0 0 0.75rem 0" }}>
                          {trimText(
                            account.persona ||
                              account.targetAudience ||
                              account.manualNotes ||
                              "还没有补充定位摘要。"
                          )}
                        </p>
                        <div
                          className="inline-row"
                          style={{ justifyContent: "space-between", paddingTop: "0.5rem", borderTop: "1px solid rgba(0,0,0,0.05)" }}
                        >
                          <span className="helper-text">
                            📝 {formatTime(account.lastPublishedAt)}
                          </span>
                          <span className="helper-text">
                            🎯 {account.learningTargets.length || 0} 个参考
                          </span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="empty-state" style={{ padding: "2rem 0" }}>
                    <p>传统链路还没有可用账户。</p>
                    <p className="muted">
                      先到{" "}
                      <Link href="/twitter/account">
                        <span style={{ textDecoration: "underline" }}>账户基础配置</span>
                      </Link>{" "}
                      页创建账户，再回来补充定位与 Soul。
                    </p>
                  </div>
                )}
              </div>
            </div>

            {accounts.length > 0 && (
              <div style={{ marginTop: "auto", paddingTop: "1rem", borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                <p className="helper-text" style={{ margin: 0 }}>
                  💡 提示：点击账户卡片可切换查看不同账户的定位与 Soul 配置。
                </p>
              </div>
            )}
          </div>
        </article>

        <div className="stack" style={{ gridColumn: "span 2" }}>
          {selectedAccount ? (
            <>
              <article className="card">
                <div className="card-header">
                  <div>
                    <h3>定位摘要</h3>
                    <p className="muted">
                      这里展示传统链路已经绑定的账户基础信息。若要修改账号基础档案，请到“账户基础配置”页。
                    </p>
                  </div>
                  <div className="inline-row" style={{ gap: "0.5rem" }}>
                    <StatusChip status={selectedAccount.status} />
                    <StatusChip status={selectedAccount.authStatus ?? "unknown"} />
                  </div>
                </div>

                <div className="grid grid--two" style={{ gap: "0.75rem" }}>
                  <div className="card" style={{ padding: "1rem" }}>
                    <div className="stack" style={{ gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.9rem", color: "var(--text-primary)" }}>📌 账号角色</strong>
                      <div className="stack" style={{ gap: "0.25rem" }}>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>名称：</span>{selectedAccount.name || `@${selectedAccount.handle}`}
                        </p>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>账号标识：</span>@{selectedAccount.handle}
                        </p>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>最近发文：</span>{formatTime(selectedAccount.lastPublishedAt)}
                        </p>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>最近校验登录：</span>{formatTime(selectedAccount.authCheckedAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ padding: "1rem" }}>
                    <div className="stack" style={{ gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.9rem", color: "var(--text-primary)" }}>🎯 内容定位</strong>
                      <div className="stack" style={{ gap: "0.25rem" }}>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>账号身份：</span>{selectedAccount.persona || "未设置"}
                        </p>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>核心受众：</span>{selectedAccount.targetAudience || "未设置"}
                        </p>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>风格约束：</span>{selectedAccount.styleGuide || "未设置"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ padding: "1rem" }}>
                    <div className="stack" style={{ gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.9rem", color: "var(--text-primary)" }}>📚 学习对象与运营备注</strong>
                      <div className="stack" style={{ gap: "0.25rem" }}>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>风格参考：</span>{formatList(selectedAccount.learningTargets, "未设置")}
                        </p>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>运营备注：</span>{selectedAccount.manualNotes || "未设置"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ padding: "1rem" }}>
                    <div className="stack" style={{ gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.9rem", color: "var(--text-primary)" }}>⚙️ 执行上下文</strong>
                      <div className="stack" style={{ gap: "0.25rem" }}>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>浏览器配置目录：</span>{selectedAccount.profileDir || "自动生成"}
                        </p>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>代理地址：</span>{selectedAccount.proxyUrl || "未设置"}
                        </p>
                        <p className="helper-text" style={{ margin: 0 }}>
                          <span style={{ opacity: 0.7 }}>登录说明：</span>{selectedAccount.authStatusReason || "暂无额外说明"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </article>

              <article className="card">
                <div className="card-header">
                  <div className="stack" style={{ gap: "0.5rem" }}>
                    <div className="inline-row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
                      <h3 style={{ margin: 0 }}>账户 Soul</h3>
                      <div className="inline-row" style={{ gap: "0.5rem" }}>
                        <StatusChip status={selectedAccount.status} />
                        <StatusChip status={selectedAccount.authStatus ?? "unknown"} />
                      </div>
                    </div>
                    <p className="muted">
                      Soul 是传统链路账户级的表达底稿。它会影响写作、复核和后续账户级资产生成。
                    </p>
                  </div>
                  <div className="stack stack--tight" style={{ alignItems: "flex-end" }}>
                    <span className={`mini-badge ${hasUnsavedChanges ? "mini-badge--accent" : ""}`}>
                      {hasUnsavedChanges ? "有未保存修改" : "已与保存版本一致"}
                    </span>
                    <span className="helper-text">
                      {soulLoading
                        ? "正在加载 Soul..."
                        : soulDocument
                          ? `版本 v${soulDocument.version} · 更新于 ${formatTime(
                              soulDocument.lastUpdatedAt
                            )} · ${soulDocument.updatedBy === "user" ? "人工更新" : "系统更新"}`
                          : "还没有 Soul 文档，保存后会生成第一版。"}
                    </span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "1rem", alignItems: "start" }}>
                  <div className="stack">
                    <label className="field">
                      <span>核心身份</span>
                      <textarea
                        rows={4}
                        value={soulForm.coreIdentity}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("coreIdentity", event.target.value)}
                        placeholder="这个账号站在什么位置说话，最想被理解成谁。"
                      />
                    </label>

                    <label className="field">
                      <span>核心读者</span>
                      <textarea
                        rows={3}
                        value={soulForm.targetReader}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("targetReader", event.target.value)}
                        placeholder="这个账号主要写给谁看，他们通常在什么情境下会打开这类内容。"
                      />
                    </label>

                    <label className="field">
                      <span>语气特征</span>
                      <textarea
                        rows={5}
                        value={soulForm.voiceTraitsText}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("voiceTraitsText", event.target.value)}
                        placeholder="每行一条，例如：先给判断，再补理由。"
                      />
                    </label>

                    <label className="field">
                      <span>观察框架</span>
                      <textarea
                        rows={5}
                        value={soulForm.worldviewText}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("worldviewText", event.target.value)}
                        placeholder="每行一条，例如：只写自己能承担的判断。"
                      />
                    </label>

                    <label className="field">
                      <span>可信锚点</span>
                      <textarea
                        rows={4}
                        value={soulForm.proofAnchorsText}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("proofAnchorsText", event.target.value)}
                        placeholder="每行一条，说明这个账号凭什么这样说。"
                      />
                    </label>

                    <label className="field">
                      <span>惯用动作</span>
                      <textarea
                        rows={4}
                        value={soulForm.signatureMovesText}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("signatureMovesText", event.target.value)}
                        placeholder="每行一条，例如：先拆误区，再给自己的做法。"
                      />
                    </label>

                    <label className="field">
                      <span>产品提及规则</span>
                      <textarea
                        rows={4}
                        value={soulForm.productMentionPolicyText}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("productMentionPolicyText", event.target.value)}
                        placeholder="每行一条，约束什么时候可以提产品、如何提得自然。"
                      />
                    </label>

                    <label className="field">
                      <span>硬边界</span>
                      <textarea
                        rows={4}
                        value={soulForm.hardBoundariesText}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("hardBoundariesText", event.target.value)}
                        placeholder="每行一条，明确哪些话绝对不能说。"
                      />
                    </label>

                    <label className="field">
                      <span>禁用词与禁用说法</span>
                      <textarea
                        rows={4}
                        value={soulForm.tabooLexiconText}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("tabooLexiconText", event.target.value)}
                        placeholder="每行一条，列出不该出现的词、句式或腔调。"
                      />
                    </label>

                    <label className="field">
                      <span>参考句式</span>
                      <textarea
                        rows={5}
                        value={soulForm.exemplarLinesText}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("exemplarLinesText", event.target.value)}
                        placeholder="每行一条，只做风格参照，不做原样复用。"
                      />
                    </label>

                    <label className="field">
                      <span>更新原因</span>
                      <input
                        value={soulForm.updateReason}
                        disabled={soulLoading}
                        onChange={(event) => updateSoulForm("updateReason", event.target.value)}
                        placeholder="manual_edit"
                      />
                    </label>

                    <div className="button-row">
                      <button
                        className="button"
                        disabled={pending || soulLoading}
                        onClick={handleSaveSoul}
                      >
                        {pending ? "保存中..." : "保存 Soul"}
                      </button>
                      <button
                        className="button button--ghost"
                        disabled={pending || soulLoading || !hasUnsavedChanges}
                        onClick={handleResetSoul}
                      >
                        恢复为已保存版本
                      </button>
                    </div>
                  </div>

                  <div className="stack">
                    <div className="card" style={{ padding: "1rem" }}>
                      <div className="stack stack--tight">
                        <strong>Markdown 预览</strong>
                        <p className="helper-text" style={{ margin: 0 }}>
                          右侧预览会随表单实时变化，保存后会作为传统链路账户级 Soul 文档供
                          写作 / 审核环节读取。
                        </p>
                      </div>
                    </div>

                    <textarea
                      className="twitter-editor"
                      rows={28}
                      readOnly
                      value={soulPreviewMarkdown}
                    />

                    {soulDocument ? (
                      <details>
                        <summary>查看最近一次已保存的 Markdown</summary>
                        <textarea
                          className="twitter-editor"
                          rows={18}
                          readOnly
                          style={{ marginTop: "1rem" }}
                          value={soulDocument.markdown}
                        />
                      </details>
                    ) : null}
                  </div>
                </div>
              </article>
            </>
          ) : (
            <section className="card empty-state">
              <p>先选择一个账户，再维护它的定位与 Soul。</p>
              <p className="muted">当前页只拆分传统链路的账户定位切片，不会改动旧工作台里的其他能力。</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function pickSelectedAccountId(accounts: TwitterAccount[], preferredAccountId?: string | null) {
  if (preferredAccountId && accounts.some((account) => account.id === preferredAccountId)) {
    return preferredAccountId;
  }

  return accounts[0]?.id ?? null;
}

function buildSoulForm(document: TwitterAccountSoulDocument | null): SoulFormState {
  if (!document) {
    return { ...DEFAULT_SOUL_FORM };
  }

  return {
    coreIdentity: document.coreIdentity,
    targetReader: document.targetReader,
    voiceTraitsText: joinLineList(document.voiceTraits),
    worldviewText: joinLineList(document.worldview),
    proofAnchorsText: joinLineList(document.proofAnchors),
    signatureMovesText: joinLineList(document.signatureMoves),
    productMentionPolicyText: joinLineList(document.productMentionPolicy),
    hardBoundariesText: joinLineList(document.hardBoundaries),
    tabooLexiconText: joinLineList(document.tabooLexicon),
    exemplarLinesText: joinLineList(document.exemplarLines),
    updateReason: document.updateReason || "manual_edit"
  };
}

function buildSoulInput(form: SoulFormState): SaveTwitterAccountSoulInput {
  return {
    coreIdentity: form.coreIdentity.trim(),
    targetReader: form.targetReader.trim(),
    voiceTraits: splitLineList(form.voiceTraitsText),
    worldview: splitLineList(form.worldviewText),
    proofAnchors: splitLineList(form.proofAnchorsText),
    signatureMoves: splitLineList(form.signatureMovesText),
    productMentionPolicy: splitLineList(form.productMentionPolicyText),
    hardBoundaries: splitLineList(form.hardBoundariesText),
    tabooLexicon: splitLineList(form.tabooLexiconText),
    exemplarLines: splitLineList(form.exemplarLinesText),
    updateReason: form.updateReason.trim() || "manual_edit"
  };
}

function buildSoulPreviewMarkdown(account: TwitterAccount | null, form: SoulFormState) {
  return [
    "# 账户 Soul",
    "",
    `- 账户 ID: ${account?.id ?? "preview"}`,
    `- 账号标识: ${account ? `@${account.handle}` : "@preview"}`,
    "- 版本: draft",
    `- 更新原因: ${form.updateReason.trim() || "manual_edit"}`,
    "",
    renderSoulTextSection("核心身份", form.coreIdentity),
    renderSoulTextSection("目标读者", form.targetReader),
    renderSoulListSection("语气特征", splitLineList(form.voiceTraitsText)),
    renderSoulListSection("观察框架", splitLineList(form.worldviewText)),
    renderSoulListSection("可信锚点", splitLineList(form.proofAnchorsText)),
    renderSoulListSection("惯用动作", splitLineList(form.signatureMovesText)),
    renderSoulListSection(
      "产品提及规则",
      splitLineList(form.productMentionPolicyText)
    ),
    renderSoulListSection("硬边界", splitLineList(form.hardBoundariesText)),
    renderSoulListSection("禁用词与禁用说法", splitLineList(form.tabooLexiconText)),
    renderSoulListSection("参考句式", splitLineList(form.exemplarLinesText))
  ].join("\n");
}

function renderSoulTextSection(title: string, value: string) {
  return [`## ${title}`, "", value.trim() || "未设置", ""].join("\n");
}

function renderSoulListSection(title: string, values: string[]) {
  return [`## ${title}`, "", ...(values.length ? values.map((item) => `- ${item}`) : ["- 未设置"]), ""].join(
    "\n"
  );
}

function splitLineList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLineList(values: string[]) {
  return values.join("\n");
}

function buildErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatTime(value: string | null) {
  if (!value) {
    return "暂无";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN");
}

function formatList(values: string[], fallback: string) {
  return values.length ? values.join(" / ") : fallback;
}

function trimText(value: string, maxLength = 120) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}
