"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  activateTwitterTraditionalPromptVersion,
  createTwitterTraditionalPrompt,
  getTwitterTraditionalPrompt,
  getTwitterTraditionalPrompts,
  testTwitterTraditionalPrompt,
  type TwitterTraditionalPrompt,
  type TwitterTraditionalPromptCategory,
  type TwitterTraditionalPromptDetail
} from "../../lib/twitter/traditional-api";

type FlashState = {
  tone: "success" | "error" | "info";
  message: string;
};

const PROMPT_ORDER: TwitterTraditionalPromptCategory[] = ["main", "writing", "review", "publish", "note"];

const PROMPT_TITLES: Record<TwitterTraditionalPromptCategory, string> = {
  main: "传统链路主控智能体",
  writing: "传统链路写作智能体",
  review: "传统链路审核智能体",
  publish: "传统链路发布智能体",
  note: "传统链路笔记智能体"
};

const TEST_INPUT_TEMPLATES: Record<TwitterTraditionalPromptCategory, string> = {
  main: `{
  "accountSoulMarkdown": "# soul\\n关注市场结构与执行，不喊口号。",
  "goal": "围绕“市场反应为什么比标题本身更重要”选一个题。",
  "hotspotCandidates": [
    {
      "id": 101,
      "title": "宏观消息改变了市场对降息的预期",
      "summaryText": "声明发出后，风险资产开始重新定价。"
    }
  ],
  "recentPublishedSignals": [],
  "candidateTweetTargets": []
}`,
  writing: `{
  "accountSoulMarkdown": "# soul\\n交易员口吻，结构紧凑，少空话。",
  "taskTitle": "为什么大多数人等看到新闻时，交易窗口已经过去了",
  "taskBrief": "写一条单推，讲清预期与反应的区别。",
  "goal": "让读者别再只看标题做交易。",
  "preferredMode": "single",
  "selectedHotspots": [],
  "writerBrief": {
    "angle": "先解释预期，再解释市场反应",
    "goal": "像真实交易台笔记，不像模板文案",
    "mustInclude": ["预期差", "市场反应"],
    "mustAvoid": ["鸡汤口号"],
    "openingDirection": "从最常见的错误认知切入",
    "threadPlan": ""
  }
}`,
  review: `{
  "accountSoulMarkdown": "# soul\\n密度高、偏实操、不说教。",
  "taskTitle": "为什么 MACD 金叉经常失效",
  "draftPack": {
    "summary": "单条推文草稿",
    "posts": [
      "MACD 金叉本身不是买点，它只是价格走出来之后的滞后结果。真正有意义的是它出现时所处的结构位置。"
    ],
    "notes": []
  }
}`,
  publish: `{
  "taskTitle": "发布前检查",
  "reviewResult": {
    "decision": "approve",
    "reason": "内容已通过审核"
  },
  "publishPlan": {
    "shouldPublish": true,
    "mode": "single",
    "action": "post"
  }
}`,
  note: `{
  "stage": "draft_account_assets",
  "mode": "style_learning",
  "targetAccount": {
    "accountKey": "account_a",
    "handle": "account_a",
    "persona": "知识分享型交易账号",
    "targetAudience": "希望快速建立交易判断框架的中文用户"
  },
  "sourceAccount": {
    "platform": "x",
    "handleOrUrl": "https://x.com/PhyrexNi",
    "normalizedHandle": "PhyrexNi",
    "profileUrl": "https://x.com/PhyrexNi"
  },
  "collectionSummary": {
    "requestedSampleSize": 40,
    "lookbackDays": 90,
    "includeReplies": false,
    "collectedSampleCount": 18
  },
  "learnedStyleProfileMarkdown": "# account_a Learned Style Profile\\n\\n## 可学特征\\n- 先判断再补条件\\n\\n## 不可学特征\\n- 不复制观点\\n\\n## 数字表达\\n- 数字只保留关键支撑点\\n\\n## 开头方式\\n- 开头直接进判断\\n\\n## 收尾方式\\n- 收尾落在边界或执行提醒",
  "samplePreview": [
    {
      "source": "timeline",
      "text": "先说结论，这种流入结构更像短线情绪修复，不像趋势反转。",
      "publishedAt": "2026-04-19T08:00:00.000Z",
      "tweetUrl": "https://x.com/example/status/1"
    }
  ]
}`
};

