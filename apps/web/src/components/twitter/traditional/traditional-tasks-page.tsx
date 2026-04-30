"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { TwitterTask } from "../../../lib/twitter/api";
import {
  createTwitterTraditionalTask,
  getTwitterTraditionalTasks,
  runTwitterTraditionalTaskNow,
  runTwitterTraditionalWorkerTick
} from "../../../lib/twitter/traditional-api";
import { StatusChip } from "../../status-chip";
import {
  buildErrorMessage,
  filterTraditionalTasks,
  formatDateTime,
  summarizeTraditionalTasks,
  type TraditionalTaskFilter,
  useTwitterTraditionalWorkspace
} from "./traditional-workspace";
import { TraditionalAccountContext } from "./traditional-account-context";

type TaskFormState = {
  title: string;
  brief: string;
  goal: string;
  preferredMode: "auto" | "single" | "thread";
  scheduledAt: string;
};

const DEFAULT_TASK_FORM: TaskFormState = {
  title: "",
  brief: "",
  goal: "",
  preferredMode: "auto",
  scheduledAt: ""
};

const TASK_FILTER_LABELS: Record<TraditionalTaskFilter, string> = {
  all: "全部",
  pending: "待处理",
  in_progress: "执行中",
  completed: "已完成",
  failed: "失败"
};

