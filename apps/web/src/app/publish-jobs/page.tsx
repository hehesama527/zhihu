import Link from "next/link";
import { StatusChip } from "../../components/status-chip";
import { getPublishJobs } from "../../lib/api";

export default async function PublishJobsPage() {
  const jobs = await getPublishJobs();

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>Publish Jobs</h2>
          <p className="muted">查看发布状态、失败分类、最近截图和详情入口。</p>
        </div>
      </section>

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>任务</th>
                <th>展示态</th>
                <th>发布时间</th>
                <th>失败分类</th>
                <th>截图</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length ? (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="stack stack--tight">
                        <Link href={`/jobs/${job.id}`}>{job.title ?? `任务 #${job.id}`}</Link>
                        <span className="muted">#{job.id}</span>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={job.displayStatus} />
                    </td>
                    <td>{formatTime(job.finishedAt ?? job.scheduledAt)}</td>
                    <td>{job.latestFailureType ?? job.lastErrorType ?? "-"}</td>
                    <td>{job.latestScreenshotPath ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>还没有发布任务。</td>
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
