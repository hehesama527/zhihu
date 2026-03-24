"use client";

import type { PromptSetView, PromptVersionSummary } from "@zhihu-mvp/shared";
import { useEffect, useMemo, useState, useTransition } from "react";
import { fetchClientResponse, getClientApiBaseUrl } from "../lib/http";

type PromptStudioProps = {
  promptSets: PromptSetView[];
};

export function PromptStudio({ promptSets }: PromptStudioProps) {
  const [selectedName, setSelectedName] = useState(promptSets[0]?.name ?? "topic_agent");
  const selectedSet = useMemo(
    () => promptSets.find((item) => item.name === selectedName) ?? promptSets[0],
    [promptSets, selectedName]
  );
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(selectedSet?.versions[0]?.id ?? null);
  const selectedVersion = useMemo(
    () => selectedSet?.versions.find((item) => item.id === selectedVersionId) ?? selectedSet?.versions[0] ?? null,
    [selectedSet, selectedVersionId]
  );
  const [draftLabel, setDraftLabel] = useState(selectedVersion?.label ?? "");
  const [draftNotes, setDraftNotes] = useState(selectedVersion?.notes ?? "");
  const [draftContent, setDraftContent] = useState(selectedVersion?.content ?? selectedSet?.activeContent ?? "");
  const [testInput, setTestInput] = useState('{\n  "questionTitle": "新手怎么判断一个回测工具靠不靠谱？"\n}');
  const [result, setResult] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!selectedVersion) {
      return;
    }

    setDraftLabel(selectedVersion.label);
    setDraftNotes(selectedVersion.notes);
    setDraftContent(selectedVersion.content);
  }, [selectedVersion]);

  function hydrateDraft(version: PromptVersionSummary | null) {
    setSelectedVersionId(version?.id ?? null);
  }

  async function runRequest(path: string, options: RequestInit) {
    const { response, text, payload } = await fetchClientResponse(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers ?? {})
      }
    });

    if (!response.ok) {
      const errorMessage =
        typeof payload.error === "object" && payload.error && "message" in payload.error
          ? String((payload.error as { message?: unknown }).message ?? "")
          : text;
      throw new Error(errorMessage || "请求失败。");
    }

    return payload;
  }

  return (
    <div className="prompt-studio">
      <aside className="prompt-sidebar">
        {promptSets.map((promptSet) => (
          <button
            key={promptSet.name}
            className={`prompt-tab ${promptSet.name === selectedSet?.name ? "prompt-tab--active" : ""}`}
            onClick={() => {
              setSelectedName(promptSet.name);
              setSelectedVersionId(promptSet.versions[0]?.id ?? null);
              setDraftLabel(promptSet.versions[0]?.label ?? "");
              setDraftNotes(promptSet.versions[0]?.notes ?? "");
              setDraftContent(promptSet.versions[0]?.content ?? promptSet.activeContent ?? "");
              setResult("");
            }}
          >
            <span>{promptSet.title}</span>
            <small>{promptSet.name}</small>
          </button>
        ))}
      </aside>

      <section className="prompt-main stack">
        <div className="card">
          <div className="card-header">
            <div>
              <h2>{selectedSet?.title ?? "Prompt Studio"}</h2>
              <p className="muted">当前生效版本：{selectedSet?.activeVersionId ?? "暂无"}</p>
              <p className="muted">只有新建 job 会使用新 prompt，运行中的 job 会继续使用自己的快照。</p>
              <p className="muted">当前前端请求的 API：{getClientApiBaseUrl()}</p>
            </div>
          </div>

          <div className="prompt-version-list">
            {selectedSet?.versions.map((version) => (
              <button
                key={version.id}
                className={`version-pill ${selectedVersion?.id === version.id ? "version-pill--active" : ""}`}
                onClick={() => hydrateDraft(version)}
              >
                v{version.version} {version.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <label className="field">
            <span>版本标签</span>
            <input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} />
          </label>

          <label className="field">
            <span>备注</span>
            <input value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
          </label>

          <label className="field">
            <span>Prompt 文本</span>
            <textarea rows={18} value={draftContent} onChange={(event) => setDraftContent(event.target.value)} />
          </label>

          <div className="button-row">
            <button
              className="button"
              disabled={pending || !selectedSet}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const data = await runRequest(`/prompt-sets/${selectedSet?.name}/drafts`, {
                      method: "POST",
                      body: JSON.stringify({
                        label: draftLabel,
                        notes: draftNotes,
                        content: draftContent
                      })
                    });
                    setResult(`草稿已创建，版本 ID：${String(data.promptVersionId ?? "")}`);
                  } catch (error) {
                    setResult(error instanceof Error ? error.message : "创建草稿失败。");
                  }
                })
              }
            >
              {pending ? "处理中..." : "新建草稿"}
            </button>

            <button
              className="button button--ghost"
              disabled={pending || !selectedVersionId}
              onClick={() =>
                startTransition(async () => {
                  if (!selectedVersionId) {
                    return;
                  }

                  try {
                    await runRequest(`/prompt-versions/${selectedVersionId}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        label: draftLabel,
                        notes: draftNotes,
                        content: draftContent
                      })
                    });
                    setResult("草稿已更新。");
                  } catch (error) {
                    setResult(error instanceof Error ? error.message : "更新草稿失败。");
                  }
                })
              }
            >
              更新草稿
            </button>

            <button
              className="button button--ghost"
              disabled={pending || !selectedVersionId}
              onClick={() =>
                startTransition(async () => {
                  if (!selectedVersionId) {
                    return;
                  }

                  try {
                    await runRequest(`/prompt-versions/${selectedVersionId}/activate`, {
                      method: "POST"
                    });
                    setResult("已发布为生效版本。");
                  } catch (error) {
                    setResult(error instanceof Error ? error.message : "激活失败。");
                  }
                })
              }
            >
              发布为生效版本
            </button>

            <button
              className="button button--ghost"
              disabled={pending || !selectedVersionId}
              onClick={() =>
                startTransition(async () => {
                  if (!selectedVersionId) {
                    return;
                  }

                  try {
                    await runRequest(`/prompt-versions/${selectedVersionId}/rollback-target`, {
                      method: "POST"
                    });
                    setResult("已回滚到该版本。");
                  } catch (error) {
                    setResult(error instanceof Error ? error.message : "回滚失败。");
                  }
                })
              }
            >
              回滚到该版本
            </button>
          </div>
        </div>

        <div className="card">
          <label className="field">
            <span>样例输入</span>
            <textarea rows={10} value={testInput} onChange={(event) => setTestInput(event.target.value)} />
          </label>
          <button
            className="button"
            disabled={pending || !selectedVersionId}
            onClick={() =>
              startTransition(async () => {
                if (!selectedVersionId) {
                  return;
                }

                try {
                  const response = await runRequest(`/prompt-versions/${selectedVersionId}/test`, {
                    method: "POST",
                    body: JSON.stringify({
                      input: JSON.parse(testInput)
                    })
                  });
                  setResult(JSON.stringify(response, null, 2));
                } catch (error) {
                  setResult(error instanceof Error ? error.message : "样例测试失败。");
                }
              })
            }
          >
            样例测试
          </button>
        </div>

        <div className="card">
          <h3>最近测试记录</h3>
          <div className="log-list">
            {selectedSet?.testRuns.length ? (
              selectedSet.testRuns.map((run) => (
                <article key={run.id} className="log-item">
                  <p>
                    #{run.id} / 版本 {run.promptVersionId} / {new Date(run.createdAt).toLocaleString("zh-CN")}
                  </p>
                  <pre>{run.outputJson ?? run.errorText ?? "暂无输出"}</pre>
                </article>
              ))
            ) : (
              <p className="muted">还没有测试记录。</p>
            )}
          </div>
        </div>

        <div className="card">
          <h3>执行反馈</h3>
          <pre>{result || "这里会显示新建、测试、激活和回滚的结果。"}</pre>
        </div>
      </section>
    </div>
  );
}
