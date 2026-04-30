import type { PromptTestRunSummary, PromptVersionSummary } from "@zhihu-mvp/shared";

export type XAccountStatus = "active" | "paused";
export type XAccountAuthStatus = "ready" | "login_required" | "session_expired" | "blocked";
export type XPreferredPublishMode = "auto" | "single" | "thread";
export type XWriterPromptSource = "main_agent" | "database";
export type XTaskStatus =
  | "planned"
  | "writing_pending"
  | "writing"
  | "draft_ready"
  | "under_review"
  | "revision_required"
  | "approved_to_publish"
  | "publishing"
  | "published"
  | "publish_failed"
  | "blocked";
export type XReviewDecision = "approve" | "revise" | "block";
export type XPublishMode = "single" | "thread";
export type XPublishAction = "post" | "reply" | "quote";
export type XPublishCadence = "single_now" | "thread_continuous_now" | "defer";
export type XSoulUpdatedBy = "llm" | "user";
export type XTaskFailureStage = "writing" | "review" | "publish" | "unknown";
export type XTaskFailureType =
  | "llm_error"
  | "invalid_output"
  | "proxy_error"
  | "browser_error"
  | "publish_error"
  | "risk_signal"
  | "unknown_error";
export type XHotspotSourceType = "news" | "market" | "watchlist";
export type XHotspotTopicType =
  | "news_flash"
  | "price_move"
  | "policy"
  | "tooling"
  | "kol_signal"
  | "market_event"
  | "other";
export type XHotspotPriority = "P0" | "P1" | "P2" | "DROP";
export type XHotspotStatus = "active" | "ignored" | "tasked" | "expired";
export type XHotspotResearchStatus = "pending" | "running" | "completed" | "failed" | "not_needed";
export type XHotspotWatchlistItemType = "x_account" | "symbol" | "keyword" | "source";
export type XContentStyle =
  | "casual_note"
  | "small_insight"
  | "pitfall_log"
  | "tool_mention"
  | "industry_talk"
  | "interactive_qa"
  | "quote_repost";

export type XReviewAgentVerdict = "pass" | "minor_issue" | "major_issue" | "block";
export type XMainAgentDecisionType = "write" | "revise" | "approve_publish" | "defer" | "block";
export type XMainAgentFallbackStage = "plan" | "draft_gate";
export type XTagPlacement = "none" | "tail" | "inline";
export type XTagApplyTo = "single" | "first_post" | "last_post" | "all_posts";
export type XRetrievalContextStage = "writer" | "review";
export type XPromptCategory =
  | "main"
  | "hotspot_scout"
  | "writing"
  | "review"
  | "publish";
export type XPromptSetName =
  | "x_main_agent"
  | "x_hotspot_scout_agent"
  | "x_writer_agent"
  | "x_review_agent"
  | "x_publish_agent";

export interface XMainAgentWriterBrief {
  angle: string;
  goal: string;
  mustInclude: string[];
  mustAvoid: string[];
  openingDirection: string;
  threadPlan: string;
}

export interface XPublishStyleRatios {
  casualNote: number;
  smallInsight: number;
  pitfallLog: number;
  toolMention: number;
  industryTalk: number;
  interactiveQa: number;
  quoteRepost: number;
}

export interface XReviewAgentResult {
  verdict: XReviewAgentVerdict;
  summary: string;
  strengths: string[];
  issues: string[];
  riskFlags: string[];
  suggestedFixes: string[];
}

export interface XRetrievalContextDocument {
  id: string;
  type: string;
  title: string;
  description: string;
  instruction: string;
  snippets: string[];
  sourcePath: string;
}

export interface XRetrievalContext {
  accountKey: string | null;
  stage: XRetrievalContextStage;
  notes: string[];
  documents: XRetrievalContextDocument[];
}

export interface XTagPlan {
  hashtags: string[];
  placement: XTagPlacement;
  applyTo: XTagApplyTo;
  maxTags: number;
  reason: string;
}