function sortPrompts(prompts: TwitterTraditionalPrompt[]) {
  const order = new Map(PROMPT_ORDER.map((category, index) => [category, index]));
  return [...prompts].sort((left, right) => {
    const leftRank = order.get(left.category) ?? 999;
    const rightRank = order.get(right.category) ?? 999;
    return leftRank - rightRank;
  });
}

function resolvePromptId(prompts: TwitterTraditionalPrompt[], rawValue: string | null) {
  if (!rawValue) {
    return prompts[0]?.id ?? null;
  }

  const match = prompts.find(
    (prompt) =>
      prompt.id === rawValue || prompt.category === rawValue || prompt.name === rawValue || prompt.setName === rawValue
  );
  return match?.id ?? prompts[0]?.id ?? null;
}

function pickVersion(detail: TwitterTraditionalPromptDetail, preferredVersionId?: number | null) {
  if (preferredVersionId) {
    const preferred = detail.versions.find((version) => version.id === preferredVersionId);
    if (preferred) {
      return preferred;
    }
  }

  if (detail.activeVersionId) {
    const active = detail.versions.find((version) => version.id === detail.activeVersionId);
    if (active) {
      return active;
    }
  }

  return detail.versions[0] ?? null;
}

function latestVersionId(detail: TwitterTraditionalPromptDetail) {
  return detail.versions.reduce<number | null>((latest, version) => {
    if (latest === null || version.version > (detail.versions.find((item) => item.id === latest)?.version ?? -1)) {
      return version.id;
    }

    return latest;
  }, null);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatPromptCategory(category: TwitterTraditionalPromptCategory) {
  return PROMPT_TITLES[category];
}

function formatPromptDescription(category: TwitterTraditionalPromptCategory, description: string) {
  if (description.trim()) {
    return description;
  }

  if (category === "note") {
    return "笔记智能体现在只负责账户学习流程，提示词定义仍然是全局的，但执行会按目标账户手动触发。";
  }

  return "传统链路固定的全局提示词定义。";
}

function formatVersionStatus(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    active: "生效中",
    archived: "已归档"
  };

  return labels[status] ?? status;
}

type TwitterTraditionalPromptWorkbenchProps = {
  initialPromptId?: string | null;
};

