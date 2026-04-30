import Link from "next/link";
import { notFound } from "next/navigation";
import { ZhihuJobImageCard } from "../../../../../components/images/zhihu-job-image-card";
import { RetryJobButton } from "../../../../../components/retry-job-button";
import { StatusChip } from "../../../../../components/status-chip";
import { getJob, getJobArtifacts, getJobAttempts, getJobSkillRuns, getJobToolTraces } from "../../../../../lib/api";

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
  const qualityScore = readQualityScore(job.editorialReviewJson);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>{job.title ?? `任务 #${job.id}`}</h2>
          <p className="muted">任务 #{job.id}</p>
        </div>
        <div className="button-row">
          {canRetryJob(job.status) ? <RetryJobButton jobId={job.id} className="button" /> : null}
          <StatusChip status={job.displayStatus} />
        </div>
      </section>

      <ZhihuJobImageCard jobId={job.id} initialAssetId={job.imageAssetId ?? null} />

      <section className="grid grid--two">
        <article className="card">
          <h3>基本信息</h3>
          <div className="stack stack--tight">
            <p>计划时间：{formatTime(job.scheduledAt)}</p>
            <p>内部状态：{formatJobStage(job.status)}</p>
            <p>当前阶段：{formatJobStage(job.currentStage)}</p>
            <p>失败分类：{formatFailureType(job.latestFailureType ?? job.lastErrorType)}</p>
            <p>失败原因：{job.failureReason ?? "暂无"}</p>
            <p>最终链接：{job.finalUrl ? <Link href={job.finalUrl}>{job.finalUrl}</Link> : "暂无"}</p>
            <p>问题标题：{job.questionTitle ?? "暂无"}</p>
            <p>问题链接：{job.questionUrl ? <Link href={job.questionUrl}>{job.questionUrl}</Link> : "暂无"}</p>
          </div>
        </article>

        <article className="card">
          <h3>恢复锚点与 Prompt 快照</h3>
          <p>Writer Prompt 快照：{writerPromptSnapshot ? `v${writerPromptSnapshot.versionText} / ${writerPromptSnapshot.labelText}` : "暂无"}</p>
          <pre>{job.resumeAnchorJson ?? "暂无恢复锚点"}</pre>
          <div className="spacer" />
          <pre>{job.promptVersionSnapshotJson ?? "暂无 Prompt 快照"}</pre>
        </article>
      </section>

      <section className="card">
        <h3>内容质量评分</h3>
        {qualityScore ? (
          <div className="stack stack--tight">
            <p>
              总分：{qualityScore.overallScore}/{qualityScore.passingScore} · 人工原因：
              {qualityScore.manualReviewReasons.length ? qualityScore.manualReviewReasons.join("、") : "无"}
            </p>
            <p>改写建议：{qualityScore.rewriteBrief || "暂无"}</p>
            <pre>{JSON.stringify(qualityScore.dimensions ?? {}, null, 2)}</pre>
          </div>
        ) : (
          <p className="muted">暂无质量评分</p>
        )}
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
          <h3>硬门槛审核</h3>
          <pre>{job.hardGateJson ?? "暂无"}</pre>
        </article>
        <article className="card">
          <h3>编辑审核</h3>
          <pre>{job.editorialReviewJson ?? "暂无"}</pre>
        </article>
      </section>

      <section className="grid grid--two">
        <article className="card">
          <h3>发布审核</h3>
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
                    <td>{formatJobStage(attempt.status)}</td>
                    <td>{formatFailureType(attempt.failureType)}</td>
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
        <h3>技能执行记录</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>技能</th>
                <th>代理</th>
                <th>阶段</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {skillRuns.length ? (
                skillRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{formatTime(run.createdAt)}</td>
                    <td>{formatSkillName(run.skillName)}</td>
                    <td>{run.agentName}</td>
                    <td>{formatJobStage(run.stage)}</td>
                    <td>{run.success ? "成功" : run.errorMessage ?? "失败"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>还没有技能运行记录。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>MCP / 工具轨迹</h3>
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
                    <td>{formatToolStage(trace.stage)}</td>
                    <td>{formatToolAction(trace.action)}</td>
                    <td>{trace.success ? "成功" : trace.errorMessage ?? "失败"}</td>
                    <td>{trace.artifactPath ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>还没有工具轨迹。</td>
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

function canRetryJob(status: string) {
  return status === "failed_terminal";
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
      versionText: writerSnapshot.version ?? "种子版",
      labelText: writerSnapshot.label ?? "未命名版本"
    };
  } catch {
    return null;
  }
}

function readQualityScore(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      quality?: {
        overallScore?: number;
        passingScore?: number;
        dimensions?: Record<string, unknown>;
        rewriteBrief?: string;
        manualReviewReasons?: string[];
      };
    };
    if (!parsed.quality) {
      return null;
    }
    return {
      overallScore: parsed.quality.overallScore ?? 0,
      passingScore: parsed.quality.passingScore ?? 72,
      dimensions: parsed.quality.dimensions ?? {},
      rewriteBrief: parsed.quality.rewriteBrief ?? "",
      manualReviewReasons: Array.isArray(parsed.quality.manualReviewReasons) ? parsed.quality.manualReviewReasons : []
    };
  } catch {
    return null;
  }
}

