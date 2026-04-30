"use client";

import type {
  AccountStatusView,
  ZhihuNoteAgentApplyResult,
  ZhihuNoteAgentDraft,
  ZhihuNoteAgentGenerateInput,
  ZhihuNoteAgentPhaseReport,
  ZhihuSampleQuality
} from "@zhihu-mvp/shared";
import { useEffect, useMemo, useState, useTransition } from "react";
import { applyZhihuNoteAgentDraft, generateZhihuNoteAgentDraft } from "../lib/api";

type ZhihuNoteAgentPanelProps = {
  account: AccountStatusView;
};

type FeedbackState =
  | {
      tone: "success" | "error";
      text: string;
    }
  | null;

type NoteAgentConfigState = {
  sourceHandleOrUrl: string;
  sampleLimit: string;
  filterConfigVersion: string;
  manualSeedTexts: string;
};

type NoteAgentDraftFormState = {
  soulCandidateMarkdown: string;
};

const DEFAULT_NOTE_AGENT_CONFIG: NoteAgentConfigState = {
  sourceHandleOrUrl: "",
  sampleLimit: "35",
  filterConfigVersion: "v1",
  manualSeedTexts: ""
};

const DEFAULT_NOTE_AGENT_FORM: NoteAgentDraftFormState = {
  soulCandidateMarkdown: ""
};

