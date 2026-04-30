type StatusChipProps = {
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  planned: "已计划",
  in_progress: "进行中",
  published: "已发布",
  failed: "失败",
  approved: "已通过",
  paused: "已暂停",
  pending_review: "待审核",
  rejected: "已拒绝",
  manual_login_required: "需人工登录",
  review_passed: "审核通过",
  retry_waiting: "等待重试",
  login_checking: "登录检查中",
  publishing: "发布中",
  failed_terminal: "终态失败",
  queued: "排队中",
  reviewing: "审核中",
  needs_manual_review: "???????",
  review_rejected: "审核驳回",
  skipped: "已跳过",
  ready_to_publish: "待发布",
  publish_failed: "发布失败",
  active: "启用中",
  ignored: "已忽略",
  expired: "已过期",
  running: "运行中",
  completed: "已完成",
  not_needed: "无需研究",
  writing_pending: "写作待开始",
  writing: "写作中",
  draft_ready: "草稿已生成",
  under_review: "复核中",
  revision_required: "需修改",
  approved_to_publish: "已批准发布",
  unknown: "未知",
  ready: "就绪",
  login_required: "需要登录",
  session_expired: "会话失效",
  challenge_required: "需要验证",
  account_mismatch: "账号不匹配",
  proxy_error: "代理异常",
  browser_error: "浏览器异常",
  topic_discovery: "选题发现",
  topic_agent: "选题代理",
  topic_review: "选题审核",
  writer: "写作代理",
  humanizing: "去 AI 味",
  review_hard_gate: "硬门槛审核",
  review_editorial: "编辑审核",
  review_publish: "发布审核",
  publish_verify: "发布校验",
  open: "待处理",
  resolved: "已解决",
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
  draft: "草稿",
  archived: "已归档",
  publish_uncertain: "发布待确认",
  success: "成功",
  error: "错误"
};

export function StatusChip({ status }: StatusChipProps) {
  return (
    <span className={`status-chip status-chip--${status.replace(/_/g, "-")}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
