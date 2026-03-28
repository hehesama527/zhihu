import Link from "next/link";
import { AccountSwitcher } from "../components/account-switcher";
import { StatusChip } from "../components/status-chip";
import { WorkerPanel } from "../components/worker-panel";
import { getAccounts, getDashboardSummaryForAccount } from "../lib/api";

type DashboardPageProps = {
  searchParams?: Promise<{
    accountId?: string;
  }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedAccountId = parseAccountId(resolvedSearchParams?.accountId);
  const [summary, accounts] = await Promise.all([getDashboardSummaryForAccount(selectedAccountId), getAccounts()]);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>系统总览</h2>
          <p className="muted">先看矩阵全局，再切到当前账号视图处理恢复、发文和人工干预。</p>
        </div>
      </section>

      <AccountSwitcher accounts={accounts} selectedAccountId={summary.account?.id ?? selectedAccountId} basePath="/" />

      <section className="grid grid--four">
        <article className="card">
          <p className="muted">累计任务</p>
          <div className="metric-value">{summary.metrics.totalJobs}</div>
        </article>
        <article className="card">
          <p className="muted">成功发布</p>
          <div className="metric-value">{summary.metrics.publishedJobs}</div>
        </article>
        <article className="card">
          <p className="muted">待发布</p>
          <div className="metric-value">{summary.metrics.readyToPublishJobs}</div>
        </article>
        <article className="card">
          <p className="muted">登录阻塞</p>
          <div className="metric-value">{summary.metrics.manualLoginJobs}</div>
        </article>
      </section>

      <section className="grid grid--two">
        <article className="card">
          <div className="card-header">
            <div>
              <h3>今日排期</h3>
              <p className="muted">工作日按账号各自生成 3-4 个发布时间，范围固定在 08:00-20:00。</p>
            </div>
            <Link href="/schedule" className="button button--ghost">
              查看完整排期
            </Link>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>时间</th>
                  <th>状态</th>
                  <th>任务</th>
                </tr>
              </thead>
              <tbody>
                {summary.todaySchedule.length ? (
                  summary.todaySchedule.map((slot) => (
                    <tr key={slot.id}>
                      <td>{slot.accountName ?? `账号 #${slot.accountId ?? "-"}`}</td>
                      <td>{new Date(slot.scheduledAt).toLocaleString("zh-CN")}</td>
                      <td>
                        <StatusChip status={slot.status} />
                      </td>
                      <td>
                        {slot.publishJobId ? (
                          <Link href={`/jobs/${slot.publishJobId}`}>{slot.title ?? `任务 #${slot.publishJobId}`}</Link>
                        ) : (
                          "待分配"
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>今天还没有排期。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <h3>当前账号视图</h3>
              <p className="muted">系统优先复用已保存登录态，只有登录失效时才需要人工介入。</p>
            </div>
            <Link href={summary.account ? `/account?accountId=${summary.account.id}` : "/account"} className="button button--ghost">
              去恢复页
            </Link>
          </div>

          {summary.account ? (
            <div className="stack">
              <div className="inline-row">
                <div>
                  <p>{summary.account.name}</p>
                  <p className="muted">知乎账号：{summary.account.zhihuUserName ?? "未命名"}</p>
                </div>
                <StatusChip status={summary.account.status} />
              </div>
              <p className="muted">最近登录检查：{formatTime(summary.account.lastLoginCheckAt)}</p>
              <p className="muted">最近发布时间：{formatTime(summary.account.lastPublishAt)}</p>
              <p className="muted">阻塞任务数：{summary.account.blockedJobs.length}</p>
              <p className="muted">恢复原因：{summary.account.recoveryReason ?? "暂无"}</p>
            </div>
          ) : (
            <p className="muted">还没有账号。</p>
          )}
        </article>
      </section>

      <WorkerPanel accountId={summary.account?.id ?? null} />

      <section className="grid grid--two">
        <article className="card">
          <div className="card-header">
            <div>
              <h3>最近任务</h3>
              <p className="muted">查看发布状态、失败分类和详情入口。</p>
            </div>
            <Link href="/publish-jobs" className="button button--ghost">
              查看全部发布任务
            </Link>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>展示态</th>
                  <th>失败分类</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentJobs.length ? (
                  summary.recentJobs.slice(0, 8).map((job) => (
                    <tr key={job.id}>
                      <td>
                        <div className="stack stack--tight">
                          <Link href={`/jobs/${job.id}`}>{job.title ?? `任务 #${job.id}`}</Link>
                          <span className="muted">{job.questionTitle ?? "题目待绑定"}</span>
                          <span className="muted">{formatTime(job.scheduledAt)}</span>
                        </div>
                      </td>
                      <td>
                        <StatusChip status={job.displayStatus} />
                      </td>
                      <td>
                        <div className="stack stack--tight">
                          <span>{job.latestFailureType ?? job.lastErrorType ?? "-"}</span>
                          <span className="muted">{job.failureReason ?? "暂无失败原因"}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>还没有任务数据。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <h3>最近题目</h3>
              <p className="muted">看题目优先级、有效性状态和当前流转结果。</p>
            </div>
            <Link href="/topics" className="button button--ghost">
              查看 Topics / Drafts
            </Link>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>题目</th>
                  <th>优先级</th>
                  <th>有效性</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentTopics.length ? (
                  summary.recentTopics.map((topic) => (
                    <tr key={topic.id}>
                      <td>
                        <div className="stack stack--tight">
                          <span>{topic.questionTitle}</span>
                          <span className="muted">{topic.sourceType}</span>
                        </div>
                      </td>
                      <td>{topic.priority ?? "-"}</td>
                      <td>{formatValidity(topic.validityStatus, topic.validityReason)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>还没有题目数据。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function parseAccountId(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatValidity(status: string, reason: string | null) {
  if (status === "valid") {
    return "有效";
  }

  if (status === "invalid") {
    return reason ?? "无效";
  }

  return "待校验";
}
