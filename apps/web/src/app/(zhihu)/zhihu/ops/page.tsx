import Link from "next/link";
import { OpsScanPanel } from "../../../../components/ops-scan-panel";
import { StatusChip } from "../../../../components/status-chip";
import { getOpsIncidents, getOpsSummary } from "../../../../lib/api";

export default async function OpsPage() {
  const [summary, incidents] = await Promise.all([getOpsSummary(), getOpsIncidents()]);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>运维事件</h2>
          <p className="muted">查看最近的事件、诊断结果与飞书通知状态。第一阶段这里保持只读。</p>
        </div>
      </section>

      <section className="grid grid--three">
        <article className="card">
          <p className="muted">未解决事件</p>
          <div className="metric-value">{summary.openCount}</div>
        </article>
        <article className="card">
          <p className="muted">严重级</p>
          <div className="metric-value">{summary.criticalCount}</div>
        </article>
        <article className="card">
          <p className="muted">高优先级</p>
          <div className="metric-value">{summary.highCount}</div>
        </article>
      </section>

      <OpsScanPanel />

      <section className="card">
        <div className="card-header">
          <div>
            <h3>最近事件</h3>
            <p className="muted">事件会按指纹去重，相同问题重复出现时只更新记录，不会反复轰炸飞书。</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>事件</th>
                <th>服务</th>
                <th>严重度</th>
                <th>状态</th>
                <th>诊断</th>
                <th>飞书</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {incidents.length ? (
                incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>
                      <div className="stack stack--tight">
                        <Link href={`/zhihu/ops/${incident.id}`}>{incident.title}</Link>
                        <span className="muted">#{incident.id}</span>
                        <span className="muted">{incident.failureType ?? incident.source}</span>
                        <span className="muted">{buildScopeLine(incident.accountId, incident.jobId)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="stack stack--tight">
                        <span>{incident.serviceName}</span>
                        <span className="muted">{incident.source}</span>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={incident.severity} />
                    </td>
                    <td>
                      <StatusChip status={incident.status} />
                    </td>
                    <td>
                      <div className="stack stack--tight">
                        <span>{truncateText(incident.diagnosisSummary, 120)}</span>
                        <span className="muted">{truncateText(incident.rootCause, 120)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="stack stack--tight">
                        <span>{formatNotificationDelivery(incident.notificationDelivery)}</span>
                        <span className="muted">{truncateText(incident.notificationMessage, 80)}</span>
                      </div>
                    </td>
                    <td>{formatTime(incident.updatedAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>暂时还没有运维事件。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function buildScopeLine(accountId: number | null, jobId: number | null) {
  const parts = [];

  if (accountId) {
    parts.push(`账号 #${accountId}`);
  }

  if (jobId) {
    parts.push(`任务 #${jobId}`);
  }

  return parts.join(" / ") || "未关联账号或任务";
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function truncateText(value: string | null, maxLength: number) {
  if (!value) {
    return "-";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function formatNotificationDelivery(value: string | null) {
  const map: Record<string, string> = {
    pending: "待发送",
    sent: "已发送",
    disabled: "未启用",
    failed: "发送失败"
  };

  return value ? map[value] ?? value : "待发送";
}
