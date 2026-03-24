export type JobStatus =
  | "queued"
  | "topic_discovery"
  | "topic_agent"
  | "topic_review"
  | "writer"
  | "humanizing"
  | "review_hard_gate"
  | "review_editorial"
  | "review_publish"
  | "review_passed"
  | "login_checking"
  | "publishing"
  | "publish_verify"
  | "retry_waiting"
  | "manual_login_required"
  | "published"
  | "failed_terminal";

export type JobStage = JobStatus;

export type JobDisplayStatus =
  | "queued"
  | "reviewing"
  | "ready_to_publish"
  | "publishing"
  | "manual_login_required"
  | "publish_failed"
  | "published";

export type ScheduleSlotStatus =
  | "pending"
  | "in_progress"
  | "published"
  | "failed"
  | "manual_login_required";

export type PromptSetName =
  | "topic_agent"
  | "writer_agent"
  | "review_agent"
  | "publish_agent";

export type FailureType =
  | "auth_required"
  | "login_required"
  | "session_expired"
  | "challenge_required"
  | "duplicate_block"
  | "editor_not_ready"
  | "submit_not_ready"
  | "network_or_page_error"
  | "publish_uncertain"
  | "content_risk_block"
  | "topic_invalid"
  | "review_block"
  | "unknown_failure";

export type RecoveryAction =
  | "RETRY_SAME_SESSION"
  | "RESTART_BROWSER"
  | "VERIFY_ONCE"
  | "REWRITE_ONCE"
  | "MANUAL_LOGIN"
  | "RESELECT_TOPIC"
  | "TERMINAL_FAIL";

export type SkillName = "humanizer-zh" | "browser-playwright";

export type ToolTraceAction =
  | "open"
  | "snapshot"
  | "click"
  | "focus"
  | "paste_text"
  | "type"
  | "press"
  | "wait"
  | "get_url"
  | "screenshot";

export type ToolTraceStage =
  | "topic_discovery"
  | "login_checking"
  | "publishing"
  | "publish_verify"
  | "manual_login"
  | "unknown";

export type PublishStepAction =
  | "OPEN_PAGE"
  | "CLICK_WRITE_ANSWER"
  | "FOCUS_EDITOR"
  | "PASTE_CONTENT"
  | "CLICK_SUBMIT"
  | "WAIT"
  | "VERIFY_RESULT"
  | "REQUEST_MANUAL_LOGIN";

