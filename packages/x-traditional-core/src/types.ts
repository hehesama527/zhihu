import type { PromptTestRunSummary, PromptVersionSummary } from "@zhihu-mvp/shared";
import type {
  XAccount,
  XAccountSoulDocument,
  XContentStyle,
  XDraftPack,
  XHotspot,
  XHotspotDetail,
  XMainAgentDecision,
  XPreferredPublishMode,
  XPublishAction,
  XPublishCadence,
  XPublishMode,
  XPublishPlan,
  XPublishResult,
  XRetrievalContext,
  XRetrievalContextDocument,
  XReviewAgentResult,
  XReviewResult,
  XTagPlan,
  XTask,
  XTaskFailureStage,
  XTaskFailureType,
  XWorkerTickSummary
} from "@zhihu-mvp/x-core";

export type XTraditionalPromptCategory = "main" | "writing" | "review" | "publish" | "note";
export type XTraditionalPromptSetName =
  | "x_traditional_main_agent"
  | "x_traditional_writer_agent"
  | "x_traditional_review_agent"
  | "x_traditional_publish_agent"
  | "x_traditional_note_agent";
export type XTraditionalRagStage = "writer" | "review";
export type XTraditionalRagDocType =
  | "style_rules"
  | "number_expression_rules"
  | "review_rubric"
  | "good_single_posts"
  | "good_threads"
  | "bad_posts";
export type XTraditionalRagDocFormat = "markdown" | "jsonl";

export type XTraditionalTopicDecision = "write" | "defer" | "block";

export interface XTraditionalTopicSelection {
  decision: XTraditionalTopicDecision;
  reason: string;
  title: string;
  brief: string;
  goal: string;
  preferredMode: XPublishMode;
  publishAction: XPublishAction;
  contentStyle: XContentStyle;
  useHotspot: boolean;
  selectedHotspotIds: number[];
  targetTweetUrl: string | null;
  targetTweetReason: string;
  cadence: XPublishCadence;
  deferMinutes: number;
  tagPlan: XTagPlan;
  writerBrief: XMainAgentDecision["writerBrief"];
  qualityNotes: string[];
}

