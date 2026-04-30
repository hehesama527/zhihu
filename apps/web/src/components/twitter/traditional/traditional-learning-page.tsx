"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { TwitterAccountSoulDocument } from "../../../lib/twitter/api";
import { getTwitterTraditionalClientApiBaseUrl } from "../../../lib/twitter/http";
import type { TwitterTraditionalNoteAgentPhaseReport } from "../../../lib/twitter/traditional-api";
import {
  applyTwitterTraditionalNoteAgentDraft,
  generateTwitterTraditionalNoteAgentDraft,
  getTwitterTraditionalAccountSoul,
  type ApplyTwitterTraditionalNoteAgentInput,
  type ApplyTwitterTraditionalNoteAgentResult,
  type TwitterTraditionalNoteAgentDraft,
  type TwitterTraditionalNoteAgentGenerateInput
} from "../../../lib/twitter/traditional-api";
import { StatusChip } from "../../status-chip";
import { TraditionalAccountContext } from "./traditional-account-context";
import { buildErrorMessage, formatDateTime, useTwitterTraditionalWorkspace } from "./traditional-workspace";

type LearningStepId = 1 | 2 | 3 | 4 | 5;
type StepState = "current" | "done" | "ready" | "locked";

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

function trimText(value: string, maxLength = 96) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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
      return "采集公开样本";
    case "distill_style_profile":
      return "提炼风格画像";
    case "draft_account_assets":
      return "生成账户草稿";
    case "apply_account_assets":
      return "确认写回";
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

function getStepBadgeLabel(state: StepState) {
  switch (state) {
    case "current":
      return "进行中";
    case "done":
      return "已完成";
    case "ready":
      return "可进入";
    case "locked":
      return "待解锁";
    default:
      return state;
  }
}

function hasConfigChangedSinceDraft(
  draft: TwitterTraditionalNoteAgentDraft | null,
  config: NoteAgentConfigState
) {
  if (!draft) {
    return false;
  }

  const manualSeedTexts = parseManualSeedTexts(config.manualSeedTexts);

  return (
    draft.sourceAccount.handleOrUrl.trim() !== config.sourceHandleOrUrl.trim() ||
    draft.collectionSummary.requestedSampleSize !== parsePositiveInteger(config.sampleSize, 40) ||
    draft.collectionSummary.lookbackDays !== parsePositiveInteger(config.lookbackDays, 90) ||
    draft.collectionSummary.includeReplies !== config.includeReplies ||
    draft.collectionSummary.manualSeedCount !== manualSeedTexts.length
  );
}

function hasDraftChangedSinceLastApply(
  draft: TwitterTraditionalNoteAgentDraft | null,
  form: NoteAgentFormState
) {
  if (!draft) {
    return false;
  }

  return JSON.stringify(buildNoteAgentForm(draft)) !== JSON.stringify(form);
}