function formatJobStage(value: string | null | undefined) {
  const map: Record<string, string> = {
    queued: "排队中",
    topic_discovery: "选题发现",
    topic_agent: "选题代理",
    topic_review: "选题审核",
    writer: "写作代理",
    humanizing: "去 AI 味",
    review_hard_gate: "硬门槛审核",
    review_editorial: "编辑审核",
    review_publish: "发布审核",
    review_passed: "审核通过",
    login_checking: "登录检查中",
    publishing: "发布中",
    publish_verify: "发布校验",
    retry_waiting: "等待重试",
    manual_login_required: "需人工登录",
    published: "已发布",
    failed_terminal: "终态失败",
    pending: "待处理",
    failed: "失败",
    unknown: "未知"
  };

  return value ? map[value] ?? value : "暂无";
}

function formatFailureType(value: string | null | undefined) {
  const map: Record<string, string> = {
    auth_required: "需要认证",
    login_required: "需要登录",
    session_expired: "会话失效",
    account_identity_mismatch: "账号身份不匹配",
    challenge_required: "需要验证",
    duplicate_block: "重复内容拦截",
    editor_not_ready: "编辑器未就绪",
    submit_not_ready: "提交按钮未就绪",
    network_or_page_error: "网络或页面异常",
    publish_uncertain: "发布结果待确认",
    content_risk_block: "内容风险拦截",
    topic_invalid: "题目无效",
    review_block: "审核拦截",
    llm_connection_error: "模型连接异常",
    unknown_failure: "未知失败"
  };

  return value ? map[value] ?? value : "-";
}

function formatSkillName(value: string) {
  const map: Record<string, string> = {
    "humanizer-zh": "去 AI 味",
    "browser-playwright": "浏览器 Playwright"
  };

  return map[value] ?? value;
}

function formatToolStage(value: string) {
  const map: Record<string, string> = {
    topic_discovery: "选题发现",
    login_checking: "登录检查",
    publishing: "发布中",
    publish_verify: "发布校验",
    manual_login: "人工登录",
    unknown: "未知"
  };

  return map[value] ?? value;
}

function formatToolAction(value: string) {
  const map: Record<string, string> = {
    open: "打开页面",
    snapshot: "采集快照",
    click: "点击",
    focus: "聚焦",
    paste_text: "粘贴文本",
    type: "输入",
    press: "按键",
    wait: "等待",
    get_url: "读取地址",
    screenshot: "截图"
  };

  return map[value] ?? value;
}