export interface XTraditionalPromptTemplateView {
  id: XTraditionalPromptCategory;
  setName: XTraditionalPromptSetName;
  name: string;
  description: string;
  category: XTraditionalPromptCategory;
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

export interface XTraditionalPromptDetailView extends XTraditionalPromptTemplateView {
  versions: PromptVersionSummary[];
  testRuns: PromptTestRunSummary[];
}

export interface XTraditionalRagAccountMapping {
  accountKey: string;
  enabled: boolean;
  accountIds: string[];
  handles: string[];
  names: string[];
}

export interface XTraditionalRagAccountMap {
  version: number;
  mappings: XTraditionalRagAccountMapping[];
}

export interface XTraditionalRagDocumentManifest {
  id: string;
  type: XTraditionalRagDocType;
  title: string;
  description: string;
  format: XTraditionalRagDocFormat;
  path: string;
  enabled: boolean;
  stages: XTraditionalRagStage[];
  modes: XPublishMode[];
  maxItems: number;
}

export interface XTraditionalRagLibraryManifest {
  accountKey: string;
  displayName: string;
  version: number;
  docs: XTraditionalRagDocumentManifest[];
}

export interface XTraditionalRagExampleRecord {
  id: string;
  text: string;
  notes: string;
  mode: XPublishMode;
  topicTags: string[];
  voiceTags: string[];
}

export interface XTraditionalNoteAgentSourcePaths {
  readme: string;
  accountConfigDir: string;
  ragLibraryDir: string;
  soulCandidatePath: string;
  noteAgentAssetDir: string;
}

export type XTraditionalNoteAgentMode = "style_learning";
export type XTraditionalNoteAgentPhase =
  | "collect_source_samples"
  | "distill_style_profile"
  | "draft_account_assets"
  | "apply_account_assets";
export type XTraditionalNoteAgentPhaseStatus = "passed" | "warning" | "failed";

export interface XTraditionalNoteAgentSourceAccountInput {
  platform: "x";
  handleOrUrl: string;
}

export interface XTraditionalNoteAgentSourceAccount {
  platform: "x";
  handleOrUrl: string;
  normalizedHandle: string | null;
  profileUrl: string | null;
}

export interface XTraditionalNoteAgentCollectionInput {
  sampleSize: number;
  lookbackDays: number;
  includeReplies: boolean;
}

export interface XTraditionalNoteAgentGenerateInput {
  mode: XTraditionalNoteAgentMode;
  sourceAccount: XTraditionalNoteAgentSourceAccountInput;
  collection: XTraditionalNoteAgentCollectionInput;
  manualSeedTexts?: string[];
}

export interface XTraditionalNoteAgentDocumentRead {
  path: string;
  label: string;
  exists: boolean;
}

export interface XTraditionalNoteAgentValidationCheck {
  label: string;
  passed: boolean;
  severity: "error" | "warning" | "info";
  details: string;
}

export interface XTraditionalNoteAgentPhaseReport {
  phase: XTraditionalNoteAgentPhase;
  status: XTraditionalNoteAgentPhaseStatus;
  startedAt: string;
  finishedAt: string;
  inputsRead: XTraditionalNoteAgentDocumentRead[];
  validationChecks: XTraditionalNoteAgentValidationCheck[];
  diagnostics: string[];
}

export interface XTraditionalNoteAgentCollectionSummary {
  requestedSampleSize: number;
  lookbackDays: number;
  includeReplies: boolean;
  timelineRequestedCount: number;
  timelineRawSampleCount: number;
  timelineSampleCount: number;
  focusFilteredCount: number;
  manualSeedCount: number;
  collectedSampleCount: number;
  browserCollectionSucceeded: boolean;
  sourceHandle: string | null;
  sourceUrl: string | null;
  browserDiagnostics: string[];
}

export interface XTraditionalNoteAgentSamplePreviewItem {
  source: "timeline" | "manual_seed";
  text: string;
  publishedAt: string | null;
  tweetUrl: string | null;
}

export interface XTraditionalNoteAgentDraft {
  accountId: string;
  accountKey: string;
  matchedBy: string | null;
  mode: XTraditionalNoteAgentMode;
  sourceAccount: XTraditionalNoteAgentSourceAccount;
  summary: string;
  diagnostics: string[];
  operatorNotes: string[];
  collectionSummary: XTraditionalNoteAgentCollectionSummary;
  phaseReports: XTraditionalNoteAgentPhaseReport[];
  learnedStyleProfileMarkdown: string;
  soulCandidateMarkdown: string;
  styleRulesMarkdown: string;
  numberExpressionRulesMarkdown: string;
  reviewRubricMarkdown: string;
  learnedSamplesJsonl: string;
  sourceMapYaml: string;
  samplePreview: XTraditionalNoteAgentSamplePreviewItem[];
  generatedAt: string;
  sourcePaths: XTraditionalNoteAgentSourcePaths;
}

export interface XTraditionalNoteAgentApplyActions {
  writeRagDocs: boolean;
  saveSoulCandidate: boolean;
  saveLearnedAssets: boolean;
}

export interface XTraditionalNoteAgentApplyInput {
  draft: XTraditionalNoteAgentDraft;
  actions?: Partial<XTraditionalNoteAgentApplyActions>;
}

export interface XTraditionalNoteAgentApplyResult {
  accountId: string;
  accountKey: string;
  appliedAt: string;
  writtenPaths: string[];
  actionsApplied: XTraditionalNoteAgentApplyActions;
  phaseReport: XTraditionalNoteAgentPhaseReport;
}

export type {
  XAccount,
  XAccountSoulDocument,
  XContentStyle,
  XDraftPack,
  XHotspot,
  XHotspotDetail,
  XMainAgentDecision,
  XPreferredPublishMode,
  XPublishAction,
  XPublishCadence,
  XPublishMode,
  XPublishPlan,
  XPublishResult,
  XRetrievalContext,
  XRetrievalContextDocument,
  XReviewAgentResult,
  XReviewResult,
  XTagPlan,
  XTask,
  XTaskFailureStage,
  XTaskFailureType,
  XWorkerTickSummary
};
