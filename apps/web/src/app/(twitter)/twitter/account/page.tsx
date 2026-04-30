"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createTwitterAccount,
  getTwitterAccountSoul,
  getTwitterAccounts,
  loginTwitterAccount,
  saveTwitterAccountSoul,
  updateTwitterAccount,
  type CreateTwitterAccountInput,
  type TwitterAccount,
  type TwitterAccountSoulDocument
} from "../../../../lib/twitter/api";
import { StatusChip } from "../../../../components/status-chip";

type AccountFormState = Omit<CreateTwitterAccountInput, "learningTargets" | "proxyUrl"> & {
  learningTargetsText: string;
  proxyUrl: string;
};

type StrategyFormState = {
  writerPromptSource: "main_agent" | "database";
  casualNote: string;
  smallInsight: string;
  pitfallLog: string;
  toolMention: string;
  industryTalk: string;
  interactiveQa: string;
  quoteRepost: string;
};

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

const DEFAULT_FORM: AccountFormState = {
  name: "",
  handle: "",
  persona: "",
  targetAudience: "",
  styleGuide: "",
  learningTargetsText: "",
  manualNotes: "",
  profileDir: "",
  proxyUrl: "http://127.0.0.1:7890",
  status: "active"
};

const DEFAULT_STRATEGY_FORM: StrategyFormState = {
  writerPromptSource: "main_agent",
  casualNote: "30",
  smallInsight: "25",
  pitfallLog: "15",
  toolMention: "15",
  industryTalk: "10",
  interactiveQa: "5",
  quoteRepost: "5"
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

export default function TwitterAccountPage() {
  const [accounts, setAccounts] = useState<TwitterAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loginStatus, setLoginStatus] = useState<"idle" | "logging" | "success" | "error">("idle");
  const [loginProfileDir, setLoginProfileDir] = useState("");
  const [loginProxyUrl, setLoginProxyUrl] = useState("http://127.0.0.1:7890");
  const [strategyForm, setStrategyForm] = useState<StrategyFormState>(DEFAULT_STRATEGY_FORM);
  const [soulDocument, setSoulDocument] = useState<TwitterAccountSoulDocument | null>(null);
  const [soulForm, setSoulForm] = useState<SoulFormState>(DEFAULT_SOUL_FORM);
  const [soulLoading, setSoulLoading] = useState(false);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;
  const databaseWriterPromptEnabled = strategyForm.writerPromptSource === "database";
  const soulPreviewMarkdown = buildSoulPreviewMarkdown(soulForm);

  useEffect(() => {
    void loadAccounts();
  }, []);

  useEffect(() => {
    setLoginProfileDir(selectedAccount?.profileDir ?? "");
    setLoginProxyUrl(selectedAccount?.proxyUrl ?? "http://127.0.0.1:7890");
    setStrategyForm(buildStrategyForm(selectedAccount));
  }, [selectedAccount?.id, selectedAccount?.profileDir, selectedAccount?.proxyUrl]);

  useEffect(() => {
    if (!selectedAccount?.id) {
      setSoulDocument(null);
      setSoulForm(DEFAULT_SOUL_FORM);
      setSoulLoading(false);
      return;
    }

    let cancelled = false;
    setSoulLoading(true);

    void getTwitterAccountSoul(selectedAccount.id)
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
        setSoulForm(DEFAULT_SOUL_FORM);
        setMessage(error instanceof Error ? error.message : "加载账号 Soul 失败");
      })
      .finally(() => {
        if (!cancelled) {
          setSoulLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAccount?.id]);

  async function loadAccounts(preferredAccountId?: string | null) {
    setLoading(true);
    try {
      const loadedAccounts = await getTwitterAccounts();
      setAccounts(loadedAccounts);
      setSelectedAccountId(pickSelectedAccountId(loadedAccounts, preferredAccountId ?? selectedAccountId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载账号列表失败");
    } finally {
      setLoading(false);
    }
  }

  function updateForm<K extends keyof AccountFormState>(key: K, value: AccountFormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateStrategyForm<K extends keyof StrategyFormState>(key: K, value: StrategyFormState[K]) {
    setStrategyForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateSoulForm<K extends keyof SoulFormState>(key: K, value: SoulFormState[K]) {
    setSoulForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function withAction(action: () => Promise<void>) {
    setMessage("");
    startTransition(async () => {
      try {
        await action();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "操作失败");
      }
    });
  }

  async function handleCreateAccount() {
    const createdAccount = await createTwitterAccount({
      name: form.name.trim(),
      handle: form.handle.trim(),
      persona: form.persona.trim(),
      targetAudience: form.targetAudience.trim(),
      styleGuide: form.styleGuide.trim(),
      learningTargets: splitTextList(form.learningTargetsText),
      manualNotes: form.manualNotes.trim(),
      profileDir: form.profileDir ? form.profileDir.trim() : undefined,
      proxyUrl: form.proxyUrl ? form.proxyUrl.trim() : null,
      status: form.status
    });

    setForm(DEFAULT_FORM);
    await loadAccounts(createdAccount.id);
    setMessage(`已创建 X 账号 @${createdAccount.handle}`);
  }

  async function handleLogin() {
    if (!selectedAccount) {
      return;
    }

    setLoginStatus("logging");
    setMessage("");

    try {
      const result = await loginTwitterAccount(selectedAccount.id, {
        profileDir: loginProfileDir || undefined,
        proxyUrl: loginProxyUrl || null
      });

      if (!result.ok) {
        throw new Error(result.error?.message || "登录失败");
      }

      if (result.sessionToken) {
        localStorage.setItem("twitter_session_token", result.sessionToken);
      }

      localStorage.setItem("twitter_last_account_id", selectedAccount.id);
      setLoginStatus("success");
      setMessage(`账号 @${selectedAccount.handle} 登录成功`);
      await loadAccounts(selectedAccount.id);
    } catch (error) {
      setLoginStatus("error");
      setMessage(error instanceof Error ? error.message : "登录失败，请重试");
    }
  }

  async function handleSaveStrategyConfig() {
    if (!selectedAccount) {
      throw new Error("请先选择一个账号。");
    }

    const updatedAccount = await updateTwitterAccount(selectedAccount.id, {
      writerPromptSource: strategyForm.writerPromptSource,
      publishStyleRatios: normalizeStrategyForm(strategyForm)
    });

    await loadAccounts(updatedAccount.id);
    setMessage("已保存 MainAgent 策略边界配置。");
  }

  async function handleSaveSoul() {
    if (!selectedAccount) {
      throw new Error("请先选择一个账号。");
    }

    const nextDocument = await saveTwitterAccountSoul(selectedAccount.id, {
      coreIdentity: soulForm.coreIdentity.trim(),
      targetReader: soulForm.targetReader.trim(),
      voiceTraits: splitLineList(soulForm.voiceTraitsText),
      worldview: splitLineList(soulForm.worldviewText),
      proofAnchors: splitLineList(soulForm.proofAnchorsText),
      signatureMoves: splitLineList(soulForm.signatureMovesText),
      productMentionPolicy: splitLineList(soulForm.productMentionPolicyText),
      hardBoundaries: splitLineList(soulForm.hardBoundariesText),
      tabooLexicon: splitLineList(soulForm.tabooLexiconText),
      exemplarLines: splitLineList(soulForm.exemplarLinesText),
      updateReason: soulForm.updateReason.trim() || "manual_edit"
    });

    setSoulDocument(nextDocument);
    setSoulForm(buildSoulForm(nextDocument));
    setMessage(`已保存账号 Soul v${nextDocument.version}`);
  }

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>账号管理</h2>
          <p className="muted">
            管理 Twitter / X 账号的基础信息、账号 Soul、MainAgent 策略边界和登录验证。
          </p>
        </div>

        <div className="button-row">
          <button className="button button--ghost" disabled={pending} onClick={() => (window.location.href = "/twitter")}>
            返回工作台
          </button>
          <button className="button button--ghost" disabled={pending} onClick={() => void loadAccounts(selectedAccountId)}>
            {pending ? "刷新中..." : "刷新"}
          </button>
        </div>
      </section>

      {message ? (
        <div className="card">
          <p className="helper-text">{message}</p>
        </div>
      ) : null}

      <div className="grid grid--two">
        <article className="card">
          <div className="stack stack--tight">
            <h3>账号列表</h3>
            <p className="muted">点击账号查看详情、Soul、策略边界和登录状态。</p>
          </div>

          <div className="account-list" style={{ marginTop: "1rem" }}>
            {loading ? (
              <p className="muted">正在加载账号...</p>
            ) : accounts.length > 0 ? (
              accounts.map((account) => (
                <button
                  key={account.id}
                  className={`account-card ${selectedAccountId === account.id ? "account-card--active" : ""}`}
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <div className="inline-row">
                    <strong>{account.name || `@${account.handle}`}</strong>
                    <div className="inline-row" style={{ gap: "0.5rem" }}>
                      <StatusChip status={account.status} />
                      {account.authStatus === "ready" ? <StatusChip status="active" /> : null}
                    </div>
                  </div>
                  <small>@{account.handle}</small>
                  <p className="account-card__snippet">
                    {trimText(account.persona || account.manualNotes || "暂时还没有人设说明。")}
                  </p>
                  <div className="inline-row" style={{ justifyContent: "space-between", marginTop: "0.5rem" }}>
                    <span className="helper-text">Writer 来源：{account.writerPromptSource === "database" ? "数据库" : "MainAgent"}</span>
                    <span className="helper-text">最近发布：{formatTime(account.lastPublishedAt)}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state">
                <p>还没有账号</p>
                <p className="muted">在右侧先创建第一个 X 账号。</p>
              </div>
            )}
          </div>
        </article>

        <article className="card">
          <div className="stack stack--tight">
            <h3>创建账号</h3>
            <p className="helper-text">创建后会自动初始化账号 Soul。</p>
          </div>

          <label className="field">
            <span>账号用户名 *</span>
            <input value={form.handle} onChange={(e) => updateForm("handle", e.target.value)} placeholder="@growthnotelab" />
          </label>

          <label className="field">
            <span>账号名称</span>
            <input value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder="例如：增长笔记实验室" />
          </label>

          <label className="field">
            <span>账号人设</span>
            <textarea
              value={form.persona}
              onChange={(e) => updateForm("persona", e.target.value)}
              rows={3}
              placeholder="这个账号应该以什么样的身份和口吻说话？"
            />
          </label>

          <label className="field">
            <span>目标受众</span>
            <textarea
              value={form.targetAudience}
              onChange={(e) => updateForm("targetAudience", e.target.value)}
              rows={2}
              placeholder="这个账号主要写给谁看？"
            />
          </label>

          <label className="field">
            <span>风格约束</span>
            <textarea
              value={form.styleGuide}
              onChange={(e) => updateForm("styleGuide", e.target.value)}
              rows={2}
              placeholder="例如：短句、强开头、避免空话、不要太鸡血"
            />
          </label>

          <label className="field">
            <span>学习对象</span>
            <input
              value={form.learningTargetsText}
              onChange={(e) => updateForm("learningTargetsText", e.target.value)}
              placeholder="用逗号或换行分隔，例如：crypto founders, AI builders"
            />
          </label>

          <label className="field">
            <span>人工备注</span>
            <textarea
              value={form.manualNotes}
              onChange={(e) => updateForm("manualNotes", e.target.value)}
              rows={2}
              placeholder="补充运营侧已知信息或限制条件。"
            />
          </label>

          <label className="field">
            <span>浏览器 Profile 目录</span>
            <input value={form.profileDir} onChange={(e) => updateForm("profileDir", e.target.value)} placeholder="留空则自动生成" />
          </label>

          <label className="field">
            <span>代理地址</span>
            <input value={form.proxyUrl} onChange={(e) => updateForm("proxyUrl", e.target.value)} placeholder="默认：http://127.0.0.1:7890" />
          </label>

          <label className="field">
            <span>账号状态</span>
            <select value={form.status} onChange={(e) => updateForm("status", e.target.value as "active" | "paused")}>
              <option value="active">启用</option>
              <option value="paused">暂停</option>
            </select>
          </label>

          <div className="button-row">
            <button className="button" disabled={pending || !form.handle.trim()} onClick={() => withAction(handleCreateAccount)}>
              {pending ? "创建中..." : "创建账号"}
            </button>
            <button className="button button--ghost" onClick={() => setForm(DEFAULT_FORM)}>
              重置表单
            </button>
          </div>
        </article>
      </div>

      {selectedAccount ? (
        <>
          <article className="card">
            <div className="card-header">
              <div>
                <h3>当前账号详情</h3>
                <p className="muted">@{selectedAccount.handle}</p>
              </div>
              <StatusChip status={selectedAccount.status} />
            </div>

            <div className="grid grid--three">
              <div>
                <h4>基本信息</h4>
                <ul className="list-compact">
                  <li><strong>名称：</strong>{selectedAccount.name || `@${selectedAccount.handle}`}</li>
                  <li><strong>用户名：</strong>@{selectedAccount.handle}</li>
                  <li><strong>状态：</strong>{selectedAccount.status === "active" ? "启用" : "暂停"}</li>
                </ul>
              </div>

              <div>
                <h4>运营信息</h4>
                <ul className="list-compact">
                  <li><strong>最近发布：</strong>{formatTime(selectedAccount.lastPublishedAt)}</li>
                  <li><strong>Writer 来源：</strong>{selectedAccount.writerPromptSource === "database" ? "数据库" : "MainAgent"}</li>
                </ul>
              </div>

              <div>
                <h4>技术配置</h4>
                <ul className="list-compact">
                  <li><strong>Profile：</strong>{selectedAccount.profileDir || "自动"}</li>
                  <li><strong>代理：</strong>{selectedAccount.proxyUrl ?? "未设置"}</li>
                  <li><strong>认证状态：</strong>{selectedAccount.authStatus ?? "未检测"}</li>
                </ul>
              </div>
            </div>

            {selectedAccount.persona ? (
              <div style={{ marginTop: "1rem" }}>
                <h4>人设</h4>
                <p className="muted">{selectedAccount.persona}</p>
              </div>
            ) : null}

            {selectedAccount.targetAudience ? (
              <div style={{ marginTop: "1rem" }}>
                <h4>目标受众</h4>
                <p className="muted">{selectedAccount.targetAudience}</p>
              </div>
            ) : null}

            {selectedAccount.styleGuide ? (
              <div style={{ marginTop: "1rem" }}>
                <h4>风格约束</h4>
                <p className="muted">{selectedAccount.styleGuide}</p>
              </div>
            ) : null}

            {selectedAccount.learningTargets.length > 0 ? (
              <div style={{ marginTop: "1rem" }}>
                <h4>学习对象</h4>
                <p className="muted">{selectedAccount.learningTargets.join("，")}</p>
              </div>
            ) : null}

            {selectedAccount.manualNotes ? (
              <div style={{ marginTop: "1rem" }}>
                <h4>人工备注</h4>
                <p className="muted">{selectedAccount.manualNotes}</p>
              </div>
            ) : null}
          </article>

          <article className="card">
            <div className="card-header">
              <div>
                <h3>账号 Soul</h3>
                <p className="muted">
                  Soul 是账号级稳定身份层。它定义“这个账号是谁、怎么说话、哪些边界不能碰”，不承载短期热点和单条任务目标。
                </p>
              </div>
              <span className="helper-text">
                {soulDocument ? `v${soulDocument.version} | ${formatTime(soulDocument.lastUpdatedAt)}` : soulLoading ? "加载中..." : "未加载"}
              </span>
            </div>

            {soulLoading ? (
              <p className="muted">正在加载账号 Soul...</p>
            ) : (
              <div className="grid grid--two">
                <div className="stack">
                  <label className="field">
                    <span>核心身份</span>
                    <textarea
                      value={soulForm.coreIdentity}
                      onChange={(event) => updateSoulForm("coreIdentity", event.target.value)}
                      rows={3}
                      placeholder="这个账号是谁，站在什么位置说话？"
                    />
                  </label>

                  <label className="field">
                    <span>目标读者</span>
                    <textarea
                      value={soulForm.targetReader}
                      onChange={(event) => updateSoulForm("targetReader", event.target.value)}
                      rows={2}
                      placeholder="这个账号主要写给谁看"
                    />
                  </label>

                  <label className="field">
                    <span>Voice Traits</span>
                    <textarea
                      value={soulForm.voiceTraitsText}
                      onChange={(event) => updateSoulForm("voiceTraitsText", event.target.value)}
                      rows={4}
                      placeholder={"一行一项\n例如：短句\n先下判断\n少讲大道理"}
                    />
                  </label>

                  <label className="field">
                    <span>Worldview</span>
                    <textarea
                      value={soulForm.worldviewText}
                      onChange={(event) => updateSoulForm("worldviewText", event.target.value)}
                      rows={4}
                      placeholder={"一行一项\n例如：更重视交易体感而不是空泛叙事"}
                    />
                  </label>

                  <label className="field">
                    <span>Proof Anchors</span>
                    <textarea
                      value={soulForm.proofAnchorsText}
                      onChange={(event) => updateSoulForm("proofAnchorsText", event.target.value)}
                      rows={3}
                      placeholder={"一行一项\n例如：实盘经验\n复盘记录"}
                    />
                  </label>

                  <label className="field">
                    <span>Signature Moves</span>
                    <textarea
                      value={soulForm.signatureMovesText}
                      onChange={(event) => updateSoulForm("signatureMovesText", event.target.value)}
                      rows={3}
                      placeholder={"一行一项\n例如：先亮观点再补背景"}
                    />
                  </label>

                  <label className="field">
                    <span>Product Mention Policy</span>
                    <textarea
                      value={soulForm.productMentionPolicyText}
                      onChange={(event) => updateSoulForm("productMentionPolicyText", event.target.value)}
                      rows={3}
                      placeholder={"一行一项\n例如：只在自然语境里提产品"}
                    />
                  </label>

                  <label className="field">
                    <span>Hard Boundaries</span>
                    <textarea
                      value={soulForm.hardBoundariesText}
                      onChange={(event) => updateSoulForm("hardBoundariesText", event.target.value)}
                      rows={3}
                      placeholder={"一行一项\n例如：不装内幕人士\n不替用户做投资建议"}
                    />
                  </label>

                  <label className="field">
                    <span>Taboo Lexicon</span>
                    <textarea
                      value={soulForm.tabooLexiconText}
                      onChange={(event) => updateSoulForm("tabooLexiconText", event.target.value)}
                      rows={3}
                      placeholder={"一行一项\n例如：财富自由\n稳赢"}
                    />
                  </label>

                  <label className="field">
                    <span>Exemplar Lines</span>
                    <textarea
                      value={soulForm.exemplarLinesText}
                      onChange={(event) => updateSoulForm("exemplarLinesText", event.target.value)}
                      rows={4}
                      placeholder={"一行一项\n例如：我更在意的不是涨没涨，而是这波情绪有没有透支"}
                    />
                  </label>

                  <label className="field">
                    <span>更新原因</span>
                    <input
                      value={soulForm.updateReason}
                      onChange={(event) => updateSoulForm("updateReason", event.target.value)}
                      placeholder="manual_edit"
                    />
                  </label>

                  <div className="button-row">
                    <button className="button" disabled={pending} onClick={() => withAction(handleSaveSoul)}>
                      {pending ? "保存中..." : "保存 Soul"}
                    </button>
                    <button
                      className="button button--ghost"
                      disabled={pending}
                      onClick={() => setSoulForm(buildSoulForm(soulDocument))}
                    >
                      重置为已保存版本
                    </button>
                  </div>
                </div>

                <div className="stack">
                  <div className="card" style={{ padding: "1rem" }}>
                    <div className="stack stack--tight">
                      <strong>Markdown 预览</strong>
                      <span className="helper-text">
                        {soulDocument ? `当前已保存版本 v${soulDocument.version} | 更新人：${soulDocument.updatedBy}` : "当前显示的是根据表单实时生成的预览"}
                      </span>
                    </div>
                  </div>

                  <textarea className="twitter-editor" rows={28} readOnly value={soulPreviewMarkdown} />
                </div>
              </div>
            )}
          </article>

          <article className="card">
            <div className="card-header">
              <div>
                <h3>MainAgent 策略边界</h3>
                <p className="muted">
                  这里控制 MainAgent 的发帖节奏偏好，以及 Writer 是走数据库里的账号 Prompt，还是走 MainAgent 运行时即时生成的 Prompt。
                </p>
              </div>
              <span className="helper-text">
                当前 Writer Prompt：{strategyForm.writerPromptSource === "main_agent" ? "MainAgent 实时生成" : "数据库版本"}
              </span>
            </div>

            <div className="field">
              <span>Writer Prompt 来源</span>
              <div className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <strong>{databaseWriterPromptEnabled ? "固定 Writer Prompt 已启用" : "MainAgent 动态 Writer Prompt 已启用"}</strong>
                  <span className="helper-text">
                    开启固定模式时走数据库里的账号 Writer Prompt；关闭固定模式时，由 MainAgent 在每次任务规划时临时生成 runtime prompt。
                  </span>
                </div>
                <div className="button-row" style={{ marginTop: "1rem" }}>
                  <button
                    type="button"
                    className={databaseWriterPromptEnabled ? "button" : "button button--ghost"}
                    onClick={() => updateStrategyForm("writerPromptSource", "database")}
                  >
                    启用固定 Writer Prompt
                  </button>
                  <button
                    type="button"
                    className={!databaseWriterPromptEnabled ? "button" : "button button--ghost"}
                    onClick={() => updateStrategyForm("writerPromptSource", "main_agent")}
                  >
                    关闭固定，交给 MainAgent
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid--two">
              <label className="field">
                <span>碎碎念</span>
                <input value={strategyForm.casualNote} onChange={(event) => updateStrategyForm("casualNote", event.target.value)} />
                <span className="helper-text">像发朋友圈，随手说一句。</span>
              </label>

              <label className="field">
                <span>小感想</span>
                <input value={strategyForm.smallInsight} onChange={(event) => updateStrategyForm("smallInsight", event.target.value)} />
                <span className="helper-text">一点心得，不展开成长文。</span>
              </label>

              <label className="field">
                <span>踩坑记录</span>
                <input value={strategyForm.pitfallLog} onChange={(event) => updateStrategyForm("pitfallLog", event.target.value)} />
                <span className="helper-text">失败经历、教训、反思。</span>
              </label>

              <label className="field">
                <span>工具提及</span>
                <input value={strategyForm.toolMention} onChange={(event) => updateStrategyForm("toolMention", event.target.value)} />
                <span className="helper-text">自然带出产品，不做硬广。</span>
              </label>

              <label className="field">
                <span>行业吐槽</span>
                <input value={strategyForm.industryTalk} onChange={(event) => updateStrategyForm("industryTalk", event.target.value)} />
                <span className="helper-text">有态度，但别天天开炮。</span>
              </label>

              <label className="field">
                <span>互动问答</span>
                <input value={strategyForm.interactiveQa} onChange={(event) => updateStrategyForm("interactiveQa", event.target.value)} />
                <span className="helper-text">主动提问，拉回复。</span>
              </label>
            </div>

            <label className="field">
              <span>引用转发权重</span>
              <input value={strategyForm.quoteRepost} onChange={(event) => updateStrategyForm("quoteRepost", event.target.value)} />
              <span className="helper-text">这不是固定日更比例，而是给 MainAgent 一个“可以不定期引用转发”的偏好强度。</span>
            </label>

            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>当前主逻辑</strong>
                <p className="muted" style={{ margin: 0 }}>
                  不是写长文，而是发朋友圈；不是教育用户，而是和用户持续建立熟悉感。
                </p>
                <p className="helper-text" style={{ margin: 0 }}>
                  当前总权重：{sumStrategyValues(strategyForm)}。这里是偏好分布，不是硬性配额。
                </p>
              </div>
            </div>

            <div className="button-row">
              <button className="button" disabled={pending} onClick={() => withAction(handleSaveStrategyConfig)}>
                {pending ? "保存中..." : "保存策略边界"}
              </button>
              <button className="button button--ghost" disabled={pending} onClick={() => setStrategyForm(buildStrategyForm(selectedAccount))}>
                重置为当前账号配置
              </button>
            </div>
          </article>

          <article className="card">
            <div className="card-header">
              <div>
                <h3>登录验证</h3>
                <p className="muted">验证通过后，这个账号才能执行真实浏览器发布流程。</p>
              </div>
              <StatusChip status={selectedAccount.authStatus === "ready" ? "active" : "paused"} />
            </div>

            {loginStatus === "success" ? (
              <div className="alert alert--success" style={{ marginBottom: "1rem" }}>
                <StatusChip status="success" />
                <span>登录成功，会话已保存。</span>
              </div>
            ) : null}

            {loginStatus === "error" ? (
              <div className="alert alert--error" style={{ marginBottom: "1rem" }}>
                <StatusChip status="error" />
                <span>登录失败，请检查代理和浏览器 Profile 配置。</span>
              </div>
            ) : null}

            <label className="field">
              <span>浏览器 Profile 目录</span>
              <input value={loginProfileDir} onChange={(e) => setLoginProfileDir(e.target.value)} placeholder="留空则使用账号默认配置" />
            </label>

            <label className="field">
              <span>代理地址</span>
              <input value={loginProxyUrl} onChange={(e) => setLoginProxyUrl(e.target.value)} placeholder="默认：http://127.0.0.1:7890" />
            </label>

            {selectedAccount.authStatusReason ? (
              <p className="helper-text" style={{ marginTop: "0.8rem" }}>
                最近认证提示：{selectedAccount.authStatusReason}
              </p>
            ) : null}

            <div className="button-row">
              <button className="button" onClick={handleLogin} disabled={loginStatus === "logging"}>
                {loginStatus === "logging" ? "登录中..." : "开始登录验证"}
              </button>
              {loginStatus === "success" ? (
                <button className="button button--ghost" onClick={() => (window.location.href = "/twitter")}>
                  返回工作台
                </button>
              ) : null}
            </div>
          </article>
        </>
      ) : null}
    </div>
  );
}

function pickSelectedAccountId(accounts: TwitterAccount[], preferredAccountId?: string | null) {
  if (preferredAccountId && accounts.some((account) => account.id === preferredAccountId)) {
    return preferredAccountId;
  }

  return accounts[0]?.id ?? null;
}

function splitTextList(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLineList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function trimText(value: string, maxLength = 120) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}

function buildStrategyForm(account: TwitterAccount | null): StrategyFormState {
  if (!account) {
    return DEFAULT_STRATEGY_FORM;
  }

  return {
    writerPromptSource: account.writerPromptSource,
    casualNote: String(account.publishStyleRatios.casualNote),
    smallInsight: String(account.publishStyleRatios.smallInsight),
    pitfallLog: String(account.publishStyleRatios.pitfallLog),
    toolMention: String(account.publishStyleRatios.toolMention),
    industryTalk: String(account.publishStyleRatios.industryTalk),
    interactiveQa: String(account.publishStyleRatios.interactiveQa),
    quoteRepost: String(account.publishStyleRatios.quoteRepost)
  };
}

function buildSoulForm(document: TwitterAccountSoulDocument | null): SoulFormState {
  if (!document) {
    return DEFAULT_SOUL_FORM;
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

function buildSoulPreviewMarkdown(form: SoulFormState) {
  return [
    "# Account Soul",
    "",
    "- Account ID: preview",
    "- Version: draft",
    `- Update Reason: ${form.updateReason.trim() || "manual_edit"}`,
    "",
    renderSoulTextSection("Core Identity", form.coreIdentity),
    renderSoulTextSection("Target Reader", form.targetReader),
    renderSoulListSection("Voice Traits", splitLineList(form.voiceTraitsText)),
    renderSoulListSection("Worldview", splitLineList(form.worldviewText)),
    renderSoulListSection("Proof Anchors", splitLineList(form.proofAnchorsText)),
    renderSoulListSection("Signature Moves", splitLineList(form.signatureMovesText)),
    renderSoulListSection("Product Mention Policy", splitLineList(form.productMentionPolicyText)),
    renderSoulListSection("Hard Boundaries", splitLineList(form.hardBoundariesText)),
    renderSoulListSection("Taboo Lexicon", splitLineList(form.tabooLexiconText)),
    renderSoulListSection("Exemplar Lines", splitLineList(form.exemplarLinesText))
  ].join("\n");
}

function normalizeStrategyForm(strategyForm: StrategyFormState) {
  return {
    casualNote: normalizeStrategyNumber(strategyForm.casualNote, 30),
    smallInsight: normalizeStrategyNumber(strategyForm.smallInsight, 25),
    pitfallLog: normalizeStrategyNumber(strategyForm.pitfallLog, 15),
    toolMention: normalizeStrategyNumber(strategyForm.toolMention, 15),
    industryTalk: normalizeStrategyNumber(strategyForm.industryTalk, 10),
    interactiveQa: normalizeStrategyNumber(strategyForm.interactiveQa, 5),
    quoteRepost: normalizeStrategyNumber(strategyForm.quoteRepost, 5)
  };
}

function normalizeStrategyNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function sumStrategyValues(strategyForm: StrategyFormState) {
  const normalized = normalizeStrategyForm(strategyForm);
  return Object.values(normalized).reduce((sum, value) => sum + value, 0);
}

function renderSoulTextSection(title: string, value: string) {
  return [`## ${title}`, "", value.trim() || "Not set.", ""].join("\n");
}

function renderSoulListSection(title: string, values: string[]) {
  return [`## ${title}`, "", ...(values.length ? values.map((item) => `- ${item}`) : ["- Not set."]), ""].join("\n");
}

function joinLineList(values: string[]) {
  return values.join("\n");
}
