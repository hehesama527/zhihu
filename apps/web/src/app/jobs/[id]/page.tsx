import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusChip } from "../../../components/status-chip";
import { getJob, getJobArtifacts, getJobAttempts, getJobSkillRuns, getJobToolTraces } from "../../../lib/api";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const [job, attempts, artifacts, traces, skillRuns] = await Promise.all([
    getJob(jobId),
    getJobAttempts(jobId),
    getJobArtifacts(jobId),
    getJobToolTraces(jobId),
    getJobSkillRuns(jobId)
  ]);

  if (!job) {
    notFound();
  }

  const writerPromptSnapshot = readWriterPromptSnapshot(job.promptVersionSnapshotJson);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>{job.title ?? `任务 #${job.id}`}</h2>
          <p className="muted">任务 #{job.id}</p>
        </div>
        <StatusChip status={job.displayStatus} />
      </section>

      <section className="grid grid--two">
        <article className="card">
          <h3>基本信息</h3>
          <div className="stack stack--tight">
            <p>计划时间：{formatTime(job.scheduledAt)}</p>
            <p>内部状态：{job.status}</p>
            <p>当前阶段：{job.currentStage ?? "暂无"}</p>
            <p>失败分类：{job.latestFailureType ?? job.lastErrorType ?? "无"}</p>
            <p>失败原因：{job.failureReason ?? "无"}</p>
            <p>最终链接：{job.finalUrl ? <Link href={job.finalUrl}>{job.finalUrl}</Link> : "暂无"}</p>
            <p>问题标题：{job.questionTitle ?? "暂无"}</p>
            <p>问题链接：{job.questionUrl ? <Link href={job.questionUrl}>{job.questionUrl}</Link> : "暂无"}</p>
          </div>
        </article>

        <article className="card">
          <h3>恢复锚点 + Prompt 快照</h3>
          <p>Writer Prompt 快照：{writerPromptSnapshot ? `v${writerPromptSnapshot.versionText} / ${writerPromptSnapshot.labelText}` : "暂无"}</p>
          <pre>{job.resumeAnchorJson ?? "暂无恢复锚点"}</pre>
          <div className="spacer" />
          <pre>{job.promptVersionSnapshotJson ?? "暂无 Prompt 快照"}</pre>
        </article>
      </section>

      <section className="grid grid--two">
        <article className="card">
          <h3>题目卡</h3>
          <pre>{job.topicOutputJson ?? "暂无"}</pre>
        </article>
        <article className="card">
          <h3>审核摘要</h3>
          <pre>{job.reviewSummary ?? "暂无审核摘要"}</pre>
        </article>
      </section>

      <section className="grid grid--two">
        <article className="card">
          <h3>原始草稿</h3>
          <pre>{job.draftContent ?? "暂无"}</pre>
        </article>

        <article className="card">
          <h3>去 AI 味后正文</h3>
          <pre>{job.humanizedContent ?? "暂无"}</pre>
        </article>
      </section>

      <section className="card">
        <h3>最终通过内容</h3>
        <pre>{job.approvedContent ?? "暂无"}</pre>
      </section>

      <section className="grid grid--two">
        <article className="card">
          <h3>Hard Gate</h3>
          <pre>{job.hardGateJson ?? "暂无"}</pre>
        </article>
        <article className="card">
          <h3>Editorial Review</h3>
          <pre>{job.editorialReviewJson ?? "暂无"}</pre>
        </article>
      </section>

      <section className="grid grid--two">
        <article className="card">
          <h3>Publish Review</h3>
          <pre>{job.publishReviewJson ?? "暂无"}</pre>
        </article>
        <article className="card">
          <h3>重复性结果</h3>
          <pre>{job.contentDuplicationJson ?? "暂无"}</pre>
        </article>
      </section>

      <section className="card">
        <h3>发布尝试</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>次数</th>
                <th>状态</th>
                <th>失败类型</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {attempts.length ? (
                attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>{attempt.attemptNo}</td>
                    <td>{attempt.status}</td>
                    <td>{attempt.failureType ?? "-"}</td>
                    <td>{attempt.failureReason ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>还没有发布尝试。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Skill Runs</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>Skill</th>
                <th>Agent</th>
                <th>阶段</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {skillRuns.length ? (
                skillRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{formatTime(run.createdAt)}</td>
                    <td>{run.skillName}</td>
                    <td>{run.agentName}</td>
                    <td>{run.stage ?? "-"}</td>
                    <td>{run.success ? "成功" : run.errorMessage ?? "失败"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>还没有 Skill 运行记录。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>MCP / Tool Trace</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>阶段</th>
                <th>动作</th>
                <th>结果</th>
                <th>产物</th>
              </tr>
            </thead>
            <tbody>
              {traces.length ? (
                traces.map((trace) => (
                  <tr key={trace.id}>
                    <td>{formatTime(trace.createdAt)}</td>
                    <td>{trace.stage}</td>
                    <td>{trace.action}</td>
                    <td>{trace.success ? "成功" : trace.errorMessage ?? "失败"}</td>
                    <td>{trace.artifactPath ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>还没有 Tool Trace。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>产物文件</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>类型</th>
                <th>路径</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.length ? (
                artifacts.map((artifact) => (
                  <tr key={artifact.id}>
                    <td>{artifact.artifactType}</td>
                    <td>{artifact.filePath}</td>
                    <td>{formatTime(artifact.createdAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3}>还没有产物文件。</td>
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

function readWriterPromptSnapshot(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      writer_agent?: {
        version?: number | null;
        label?: string | null;
      };
    };

    const writerSnapshot = parsed.writer_agent;
    if (!writerSnapshot) {
      return null;
    }

    return {
      versionText: writerSnapshot.version ?? "seed",
      labelText: writerSnapshot.label ?? "未命名版本"
    };
  } catch {
    return null;
  }
}
