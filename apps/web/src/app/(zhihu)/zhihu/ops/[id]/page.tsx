import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "../../../../../components/status-chip";
import { getOpsIncident } from "../../../../../lib/api";

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
          <p className="muted">事件 #{incident.id}</p>
        </div>

        <div className="button-row">
          <StatusChip status={incident.severity} />
          <StatusChip status={incident.status} />
        </div>
      </section>

      <section className="grid grid--two">
        <article className="card">
          <h3>基本信息</h3>
          <div className="stack stack--tight">
            <p>服务：{incident.serviceName}</p>
            <p>来源：{incident.source}</p>
            <p>失败类型：{incident.failureType ?? "暂无"}</p>
            <p>账号：{incident.accountId ? `#${incident.accountId}` : "暂无"}</p>
            <p>任务：{incident.jobId ? <Link href={`/zhihu/jobs/${incident.jobId}`}>#{incident.jobId}</Link> : "暂无"}</p>
            <p>创建时间：{formatTime(incident.createdAt)}</p>
            <p>更新时间：{formatTime(incident.updatedAt)}</p>
            <p>解决时间：{formatTime(incident.resolvedAt)}</p>
          </div>
        </article>

        <article className="card">
          <h3>诊断结果</h3>
          <div className="stack stack--tight">
            <p>摘要：{incident.diagnosisSummary ?? "暂无"}</p>
            <p>根因：{incident.rootCause ?? "暂无"}</p>
            <p>建议动作：{incident.suggestedAction ?? "暂无"}</p>
            <p>飞书通知状态：{formatNotificationDelivery(incident.notificationDelivery)}</p>
            <p>飞书通知内容：{incident.notificationMessage ?? "暂无"}</p>
            <p>通知时间：{formatTime(incident.notifiedAt)}</p>
          </div>
        </article>
      </section>

      <section className="card">
        <h3>原始错误摘要</h3>
        <pre>{incident.rawErrorExcerpt ?? "暂无"}</pre>
      </section>

      <section className="card">
        <h3>证据数据</h3>
        <pre>{evidence}</pre>
      </section>
    </div>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function readJson(value: string | null) {
  if (!value) {
    return "暂无";
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
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
