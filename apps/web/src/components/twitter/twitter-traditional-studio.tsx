"use client";

import { useEffect, useState, useTransition } from "react";
import type {
  SaveTwitterAccountSoulInput,
  TwitterAccount,
  TwitterAccountSoulDocument,
  TwitterTask
} from "../../lib/twitter/api";
import { getTwitterTraditionalClientApiBaseUrl } from "../../lib/twitter/http";
import {
  applyTwitterTraditionalNoteAgentDraft,
  createTwitterTraditionalTask,
  generateTwitterTraditionalNoteAgentDraft,
  getTwitterTraditionalAccountSoul,
  getTwitterTraditionalAccounts,
  getTwitterTraditionalHealth,
  getTwitterTraditionalTasks,
  runTwitterTraditionalTaskNow,
  runTwitterTraditionalWorkerTick,
  saveTwitterTraditionalAccountSoul,
  type ApplyTwitterTraditionalNoteAgentInput,
  type ApplyTwitterTraditionalNoteAgentResult,
  type TwitterTraditionalHealth,
  type TwitterTraditionalNoteAgentDraft,
  type TwitterTraditionalNoteAgentGenerateInput,
  type TwitterTraditionalNoteAgentPhaseReport
} from "../../lib/twitter/traditional-api";
import { StatusChip } from "../status-chip";

type SoulFormState = {
  coreIdentity: string;
  targetReader: string;
  exemplarLinesText: string;
  updateReason: string;
};

type TaskFormState = {
  title: string;
  brief: string;
  goal: string;
  preferredMode: "auto" | "single" | "thread";
  scheduledAt: string;
};

type NoteAgentConfigState = {
  sourceHandleOrUrl: string;
  sampleSize: string;
  lookbackDays: string;
  includeReplies: boolean;
  manualSeedTexts: string;
};

type NoteAgentFormState = {
  learnedStyleProfileMarkdown: string;
  soulCandidateMarkdown: string;
  styleRulesMarkdown: string;
  numberExpressionRulesMarkdown: string;
  reviewRubricMarkdown: string;
  learnedSamplesJsonl: string;
  sourceMapYaml: string;
};

const DEFAULT_SOUL_FORM: SoulFormState = {
  coreIdentity: "",
  targetReader: "",
  exemplarLinesText: "",
  updateReason: "manual_edit"
};

const DEFAULT_TASK_FORM: TaskFormState = {
  title: "",
  brief: "",
  goal: "",
  preferredMode: "auto",
  scheduledAt: ""
};

const DEFAULT_NOTE_AGENT_CONFIG: NoteAgentConfigState = {
  sourceHandleOrUrl: "https://x.com/PhyrexNi",
  sampleSize: "40",
  lookbackDays: "90",
  includeReplies: false,
  manualSeedTexts: ""
};

const DEFAULT_NOTE_AGENT_FORM: NoteAgentFormState = {
  learnedStyleProfileMarkdown: "",
  soulCandidateMarkdown: "",
  styleRulesMarkdown: "",
  numberExpressionRulesMarkdown: "",
  reviewRubricMarkdown: "",
  learnedSamplesJsonl: "",
  sourceMapYaml: ""
};

function buildSoulForm(document: TwitterAccountSoulDocument): SoulFormState {
  return {
    coreIdentity: document.coreIdentity,
    targetReader: document.targetReader,
    exemplarLinesText: document.exemplarLines.join("\n"),
    updateReason: document.updateReason || "manual_edit"
  };
}