export interface XMainAgentDecision {
  usedFallback: boolean;
  fallbackStage: XMainAgentFallbackStage | null;
  decision: XMainAgentDecisionType;
  reason: string;
  shouldWrite: boolean;
  shouldPublish: boolean;
  preferredMode: XPublishMode;
  publishAction: XPublishAction;
  contentStyle: XContentStyle;
  useHotspot: boolean;
  selectedHotspotIds: number[];
  targetTweetUrl: string | null;
  targetTweetReason: string;
  runtimeWriterPrompt: string;
  cadence: XPublishCadence;
  deferMinutes: number;
  tagPlan: XTagPlan;
  writerBrief: XMainAgentWriterBrief;
  revisionInstructions: string[];
  qualityNotes: string[];
  publishNotes: string[];
}

export interface XReferenceTweetSample {
  tweetUrl: string;
  text: string;
  publishedAt: string | null;
  isReply?: boolean;
  socialContext?: string | null;
}

export interface XPrompt {
  id: string;
  name: string;
  description: string;
  category: XPromptCategory;
  template: string;
  variables: string[];
  isActive: boolean;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface XAccount {
  id: string;
  name: string;
  handle: string;
  persona: string;
  targetAudience: string;
  styleGuide: string;
  learningTargets: string[];
  manualNotes: string;
  profileDir: string;
  proxyUrl: string | null;
  status: XAccountStatus;
  // 认证相关字段（用于浏览器登录态管理）
  accessToken: string | null;
  authStatus: "ready" | "login_required" | "session_expired" | "blocked" | null;
  authStatusReason: string | null;
  authCheckedAt: string | null;
  mainPromptVersionId: number | null;
  writerPromptVersionId: number | null;
  reviewPromptVersionId: number | null;
  publishPromptVersionId: number | null;
  writerPromptSource: XWriterPromptSource;
  publishStyleRatios: XPublishStyleRatios;
  lastPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface XAccountSoulDocument {
  accountId: string;
  version: number;
  coreIdentity: string;
  targetReader: string;
  voiceTraits: string[];
  worldview: string[];
  proofAnchors: string[];
  signatureMoves: string[];
  productMentionPolicy: string[];
  hardBoundaries: string[];
  tabooLexicon: string[];
  exemplarLines: string[];
  markdown: string;
  lastUpdatedAt: string;
  updatedBy: XSoulUpdatedBy;
  updateReason: string;
  userEditedAt: string | null;
}

export interface XDraftPack {
  summary: string;
  posts: string[];
  notes: string[];
}

export interface XReviewResult {
  decision: XReviewDecision;
  reason: string;
  revisionInstructions: string[];
  qualityNotes: string[];
}

export interface XPublishPlan {
  shouldPublish: boolean;
  mode: XPublishMode;
  action: XPublishAction;
  contentStyle: XContentStyle;
  cadence: XPublishCadence;
  deferMinutes: number;
  targetTweetUrl: string | null;
  selectedHotspotIds: number[];
  tagPlan: XTagPlan;
  reason: string;
}

export interface XPublishResult {
  transport: "dry_run" | "browser";
  tweetIds: string[];
  urls: string[];
  publishedAt: string;
  note: string;
}

export interface XTask {
  id: string;
  accountId: string;
  imageAssetId: string | null;
  title: string;
  brief: string;
  goal: string;
  preferredMode: XPreferredPublishMode;
  status: XTaskStatus;
  currentStage: string;
  soulVersion: number | null;
  soulMarkdownSnapshot: string | null;
  draftPack: XDraftPack | null;
  mainAgentPlan: XMainAgentDecision | null;
  reviewAgentResult: XReviewAgentResult | null;
  reviewResult: XReviewResult | null;
  publishPlan: XPublishPlan | null;
  publishResult: XPublishResult | null;
  promptVersionSnapshotJson: string | null;
  revisionCount: number;
  scheduledAt: string | null;
  failureStage: XTaskFailureStage | null;
  failureType: XTaskFailureType | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface XWorkerTickSummary {
  processedTaskIds: string[];
  publishedTaskIds: string[];
  blockedTaskIds: string[];
}

export interface XPromptTemplateView {
  id: string;
  setName: XPromptSetName;
  name: string;
  description: string;
  category: XPromptCategory;
  template: string;
  variables: string[];
  isActive: boolean;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeVersionId: number | null;
  activeVersion: number | null;
  activeLabel: string | null;
  versionCount: number;
}

export interface XPromptDetailView extends XPromptTemplateView {
  versions: PromptVersionSummary[];
  testRuns: PromptTestRunSummary[];
}

export interface XAccountPromptPanelView {
  category: "main" | "writing";
  prompt: XPromptDetailView;
  boundVersionId: number | null;
  boundVersion: PromptVersionSummary | null;
  accountVersions: PromptVersionSummary[];
}

export interface XHotspot {
  id: number;
  hotspotKey: string;
  title: string;
  summaryText: string;
  sourceType: XHotspotSourceType;
  topicType: XHotspotTopicType;
  symbols: string[];
  keywords: string[];
  matchedWatchlistValues: string[];
  canonicalUrl: string | null;
  score: number;
  priority: XHotspotPriority;
  status: XHotspotStatus;
  researchStatus: XHotspotResearchStatus;
  sourceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  eventTime: string | null;
  expiresAt: string;
  taskLinkedAt: string | null;
  researchSummaryText: string | null;
  researchUpdatedAt: string | null;
  suggestedTaskTitle: string | null;
  suggestedTaskBrief: string | null;
  angles: string[];
  risks: string[];
  createdAt: string;
  updatedAt: string;
}

export interface XHotspotSource {
  id: number;
  hotspotId: number;
  sourceHash: string;
  sourceType: XHotspotSourceType;
  sourceLabel: string;
  sourceUrl: string | null;
  title: string;
  summaryText: string;
  rawPayloadJson: string | null;
  eventTime: string | null;
  detectedAt: string;
  scoreDelta: number;
  createdAt: string;
}

export interface XHotspotResearchRun {
  id: number;
  hotspotId: number;
  status: "completed" | "failed";
  summary: string;
  whyNow: string;
  recommendedAction: "create_task" | "watch" | "ignore";
  suggestedTaskTitle: string;
  suggestedTaskBrief: string;
  angles: string[];
  risks: string[];
  operatorHints: string[];
  rawOutputJson: string | null;
  errorText: string | null;
  createdAt: string;
}

export interface XHotspotTaskLink {
  id: number;
  hotspotId: number | null;
  taskId: string;
  accountId: string;
  accountHandle: string;
  snapshotJson: string;
  createdAt: string;
}

export interface XHotspotDetail extends XHotspot {
  sources: XHotspotSource[];
  latestResearchRun: XHotspotResearchRun | null;
  taskLinks: XHotspotTaskLink[];
}

export interface XHotspotWatchlistItem {
  id: number;
  watchlistId: number;
  type: XHotspotWatchlistItemType;
  value: string;
  label: string;
  enabled: boolean;
  priority: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface XHotspotWatchlist {
  id: number;
  name: string;
  description: string;
  scope: "global";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  items: XHotspotWatchlistItem[];
}

export interface XHotspotScanRun {
  id: number;
  sourceType: XHotspotSourceType;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  summaryText: string | null;
  createdCount: number;
  updatedCount: number;
  researchCount: number;
  errorText: string | null;
}

export interface XHotspotScanSummary {
  triggeredSources: XHotspotSourceType[];
  skippedSources: XHotspotSourceType[];
  createdCount: number;
  updatedCount: number;
  researchCount: number;
  ignoredCount: number;
  runs: XHotspotScanRun[];
}

export interface XHotspotResearchOutput {
  summary: string;
  whyNow: string;
  recommendedAction: "create_task" | "watch" | "ignore";
  suggestedTaskTitle: string;
  suggestedTaskBrief: string;
  angles: string[];
  risks: string[];
  operatorHints: string[];
}
