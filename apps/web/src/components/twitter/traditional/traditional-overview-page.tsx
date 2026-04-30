"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { getTwitterTraditionalClientApiBaseUrl } from "../../../lib/twitter/http";
import {
  getTwitterTraditionalTasks,
  runTwitterTraditionalWorkerTick,
  type TwitterTraditionalHealth
} from "../../../lib/twitter/traditional-api";
import { StatusChip } from "../../status-chip";
import {
  buildErrorMessage,
  formatDateTime,
  summarizeTraditionalTasks,
  useTwitterTraditionalWorkspace
} from "./traditional-workspace";
import { TraditionalAccountContext } from "./traditional-account-context";
import type { TwitterTask } from "../../../lib/twitter/api";

function pickRecommendedAction(args: {
  health: TwitterTraditionalHealth | null;
  selectedAccountName: string;
  tasks: TwitterTask[];
}) {
  const { selectedAccountName, tasks } = args;
  const summary = summarizeTraditionalTasks(tasks);

  if (!tasks.length) {
    return {
      title: `先为 ${selectedAccountName} 创建第一条任务`,
      description: "当前还没有待处理任务，建议先进入任务页补一条标题清晰、目标明确的内容任务。",
      href: "/twitter/traditional/tasks",
      cta: "去创建任务"
    };
  }

  if (summary.pending > 0) {
    return {
      title: `当前最值得做的是推进 ${summary.pending} 条待处理任务`,
      description: "先看任务列表，再决定是直接执行单条任务，还是统一跑一轮任务执行器。",
      href: "/twitter/traditional/tasks",
      cta: "去处理任务"
    };
  }

  return {
    title: "补充参考账号学习，让风格边界更稳定",
    description: "任务已经不堆积时，下一步更适合回到账户层面，继续校准传统链路的表达风格。",
    href: "/twitter/traditional/learning",
    cta: "去学习风格"
  };
}