export function ZhihuNoteAgentPanel({ account }: ZhihuNoteAgentPanelProps) {
  const [noteAgentConfig, setNoteAgentConfig] = useState<NoteAgentConfigState>(DEFAULT_NOTE_AGENT_CONFIG);
  const [noteAgentDraft, setNoteAgentDraft] = useState<ZhihuNoteAgentDraft | null>(null);
  const [noteAgentForm, setNoteAgentForm] = useState<NoteAgentDraftFormState>(DEFAULT_NOTE_AGENT_FORM);
  const [applyResult, setApplyResult] = useState<ZhihuNoteAgentApplyResult | null>(null);
  const [lastGeneratedInput, setLastGeneratedInput] = useState<ZhihuNoteAgentGenerateInput | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [actionMode, setActionMode] = useState<"generate" | "apply" | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setNoteAgentConfig(DEFAULT_NOTE_AGENT_CONFIG);
    setNoteAgentDraft(null);
    setNoteAgentForm(DEFAULT_NOTE_AGENT_FORM);
    setApplyResult(null);
    setLastGeneratedInput(null);
    setFeedback(null);
    setActionMode(null);
  }, [account.id]);

  const normalizedGenerateInput = useMemo(() => buildGenerateInput(noteAgentConfig), [noteAgentConfig]);
  const configChangedSinceGenerate = useMemo(() => {
    if (!lastGeneratedInput || !normalizedGenerateInput) {
      return false;
    }

    return JSON.stringify(lastGeneratedInput) !== JSON.stringify(normalizedGenerateInput);
  }, [lastGeneratedInput, normalizedGenerateInput]);

  const draftChangedSinceGenerate = useMemo(() => {
    if (!noteAgentDraft) {
      return false;
    }

    return noteAgentDraft.soulCandidateMarkdown !== noteAgentForm.soulCandidateMarkdown;
  }, [noteAgentDraft, noteAgentForm]);

  function updateConfig<K extends keyof NoteAgentConfigState>(key: K, value: NoteAgentConfigState[K]) {
    setNoteAgentConfig((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateDraftForm<K extends keyof NoteAgentDraftFormState>(key: K, value: NoteAgentDraftFormState[K]) {
    setNoteAgentForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function runAction(mode: "generate" | "apply", action: () => Promise<void>, fallback: string) {
    setFeedback(null);
    setActionMode(mode);

    startTransition(() => {
      void action()
        .catch((error) => {
          setFeedback({
            tone: "error",
            text: error instanceof Error ? error.message : fallback
          });
        })
        .finally(() => {
          setActionMode(null);
        });
    });
  }

  function handleGenerateDraft() {
    if (!normalizedGenerateInput) {
      setFeedback({
        tone: "error",
        text: "请输入知乎来源账号 URL 或用户名。"
      });
      return;
    }

    runAction("generate", async () => {
      const draft = await generateZhihuNoteAgentDraft(account.id, normalizedGenerateInput);
      setNoteAgentDraft(draft);
      setNoteAgentForm(buildNoteAgentDraftForm(draft));
      setApplyResult(null);
      setLastGeneratedInput(normalizedGenerateInput);
      setFeedback({
        tone: "success",
        text: `已生成 Soul 候选稿，样本质量：${sampleQualityLabel(draft.sampleQuality)}。`
      });
    }, "生成知乎 Soul 候选稿失败。");
  }

  function handleResetDraftEdits() {
    if (!noteAgentDraft) {
      return;
    }

    setNoteAgentForm(buildNoteAgentDraftForm(noteAgentDraft));
    setFeedback(null);
  }

  function handleApplyDraft() {
    if (!noteAgentDraft) {
      setFeedback({
        tone: "error",
        text: "请先生成并审阅 Soul 候选稿。"
      });
      return;
    }

    const editedDraft = buildEditableDraft(noteAgentDraft, noteAgentForm);

    runAction("apply", async () => {
      const result = await applyZhihuNoteAgentDraft(account.id, {
        draft: editedDraft,
        actions: {
          saveSoulCandidate: true
        }
      });

      setNoteAgentDraft(editedDraft);
      setNoteAgentForm(buildNoteAgentDraftForm(editedDraft));
      setApplyResult(result);
      setFeedback({
        tone: "success",
        text: `已写回 ${result.writtenPaths.length} 个文件：note-agent/soul_candidate.md。`
      });
    }, "写回知乎 Soul 候选稿失败。");
  }

  const sourceFilterReasonEntries = noteAgentDraft
    ? Object.entries(noteAgentDraft.collectionSummary.filterReasonCounts).sort((left, right) => right[1] - left[1])
    : [];

  return (
    <div className="stack">
      <section className="card">
        <div className="card-header">
          <div>
            <h3>知乎 Note Agent</h3>
            <p className="muted">当前只生成并保存账户级 Soul 候选稿；知乎 Writer / Review 不再读取 Note Agent RAG。</p>
          </div>
          <div className="inline-row">
            <span className="mini-badge mini-badge--accent">Soul Only</span>
            <span className="mini-badge">Target: {account.name}</span>
          </div>
        </div>

        {feedback ? (
          <div
            className="card"
            style={{
              marginTop: "1rem",
              padding: "1rem",
              borderColor: feedback.tone === "error" ? "rgba(166, 61, 64, 0.28)" : "rgba(45, 124, 88, 0.24)"
            }}
          >
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
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>1. 生成配置</h3>
            <p className="muted">填写来源知乎账号，生成一份可人工审阅的 Soul 候选稿。</p>
          </div>
          {configChangedSinceGenerate ? <span className="mini-badge mini-badge--accent">配置已变更</span> : null}
        </div>

        <div className="grid grid--two" style={{ marginTop: "1rem" }}>
          <label className="field">
            <span>来源知乎账号 URL / 用户名</span>
            <input
              value={noteAgentConfig.sourceHandleOrUrl}
              onChange={(event) => updateConfig("sourceHandleOrUrl", event.target.value)}
              placeholder="https://www.zhihu.com/people/source-user"
            />
          </label>

          <label className="field">
            <span>采样上限</span>
            <input
              type="number"
              min={1}
              max={60}
              value={noteAgentConfig.sampleLimit}
              onChange={(event) => updateConfig("sampleLimit", event.target.value)}
              placeholder="35"
            />
          </label>

          <label className="field">
            <span>过滤配置版本</span>
            <input
              value={noteAgentConfig.filterConfigVersion}
              onChange={(event) => updateConfig("filterConfigVersion", event.target.value)}
              placeholder="v1"
            />
          </label>

          <div className="field">
            <span>目标账号</span>
            <input value={`${account.name}${account.zhihuUserName ? ` / ${account.zhihuUserName}` : ""}`} readOnly />
          </div>
        </div>

        <label className="field" style={{ marginTop: "0.5rem" }}>
          <span>手动种子样本</span>
          <textarea
            rows={6}
            value={noteAgentConfig.manualSeedTexts}
            onChange={(event) => updateConfig("manualSeedTexts", event.target.value)}
            placeholder="每段一条样本，公开采样受限时使用。"
          />
        </label>

        <div className="button-row" style={{ marginTop: "1rem" }}>
          <button className="button" disabled={pending || !noteAgentConfig.sourceHandleOrUrl.trim()} onClick={handleGenerateDraft}>
            {actionMode === "generate" ? "生成中..." : "生成 Soul 候选稿"}
          </button>
          {noteAgentDraft ? (
            <button className="button button--ghost" disabled={pending} onClick={() => setApplyResult(null)}>
              清空写回结果
            </button>
          ) : null}
        </div>
      </section>

      {noteAgentDraft ? (
        <>
          <section className="card">
            <div className="card-header">
              <div>
                <h3>2. 采样诊断</h3>
                <p className="muted">用于判断这次候选稿是否值得合并到正式 Soul。</p>
              </div>
              <div className="inline-row">
                <span
                  className={`mini-badge ${
                    noteAgentDraft.sampleQuality === "strong" || noteAgentDraft.sampleQuality === "ok"
                      ? ""
                      : "mini-badge--accent"
                  }`}
                >
                  样本质量：{sampleQualityLabel(noteAgentDraft.sampleQuality)}
                </span>
                {noteAgentDraft.matchedBy ? <span className="mini-badge">映射：{matchedByLabel(noteAgentDraft.matchedBy)}</span> : null}
              </div>
            </div>

            <div
              className="grid"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                marginTop: "1rem"
              }}
            >
              <MetricCard label="请求采样" value={noteAgentDraft.collectionSummary.requestedSampleSize} />
              <MetricCard label="原始样本" value={noteAgentDraft.collectionSummary.fetchedSampleCount} />
              <MetricCard label="保留样本" value={noteAgentDraft.collectionSummary.keptSampleCount} />
              <MetricCard label="过滤样本" value={noteAgentDraft.collectionSummary.filteredOutCount} />
              <MetricCard label="生成时间" value={formatDateTime(noteAgentDraft.generatedAt)} />
            </div>

            <div className="grid grid--two" style={{ marginTop: "1rem", alignItems: "start" }}>
              <article className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <strong>摘要</strong>
                  <p className="helper-text" style={{ margin: 0 }}>
                    {noteAgentDraft.summary}
                  </p>
                  <p className="helper-text" style={{ margin: 0 }}>
                    来源：
                    {noteAgentDraft.sourceAccount.profileUrl ? (
                      <>
                        {" "}
                        <a href={noteAgentDraft.sourceAccount.profileUrl} target="_blank" rel="noreferrer">
                          {noteAgentDraft.sourceAccount.handleOrUrl}
                        </a>
                      </>
                    ) : (
                      ` ${noteAgentDraft.sourceAccount.handleOrUrl}`
                    )}
                  </p>
                  <p className="helper-text" style={{ margin: 0 }}>
                    账户键：{noteAgentDraft.accountKey}
                  </p>
                  {noteAgentDraft.diagnostics.length ? <MessageList title="诊断信息" items={noteAgentDraft.diagnostics} /> : null}
                  {noteAgentDraft.operatorNotes.length ? <MessageList title="操作提示" items={noteAgentDraft.operatorNotes} /> : null}
                </div>
              </article>

              <article className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <strong>文件路径</strong>
                  <pre style={{ marginTop: "0.75rem" }}>
                    {[
                      `accountMapPath: ${noteAgentDraft.sourcePaths.accountMapPath}`,
                      `noteAgentAssetDir: ${noteAgentDraft.sourcePaths.noteAgentAssetDir}`,
                      `soulCandidatePath: ${noteAgentDraft.sourcePaths.soulCandidatePath}`
                    ].join("\n")}
                  </pre>
                  <strong>过滤统计</strong>
                  {sourceFilterReasonEntries.length ? (
                    <div className="log-list" style={{ marginTop: "0.5rem" }}>
                      {sourceFilterReasonEntries.map(([reason, count]) => (
                        <div key={reason} className="inline-row">
                          <span className="helper-text">{filterReasonLabel(reason)}</span>
                          <span className="mini-badge">{count}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="helper-text" style={{ margin: 0 }}>
                      当前没有过滤原因记录。
                    </p>
                  )}
                </div>
              </article>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h3>3. Soul 候选稿</h3>
                <p className="muted">写回后只保存到 note-agent/soul_candidate.md，不覆盖正式 Soul。</p>
              </div>
              {draftChangedSinceGenerate ? <span className="mini-badge mini-badge--accent">已编辑</span> : null}
            </div>

            <label className="field" style={{ marginTop: "1rem" }}>
              <span>note-agent/soul_candidate.md</span>
              <textarea
                rows={22}
                value={noteAgentForm.soulCandidateMarkdown}
                onChange={(event) => updateDraftForm("soulCandidateMarkdown", event.target.value)}
              />
            </label>

            <div className="button-row" style={{ marginTop: "1rem" }}>
              <button className="button button--ghost" disabled={pending || !draftChangedSinceGenerate} onClick={handleResetDraftEdits}>
                重置到最近一次生成结果
              </button>
              <button className="button" disabled={pending || !noteAgentForm.soulCandidateMarkdown.trim()} onClick={handleApplyDraft}>
                {actionMode === "apply" ? "写回中..." : "写回 Soul 候选稿"}
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h3>4. 样本与阶段</h3>
                <p className="muted">保留诊断信息，但不保存为 RAG 或学习资产。</p>
              </div>
              {applyResult ? <span className="mini-badge">最近写回：{formatDateTime(applyResult.appliedAt)}</span> : null}
            </div>

            {applyResult ? (
              <article className="card" style={{ marginTop: "1rem", padding: "1rem" }}>
                <strong>写回结果</strong>
                <pre style={{ marginTop: "0.75rem" }}>{applyResult.writtenPaths.join("\n")}</pre>
              </article>
            ) : null}

            <div className="stack" style={{ marginTop: "1rem" }}>
              {noteAgentDraft.phaseReports.map((report) => (
                <PhaseReportCard key={`${report.phase}-${report.finishedAt}`} report={report} />
              ))}
            </div>

            <div className="stack" style={{ marginTop: "1rem" }}>
              <strong>样本预览</strong>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))"
                }}
              >
                {noteAgentDraft.samplePreview.map((sample) => (
                  <article key={`${sample.questionTitle}-${sample.answerUrl ?? sample.createdAt ?? "sample"}`} className="card" style={{ padding: "1rem" }}>
                    <div className="stack stack--tight">
                      <strong>{sample.questionTitle}</strong>
                      <p className="helper-text" style={{ margin: 0 }}>
                        {sample.createdAt ? formatDateTime(sample.createdAt) : "时间未知"}
                      </p>
                      <p className="helper-text" style={{ margin: 0 }}>
                        {sample.excerpt || trimText(sample.text, 160)}
                      </p>
                      {sample.answerUrl ? (
                        <a href={sample.answerUrl} target="_blank" rel="noreferrer" className="helper-text">
                          打开原回答
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="card">
          <p className="muted">还没有生成 Soul 候选稿。</p>
        </section>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="card" style={{ padding: "1rem" }}>
      <p className="muted">{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function MessageList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <strong>{title}</strong>
      <ul className="log-list" style={{ marginTop: "0.75rem" }}>
        {items.map((item) => (
          <li key={`${title}-${item}`} className="helper-text">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhaseReportCard({ report }: { report: ZhihuNoteAgentPhaseReport }) {
  return (
    <article className="card" style={{ padding: "1rem" }}>
      <div className="card-header">
        <div>
          <strong>{phaseLabel(report.phase)}</strong>
          <p className="helper-text" style={{ margin: "0.35rem 0 0" }}>
            开始：{formatDateTime(report.startedAt)} / 结束：{formatDateTime(report.finishedAt)}
          </p>
        </div>
        <span className={`mini-badge ${report.status === "passed" ? "" : "mini-badge--accent"}`}>
          {phaseStatusLabel(report.status)}
        </span>
      </div>

      <div className="grid grid--two" style={{ marginTop: "1rem", alignItems: "start" }}>
        <div>
          <strong>输入读取</strong>
          {report.inputsRead.length ? (
            <div className="log-list" style={{ marginTop: "0.75rem" }}>
              {report.inputsRead.map((item) => (
                <div key={`${report.phase}-${item.path}`} className="card" style={{ padding: "0.85rem" }}>
                  <div className="inline-row">
                    <div>
                      <div>{item.label}</div>
                      <div className="helper-text">{item.path}</div>
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
              没有额外输入。
            </p>
          )}
        </div>

        <div>
          <strong>阶段校验</strong>
          {report.validationChecks.length ? (
            <div className="log-list" style={{ marginTop: "0.75rem" }}>
              {report.validationChecks.map((item) => (
                <div key={`${report.phase}-${item.label}`} className="card" style={{ padding: "0.85rem" }}>
                  <div className="inline-row">
                    <div>
                      <div>{item.label}</div>
                      <div className="helper-text">{item.details}</div>
                    </div>
                    <span className={`mini-badge ${item.passed ? "" : "mini-badge--accent"}`}>
                      {item.passed ? "通过" : `${validationSeverityLabel(item.severity)}未通过`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="helper-text" style={{ marginTop: "0.75rem" }}>
              没有额外校验。
            </p>
          )}
        </div>
      </div>

      {report.diagnostics.length ? <MessageList title="诊断说明" items={report.diagnostics} /> : null}
    </article>
  );
}

function buildGenerateInput(config: NoteAgentConfigState): ZhihuNoteAgentGenerateInput | null {
  const sourceHandleOrUrl = config.sourceHandleOrUrl.trim();
  if (!sourceHandleOrUrl) {
    return null;
  }

  const manualSeedTexts = parseManualSeedTexts(config.manualSeedTexts);

  return {
    mode: "zhihu_answer_style_learning",
    sourceAccount: {
      platform: "zhihu",
      handleOrUrl: sourceHandleOrUrl
    },
    sampleLimit: parsePositiveInteger(config.sampleLimit, 35, 1, 60),
    filterConfigVersion: config.filterConfigVersion.trim() || "v1",
    ...(manualSeedTexts.length ? { manualSeedTexts } : {})
  };
}

function buildNoteAgentDraftForm(draft: ZhihuNoteAgentDraft): NoteAgentDraftFormState {
  return {
    soulCandidateMarkdown: draft.soulCandidateMarkdown
  };
}

function buildEditableDraft(draft: ZhihuNoteAgentDraft, form: NoteAgentDraftFormState): ZhihuNoteAgentDraft {
  return {
    ...draft,
    soulCandidateMarkdown: form.soulCandidateMarkdown
  };
}

function parsePositiveInteger(value: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
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

function sampleQualityLabel(value: ZhihuSampleQuality) {
  switch (value) {
    case "strong":
      return "strong";
    case "ok":
      return "ok";
    case "weak":
      return "weak";
    case "insufficient":
      return "insufficient";
    default:
      return value;
  }
}

function matchedByLabel(value: ZhihuNoteAgentDraft["matchedBy"]) {
  switch (value) {
    case "accountId":
      return "accountId";
    case "zhihuUserName":
      return "zhihuUserName";
    case "accountName":
      return "accountName";
    case "bootstrapped":
      return "bootstrapped";
    default:
      return "未命中";
  }
}

function phaseLabel(value: ZhihuNoteAgentPhaseReport["phase"]) {
  switch (value) {
    case "collect_source_samples":
      return "采样";
    case "draft_soul_candidate":
      return "生成 Soul 候选";
    case "apply_soul_candidate":
      return "写回 Soul 候选";
    default:
      return value;
  }
}

function phaseStatusLabel(value: ZhihuNoteAgentPhaseReport["status"]) {
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

function validationSeverityLabel(value: "error" | "warning" | "info") {
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

function filterReasonLabel(value: string) {
  const map: Record<string, string> = {
    brand_slogan: "品牌 slogan / 强 CTA",
    pure_announcement: "公告 / 活动 / 介绍型内容",
    near_duplicate: "近重复样本",
    repeated_opening: "重复开头",
    repeated_closing: "重复结尾",
    source_specific_identity: "来源账号身份锚点过强",
    low_information: "信息量过低"
  };

  return map[value] ?? value;
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function trimText(value: string, maxLength = 160) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
