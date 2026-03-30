import Link from "next/link";
import { OpsScanPanel } from "../../components/ops-scan-panel";
import { StatusChip } from "../../components/status-chip";
import { getOpsIncidents, getOpsSummary } from "../../lib/api";

export default async function OpsPage() {
  const [summary, incidents] = await Promise.all([getOpsSummary(), getOpsIncidents()]);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>Ops Incidents</h2>
          <p className="muted">
            Review recent incidents, diagnosis results, and Feishu notification status. This page is read-only in V1.
          </p>
        </div>
      </section>

      <section className="grid grid--three">
        <article className="card">
          <p className="muted">Open Incidents</p>
          <div className="metric-value">{summary.openCount}</div>
        </article>
        <article className="card">
          <p className="muted">Critical</p>
          <div className="metric-value">{summary.criticalCount}</div>
        </article>
        <article className="card">
          <p className="muted">High</p>
          <div className="metric-value">{summary.highCount}</div>
        </article>
      </section>

      <OpsScanPanel />

      <section className="card">
        <div className="card-header">
          <div>
            <h3>Recent Incidents</h3>
            <p className="muted">Incidents are deduplicated by fingerprint. Repeated hits update the record instead of spamming Feishu.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Incident</th>
                <th>Service</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Diagnosis</th>
                <th>Feishu</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {incidents.length ? (
                incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>
                      <div className="stack stack--tight">
                        <Link href={`/ops/${incident.id}`}>{incident.title}</Link>
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
                        <span>{incident.notificationDelivery ?? "pending"}</span>
                        <span className="muted">{truncateText(incident.notificationMessage, 80)}</span>
                      </div>
                    </td>
                    <td>{formatTime(incident.updatedAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No incidents yet.</td>
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
    parts.push(`Account #${accountId}`);
  }

  if (jobId) {
    parts.push(`Job #${jobId}`);
  }

  return parts.join(" / ") || "No linked account or job";
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "N/A";
}

function truncateText(value: string | null, maxLength: number) {
  if (!value) {
    return "-";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