function buildNoteAgentForm(draft: TwitterTraditionalNoteAgentDraft): NoteAgentFormState {
  return {
    learnedStyleProfileMarkdown: draft.learnedStyleProfileMarkdown,
    soulCandidateMarkdown: draft.soulCandidateMarkdown,
    styleRulesMarkdown: draft.styleRulesMarkdown,
    numberExpressionRulesMarkdown: draft.numberExpressionRulesMarkdown,
    reviewRubricMarkdown: draft.reviewRubricMarkdown,
    learnedSamplesJsonl: draft.learnedSamplesJsonl,
    sourceMapYaml: draft.sourceMapYaml
  };
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function parseManualSeedTexts(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  if (/\n\s*\n/.test(normalized)) {
    return normalized
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return normalized
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildGenerateInput(config: NoteAgentConfigState): TwitterTraditionalNoteAgentGenerateInput {
  return {
    mode: "style_learning",
    sourceAccount: {
      platform: "x",
      handleOrUrl: config.sourceHandleOrUrl.trim()
    },
    collection: {
      sampleSize: parsePositiveInteger(config.sampleSize, 40),
      lookbackDays: parsePositiveInteger(config.lookbackDays, 90),
      includeReplies: config.includeReplies
    },
    manualSeedTexts: parseManualSeedTexts(config.manualSeedTexts)
  };
}

function buildNoteAgentDraft(nextDraft: TwitterTraditionalNoteAgentDraft, form: NoteAgentFormState): TwitterTraditionalNoteAgentDraft {
  return {
    ...nextDraft,
    learnedStyleProfileMarkdown: form.learnedStyleProfileMarkdown,
    soulCandidateMarkdown: form.soulCandidateMarkdown,
    styleRulesMarkdown: form.styleRulesMarkdown,
    numberExpressionRulesMarkdown: form.numberExpressionRulesMarkdown,
    reviewRubricMarkdown: form.reviewRubricMarkdown,
    learnedSamplesJsonl: form.learnedSamplesJsonl,
    sourceMapYaml: form.sourceMapYaml
  };
}

function buildSoulInput(form: SoulFormState): SaveTwitterAccountSoulInput {
  return {
    coreIdentity: form.coreIdentity.trim(),
    targetReader: form.targetReader.trim(),
    voiceTraits: [],
    worldview: [],
    proofAnchors: [],
    signatureMoves: [],
    productMentionPolicy: [],
    hardBoundaries: [],
    tabooLexicon: [],
    exemplarLines: form.exemplarLinesText
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    updateReason: form.updateReason.trim() || "manual_edit"
  };
}

function phaseStatusLabel(value: TwitterTraditionalNoteAgentPhaseReport["status"]) {
  switch (value) {
    case "passed":
      return "通过";
    case "warning":
      return "警告";
    case "failed":
      return "失败";
    default:
      return value;
  }
}

function phaseLabel(value: TwitterTraditionalNoteAgentPhaseReport["phase"]) {
  switch (value) {
    case "collect_source_samples":
      return "采样";
    case "distill_style_profile":
      return "提炼风格画像";
    case "draft_account_assets":
      return "生成账户资产草稿";
    case "apply_account_assets":
      return "写回账户资产";
    default:
      return value;
  }
}

function checkSeverityLabel(value: "error" | "warning" | "info") {
  switch (value) {
    case "error":
      return "错误";
    case "warning":
      return "警告";
    case "info":
      return "信息";
    default:
      return value;
  }
}

function PhaseReportBlock({ report }: { report: TwitterTraditionalNoteAgentPhaseReport }) {
  return (
    <article className="card" style={{ padding: "1rem" }}>
      <div className="card-header">
        <div>
          <strong>{phaseLabel(report.phase)}</strong>
          <p className="helper-text">
            开始：{formatDateTime(report.startedAt)} / 结束：{formatDateTime(report.finishedAt)}
          </p>
        </div>
        <span className={`mini-badge ${report.status === "passed" ? "" : "mini-badge--accent"}`}>
          {phaseStatusLabel(report.status)}
        </span>
      </div>

      <div className="stack stack--tight">
        <div>
          <strong>开始前读取的文档</strong>
          <div className="log-list" style={{ marginTop: "0.5rem" }}>
            {report.inputsRead.map((item) => (
              <div key={`${report.phase}-${item.path}`} className="catalog-list__item">
                <div className="catalog-list__item-top">
                  <div>
                    <div className="catalog-list__item-subtitle">{item.label}</div>
                    <div className="catalog-list__item-caption">{item.path}</div>
                  </div>
                  <span className={`mini-badge ${item.exists ? "" : "mini-badge--accent"}`}>{item.exists ? "已读" : "缺失"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <strong>结束后验证结果</strong>
          <div className="log-list" style={{ marginTop: "0.5rem" }}>
            {report.validationChecks.map((item) => (
              <div key={`${report.phase}-${item.label}`} className="catalog-list__item">
                <div className="catalog-list__item-top">
                  <div>
                    <div className="catalog-list__item-subtitle">{item.label}</div>
                    <div className="catalog-list__item-caption">{item.details}</div>
                  </div>
                  <span className={`mini-badge ${item.passed ? "" : "mini-badge--accent"}`}>
                    {item.passed ? "通过" : `${checkSeverityLabel(item.severity)}未通过`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <strong>Diagnostics</strong>
          {report.diagnostics.length ? (
            <ul>
              {report.diagnostics.map((item) => (
                <li key={`${report.phase}-${item}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="helper-text">本阶段没有额外 diagnostics。</p>
          )}
        </div>
      </div>
    </article>
  );
}

export function TwitterTraditionalStudio() {
  const [health, setHealth] = useState<TwitterTraditionalHealth | null>(null);
  const [accounts, setAccounts] = useState<TwitterAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [soulDocument, setSoulDocument] = useState<TwitterAccountSoulDocument | null>(null);
  const [soulForm, setSoulForm] = useState<SoulFormState>(DEFAULT_SOUL_FORM);
  const [tasks, setTasks] = useState<TwitterTask[]>([]);
  const [taskForm, setTaskForm] = useState<TaskFormState>(DEFAULT_TASK_FORM);
  const [noteAgentConfig, setNoteAgentConfig] = useState<NoteAgentConfigState>(DEFAULT_NOTE_AGENT_CONFIG);
  const [noteAgentDraft, setNoteAgentDraft] = useState<TwitterTraditionalNoteAgentDraft | null>(null);
  const [noteAgentForm, setNoteAgentForm] = useState<NoteAgentFormState>(DEFAULT_NOTE_AGENT_FORM);
  const [noteAgentApplyResult, setNoteAgentApplyResult] = useState<ApplyTwitterTraditionalNoteAgentResult | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;

  useEffect(() => {
    void hydrate();
  }, []);

  function resetNoteAgent() {
    setNoteAgentDraft(null);
    setNoteAgentForm({ ...DEFAULT_NOTE_AGENT_FORM });
    setNoteAgentApplyResult(null);
  }

  function resetWorkspace() {
    setSoulDocument(null);
    setSoulForm({ ...DEFAULT_SOUL_FORM });
    setTasks([]);
    setTaskForm({ ...DEFAULT_TASK_FORM });
    resetNoteAgent();
  }

  async function hydrate(preferredAccountId?: string | null) {
    setLoading(true);

    try {
      const [nextHealth, nextAccounts] = await Promise.all([
        getTwitterTraditionalHealth(),
        getTwitterTraditionalAccounts()
      ]);
      const nextSelectedAccountId =
        preferredAccountId && nextAccounts.some((item) => item.id === preferredAccountId)
          ? preferredAccountId
          : nextAccounts[0]?.id ?? null;

      setHealth(nextHealth);
      setAccounts(nextAccounts);
      setSelectedAccountId(nextSelectedAccountId);

      if (!nextSelectedAccountId) {
        resetWorkspace();
        return;
      }

      const [nextSoul, nextTasks] = await Promise.all([
        getTwitterTraditionalAccountSoul(nextSelectedAccountId),
        getTwitterTraditionalTasks(nextSelectedAccountId)
      ]);

      setSoulDocument(nextSoul);
      setSoulForm(buildSoulForm(nextSoul));
      setTasks(nextTasks);
      resetNoteAgent();
    } catch (error) {
      setMessage(buildErrorMessage(error, "加载传统链路工作台失败。"));
    } finally {
      setLoading(false);
    }
  }

  function runAction(action: () => Promise<void>) {
    setMessage("");
    startTransition(() => {
      void action().catch((error) => {
        setMessage(buildErrorMessage(error, "传统链路操作失败。"));
      });
    });
  }

  function applyNoteAgent(actions: ApplyTwitterTraditionalNoteAgentInput["actions"], successMessage: string) {
    runAction(async () => {
      if (!selectedAccountId || !noteAgentDraft) {
        return;
      }

      const nextDraft = buildNoteAgentDraft(noteAgentDraft, noteAgentForm);
      const result = await applyTwitterTraditionalNoteAgentDraft(selectedAccountId, {
        draft: nextDraft,
        actions
      });

      setNoteAgentDraft(nextDraft);
      setNoteAgentApplyResult(result);
      setMessage(successMessage);
    });
  }

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>X 传统链路工作台</h2>
          <p className="muted">
            这里只处理传统链路。从参考账号学习风格现在是人工触发流程，不受 main 控制，也不会覆盖正式
            soul。
          </p>
          <p className="helper-text">
            API: {getTwitterTraditionalClientApiBaseUrl()} / 发布模式: {health?.publishMode ?? "-"}
          </p>
        </div>
        <div className="button-row">
          <button className="button button--ghost" disabled={pending || loading} onClick={() => runAction(() => hydrate(selectedAccountId))}>
            刷新
          </button>
          <button
            className="button"
            disabled={pending || loading}
            onClick={() =>
              runAction(async () => {
                const summary = await runTwitterTraditionalWorkerTick(5);
                await hydrate(selectedAccountId);
                setMessage(
                  `任务执行器已处理 ${summary.processedTaskIds.length} 个任务，发布 ${summary.publishedTaskIds.length} 个，阻塞 ${summary.blockedTaskIds.length} 个。`
                );
              })
            }
          >
            执行待处理任务
          </button>
        </div>
      </section>

      {message ? (
        <div className="card">
          <p className="helper-text">{message}</p>
        </div>
      ) : null}

      <section className="grid grid--two">
        <article className="card stack stack--tight">
          <h3>账户</h3>
          {accounts.length ? (
            <select
              value={selectedAccountId ?? ""}
              disabled={pending || loading}
              onChange={(event) => runAction(() => hydrate(event.target.value || null))}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.handle}
                </option>
              ))}
            </select>
          ) : (
            <p className="muted">暂无账户</p>
          )}

          {selectedAccount ? (
            <>
              <div className="inline-row">
                <strong>{selectedAccount.name || `@${selectedAccount.handle}`}</strong>
                <StatusChip status={selectedAccount.status} />
              </div>
              <p className="helper-text">data dir: {health?.dataDir ?? "-"}</p>
              <p className="helper-text">Persona: {selectedAccount.persona || "-"}</p>
              <p className="helper-text">Target Audience: {selectedAccount.targetAudience || "-"}</p>
            </>
          ) : null}
        </article>

        <article className="card stack stack--tight">
          <h3>创建任务</h3>
          <label className="field">
            <span>标题</span>
            <input value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label className="field">
            <span>Brief</span>
            <textarea rows={4} value={taskForm.brief} onChange={(event) => setTaskForm((current) => ({ ...current, brief: event.target.value }))} />
          </label>
          <label className="field">
            <span>Goal</span>
            <input value={taskForm.goal} onChange={(event) => setTaskForm((current) => ({ ...current, goal: event.target.value }))} />
          </label>
          <label className="field">
            <span>Mode</span>
            <select
              value={taskForm.preferredMode}
              onChange={(event) =>
                setTaskForm((current) => ({
                  ...current,
                  preferredMode: event.target.value as TaskFormState["preferredMode"]
                }))
              }
            >
              <option value="auto">auto</option>
              <option value="single">single</option>
              <option value="thread">thread</option>
            </select>
          </label>
          <label className="field">
            <span>Scheduled At</span>
            <input
              placeholder="2026-04-21T09:30:00+08:00"
              value={taskForm.scheduledAt}
              onChange={(event) => setTaskForm((current) => ({ ...current, scheduledAt: event.target.value }))}
            />
          </label>
          <button
            className="button"
            disabled={pending || loading || !selectedAccountId}
            onClick={() =>
              runAction(async () => {
                if (!selectedAccountId) {
                  return;
                }

                await createTwitterTraditionalTask({
                  accountId: selectedAccountId,
                  title: taskForm.title.trim() || undefined,
                  brief: taskForm.brief.trim() || undefined,
                  goal: taskForm.goal.trim() || undefined,
                  preferredMode: taskForm.preferredMode,
                  scheduledAt: taskForm.scheduledAt.trim() || null
                });

                setTaskForm({ ...DEFAULT_TASK_FORM });
                await hydrate(selectedAccountId);
              })
            }
          >
            创建任务
          </button>
        </article>
      </section>

      <article className="card stack stack--tight">
        <h3>账户 Soul</h3>
        <label className="field">
          <span>Core Identity</span>
          <textarea rows={3} value={soulForm.coreIdentity} onChange={(event) => setSoulForm((current) => ({ ...current, coreIdentity: event.target.value }))} />
        </label>
        <label className="field">
          <span>Target Reader</span>
          <textarea rows={3} value={soulForm.targetReader} onChange={(event) => setSoulForm((current) => ({ ...current, targetReader: event.target.value }))} />
        </label>
        <label className="field">
          <span>Exemplar Lines</span>
          <textarea rows={4} value={soulForm.exemplarLinesText} onChange={(event) => setSoulForm((current) => ({ ...current, exemplarLinesText: event.target.value }))} />
        </label>
        <button
          className="button"
          disabled={pending || loading || !selectedAccountId}
          onClick={() =>
            runAction(async () => {
              if (!selectedAccountId) {
                return;
              }

              const nextSoul = await saveTwitterTraditionalAccountSoul(selectedAccountId, buildSoulInput(soulForm));
              setSoulDocument(nextSoul);
              setSoulForm(buildSoulForm(nextSoul));
              setMessage("Soul 已保存。");
            })
          }
        >
          保存 Soul
        </button>
        {soulDocument ? <pre>{soulDocument.markdown}</pre> : <p className="muted">暂无 Soul 文档。</p>}
      </article>

      <article className="card stack stack--tight">
        <div className="card-header">
          <div>
            <h3>Note Agent 账户学习代理</h3>
            <p className="muted">
              当前流程是 “A 学 C”。它会读取目标账户资料、采样来源账户公开表达方式，生成账户级学习资产草稿，再由你手动写回。
            </p>
          </div>
          <div className="button-row">
            <button
              className="button button--ghost"
              disabled={pending || loading || !selectedAccountId || !noteAgentConfig.sourceHandleOrUrl.trim()}
              onClick={() =>
                runAction(async () => {
                  if (!selectedAccountId) {
                    return;
                  }

                  const draft = await generateTwitterTraditionalNoteAgentDraft(selectedAccountId, buildGenerateInput(noteAgentConfig));
                  setNoteAgentDraft(draft);
                  setNoteAgentForm(buildNoteAgentForm(draft));
                  setNoteAgentApplyResult(null);
                  setMessage("账户学习草稿已生成。");
                })
              }
            >
              生成学习草稿
            </button>
            <button className="button button--ghost" disabled={pending || loading || !noteAgentDraft} onClick={() => resetNoteAgent()}>
              清空草稿
            </button>
          </div>
        </div>

        <section className="stack stack--tight">
          <h4>1. 目标账户确认</h4>
          {selectedAccount ? (
            <div className="grid grid--two">
              <div className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <strong>
                    {selectedAccount.name || `@${selectedAccount.handle}`} / @{selectedAccount.handle}
                  </strong>
                  <span className="helper-text">Persona: {selectedAccount.persona || "-"}</span>
                  <span className="helper-text">Target Audience: {selectedAccount.targetAudience || "-"}</span>
                  <span className="helper-text">Style Guide: {selectedAccount.styleGuide || "-"}</span>
                </div>
              </div>
              <div className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <strong>账户级学习变量</strong>
                  <span className="helper-text">
                    Learning Targets: {selectedAccount.learningTargets.length ? selectedAccount.learningTargets.join(" / ") : "-"}
                  </span>
                  <span className="helper-text">Manual Notes: {selectedAccount.manualNotes || "-"}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="helper-text">请先选择目标账户。</p>
          )}
        </section>

        <section className="stack stack--tight">
          <h4>2. 来源账户配置</h4>
          <div className="grid grid--two">
            <label className="field">
              <span>来源 X 账户 handle / URL</span>
              <input
                placeholder="https://x.com/PhyrexNi"
                value={noteAgentConfig.sourceHandleOrUrl}
                onChange={(event) => setNoteAgentConfig((current) => ({ ...current, sourceHandleOrUrl: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>sampleSize</span>
              <input value={noteAgentConfig.sampleSize} onChange={(event) => setNoteAgentConfig((current) => ({ ...current, sampleSize: event.target.value }))} />
            </label>
            <label className="field">
              <span>lookbackDays</span>
              <input value={noteAgentConfig.lookbackDays} onChange={(event) => setNoteAgentConfig((current) => ({ ...current, lookbackDays: event.target.value }))} />
            </label>
            <label className="field">
              <span>includeReplies</span>
              <select
                value={noteAgentConfig.includeReplies ? "true" : "false"}
                onChange={(event) =>
                  setNoteAgentConfig((current) => ({
                    ...current,
                    includeReplies: event.target.value === "true"
                  }))
                }
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>手动补充样本</span>
            <textarea
              rows={6}
              placeholder="可选。建议每条样本之间空一行。浏览器采样受限时，这里会作为 fallback。"
              value={noteAgentConfig.manualSeedTexts}
              onChange={(event) => setNoteAgentConfig((current) => ({ ...current, manualSeedTexts: event.target.value }))}
            />
          </label>
        </section>

        <section className="stack stack--tight">
          <h4>3. 采样与 Phase 状态</h4>
          {noteAgentDraft ? (
            <>
              <div className="grid grid--two">
                <div className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <strong>来源账户</strong>
                    <span className="helper-text">
                      handle / URL: {noteAgentDraft.sourceAccount.handleOrUrl}
                    </span>
                    <span className="helper-text">normalizedHandle: {noteAgentDraft.sourceAccount.normalizedHandle ?? "-"}</span>
                    <span className="helper-text">profileUrl: {noteAgentDraft.sourceAccount.profileUrl ?? "-"}</span>
                  </div>
                </div>
                <div className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <strong>采样摘要</strong>
                    <span className="helper-text">可用样本：{noteAgentDraft.collectionSummary.collectedSampleCount}</span>
                    <span className="helper-text">timeline 样本：{noteAgentDraft.collectionSummary.timelineSampleCount}</span>
                    <span className="helper-text">手动补样本：{noteAgentDraft.collectionSummary.manualSeedCount}</span>
                    <span className="helper-text">
                      浏览器采样：{noteAgentDraft.collectionSummary.browserCollectionSucceeded ? "成功" : "受限 / fallback"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <strong>样本预览</strong>
                  {noteAgentDraft.samplePreview.length ? (
                    <div className="log-list">
                      {noteAgentDraft.samplePreview.map((item, index) => (
                        <div key={`${item.source}-${index}`} className="catalog-list__item">
                          <div className="catalog-list__item-top">
                            <div>
                              <div className="catalog-list__item-subtitle">
                                {item.source === "timeline" ? "timeline" : "manual_seed"} / {formatDateTime(item.publishedAt)}
                              </div>
                              <div className="catalog-list__item-caption">{item.tweetUrl ?? "无 tweetUrl"}</div>
                            </div>
                          </div>
                          <div className="catalog-list__item-caption">{item.text}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="helper-text">当前没有可展示的样本预览。</p>
                  )}
                </div>
              </div>

              <div className="stack stack--tight">
                {noteAgentDraft.phaseReports.map((report) => (
                  <PhaseReportBlock key={report.phase} report={report} />
                ))}
              </div>
            </>
          ) : (
            <p className="helper-text">生成草稿后，这里会显示来源账户、样本预览以及每个 phase 的读取与验证结果。</p>
          )}
        </section>

        <section className="stack stack--tight">
          <h4>4. 学习结果草稿</h4>
          {noteAgentDraft ? (
            <>
              <p className="helper-text">
                account: {noteAgentDraft.accountKey} / matched by: {noteAgentDraft.matchedBy ?? "-"} / generated:
                {" "}{formatDateTime(noteAgentDraft.generatedAt)}
              </p>
              <p>{noteAgentDraft.summary}</p>

              {noteAgentDraft.diagnostics.length ? (
                <div>
                  <strong>全局 diagnostics</strong>
                  <ul>
                    {noteAgentDraft.diagnostics.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {noteAgentDraft.operatorNotes.length ? (
                <div>
                  <strong>Operator Notes</strong>
                  <ul>
                    {noteAgentDraft.operatorNotes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid grid--two">
                <div className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <strong>读取路径</strong>
                    <span className="helper-text">README: {noteAgentDraft.sourcePaths.readme}</span>
                    <span className="helper-text">Account Config: {noteAgentDraft.sourcePaths.accountConfigDir}</span>
                    <span className="helper-text">RAG Library: {noteAgentDraft.sourcePaths.ragLibraryDir}</span>
                  </div>
                </div>
                <div className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <strong>写回目标路径</strong>
                    <span className="helper-text">soul_candidate.md: {noteAgentDraft.sourcePaths.soulCandidatePath}</span>
                    <span className="helper-text">note-agent assets: {noteAgentDraft.sourcePaths.noteAgentAssetDir}</span>
                  </div>
                </div>
              </div>

              <label className="field">
                <span>learned_style_profile.md</span>
                <textarea
                  rows={16}
                  value={noteAgentForm.learnedStyleProfileMarkdown}
                  onChange={(event) => setNoteAgentForm((current) => ({ ...current, learnedStyleProfileMarkdown: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>soul_candidate.md</span>
                <textarea
                  rows={16}
                  value={noteAgentForm.soulCandidateMarkdown}
                  onChange={(event) => setNoteAgentForm((current) => ({ ...current, soulCandidateMarkdown: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>style_rules.md</span>
                <textarea rows={14} value={noteAgentForm.styleRulesMarkdown} onChange={(event) => setNoteAgentForm((current) => ({ ...current, styleRulesMarkdown: event.target.value }))} />
              </label>
              <label className="field">
                <span>number_expression_rules.md</span>
                <textarea
                  rows={14}
                  value={noteAgentForm.numberExpressionRulesMarkdown}
                  onChange={(event) =>
                    setNoteAgentForm((current) => ({
                      ...current,
                      numberExpressionRulesMarkdown: event.target.value
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>review_rubric.md</span>
                <textarea rows={14} value={noteAgentForm.reviewRubricMarkdown} onChange={(event) => setNoteAgentForm((current) => ({ ...current, reviewRubricMarkdown: event.target.value }))} />
              </label>

              <details>
                <summary>展开 provenance 资产</summary>
                <div className="stack stack--tight" style={{ marginTop: "1rem" }}>
                  <label className="field">
                    <span>learned_samples.jsonl</span>
                    <textarea
                      rows={12}
                      value={noteAgentForm.learnedSamplesJsonl}
                      onChange={(event) => setNoteAgentForm((current) => ({ ...current, learnedSamplesJsonl: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>source_map.yaml</span>
                    <textarea rows={12} value={noteAgentForm.sourceMapYaml} onChange={(event) => setNoteAgentForm((current) => ({ ...current, sourceMapYaml: event.target.value }))} />
                  </label>
                </div>
              </details>
            </>
          ) : (
            <p className="helper-text">生成草稿后，这里会出现 `soul candidate`、3 份正式规则文档和学习画像文档。</p>
          )}
        </section>

        <section className="stack stack--tight">
          <h4>5. 写回账户资产</h4>
          <p className="helper-text">
            这里只提供安全动作。V1 不会出现覆盖正式 soul.md 的按钮。
          </p>
          <div className="button-row">
            <button
              className="button"
              disabled={pending || loading || !selectedAccountId || !noteAgentDraft}
              onClick={() =>
                applyNoteAgent(
                  {
                    writeRagDocs: true,
                    saveSoulCandidate: false,
                    saveLearnedAssets: true
                  },
                  "账户级 RAG 与学习资产已写回。"
                )
              }
            >
              写回账户级 RAG
            </button>
            <button
              className="button button--ghost"
              disabled={pending || loading || !selectedAccountId || !noteAgentDraft}
              onClick={() =>
                applyNoteAgent(
                  {
                    writeRagDocs: false,
                    saveSoulCandidate: true,
                    saveLearnedAssets: false
                  },
                  "soul 候选稿已保存。"
                )
              }
            >
              保存 Soul 候选稿
            </button>
          </div>

          {noteAgentApplyResult ? (
            <div className="stack stack--tight">
              <div className="card" style={{ padding: "1rem" }}>
                <div className="card-header">
                  <div>
                    <strong>最近一次写回</strong>
                    <p className="helper-text">applied: {formatDateTime(noteAgentApplyResult.appliedAt)}</p>
                  </div>
                  <span className="mini-badge mini-badge--accent">安全写回</span>
                </div>
                <p className="helper-text">
                  actions: rag={noteAgentApplyResult.actionsApplied.writeRagDocs ? "true" : "false"} / soul=
                  {noteAgentApplyResult.actionsApplied.saveSoulCandidate ? "true" : "false"} / learnedAssets=
                  {noteAgentApplyResult.actionsApplied.saveLearnedAssets ? "true" : "false"}
                </p>
                <ul>
                  {noteAgentApplyResult.writtenPaths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </div>

              <PhaseReportBlock report={noteAgentApplyResult.phaseReport} />
            </div>
          ) : (
            <p className="helper-text">写回后，这里会显示目标路径和 apply 阶段的验证结果。</p>
          )}
        </section>
      </article>

      <article className="card stack stack--tight">
        <h3>任务</h3>
        {tasks.length ? (
          tasks.map((task) => (
            <div key={task.id} className="twitter-task-card">
              <div className="card-header">
                <div>
                  <strong>{task.title}</strong>
                  <p className="muted">{task.brief}</p>
                </div>
                <StatusChip status={task.status} />
              </div>
              <p className="helper-text">
                stage: {task.currentStage} / revision: {task.revisionCount}
              </p>
              <p className="helper-text">
                failure: {task.failureStage ?? "-"} / {task.failureType ?? "-"}
              </p>
              {task.reviewResult ? (
                <p className="helper-text">
                  review: {task.reviewResult.decision} / {task.reviewResult.reason}
                </p>
              ) : null}
              <button
                className="button button--ghost"
                disabled={pending || loading}
                onClick={() =>
                  runAction(async () => {
                    await runTwitterTraditionalTaskNow(task.id);
                    await hydrate(selectedAccountId);
                  })
                }
              >
                立即执行
              </button>
            </div>
          ))
        ) : (
          <p className="muted">暂无任务</p>
        )}
      </article>
    </div>
  );
}
