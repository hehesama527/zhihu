import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "../../../components/status-chip";
import { getOpsIncident } from "../../../lib/api";

export default async function OpsIncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const incidentId = Number(id);
  const incident = await getOpsIncident(incidentId);

  if (!incident) {
    notFound();
  }

  const evidence = readJson(incident.evidenceJson);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>{incident.title}</h2>
          <p className="muted">Incident #{incident.id}</p>
        </div>

        <div className="button-row">
          <StatusChip status={incident.severity} />
          <StatusChip status={incident.status} />
        </div>
      </section>

      <section className="grid grid--two">
        <article className="card">
          <h3>Basic Info</h3>
          <div className="stack stack--tight">
            <p>Service: {incident.serviceName}</p>
            <p>Source: {incident.source}</p>
            <p>Failure Type: {incident.failureType ?? "N/A"}</p>
            <p>Account: {incident.accountId ? `#${incident.accountId}` : "N/A"}</p>
            <p>
              Job:{" "}
              {incident.jobId ? <Link href={`/jobs/${incident.jobId}`}>#{incident.jobId}</Link> : "N/A"}
            </p>
            <p>Created: {formatTime(incident.createdAt)}</p>
            <p>Updated: {formatTime(incident.updatedAt)}</p>
            <p>Resolved: {formatTime(incident.resolvedAt)}</p>
          </div>
        </article>

        <article className="card">
          <h3>Diagnosis</h3>
          <div className="stack stack--tight">
            <p>Summary: {incident.diagnosisSummary ?? "N/A"}</p>
            <p>Root Cause: {incident.rootCause ?? "N/A"}</p>
            <p>Suggested Action: {incident.suggestedAction ?? "N/A"}</p>
            <p>Feishu Delivery: {incident.notificationDelivery ?? "pending"}</p>
            <p>Feishu Message: {incident.notificationMessage ?? "N/A"}</p>
            <p>Notified At: {formatTime(incident.notifiedAt)}</p>
          </div>
        </article>
      </section>

      <section className="card">
        <h3>Raw Error Excerpt</h3>
        <pre>{incident.rawErrorExcerpt ?? "N/A"}</pre>
      </section>

      <section className="card">
        <h3>Evidence</h3>
        <pre>{evidence}</pre>
      </section>
    </div>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "N/A";
}

function readJson(value: string | null) {
  if (!value) {
    return "N/A";
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