export function TwitterTraditionalTasksPage() {
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
  const [tasks, setTasks] = useState<TwitterTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<TraditionalTaskFilter>("all");
  const [form, setForm] = useState<TaskFormState>(DEFAULT_TASK_FORM);

  useEffect(() => {
    if (!selectedAccountId) {
      setTasks([]);
      return;
    }

    void refreshTasks(selectedAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  async function refreshTasks(accountId?: string | null) {
    setTasksLoading(true);

    try {
      const nextTasks = await getTwitterTraditionalTasks(accountId);
      setTasks(nextTasks);
      setMessage("");
    } catch (error) {
      setMessage(buildErrorMessage(error, "加载任务列表失败。"));
    } finally {
      setTasksLoading(false);
    }
  }

  function runAction(action: () => Promise<void>, fallback: string) {
    setMessage("");
    startTransition(() => {
      void action().catch((error) => {
        setMessage(buildErrorMessage(error, fallback));
      });
    });
  }

  const summary = useMemo(() => summarizeTraditionalTasks(tasks), [tasks]);
  const filteredTasks = useMemo(() => filterTraditionalTasks(tasks, filter), [tasks, filter]);

  return (
    <div className="stack traditional-page">
      <section className="page-header">
        <div>
          <h2>任务工作区</h2>
          <p className="muted">把“选账户、建任务、筛任务、执行任务”放进同一个工作区，不再在总览页里分散处理。</p>
        </div>

        <div className="button-row">
          <button
            className="button button--ghost"
            disabled={pending || loading}
            onClick={() => runAction(async () => {
              await refreshWorkspace(selectedAccountId);
              await refreshTasks(selectedAccountId);
            }, "刷新任务工作区失败。")}
          >
            刷新任务
          </button>
          <button
            className="button"
            disabled={pending || loading}
            onClick={() =>
              runAction(async () => {
                const summaryResult = await runTwitterTraditionalWorkerTick(5);
                await refreshTasks(selectedAccountId);
                setMessage(
                  `任务执行器已处理 ${summaryResult.processedTaskIds.length} 条任务，发布 ${summaryResult.publishedTaskIds.length} 条，阻塞 ${summaryResult.blockedTaskIds.length} 条。`
                );
              }, "执行待处理任务失败。")
            }
          >
            执行待处理任务
          </button>
        </div>
      </section>

      {message ? (
        <div className="traditional-inline-feedback">
          <p>{message}</p>
        </div>
      ) : null}

      <TraditionalAccountContext
        heading="当前任务账户"
        description="任务创建、筛选和立即执行都只作用在当前账户。把账户上下文固定在这里，避免在长列表里来回确认。"
        selectionLabel="切换任务账户"
        helperText="切换后，任务列表、创建表单和任务统计都会自动切换到对应账户。"
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        selectedAccount={selectedAccount}
        disabled={loading || pending}
        onSelectAccount={selectAccount}
        supplemental={
          <>
            <div className="traditional-summary-chip-row">
              <span className="mini-badge">待处理 {summary.pending}</span>
              <span className="mini-badge">执行中 {summary.inProgress}</span>
              <span className="mini-badge">已完成 {summary.completed}</span>
              <span className="mini-badge mini-badge--accent">失败 {summary.failed}</span>
            </div>
            <p className="helper-text traditional-account-context__meta-note">
              发布模式：{health?.publishMode ?? "-"} / 当前账户任务数：{tasksLoading ? "-" : tasks.length}
            </p>
          </>
        }
      />

      <section className="traditional-grid traditional-grid--tasks">
        <article className="traditional-panel">
          <div className="traditional-panel__header">
            <div>
              <h3>新建任务</h3>
              <p className="muted">先把任务说明和预期结果写清楚，再决定用单条、线程还是自动模式。</p>
            </div>
          </div>

          <div className="traditional-form-grid">
            <label className="field traditional-form-grid__full">
              <span>标题</span>
              <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </label>

            <label className="field traditional-form-grid__full">
              <span>任务说明</span>
              <textarea
                rows={5}
                value={form.brief}
                onChange={(event) => setForm((current) => ({ ...current, brief: event.target.value }))}
              />
            </label>

            <label className="field traditional-form-grid__full">
              <span>预期结果</span>
              <input value={form.goal} onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))} />
            </label>

            <label className="field">
              <span>发布形式</span>
              <select
                value={form.preferredMode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    preferredMode: event.target.value as TaskFormState["preferredMode"]
                  }))
                }
              >
                <option value="auto">自动判断</option>
                <option value="single">单条</option>
                <option value="thread">线程</option>
              </select>
            </label>

            <label className="field">
              <span>计划执行时间</span>
              <input
                placeholder="2026-04-21T09:30:00+08:00"
                value={form.scheduledAt}
                onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))}
              />
            </label>
          </div>

          <div className="button-row">
            <button
              className="button"
              disabled={pending || loading || !selectedAccountId || !form.title.trim()}
              onClick={() =>
                runAction(async () => {
                  if (!selectedAccountId) {
                    return;
                  }

                  await createTwitterTraditionalTask({
                    accountId: selectedAccountId,
                    title: form.title.trim() || undefined,
                    brief: form.brief.trim() || undefined,
                    goal: form.goal.trim() || undefined,
                    preferredMode: form.preferredMode,
                    scheduledAt: form.scheduledAt.trim() || null
                  });

                  setForm(DEFAULT_TASK_FORM);
                  await refreshTasks(selectedAccountId);
                  setFilter("all");
                  setMessage("任务已创建。");
                }, "创建任务失败。")
              }
            >
              创建任务
            </button>
          </div>
        </article>

        <article className="traditional-panel">
          <div className="traditional-panel__header">
            <div>
              <h3>任务列表</h3>
              <p className="muted">
                {selectedAccount ? `当前查看 ${selectedAccount.name || `@${selectedAccount.handle}`} 的任务。` : "先选择账户，再开始看任务。"}
              </p>
            </div>
          </div>

          <div className="traditional-filter-row">
            {(Object.keys(TASK_FILTER_LABELS) as TraditionalTaskFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`traditional-filter-chip ${filter === item ? "traditional-filter-chip--active" : ""}`}
                onClick={() => setFilter(item)}
              >
                {TASK_FILTER_LABELS[item]}
              </button>
            ))}
          </div>

          {tasksLoading ? <p className="helper-text">正在加载任务列表...</p> : null}

          {!tasksLoading && !filteredTasks.length ? (
            <div className="traditional-empty-state">
              <p>{tasks.length ? "当前筛选下没有任务。" : "当前账户还没有任务。"}</p>
              <p className="muted">可以先创建一条任务，或者切换其他账户继续查看。</p>
            </div>
          ) : null}

          {filteredTasks.length ? (
            <div className="traditional-task-list">
              {filteredTasks.map((task) => (
                <article key={task.id} className="traditional-task-row">
                  <div className="traditional-task-row__main">
                    <div className="traditional-task-row__top">
                      <div>
                        <h4>{task.title}</h4>
                        <p className="traditional-task-row__brief">{task.brief || "暂无任务说明。"}</p>
                      </div>
                      <StatusChip status={task.status} />
                    </div>

                    <div className="traditional-task-row__meta">
                      <span>阶段：{task.currentStage}</span>
                      <span>形式：{task.preferredMode}</span>
                      <span>修订：{task.revisionCount}</span>
                      <span>更新：{formatDateTime(task.updatedAt)}</span>
                    </div>

                    {task.failureType || task.failureStage ? (
                      <p className="helper-text">
                        失败信息：{task.failureStage ?? "-"} / {task.failureType ?? "-"}
                      </p>
                    ) : null}

                    {task.reviewResult ? (
                      <p className="helper-text">审核结果：{task.reviewResult.decision} / {task.reviewResult.reason}</p>
                    ) : null}
                  </div>

                  <div className="traditional-task-row__actions">
                    <button
                      className="button button--ghost"
                      disabled={pending || loading}
                      onClick={() =>
                        runAction(async () => {
                          await runTwitterTraditionalTaskNow(task.id);
                          await refreshTasks(selectedAccountId);
                          setMessage(`已触发任务「${task.title}」立即执行。`);
                        }, "触发任务执行失败。")
                      }
                    >
                      立即执行
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );
}
