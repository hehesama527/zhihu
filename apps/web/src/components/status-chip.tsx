type StatusChipProps = {
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  in_progress: "执行中",
  published: "已发布",
  failed: "失败",
  manual_login_required: "登录阻塞",
  review_passed: "待发布",
  retry_waiting: "等待重试",
  login_checking: "登录校验",
  publishing: "发布中",
  failed_terminal: "终止失败",
  queued: "排队中",
  reviewing: "审核中",
  review_rejected: "审核拦截",
  ready_to_publish: "待发布",
  publish_failed: "发布失败",
  active: "正常",
  session_expired: "会话失效",
  topic_discovery: "采题中",
  topic_agent: "选题分析中",
  topic_review: "选题复核中",
  writer: "写作中",
  humanizing: "去 AI 味中",
  review_hard_gate: "红线审核",
  review_editorial: "编辑审核",
  review_publish: "发布审核",
  publish_verify: "发布核验"
};

export function StatusChip({ status }: StatusChipProps) {
  return (
    <span className={`status-chip status-chip--${status.replace(/_/g, "-")}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