function PhaseReportCard({ report }: { report: TwitterTraditionalNoteAgentPhaseReport }) {
  return (
    <article className="traditional-phase-card">
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

      <div className="traditional-phase-card__grid">
        <div>
          <strong>读取的资料</strong>
          {report.inputsRead.length ? (
            <div className="log-list" style={{ marginTop: "0.75rem" }}>
              {report.inputsRead.map((item) => (
                <div key={`${report.phase}-${item.path}`} className="catalog-list__item">
                  <div className="catalog-list__item-top">
                    <div>
                      <div className="catalog-list__item-subtitle">{item.label}</div>
                      <div className="catalog-list__item-caption">{item.path}</div>
                    </div>
                    <span className={`mini-badge ${item.exists ? "" : "mini-badge--accent"}`}>
                      {item.exists ? "已读取" : "缺失"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="helper-text" style={{ marginTop: "0.75rem" }}>
              这一阶段没有记录额外输入。
            </p>
          )}
        </div>

        <div>
          <strong>阶段校验</strong>
          {report.validationChecks.length ? (
            <div className="log-list" style={{ marginTop: "0.75rem" }}>
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
          ) : (
            <p className="helper-text" style={{ marginTop: "0.75rem" }}>
              这一阶段没有额外校验项。
            </p>
          )}
        </div>
      </div>

      <div>
        <strong>补充说明</strong>
        {report.diagnostics.length ? (
          <ul className="traditional-list" style={{ marginTop: "0.75rem" }}>
            {report.diagnostics.map((item) => (
              <li key={`${report.phase}-${item}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="helper-text" style={{ marginTop: "0.75rem" }}>
            这一阶段没有额外诊断说明。
          </p>
        )}
      </div>
    </article>
  );
}

type StepCardProps = {
  step: number;
  title: string;
  summary: string;
  activeStep: LearningStepId;
  state: StepState;
  onOpen: () => void;
  children: ReactNode;
};

function StepCard({ step, title, summary, activeStep, state, onOpen, children }: StepCardProps) {
  const active = activeStep === step;

  return (
    <article className={`traditional-step-card ${active ? "traditional-step-card--active" : ""}`}>
      <button type="button" className="traditional-step-card__header" onClick={onOpen}>
        <div className="traditional-step-card__title">
          <span className={`mini-badge ${state === "current" ? "mini-badge--accent" : ""}`}>{`步骤 ${step}`}</span>
          <div>
            <strong>{title}</strong>
            <p className="helper-text">{summary}</p>
          </div>
        </div>
        <span className={`mini-badge ${state === "done" ? "" : "mini-badge--accent"}`}>
          {getStepBadgeLabel(state)}
        </span>
      </button>

      {active ? <div className="traditional-step-card__body">{children}</div> : null}
    </article>
  );
}

export function TraditionalLearningPage() {
  const {
    health,
    accounts,
    selectedAccountId,
    selectedAccount,
    loading,
    message,
    setMessage,
    refreshWorkspace,
    selectAccount
  } = useTwitterTraditionalWorkspace();
  const [pending, startTransition] = useTransition();
  const [activeStep, setActiveStep] = useState<LearningStepId>(1);
  const [soulDocument, setSoulDocument] = useState<TwitterAccountSoulDocument | null>(null);
  const [soulLoading, setSoulLoading] = useState(false);
  const [noteAgentConfig, setNoteAgentConfig] = useState<NoteAgentConfigState>(DEFAULT_NOTE_AGENT_CONFIG);
  const [noteAgentDraft, setNoteAgentDraft] = useState<TwitterTraditionalNoteAgentDraft | null>(null);
  const [noteAgentForm, setNoteAgentForm] = useState<NoteAgentFormState>(DEFAULT_NOTE_AGENT_FORM);
  const [noteAgentApplyResult, setNoteAgentApplyResult] = useState<ApplyTwitterTraditionalNoteAgentResult | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setNoteAgentDraft(null);
    setNoteAgentForm({ ...DEFAULT_NOTE_AGENT_FORM });
    setNoteAgentApplyResult(null);
    setActiveStep(1);
  }, [selectedAccountId]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!selectedAccountId) {
      setSoulDocument(null);
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
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSoulDocument(null);
        setMessage(buildErrorMessage(error, "加载目标账户定位摘要失败。"));
      })
      .finally(() => {
        if (!cancelled) {
          setSoulLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loading, selectedAccountId, setMessage]);

  function runAction(action: () => Promise<void>, fallback: string) {
    setMessage("");
    startTransition(() => {
      void action().catch((error) => {
        setMessage(buildErrorMessage(error, fallback));
      });
    });
  }

  function updateConfig<K extends keyof NoteAgentConfigState>(key: K, value: NoteAgentConfigState[K]) {
    setNoteAgentConfig((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateDraftForm<K extends keyof NoteAgentFormState>(key: K, value: NoteAgentFormState[K]) {
    setNoteAgentForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function resetLearningDraft(nextMessage?: string) {
    setNoteAgentDraft(null);
    setNoteAgentForm({ ...DEFAULT_NOTE_AGENT_FORM });
    setNoteAgentApplyResult(null);
    if (nextMessage) {
      setMessage(nextMessage);
    }
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
      setActiveStep(5);
    }, "写回学习结果失败。");
  }

  const manualSeedTexts = parseManualSeedTexts(noteAgentConfig.manualSeedTexts);
  const sourceConfigured = Boolean(noteAgentConfig.sourceHandleOrUrl.trim());
  const configChangedSinceDraft = hasConfigChangedSinceDraft(noteAgentDraft, noteAgentConfig);
  const draftEdited = hasDraftChangedSinceLastApply(noteAgentDraft, noteAgentForm);
  const hasWrittenBack = Boolean(noteAgentApplyResult);
  const visibleSamplePreview = noteAgentDraft?.samplePreview.slice(0, 12) ?? [];

  const stepState1: StepState = activeStep === 1 ? "current" : selectedAccount ? "done" : "ready";
  const stepState2: StepState = activeStep === 2 ? "current" : sourceConfigured ? "done" : selectedAccount ? "ready" : "locked";
  const stepState3: StepState = activeStep === 3 ? "current" : noteAgentDraft ? "done" : sourceConfigured ? "ready" : "locked";
  const stepState4: StepState = activeStep === 4 ? "current" : noteAgentDraft ? (activeStep === 5 ? "done" : "ready") : "locked";
  const stepState5: StepState = activeStep === 5 ? "current" : noteAgentApplyResult ? "done" : noteAgentDraft ? "ready" : "locked";

  return (
    <div className="stack traditional-page">
      <section className="page-header">
        <div className="stack stack--tight">
          <div className="inline-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <span className="mini-badge mini-badge--accent">X Traditional</span>
            <span className="mini-badge">风格学习</span>
            <span className="mini-badge">{accounts.length} 个目标账户</span>
          </div>
          <div>
            <h2>把参考账号的表达方式，沉淀成目标账户可用的学习资产</h2>
            <p className="muted">
              这一页只处理参考账号风格学习流程。先确认要写回到哪个目标账户，再设置参考账号、生成样本、审阅草稿，最后人工确认写回。
            </p>
            <p className="helper-text">
              API：{getTwitterTraditionalClientApiBaseUrl()} / 发布模式：{health?.publishMode ?? "-"} / 这里只提供安全写回，不会覆盖正式 Soul。
            </p>
          </div>
        </div>

        <div className="button-row">
          <Link className="button button--ghost" href="/twitter/traditional">
            返回总览
          </Link>
          <Link className="button button--ghost" href="/twitter/traditional/account">
            查看账号定位
          </Link>
          <button
            className="button"
            disabled={pending || loading}
            onClick={() => runAction(() => refreshWorkspace(selectedAccountId), "刷新学习页失败。")}
          >
            {pending || loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </section>

      {message ? (
        <div className="traditional-inline-feedback">
          <p>{message}</p>
        </div>
      ) : null}

      <section className="traditional-kpi-grid">
        <article className="traditional-kpi">
          <span className="traditional-kpi__label">目标账户</span>
          <strong className="traditional-kpi__value" style={{ fontSize: "1.25rem", lineHeight: 1.3 }}>
            {selectedAccount ? `@${selectedAccount.handle}` : "未选择"}
          </strong>
          <span className="helper-text">学习结果会按这个账户的资产目录写回。</span>
        </article>
        <article className="traditional-kpi">
          <span className="traditional-kpi__label">采样计划</span>
          <strong className="traditional-kpi__value" style={{ fontSize: "1.25rem", lineHeight: 1.3 }}>
            {`${parsePositiveInteger(noteAgentConfig.sampleSize, 40)} 条 / ${parsePositiveInteger(noteAgentConfig.lookbackDays, 90)} 天`}
          </strong>
          <span className="helper-text">
            {sourceConfigured ? "参考账号已设置，可直接进入生成样本。" : "先填参考账号，再开始生成。"}
          </span>
        </article>
        <article className="traditional-kpi">
          <span className="traditional-kpi__label">样本状态</span>
          <strong className="traditional-kpi__value" style={{ fontSize: "1.25rem", lineHeight: 1.3 }}>
            {noteAgentDraft ? `${noteAgentDraft.collectionSummary.collectedSampleCount} 条` : "未生成"}
          </strong>
          <span className="helper-text">
            {noteAgentDraft ? "已经拿到一轮学习草稿，可继续审阅。" : "生成后这里会显示可用样本数。"}
          </span>
        </article>
        <article className="traditional-kpi">
          <span className="traditional-kpi__label">写回状态</span>
          <strong className="traditional-kpi__value" style={{ fontSize: "1.25rem", lineHeight: 1.3 }}>
            {hasWrittenBack ? (draftEdited ? "待重写回" : "已写回") : draftEdited ? "待写回" : "待确认"}
          </strong>
          <span className="helper-text">
            {noteAgentApplyResult
              ? `最近一次写回：${formatDateTime(noteAgentApplyResult.appliedAt)}`
              : "写回前仍然需要人工确认。"}
          </span>
        </article>
      </section>

      <TraditionalAccountContext
        heading="当前学习目标账户"
        description="后续的参考账号配置、样本生成、草稿审阅和写回都会指向这个账户。先把目标固定下来，再进入五步向导。"
        selectionLabel="切换目标账户"
        helperText="切换后，当前学习草稿、采样结果和写回目标都会跟着切换。"
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        selectedAccount={selectedAccount}
        disabled={loading || pending}
        onSelectAccount={selectAccount}
        supplemental={
          <div className="traditional-summary-chip-row">
            <span className={`mini-badge ${activeStep === 1 ? "mini-badge--accent" : ""}`}>1. 目标账户</span>
            <span className={`mini-badge ${activeStep === 2 ? "mini-badge--accent" : ""}`}>2. 参考账号</span>
            <span className={`mini-badge ${activeStep === 3 ? "mini-badge--accent" : ""}`}>3. 生成样本</span>
            <span className={`mini-badge ${activeStep === 4 ? "mini-badge--accent" : ""}`}>4. 审阅草稿</span>
            <span className={`mini-badge ${activeStep === 5 ? "mini-badge--accent" : ""}`}>5. 确认写回</span>
          </div>
        }
      />

      <section className="traditional-step-list">
        <StepCard
          step={1}
          title="确认目标账户"
          summary={
            selectedAccount
              ? `当前将写回到 ${selectedAccount.name || `@${selectedAccount.handle}`}。先确认账号定位，再决定是否进入采样。`
              : "先选中本次要学习并写回的目标账户。"
          }
          activeStep={activeStep}
          state={stepState1}
          onOpen={() => setActiveStep(1)}
        >
          {selectedAccount ? (
            <div className="traditional-grid traditional-grid--overview">
              <article className="traditional-panel">
                <div className="traditional-panel__header">
                  <div>
                    <h3>{selectedAccount.name || `@${selectedAccount.handle}`}</h3>
                    <p className="muted">@{selectedAccount.handle}</p>
                  </div>
                  <div className="inline-row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
                    <StatusChip status={selectedAccount.status} />
                    {selectedAccount.authStatus ? <StatusChip status={selectedAccount.authStatus} /> : null}
                  </div>
                </div>

                <p className="traditional-summary-copy">
                  {selectedAccount.persona || "这个账户还没有补充明确的人设描述。"}
                </p>

                <div className="traditional-fact-list">
                  <div className="traditional-fact">
                    <span>目标读者</span>
                    <strong>{selectedAccount.targetAudience || "-"}</strong>
                  </div>
                  <div className="traditional-fact">
                    <span>风格约束</span>
                    <strong>{selectedAccount.styleGuide || "-"}</strong>
                  </div>
                  <div className="traditional-fact">
                    <span>最后发布时间</span>
                    <strong>{formatDateTime(selectedAccount.lastPublishedAt)}</strong>
                  </div>
                </div>

                <div className="stack stack--tight">
                  <strong>学习目标</strong>
                  {selectedAccount.learningTargets.length ? (
                    <div className="traditional-summary-chip-row">
                      {selectedAccount.learningTargets.map((item) => (
                        <span key={item} className="mini-badge">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="helper-text">这个账户还没有单独补充学习目标。</p>
                  )}

                  <p className="helper-text">
                    账号备注：{selectedAccount.manualNotes || "暂无补充备注。"}
                  </p>
                </div>
              </article>

              <article className="traditional-panel">
                <div className="stack stack--tight">
                  <div>
                    <strong>进入下一步前，先确认三件事</strong>
                    <ul className="traditional-list" style={{ marginTop: "0.75rem" }}>
                      <li>这次学习的目标是“收紧表达风格”，不是代替任务 brief。</li>
                      <li>如果账号定位还在调整，先去“账号定位”页补齐，再回来做风格学习。</li>
                      <li>参考账号应该是你想学它“说话方式”的对象，而不是单条爆款来源。</li>
                    </ul>
                  </div>

                  <div>
                    <strong>当前 Soul 摘要</strong>
                    {soulLoading ? (
                      <p className="helper-text" style={{ marginTop: "0.75rem" }}>
                        正在读取当前账户定位...
                      </p>
                    ) : soulDocument ? (
                      <div className="traditional-fact-list" style={{ marginTop: "0.75rem" }}>
                        <div className="traditional-fact">
                          <span>当前版本</span>
                          <strong>{`v${soulDocument.version}`}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>核心身份</span>
                          <strong>{trimText(soulDocument.coreIdentity || "-")}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>目标读者</span>
                          <strong>{trimText(soulDocument.targetReader || "-")}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>最近更新</span>
                          <strong>{formatDateTime(soulDocument.lastUpdatedAt)}</strong>
                        </div>
                      </div>
                    ) : (
                      <p className="helper-text" style={{ marginTop: "0.75rem" }}>
                        暂时没读到账户 Soul 摘要，可以刷新后再试。
                      </p>
                    )}
                  </div>

                  <div className="button-row">
                    <button className="button" onClick={() => setActiveStep(2)}>
                      继续设置参考账号
                    </button>
                  </div>
                </div>
              </article>
            </div>
          ) : (
            <div className="traditional-empty-state">
              <p>当前没有可用的目标账户。</p>
              <p className="muted">先创建或补齐 Traditional 账户，再开始这一轮风格学习。</p>
              <div className="button-row">
                <Link className="button" href="/twitter/account">
                  去账号页处理
                </Link>
              </div>
            </div>
          )}
        </StepCard>

        <StepCard
          step={2}
          title="设置参考账号"
          summary={
            sourceConfigured
              ? `当前参考账号：${noteAgentConfig.sourceHandleOrUrl}。这一步决定系统去哪里学表达方式。`
              : "填参考账号主页、采样范围和必要的手工补样。"
          }
          activeStep={activeStep}
          state={stepState2}
          onOpen={() => setActiveStep(2)}
        >
          {selectedAccount ? (
            <>
              <div className="traditional-grid traditional-grid--overview">
                <article className="traditional-panel">
                  <div className="traditional-panel__header">
                    <div>
                      <h3>参考账号配置</h3>
                      <p className="muted">优先填账号主页，不要填单条推文。这里只决定采样对象和范围。</p>
                    </div>
                  </div>

                  <div className="traditional-form-grid">
                    <label className="field traditional-form-grid__full">
                      <span>参考账号主页</span>
                      <input
                        placeholder="https://x.com/PhyrexNi"
                        value={noteAgentConfig.sourceHandleOrUrl}
                        onChange={(event) => updateConfig("sourceHandleOrUrl", event.target.value)}
                      />
                    </label>

                    <label className="field">
                      <span>计划抓取样本数</span>
                      <input
                        value={noteAgentConfig.sampleSize}
                        onChange={(event) => updateConfig("sampleSize", event.target.value)}
                      />
                    </label>

                    <label className="field">
                      <span>回看周期（天）</span>
                      <input
                        value={noteAgentConfig.lookbackDays}
                        onChange={(event) => updateConfig("lookbackDays", event.target.value)}
                      />
                    </label>

                    <label className="field">
                      <span>是否纳入回复</span>
                      <select
                        value={noteAgentConfig.includeReplies ? "true" : "false"}
                        onChange={(event) => updateConfig("includeReplies", event.target.value === "true")}
                      >
                        <option value="false">只看主页正文</option>
                        <option value="true">包含回复表达</option>
                      </select>
                    </label>

                    <div className="traditional-empty-state traditional-empty-state--compact">
                      <p>手工补样</p>
                      <p className="muted">浏览器采样受限时，这些文本会作为兜底样本一起参与学习。</p>
                    </div>

                    <label className="field traditional-form-grid__full">
                      <span>手工补充样本</span>
                      <textarea
                        rows={6}
                        placeholder="可选。建议每条样本之间空一行。"
                        value={noteAgentConfig.manualSeedTexts}
                        onChange={(event) => updateConfig("manualSeedTexts", event.target.value)}
                      />
                    </label>
                  </div>
                </article>

                <article className="traditional-panel">
                  <div className="stack stack--tight">
                    <div>
                      <strong>本轮采样计划</strong>
                      <div className="traditional-fact-list" style={{ marginTop: "0.75rem" }}>
                        <div className="traditional-fact">
                          <span>目标账户</span>
                          <strong>{`@${selectedAccount.handle}`}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>参考账号</span>
                          <strong>{trimText(noteAgentConfig.sourceHandleOrUrl.trim() || "待填写")}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>采样范围</span>
                          <strong>{`${parsePositiveInteger(noteAgentConfig.sampleSize, 40)} 条 / ${parsePositiveInteger(noteAgentConfig.lookbackDays, 90)} 天`}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>手工补样</span>
                          <strong>{manualSeedTexts.length ? `${manualSeedTexts.length} 条` : "未填写"}</strong>
                        </div>
                      </div>
                    </div>

                    <div>
                      <strong>操作建议</strong>
                      <ul className="traditional-list" style={{ marginTop: "0.75rem" }}>
                        <li>优先选择表达稳定、长期输出的账号，不要只看一两条临时热点内容。</li>
                        <li>如果目标是“学口吻”，样本数宁可少一点，也要保证来源一致。</li>
                        <li>回复是否纳入，取决于你是否也想学习对话时的语气和节奏。</li>
                      </ul>
                    </div>

                    {configChangedSinceDraft ? (
                      <p className="helper-text">
                        你已经改过参考设置。当前草稿仍然是上一次生成结果，重新生成后这些变化才会生效。
                      </p>
                    ) : null}
                  </div>
                </article>
              </div>

              <div className="button-row">
                <button className="button button--ghost" onClick={() => setActiveStep(1)}>
                  返回目标账户
                </button>
                <button
                  className="button"
                  disabled={!selectedAccountId || !sourceConfigured}
                  onClick={() => setActiveStep(3)}
                >
                  下一步：生成样本
                </button>
              </div>
            </>
          ) : (
            <div className="traditional-empty-state traditional-empty-state--compact">
              <p>先选好目标账户，再配置参考账号。</p>
            </div>
          )}
        </StepCard>

        <StepCard
          step={3}
          title="生成样本"
          summary={
            noteAgentDraft
              ? `已拿到 ${noteAgentDraft.collectionSummary.collectedSampleCount} 条可用样本。先看样本质量，再决定是否进入草稿审阅。`
              : "触发一次学习草稿生成，拿到样本预览、学习摘要和阶段结果。"
          }
          activeStep={activeStep}
          state={stepState3}
          onOpen={() => setActiveStep(3)}
        >
          {selectedAccount ? (
            <>
              {generating ? (
                <div className="traditional-loading-indicator">
                  <div className="traditional-loading-bar">
                    <div className="traditional-loading-bar__fill" />
                  </div>
                  <p className="helper-text" style={{ textAlign: "center", marginTop: "0.5rem" }}>
                    正在生成学习样本，这可能需要几分钟时间...
                  </p>
                </div>
              ) : null}

              <div className="button-row">
                <button
                  className="button"
                  disabled={pending || loading || generating || !selectedAccountId || !sourceConfigured}
                  onClick={() =>
                    runAction(async () => {
                      if (!selectedAccountId) {
                        return;
                      }

                      setGenerating(true);
                      try {
                        const draft = await generateTwitterTraditionalNoteAgentDraft(
                          selectedAccountId,
                          buildGenerateInput(noteAgentConfig)
                        );
                        setNoteAgentDraft(draft);
                        setNoteAgentForm(buildNoteAgentForm(draft));
                        setNoteAgentApplyResult(null);
                        setActiveStep(3);
                        setMessage("已生成一轮学习样本和草稿，可以先看样本质量，再继续审阅。");
                      } finally {
                        setGenerating(false);
                      }
                    }, "生成学习样本失败。")
                  }
                >
                  {generating ? "生成中..." : noteAgentDraft ? "重新生成样本" : "生成学习样本"}
                </button>
                <button
                  className="button button--ghost"
                  disabled={pending || !noteAgentDraft}
                  onClick={() => resetLearningDraft("已清空本轮草稿，可以重新生成。")}
                >
                  清空本轮草稿
                </button>
              </div>

              {configChangedSinceDraft ? (
                <div className="traditional-inline-feedback">
                  <p>参考设置已变更。想让新的配置生效，请重新生成样本。</p>
                </div>
              ) : null}

              {noteAgentDraft ? (
                <div className="stack stack--tight">
                  <section className="traditional-kpi-grid">
                    <article className="traditional-kpi">
                      <span className="traditional-kpi__label">可用样本</span>
                      <strong className="traditional-kpi__value">{noteAgentDraft.collectionSummary.collectedSampleCount}</strong>
                      <span className="helper-text">最终进入学习阶段的样本数量。</span>
                    </article>
                    <article className="traditional-kpi">
                      <span className="traditional-kpi__label">主页采样</span>
                      <strong className="traditional-kpi__value">{noteAgentDraft.collectionSummary.timelineSampleCount}</strong>
                      <span className="helper-text">直接从参考账号公开时间线拿到的样本。</span>
                    </article>
                    <article className="traditional-kpi">
                      <span className="traditional-kpi__label">手工补样</span>
                      <strong className="traditional-kpi__value">{noteAgentDraft.collectionSummary.manualSeedCount}</strong>
                      <span className="helper-text">你手工补充进本轮学习的样本数。</span>
                    </article>
                    <article className="traditional-kpi">
                      <span className="traditional-kpi__label">浏览器采样</span>
                      <strong className="traditional-kpi__value" style={{ fontSize: "1.2rem", lineHeight: 1.25 }}>
                        {noteAgentDraft.collectionSummary.browserCollectionSucceeded ? "成功" : "受限"}
                      </strong>
                      <span className="helper-text">受限时会回退到手工补样或其他兜底材料。</span>
                    </article>
                  </section>

                  <div className="traditional-grid traditional-grid--overview">
                    <article className="traditional-panel">
                      <div className="traditional-panel__header">
                        <div>
                          <h3>这轮学习抓到了什么</h3>
                          <p className="muted">{noteAgentDraft.summary}</p>
                        </div>
                      </div>

                      <div className="traditional-fact-list">
                        <div className="traditional-fact">
                          <span>参考账号</span>
                          <strong>{trimText(noteAgentDraft.sourceAccount.handleOrUrl)}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>标准化 handle</span>
                          <strong>{noteAgentDraft.sourceAccount.normalizedHandle ?? "-"}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>生成时间</span>
                          <strong>{formatDateTime(noteAgentDraft.generatedAt)}</strong>
                        </div>
                        <div className="traditional-fact">
                          <span>匹配方式</span>
                          <strong>{noteAgentDraft.matchedBy ?? "-"}</strong>
                        </div>
                      </div>

                      {noteAgentDraft.operatorNotes.length ? (
                        <div>
                          <strong>操作提醒</strong>
                          <ul className="traditional-list" style={{ marginTop: "0.75rem" }}>
                            {noteAgentDraft.operatorNotes.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </article>

                    <article className="traditional-panel">
                      <div className="traditional-panel__header">
                        <div>
                          <h3>样本预览</h3>
                          <p className="muted">
                            {noteAgentDraft.samplePreview.length > visibleSamplePreview.length
                              ? `当前只展示前 ${visibleSamplePreview.length} 条，完整原始样本可在审阅页展开 provenance 资产查看。`
                              : "先快速确认采到的是你想学的表达方式。"}
                          </p>
                        </div>
                      </div>

                      {visibleSamplePreview.length ? (
                        <div className="log-list">
                          {visibleSamplePreview.map((item, index) => (
                            <div key={`${item.source}-${index}`} className="catalog-list__item">
                              <div className="catalog-list__item-top">
                                <div>
                                  <div className="catalog-list__item-subtitle">
                                    {item.source === "timeline" ? "主页样本" : "手工补样"} / {formatDateTime(item.publishedAt)}
                                  </div>
                                  <div className="catalog-list__item-caption">{item.tweetUrl ?? "未记录原始链接"}</div>
                                </div>
                              </div>
                              <div className="catalog-list__item-caption">{item.text}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="helper-text">当前没有可以展示的样本预览。</p>
                      )}
                    </article>
                  </div>

                  <details>
                    <summary>展开阶段校验、浏览器诊断和详细说明</summary>
                    <div className="stack stack--tight" style={{ marginTop: "1rem" }}>
                      {noteAgentDraft.phaseReports.map((report) => (
                        <PhaseReportCard key={report.phase} report={report} />
                      ))}

                      {noteAgentDraft.diagnostics.length ? (
                        <article className="traditional-panel">
                          <div className="stack stack--tight">
                            <strong>全局诊断</strong>
                            <ul className="traditional-list">
                              {noteAgentDraft.diagnostics.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </article>
                      ) : null}

                      {noteAgentDraft.collectionSummary.browserDiagnostics.length ? (
                        <article className="traditional-panel">
                          <div className="stack stack--tight">
                            <strong>浏览器采样说明</strong>
                            <ul className="traditional-list">
                              {noteAgentDraft.collectionSummary.browserDiagnostics.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </article>
                      ) : null}
                    </div>
                  </details>

                  <div className="button-row">
                    <button className="button button--ghost" onClick={() => setActiveStep(2)}>
                      返回参考账号
                    </button>
                    <button className="button" disabled={!noteAgentDraft} onClick={() => setActiveStep(4)}>
                      下一步：审阅草稿
                    </button>
                  </div>
                </div>
              ) : (
                <div className="traditional-empty-state traditional-empty-state--compact">
                  <p>先点击“生成学习样本”，这里才会出现样本预览和阶段结果。</p>
                  <p className="muted">生成成功后，先检查采到的是不是你真正想学的表达方式，再往下走。</p>
                </div>
              )}
            </>
          ) : (
            <div className="traditional-empty-state traditional-empty-state--compact">
              <p>先选目标账户并设置参考账号，再开始生成样本。</p>
            </div>
          )}
        </StepCard>

        <StepCard
          step={4}
          title="审阅草稿"
          summary={
            noteAgentDraft
              ? "把风格画像、Soul 候选稿和规则文档调到你认可的版本，再决定是否写回。"
              : "生成草稿后，这一步会出现可编辑的学习结果。"
          }
          activeStep={activeStep}
          state={stepState4}
          onOpen={() => setActiveStep(4)}
        >
          {noteAgentDraft ? (
            <div className="stack stack--tight">
              <article className="traditional-panel">
                <div className="traditional-panel__header">
                  <div>
                    <h3>本轮草稿摘要</h3>
                    <p className="muted">{noteAgentDraft.summary}</p>
                  </div>
                  <span className="mini-badge">{formatDateTime(noteAgentDraft.generatedAt)}</span>
                </div>

                {configChangedSinceDraft ? (
                  <p className="helper-text">
                    参考设置已经变化。当前草稿仍然对应上一轮样本，如需对齐新设置，请先回到第 3 步重新生成。
                  </p>
                ) : null}

                {draftEdited ? (
                  <p className="helper-text">
                    {hasWrittenBack
                      ? "你已经修改了草稿内容，但这些改动还没有重新写回。"
                      : "你已经修改了草稿内容，写回时会以当前版本为准。"}
                  </p>
                ) : null}

                {noteAgentDraft.operatorNotes.length ? (
                  <ul className="traditional-list">
                    {noteAgentDraft.operatorNotes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </article>

              <label className="field">
                <span>风格画像</span>
                <textarea
                  rows={14}
                  value={noteAgentForm.learnedStyleProfileMarkdown}
                  onChange={(event) => updateDraftForm("learnedStyleProfileMarkdown", event.target.value)}
                />
                  <small className="helper-text">
                    写回 `learned_style_profile.md`，给后续写作 / 审核环节一个整体风格基线。
                  </small>
              </label>

              <label className="field">
                <span>Soul 候选稿</span>
                <textarea
                  rows={14}
                  value={noteAgentForm.soulCandidateMarkdown}
                  onChange={(event) => updateDraftForm("soulCandidateMarkdown", event.target.value)}
                />
                <small className="helper-text">
                  写回 `soul_candidate.md`，适合先给团队复核，不会直接覆盖正式 Soul。
                </small>
              </label>

              <div className="traditional-form-grid">
                <label className="field">
                  <span>表达规则</span>
                  <textarea
                    rows={12}
                    value={noteAgentForm.styleRulesMarkdown}
                    onChange={(event) => updateDraftForm("styleRulesMarkdown", event.target.value)}
                  />
                  <small className="helper-text">写回 `style_rules.md`，约束整体语气、结构和表达动作。</small>
                </label>

                <label className="field">
                  <span>数字表达规则</span>
                  <textarea
                    rows={12}
                    value={noteAgentForm.numberExpressionRulesMarkdown}
                    onChange={(event) => updateDraftForm("numberExpressionRulesMarkdown", event.target.value)}
                  />
                  <small className="helper-text">
                    写回 `number_expression_rules.md`，约束数字、百分比和定量表达的口径。
                  </small>
                </label>

                <label className="field traditional-form-grid__full">
                  <span>审阅标准</span>
                  <textarea
                    rows={12}
                    value={noteAgentForm.reviewRubricMarkdown}
                    onChange={(event) => updateDraftForm("reviewRubricMarkdown", event.target.value)}
                  />
                  <small className="helper-text">
                    写回 `review_rubric.md`，帮助审核阶段判断“像不像这个账户在说话”。
                  </small>
                </label>
              </div>

              <details>
                <summary>展开原始样本、来源映射和读写路径</summary>
                <div className="stack stack--tight" style={{ marginTop: "1rem" }}>
                  <div className="traditional-grid traditional-grid--overview">
                    <article className="traditional-panel">
                      <div className="stack stack--tight">
                        <strong>读取路径</strong>
                        <p className="helper-text">README：{noteAgentDraft.sourcePaths.readme}</p>
                        <p className="helper-text">账号配置目录：{noteAgentDraft.sourcePaths.accountConfigDir}</p>
                        <p className="helper-text">RAG 目录：{noteAgentDraft.sourcePaths.ragLibraryDir}</p>
                      </div>
                    </article>
                    <article className="traditional-panel">
                      <div className="stack stack--tight">
                        <strong>目标写回路径</strong>
                        <p className="helper-text">Soul 候选稿：{noteAgentDraft.sourcePaths.soulCandidatePath}</p>
                        <p className="helper-text">学习资产目录：{noteAgentDraft.sourcePaths.noteAgentAssetDir}</p>
                      </div>
                    </article>
                  </div>

                  <label className="field">
                    <span>原始样本资产</span>
                    <textarea
                      rows={12}
                      value={noteAgentForm.learnedSamplesJsonl}
                      onChange={(event) => updateDraftForm("learnedSamplesJsonl", event.target.value)}
                    />
                    <small className="helper-text">对应 `learned_samples.jsonl`，用于追溯这轮学习看过哪些样本。</small>
                  </label>

                  <label className="field">
                    <span>来源映射</span>
                    <textarea
                      rows={12}
                      value={noteAgentForm.sourceMapYaml}
                      onChange={(event) => updateDraftForm("sourceMapYaml", event.target.value)}
                    />
                    <small className="helper-text">对应 `source_map.yaml`，记录样本与来源的映射关系。</small>
                  </label>
                </div>
              </details>

              <div className="button-row">
                <button className="button button--ghost" onClick={() => setActiveStep(3)}>
                  返回生成样本
                </button>
                <button className="button" onClick={() => setActiveStep(5)}>
                  下一步：确认写回
                </button>
              </div>
            </div>
          ) : (
            <div className="traditional-empty-state traditional-empty-state--compact">
              <p>先完成第 3 步生成样本，这里才会出现可审阅的草稿。</p>
            </div>
          )}
        </StepCard>

        <StepCard
          step={5}
          title="确认写回"
          summary={
            noteAgentApplyResult
              ? `最近一次写回时间：${formatDateTime(noteAgentApplyResult.appliedAt)}。`
              : "选择写回方式，把确认过的学习结果落到账户资产目录。"
          }
          activeStep={activeStep}
          state={stepState5}
          onOpen={() => setActiveStep(5)}
        >
          {noteAgentDraft ? (
            <div className="stack stack--tight">
              <article className="traditional-panel">
                <div className="traditional-fact-list">
                  <div className="traditional-fact">
                    <span>目标账户</span>
                    <strong>{selectedAccount ? `@${selectedAccount.handle}` : "-"}</strong>
                  </div>
                  <div className="traditional-fact">
                    <span>草稿状态</span>
                    <strong>
                      {hasWrittenBack ? (draftEdited ? "已改动，待重写回" : "最近已写回") : draftEdited ? "已审阅，待写回" : "可写回"}
                    </strong>
                  </div>
                  <div className="traditional-fact">
                    <span>本页不会做的事</span>
                    <strong>不会直接覆盖正式 Soul</strong>
                  </div>
                  <div className="traditional-fact">
                    <span>当前资产目录</span>
                    <strong>{trimText(noteAgentDraft.sourcePaths.noteAgentAssetDir)}</strong>
                  </div>
                </div>

                {draftEdited ? (
                  <p className="helper-text">
                    {hasWrittenBack
                      ? "你已经在第 4 步修改了草稿。要把最新版本落地，请重新执行下面的写回动作。"
                      : "当前草稿还没有正式写回。确认无误后，执行下面的写回动作即可。"}
                  </p>
                ) : null}
              </article>

              <section className="traditional-action-grid traditional-action-grid--hub">
                <article className="traditional-action-card traditional-action-card--primary">
                  <strong>写回账号学习资产</strong>
                  <p>把本轮确认过的规则文档和学习资产写回到账户级目录，供后续写作 / 审核环节使用。</p>
                  <button
                    className="button"
                    disabled={pending || loading || !selectedAccountId}
                    onClick={() =>
                      applyNoteAgent(
                        {
                          writeRagDocs: true,
                          saveSoulCandidate: false,
                          saveLearnedAssets: true
                        },
                        "已把本轮学习资产写回到账户级目录。"
                      )
                    }
                  >
                    确认写回学习资产
                  </button>
                </article>

                <article className="traditional-action-card">
                  <strong>只保存 Soul 候选稿</strong>
                  <p>如果你想先让团队看一版 Soul 候选稿，可以只保存候选稿，不动其他学习资产。</p>
                  <button
                    className="button button--ghost"
                    disabled={pending || loading || !selectedAccountId}
                    onClick={() =>
                      applyNoteAgent(
                        {
                          writeRagDocs: false,
                          saveSoulCandidate: true,
                          saveLearnedAssets: false
                        },
                        "已保存 Soul 候选稿。"
                      )
                    }
                  >
                    只保存候选稿
                  </button>
                </article>
              </section>

              {noteAgentApplyResult ? (
                <div className="stack stack--tight">
                  <article className="traditional-panel">
                    <div className="card-header">
                      <div>
                        <strong>最近一次写回结果</strong>
                        <p className="helper-text">写回时间：{formatDateTime(noteAgentApplyResult.appliedAt)}</p>
                      </div>
                      <span className="mini-badge mini-badge--accent">安全写回</span>
                    </div>

                    <p className="helper-text">
                      动作：
                      {` RAG=${noteAgentApplyResult.actionsApplied.writeRagDocs ? "true" : "false"} / SoulCandidate=${noteAgentApplyResult.actionsApplied.saveSoulCandidate ? "true" : "false"} / LearnedAssets=${noteAgentApplyResult.actionsApplied.saveLearnedAssets ? "true" : "false"}`}
                    </p>

                    <ul className="traditional-list">
                      {noteAgentApplyResult.writtenPaths.map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                    </ul>
                  </article>

                  <details>
                    <summary>展开写回阶段校验</summary>
                    <div style={{ marginTop: "1rem" }}>
                      <PhaseReportCard report={noteAgentApplyResult.phaseReport} />
                    </div>
                  </details>
                </div>
              ) : (
                <div className="traditional-empty-state traditional-empty-state--compact">
                  <p>确认写回后，这里会显示写入路径和 apply 阶段的校验结果。</p>
                </div>
              )}

              <div className="button-row">
                <button className="button button--ghost" onClick={() => setActiveStep(4)}>
                  返回审阅草稿
                </button>
              </div>
            </div>
          ) : (
            <div className="traditional-empty-state traditional-empty-state--compact">
              <p>先完成草稿生成和审阅，再进入写回确认。</p>
            </div>
          )}
        </StepCard>
      </section>
    </div>
  );
}
