type StatusChipProps = {
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  published: "Published",
  failed: "Failed",
  manual_login_required: "Manual Login",
  review_passed: "Review Passed",
  retry_waiting: "Retry Waiting",
  login_checking: "Login Check",
  publishing: "Publishing",
  failed_terminal: "Terminal Failure",
  queued: "Queued",
  reviewing: "Reviewing",
  review_rejected: "Review Rejected",
  ready_to_publish: "Ready to Publish",
  publish_failed: "Publish Failed",
  active: "Active",
  session_expired: "Session Expired",
  topic_discovery: "Topic Discovery",
  topic_agent: "Topic Agent",
  topic_review: "Topic Review",
  writer: "Writer",
  humanizing: "Humanizing",
  review_hard_gate: "Hard Gate Review",
  review_editorial: "Editorial Review",
  review_publish: "Publish Review",
  publish_verify: "Publish Verify",
  open: "Open",
  resolved: "Resolved",
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low"
};

export function StatusChip({ status }: StatusChipProps) {
  return (
    <span className={`status-chip status-chip--${status.replace(/_/g, "-")}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
