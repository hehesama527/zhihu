import Link from "next/link";
import { RetryJobButton } from "../../components/retry-job-button";
import { StatusChip } from "../../components/status-chip";
import { getPublishJobs } from "../../lib/api";

export default async function PublishJobsPage() {
  const jobs = await getPublishJobs();

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>Publish Jobs</h2>
          <p className="muted">直接查看发布状态、题目关联、失败分类和最近截图。</p>
        </div>
      </section>

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>发布时间</th>
                <th>失败信息</th>
                <th>截图</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length ? (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="stack stack--tight">
                        <Link href={`/jobs/${job.id}`}>{job.title ?? `任务 #${job.id}`}</Link>
                        <span className="muted">{job.questionTitle ?? "题目待绑定"}</span>
                        <span className="muted">#{job.id}</span>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={job.displayStatus} />
                    </td>
                    <td>{formatTime(job.finishedAt ?? job.scheduledAt)}</td>
                    <td>
                      <div className="stack stack--tight">
                        <span>{job.latestFailureType ?? job.lastErrorType ?? "-"}</span>
                        <span className="muted">{job.failureReason ?? "暂无失败原因"}</span>
                      </div>
                    </td>
                    <td>{job.latestScreenshotPath ?? "-"}</td>
                    <td>
                      {canRetryJob(job.status) ? <RetryJobButton jobId={job.id} /> : <span className="muted">暂无</span>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>还没有发布任务。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function canRetryJob(status: string) {
  return status === "failed_terminal";
}