export function TwitterTraditionalPromptWorkbench({
  initialPromptId = null
}: TwitterTraditionalPromptWorkbenchProps) {
  const [prompts, setPrompts] = useState<TwitterTraditionalPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<TwitterTraditionalPromptDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [testInput, setTestInput] = useState(TEST_INPUT_TEMPLATES.main);
  const [testResult, setTestResult] = useState("");
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void refreshPromptList(initialPromptId);
  }, [initialPromptId]);

  useEffect(() => {
    if (!selectedPromptId) {
      setSelectedPrompt(null);
      setSelectedVersionId(null);
      return;
    }

    void refreshPromptDetail(selectedPromptId);
  }, [selectedPromptId]);

  function hydrateEditor(nextPrompt: TwitterTraditionalPromptDetail, preferredVersionId?: number | null) {
    const version = pickVersion(nextPrompt, preferredVersionId);
    setSelectedPrompt(nextPrompt);
    setSelectedVersionId(version?.id ?? null);
    setDraftLabel(version?.label ?? nextPrompt.activeLabel ?? nextPrompt.name ?? "");
    setDraftNotes(version?.notes ?? nextPrompt.description ?? "");
    setDraftContent(version?.content ?? nextPrompt.template ?? "");
    setTestInput(TEST_INPUT_TEMPLATES[nextPrompt.category]);
    setTestResult("");
  }

  async function refreshPromptList(preferredPromptId?: string | null) {
    setLoadingList(true);

    try {
      const nextPrompts = sortPrompts(await getTwitterTraditionalPrompts());
      setPrompts(nextPrompts);
      setSelectedPromptId((current) => {
        if (current && nextPrompts.some((prompt) => prompt.id === current) && !preferredPromptId) {
          return current;
        }

        return resolvePromptId(nextPrompts, preferredPromptId ?? null) ?? null;
      });
      setFlash(null);
    } catch (error) {
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : "加载传统链路配置列表失败。"
      });
    } finally {
      setLoadingList(false);
    }
  }

  async function refreshPromptDetail(promptId: string, preferredVersionId?: number | null) {
    setLoadingDetail(true);

    try {
      const nextPrompt = await getTwitterTraditionalPrompt(promptId);
      hydrateEditor(nextPrompt, preferredVersionId);
    } catch (error) {
      setSelectedPrompt(null);
      setSelectedVersionId(null);
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : "加载传统链路配置详情失败。"
      });
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleVersionSelect(versionId: number) {
    if (!selectedPrompt) {
      return;
    }

    const version = selectedPrompt.versions.find((item) => item.id === versionId);
    if (!version) {
      return;
    }

    setSelectedVersionId(version.id);
    setDraftLabel(version.label);
    setDraftNotes(version.notes);
    setDraftContent(version.content);
  }

  function createVersion(activate: boolean) {
    if (!selectedPrompt) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const nextPrompt = await createTwitterTraditionalPrompt({
            name: draftLabel.trim(),
            description: draftNotes.trim(),
            category: selectedPrompt.category,
            template: draftContent,
            isActive: activate
          });

          const nextVersionId = activate ? nextPrompt.activeVersionId : latestVersionId(nextPrompt);
          hydrateEditor(nextPrompt, nextVersionId);
          await refreshPromptList(nextPrompt.id);
          setFlash({
            tone: "success",
            message: activate ? "新版本已保存并启用。" : "新草稿版本已保存。"
          });
        } catch (error) {
          setFlash({
            tone: "error",
            message: error instanceof Error ? error.message : "保存传统链路配置版本失败。"
          });
        }
      })();
    });
  }

  function activateSelectedVersion() {
    if (!selectedPrompt || !selectedVersionId) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const nextPrompt = await activateTwitterTraditionalPromptVersion(selectedVersionId);
          hydrateEditor(nextPrompt, nextPrompt.activeVersionId);
          await refreshPromptList(nextPrompt.id);
          setFlash({
            tone: "success",
            message: `已启用 ${formatPromptCategory(nextPrompt.category)} 的所选版本。`
          });
        } catch (error) {
          setFlash({
            tone: "error",
            message: error instanceof Error ? error.message : "启用传统链路配置版本失败。"
          });
        }
      })();
    });
  }

  function runPromptTest() {
    if (!selectedPrompt) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const parsedInput = JSON.parse(testInput) as Record<string, unknown>;
          const result = await testTwitterTraditionalPrompt(selectedPrompt.id, parsedInput);
          setTestResult(result);
          setFlash({
            tone: "success",
            message: "测试已完成。测试接口始终运行当前已生效的传统链路版本。"
          });
          await refreshPromptDetail(selectedPrompt.id, selectedPrompt.activeVersionId);
        } catch (error) {
          setFlash({
            tone: "error",
            message: error instanceof Error ? error.message : "传统链路配置测试失败。"
          });
        }
      })();
    });
  }

  return (
    <div className="stack">
      <section className="grid grid--two">
        <article className="card stack stack--tight">
          <h3>这里只做传统链路配置</h3>
          <p className="muted">
            作用域说明和主链路账户绑定已经拆出这个页面。这里聚焦传统链路全局提示词配置本身，不再承担整个配置中心总览。
          </p>
        </article>
        <article className="card stack stack--tight">
          <h3>返回与相关入口</h3>
          <div className="button-row">
            <Link href="/twitter/traditional" className="button">
              返回传统工作台总览
            </Link>
            <Link href="/twitter/prompts" className="button button--ghost">
              回配置中心总览
            </Link>
            <Link href="/twitter/prompts/scopes" className="button button--ghost">
              看作用域地图
            </Link>
          </div>
        </article>
      </section>

      {flash ? (
        <div className="card" style={{ padding: "1rem" }}>
          <p className="helper-text">{flash.message}</p>
        </div>
      ) : null}

      <article className="card stack stack--tight">
        <div className="card-header">
          <div>
            <h3>传统链路全局提示词配置</h3>
            <p className="muted">
              当前页面只维护传统链路全局提示词配置集合。账户差异主要由 Soul、RAG 和笔记智能体生成的账户级资产收紧。
            </p>
          </div>
          <span className="mini-badge">/x-traditional-api/prompts</span>
        </div>

        <div className="prompt-studio">
          <aside className="prompt-sidebar">
            {prompts.map((prompt) => {
              const isActive = prompt.id === selectedPromptId;

              return (
                <button
                  key={prompt.id}
                  className={`prompt-tab ${isActive ? "prompt-tab--active" : ""}`}
                  disabled={pending || loadingList}
                  onClick={() => setSelectedPromptId(prompt.id)}
                >
                  <span>{formatPromptCategory(prompt.category)}</span>
                  <small>{prompt.setName}</small>
                  <small>作用域：全局</small>
                  <small>{prompt.category === "note" ? "执行方式：按账户手动触发" : "执行方式：链路正常运行时生效"}</small>
                </button>
              );
            })}
          </aside>

          <section className="prompt-main stack">
            {loadingList || loadingDetail ? (
              <div className="card">
                <p className="helper-text">正在加载传统链路配置数据...</p>
              </div>
            ) : null}

            {selectedPrompt ? (
              <>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>{formatPromptCategory(selectedPrompt.category)}</h3>
                      <p className="muted">{formatPromptDescription(selectedPrompt.category, selectedPrompt.description)}</p>
                    </div>
                    <div className="button-row">
                      <span className="mini-badge">传统链路</span>
                      <span className="mini-badge">全局</span>
                      {selectedPrompt.category === "note" ? <span className="mini-badge mini-badge--accent">手动执行</span> : null}
                    </div>
                  </div>

                  <div className="grid grid--two">
                    <div className="card" style={{ padding: "1rem" }}>
                      <div className="stack stack--tight">
                        <strong>当前状态</strong>
                        <span className="helper-text">Prompt Set：{selectedPrompt.setName}</span>
                        <span className="helper-text">
                          生效版本：{selectedPrompt.activeVersion ? `v${selectedPrompt.activeVersion}` : "-"}
                        </span>
                        <span className="helper-text">版本数量：{selectedPrompt.versionCount}</span>
                        <span className="helper-text">最后测试：{formatDateTime(selectedPrompt.lastTestedAt)}</span>
                      </div>
                    </div>

                    <div className="card" style={{ padding: "1rem" }}>
                      <div className="stack stack--tight">
                        <strong>提示</strong>
                        <span className="helper-text">测试接口会跑当前生效版本，不会直接测试你尚未保存的编辑区内容。</span>
                        <span className="helper-text">笔记智能体虽然是全局提示词定义，但运行时会按目标账户手动触发。</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="stack stack--tight">
                    <h3>版本列表</h3>
                    <p className="muted">每次保存都会创建新版本。你可以先保存草稿，再决定是否启用。</p>
                  </div>

                  <div className="prompt-version-list" style={{ marginTop: "1rem" }}>
                    {selectedPrompt.versions.map((version) => (
                      <button
                        key={version.id}
                        className={`version-pill ${version.id === selectedVersionId ? "version-pill--active" : ""}`}
                        disabled={pending}
                        onClick={() => handleVersionSelect(version.id)}
                      >
                        <strong>
                          v{version.version} / #{version.id}
                          {version.id === selectedPrompt.activeVersionId ? " / 生效中" : ""}
                        </strong>
                        <small>
                          {version.label} / {formatVersionStatus(version.status)} / {formatDateTime(version.updatedAt)}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="stack stack--tight">
                    <h3>编辑区</h3>
                    <p className="muted">
                      当前载入版本：{selectedVersionId ? `#${selectedVersionId}` : "未选择"}。先在这里改，再决定保存草稿还是直接启用。
                    </p>
                  </div>

                  <label className="field">
                    <span>版本标签</span>
                    <input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} />
                  </label>

                  <label className="field">
                    <span>备注</span>
                    <textarea rows={3} value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
                  </label>

                  <label className="field">
                    <span>提示词内容</span>
                    <textarea
                      className="twitter-editor"
                      rows={20}
                      value={draftContent}
                      onChange={(event) => setDraftContent(event.target.value)}
                    />
                  </label>

                  <div className="button-row">
                    <button
                      className="button"
                      disabled={pending || !selectedPrompt || !draftLabel.trim() || !draftContent.trim()}
                      onClick={() => createVersion(false)}
                    >
                      保存为新草稿
                    </button>
                    <button
                      className="button button--ghost"
                      disabled={pending || !selectedPrompt || !draftLabel.trim() || !draftContent.trim()}
                      onClick={() => createVersion(true)}
                    >
                      保存并启用
                    </button>
                    <button
                      className="button button--ghost"
                      disabled={pending || !selectedPrompt || !selectedVersionId || selectedVersionId === selectedPrompt.activeVersionId}
                      onClick={activateSelectedVersion}
                    >
                      启用所选版本
                    </button>
                  </div>
                </div>

                <div className="grid grid--two">
                  <article className="card">
                    <div className="stack stack--tight">
                      <h3>测试输入</h3>
                      <p className="muted">示例输入已经按不同 agent 拆开。你可以先加载示例，再做针对性修改。</p>
                    </div>

                    <label className="field">
                      <span>输入 JSON</span>
                      <textarea
                        rows={14}
                        className="twitter-editor"
                        value={testInput}
                        onChange={(event) => setTestInput(event.target.value)}
                      />
                    </label>

                    <div className="button-row">
                      <button className="button" disabled={pending || !selectedPrompt} onClick={runPromptTest}>
                        测试生效版本
                      </button>
                      <button
                        className="button button--ghost"
                        disabled={pending || !selectedPrompt}
                        onClick={() => setTestInput(TEST_INPUT_TEMPLATES[selectedPrompt.category])}
                      >
                        载入示例
                      </button>
                    </div>
                  </article>

                  <article className="card">
                    <div className="stack stack--tight">
                      <h3>测试结果</h3>
                      <p className="muted">这里显示传统链路提示词配置测试接口返回的原始结果。</p>
                    </div>

                    {testResult ? (
                      <pre>{testResult}</pre>
                    ) : (
                      <div className="empty-state empty-state--compact">
                        <p>当前还没有测试结果。</p>
                      </div>
                    )}
                  </article>
                </div>

                <div className="card">
                  <div className="stack stack--tight">
                    <h3>最近测试记录</h3>
                    <p className="muted">这里直接展示当前提示词配置详情接口返回的测试记录。</p>
                  </div>

                  <div className="log-list" style={{ marginTop: "1rem" }}>
                    {selectedPrompt.testRuns.length ? (
                      selectedPrompt.testRuns.map((run) => (
                        <article key={run.id} className="log-item">
                          <p>
                            #{run.id} / 版本 {run.promptVersionId} / {formatDateTime(run.createdAt)}
                          </p>
                          <pre>{run.outputJson ?? run.errorText ?? "无输出"}</pre>
                        </article>
                      ))
                    ) : (
                      <p className="muted">当前还没有测试记录。</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="card">
                <p className="helper-text">当前还没有可用的传统链路提示词配置。</p>
              </div>
            )}
          </section>
        </div>
      </article>
    </div>
  );
}