export function TwitterTraditionalOverviewPage() {
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

  useEffect(() => {
    if (!selectedAccountId) {
      setTasks([]);
      return;
    }

    setTasksLoading(true);
    void getTwitterTraditionalTasks(selectedAccountId)
      .then((nextTasks) => setTasks(nextTasks))
      .catch((error) => setMessage(buildErrorMessage(error, "加载任务摘要失败。")))
      .finally(() => setTasksLoading(false));
  }, [selectedAccountId, setMessage]);

  const taskSummary = useMemo(() => summarizeTraditionalTasks(tasks), [tasks]);
  const recommendation = pickRecommendedAction({
    health,
    selectedAccountName: selectedAccount?.name || (selectedAccount ? `@${selectedAccount.handle}` : "当前账户"),
    tasks
  });

  function runAction(action: () => Promise<void>, fallback: string) {
    setMessage("");
    startTransition(() => {
      void action().catch((error) => {
        setMessage(buildErrorMessage(error, fallback));
      });
    });
  }

  return (
    <div className="stack traditional-page">
      <section className="page-header">
        <div>
          <h2>X 传统链路工作台</h2>
          <p className="muted">先看状态，再决定要处理任务、校准账户定位，还是继续做参考账号学习。</p>
          <p className="helper-text">API: {getTwitterTraditionalClientApiBaseUrl()} / 发布模式: {health?.publishMode ?? "-"}</p>
        </div>

        <div className="button-row">
          <button
            className="button button--ghost"
            disabled={pending || loading}
            onClick={() => runAction(() => refreshWorkspace(selectedAccountId), "刷新传统工作台失败。")}
          >
            刷新状态
          </button>
          <button
            className="button"
            disabled={pending || loading}
            onClick={() =>
              runAction(async () => {
                const summary = await runTwitterTraditionalWorkerTick(5);
                await refreshWorkspace(selectedAccountId);
                const nextTasks = await getTwitterTraditionalTasks(selectedAccountId);
                setTasks(nextTasks);
                setMessage(
                  `任务执行器已处理 ${summary.processedTaskIds.length} 条任务，发布 ${summary.publishedTaskIds.length} 条，阻塞 ${summary.blockedTaskIds.length} 条。`
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
        heading="当前工作账户"
        description="总览中的状态、推荐动作和后续进入的工作区，都会围绕这个账户展开。先确认对象，再决定接下来处理任务还是继续学习。"
        selectionLabel="切换账户"
        helperText="切换后，总览摘要、任务统计和推荐动作会一起刷新。"
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        selectedAccount={selectedAccount}
        disabled={loading || pending}
        onSelectAccount={selectAccount}
        supplemental={
          <div className="traditional-summary-chip-row">
            <span className="mini-badge">发布模式 {health?.publishMode ?? "-"}</span>
            <span className="mini-badge">账户数 {accounts.length}</span>
            <span className="mini-badge">待处理 {taskSummary.pending}</span>
          </div>
        }
      />

      <section className="traditional-kpi-grid">
        <article className="traditional-kpi">
          <span className="traditional-kpi__label">待处理任务</span>
          <strong className="traditional-kpi__value">{tasksLoading ? "-" : taskSummary.pending}</strong>
          <span className="helper-text">还没有进入完成态的任务数量</span>
        </article>
        <article className="traditional-kpi">
          <span className="traditional-kpi__label">执行中</span>
          <strong className="traditional-kpi__value">{tasksLoading ? "-" : taskSummary.inProgress}</strong>
          <span className="helper-text">正在写作、审核或发布中的任务</span>
        </article>
        <article className="traditional-kpi">
          <span className="traditional-kpi__label">已完成</span>
          <strong className="traditional-kpi__value">{tasksLoading ? "-" : taskSummary.completed}</strong>
          <span className="helper-text">已完成或已发布的任务</span>
        </article>
        <article className="traditional-kpi">
          <span className="traditional-kpi__label">失败任务</span>
          <strong className="traditional-kpi__value">{tasksLoading ? "-" : taskSummary.failed}</strong>
          <span className="helper-text">需要回看并重新处理的任务</span>
        </article>
      </section>

      <section className="traditional-grid traditional-grid--overview">
        <article className="traditional-panel">
          <div className="traditional-panel__header">
            <div>
              <h3>当前账户摘要</h3>
              <p className="muted">确认这次工作的目标账户是谁，以及它的表达定位。</p>
            </div>
            {selectedAccount ? <StatusChip status={selectedAccount.status} /> : null}
          </div>

          {selectedAccount ? (
            <div className="stack stack--tight">
              <div className="traditional-summary-line">
                <strong>{selectedAccount.name || `@${selectedAccount.handle}`}</strong>
                <span>@{selectedAccount.handle}</span>
              </div>
              <p className="traditional-summary-copy">{selectedAccount.persona || "还没有填写账号定位。"}</p>
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
                  <span>学习目标</span>
                  <strong>{selectedAccount.learningTargets.length ? selectedAccount.learningTargets.join(" / ") : "-"}</strong>
                </div>
              </div>
              <div className="button-row">
                <Link href="/twitter/traditional/account" className="button button--ghost">
                  去看账户定位
                </Link>
              </div>
            </div>
          ) : (
            <div className="traditional-empty-state">
              <p>当前还没有可用账户。</p>
              <p className="muted">先准备一个 Traditional 账户后，再进入任务或学习流程。</p>
            </div>
          )}
        </article>

        <article className="traditional-panel">
          <div className="traditional-panel__header">
            <div>
              <h3>待处理任务摘要</h3>
              <p className="muted">先判断任务有没有堆积，再决定是否立刻进入任务页处理。</p>
            </div>
            <Link href="/twitter/traditional/tasks" className="button button--ghost">
              打开任务页
            </Link>
          </div>

          <div className="traditional-task-summary">
            <div className="traditional-summary-line">
              <strong>{taskSummary.all}</strong>
              <span>当前账户总任务数</span>
            </div>
            <div className="traditional-summary-chip-row">
              <span className="mini-badge">待处理 {taskSummary.pending}</span>
              <span className="mini-badge">执行中 {taskSummary.inProgress}</span>
              <span className="mini-badge">已完成 {taskSummary.completed}</span>
              <span className="mini-badge mini-badge--accent">失败 {taskSummary.failed}</span>
            </div>

            {tasks.length ? (
              <div className="traditional-compact-list">
                {tasks.slice(0, 3).map((task) => (
                  <div key={task.id} className="traditional-compact-list__item">
                    <div>
                      <div className="traditional-compact-list__title">{task.title}</div>
                      <div className="traditional-compact-list__meta">
                        阶段：{task.currentStage} / 更新：{formatDateTime(task.updatedAt)}
                      </div>
                    </div>
                    <StatusChip status={task.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="traditional-empty-state traditional-empty-state--compact">
                <p>当前账户还没有任务。</p>
              </div>
            )}
          </div>
        </article>

        <article className="traditional-panel">
          <div className="traditional-panel__header">
            <div>
              <h3>系统运行状态</h3>
              <p className="muted">查看传统链路的运行模式和最近上下文。</p>
            </div>
          </div>

          <div className="traditional-fact-list">
            <div className="traditional-fact">
              <span>发布模式</span>
              <strong>{health?.publishMode ?? "-"}</strong>
            </div>
            <div className="traditional-fact">
              <span>数据目录</span>
              <strong>{health?.dataDir ?? "-"}</strong>
            </div>
            <div className="traditional-fact">
              <span>账户数</span>
              <strong>{accounts.length}</strong>
            </div>
            <div className="traditional-fact">
              <span>任务摘要</span>
              <strong>{tasksLoading ? "加载中" : `${taskSummary.pending} 待处理 / ${taskSummary.inProgress} 执行中`}</strong>
            </div>
          </div>
        </article>

        <article className="traditional-panel traditional-panel--accent">
          <div className="traditional-panel__header">
            <div>
              <h3>推荐下一步</h3>
              <p className="muted">把最值得做的动作放在前面，不再让你在单页控制台里自己找。</p>
            </div>
          </div>

          <div className="stack stack--tight">
            <strong>{recommendation.title}</strong>
            <p className="traditional-summary-copy">{recommendation.description}</p>
            <div className="button-row">
              <Link href={recommendation.href} className="button">
                {recommendation.cta}
              </Link>
              <Link href="/twitter/prompts" className="button button--ghost">
                去配置中心
              </Link>
            </div>
          </div>
        </article>
      </section>

      <section className="traditional-action-grid">
        <Link href="/twitter/traditional/tasks" className="traditional-action-card">
          <span className="mini-badge">主动作</span>
          <h3>新建任务</h3>
          <p>进入任务工作区，给当前账户补一条标题明确、目标明确的内容任务。</p>
        </Link>
        <Link href="/twitter/traditional/learning" className="traditional-action-card">
          <span className="mini-badge">主动作</span>
          <h3>从参考账号学习风格</h3>
          <p>把参考账号的表达方式沉淀成账户级学习草稿，再按需写回。</p>
        </Link>
        <Link href="/twitter/traditional/account" className="traditional-action-card">
          <span className="mini-badge">主动作</span>
          <h3>完善账户定位</h3>
          <p>确认这个账号是谁、写给谁，以及哪些表达可以长期稳定复用。</p>
        </Link>
      </section>
    </div>
  );
}