export type PublishStepPlan = {
  nextAction: PublishStepAction;
  targetTexts: string[];
  targetRoles: Array<"button" | "link">;
  targetSelectors: string[];
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type PromptVersionSummary = {
  id: number;
  setName: PromptSetName;
  version: number;
  status: "draft" | "active" | "archived";
  label: string;
  notes: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptVersionSnapshot = {
  promptSetName: PromptSetName;
  promptVersionId: number | null;
  version: number | null;
  label: string | null;
  content: string;
};

export type PromptSnapshotMap = Partial<Record<PromptSetName, PromptVersionSnapshot>>;

export type PromptSetView = {
  id: number;
  name: PromptSetName;
  title: string;
  activeVersionId: number | null;
  activeContent: string | null;
  versions: PromptVersionSummary[];
  testRuns: PromptTestRunSummary[];
};

export type PromptTestRunSummary = {
  id: number;
  promptVersionId: number;
  createdAt: string;
  inputJson: string;
  outputJson: string | null;
  errorText: string | null;
};

export type ScheduleSlot = {
  id: number;
  scheduledAt: string;
  status: ScheduleSlotStatus;
  publishJobId: number | null;
  title: string | null;
};

export type TopicPriority = "P0" | "P1" | "P2" | "SKIP";
export type TopicValidityStatus = "unchecked" | "valid" | "invalid";

export type TopicListItem = {
  id: number;
  questionTitle: string;
  questionUrl: string;
  sourceType: string;
  status: string;
  priority: TopicPriority | null;
  fitScore: number | null;
  questionType: string | null;
  personaMode: string | null;
  mustAvoid: string[];
  riskNotes: string[];
  validityStatus: TopicValidityStatus;
  validityReason: string | null;
  topicSummary: string | null;
  createdAt: string;
};

export type TopicBatchPlanItem = {
  candidateId: number;
  rank: number;
  selectionScore: number;
  selected: boolean;
  reason: string;
  questionTitle: string;
  questionUrl: string;
  sourceType: string;
  priority: TopicPriority | null;
  fitScore: number | null;
  questionType: string | null;
  personaMode: string | null;
};

export type TopicBatchPlan = {
  batchSize: number;
  availableCount: number;
  selectedCandidateId: number | null;
  selectedTitle: string | null;
  summary: string;
  ranking: TopicBatchPlanItem[];
};

export type DraftListItem = {
  id: number;
  topicCardId: number;
  topicCandidateId: number;
  questionTitle: string;
  questionUrl: string;
  rawDraftContent: string | null;
  humanizedContent: string | null;
  approvedContent: string | null;
  reviewStatus: string | null;
  reviewSummary: string | null;
  canPublish: boolean;
  createdAt: string;
};

export type PublishAttemptSummary = {
  id: number;
  publishJobId: number;
  attemptNo: number;
  status: string;
  currentUrl: string | null;
  failureType: FailureType | null;
  failureReason: string | null;
  attemptJson: string;
  createdAt: string;
};

export type ArtifactSummary = {
  id: number;
  publishAttemptId: number | null;
  artifactType: string;
  filePath: string;
  metaJson: string | null;
  createdAt: string;
};

export type ToolTraceSummary = {
  id: number;
  publishJobId: number | null;
  publishAttemptId: number | null;
  traceId: string;
  stage: ToolTraceStage;
  toolName: string;
  action: ToolTraceAction;
  inputJson: string;
  resultJson: string | null;
  artifactPath: string | null;
  durationMs: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
};

export type SkillRunSummary = {
  id: number;
  publishJobId: number | null;
  publishAttemptId: number | null;
  skillName: SkillName;
  agentName: string;
  stage: string | null;
  traceId: string | null;
  inputJson: string;
  outputJson: string | null;
  durationMs: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
};

export type JobListItem = {
  id: number;
  accountId: number;
  topicCardId: number | null;
  reviewId: number | null;
  status: JobStatus;
  displayStatus: JobDisplayStatus;
  title: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  finalUrl: string | null;
  retryCount: number;
  failureReason: string | null;
  lastErrorType: FailureType | null;
  createdAt: string;
  updatedAt: string;
  scheduleSlotId: number | null;
  scheduleStatus: ScheduleSlotStatus | null;
  currentStage: JobStage | null;
  resumeAnchorJson: string | null;
  promptVersionSnapshotJson: string | null;
  latestAttemptStatus: string | null;
  latestFailureType: FailureType | null;
  latestScreenshotPath: string | null;
};

export type JobDetail = JobListItem & {
  questionTitle: string | null;
  questionUrl: string | null;
  topicSummary: string | null;
  topicOutputJson: string | null;
  draftContent: string | null;
  humanizedContent: string | null;
  approvedContent: string | null;
  reviewSummary: string | null;
  hardGateJson: string | null;
  editorialReviewJson: string | null;
  publishReviewJson: string | null;
  topicDuplicationJson: string | null;
  contentDuplicationJson: string | null;
};

export type AccountStatusView = {
  id: number;
  name: string;
  zhihuUserName: string | null;
  status: string;
  statusReason: string | null;
  profileDir: string | null;
  lastLoginCheckAt: string | null;
  lastPublishAt: string | null;
  recoveryRequired: boolean;
  recoveryReason: string | null;
  resumeStage: JobStage | null;
  returnUrl: string | null;
  blockedJobs: JobListItem[];
};

export type DashboardSummary = {
  account: AccountStatusView | null;
  todaySchedule: ScheduleSlot[];
  weekSchedule: ScheduleSlot[];
  recentJobs: JobListItem[];
  recentTopics: TopicListItem[];
  metrics: {
    totalJobs: number;
    publishedJobs: number;
    manualLoginJobs: number;
    failedJobs: number;
    readyToPublishJobs: number;
  };
};

export type WorkerTickSummary = {
  generatedSlots: number;
  harvestedCandidates: number;
  preparedJobs: number;
  processedJobs: number;
  blockedByLogin: boolean;
  accountStatus: string;
  message: string | null;
};
