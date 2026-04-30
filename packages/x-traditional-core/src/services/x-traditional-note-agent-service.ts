import fs from "node:fs/promises";
import {
  XBrowserRuntime,
  collectAccountTimeline,
  extractHandleFromLink,
  normalizeProfileUrl,
  type XAccount,
  type XReferenceTweetSample
} from "@zhihu-mvp/x-core";
import { XTraditionalRagRepository } from "../repositories/x-traditional-rag-repository.js";
import type {
  XTraditionalNoteAgentApplyActions,
  XTraditionalNoteAgentApplyInput,
  XTraditionalNoteAgentApplyResult,
  XTraditionalNoteAgentCollectionInput,
  XTraditionalNoteAgentCollectionSummary,
  XTraditionalNoteAgentDocumentRead,
  XTraditionalNoteAgentDraft,
  XTraditionalNoteAgentGenerateInput,
  XTraditionalNoteAgentPhase,
  XTraditionalNoteAgentPhaseReport,
  XTraditionalNoteAgentPhaseStatus,
  XTraditionalNoteAgentSamplePreviewItem,
  XTraditionalNoteAgentSourceAccount,
  XTraditionalNoteAgentValidationCheck
} from "../types.js";
import { XTraditionalLlmService } from "./x-traditional-llm-service.js";

type NoteAgentAccount = Pick<
  XAccount,
  | "id"
  | "handle"
  | "name"
  | "persona"
  | "targetAudience"
  | "styleGuide"
  | "manualNotes"
  | "learningTargets"
  | "profileDir"
  | "proxyUrl"
>;

type NoteAgentCollectedSample = {
  id: string;
  source: "timeline" | "manual_seed";
  text: string;
  tweetUrl: string | null;
  publishedAt: string | null;
  isReply: boolean;
};

type NoteAgentTimelineFocusFilterResult = {
  keptSamples: NoteAgentCollectedSample[];
  filteredOutCount: number;
  filteredReasonCounts: Record<string, number>;
};

type NoteAgentFocusProfile = {
  includeTerms: string[];
  avoidTerms: string[];
  hardRejectTerms: string[];
  recurringPhrases: string[];
  requireKnowledgeStructure: boolean;
  rejectAssetCentricHotTakes: boolean;
  preferCalmKnowledgeTone: boolean;
  rejectLifestyleContent: boolean;
  rejectTradeDiaryTone: boolean;
  rejectBrandSlogans: boolean;
  rejectHighlyRepetitiveLines: boolean;
};

type NoteAgentPhaseContext = {
  ragReadmeMarkdown: string;
  accountConfig: {
    soulMarkdown: string;
    strategyYaml: string;
    goalsYaml: string;
    sampleFilterMarkdown: string;
    boundariesMarkdown: string;
    soulCandidateMarkdown: string;
  };
  existingRagDocs: {
    styleRulesMarkdown: string;
    numberExpressionRulesMarkdown: string;
    reviewRubricMarkdown: string;
  };
  existingNoteAgentAssets: {
    learnedStyleProfileMarkdown: string;
    learnedSamplesJsonl: string;
    sourceMapYaml: string;
  };
  inputsRead: XTraditionalNoteAgentDocumentRead[];
};

type NoteAgentStyleProfileOutput = {
  summary: string;
  diagnostics: string[];
  operatorNotes: string[];
  learnedStyleProfileMarkdown: string;
};

type NoteAgentDraftAssetsOutput = {
  summary: string;
  diagnostics: string[];
  operatorNotes: string[];
  soulCandidateMarkdown: string;
  styleRulesMarkdown: string;
  numberExpressionRulesMarkdown: string;
  reviewRubricMarkdown: string;
};

const DEFAULT_COLLECTION: XTraditionalNoteAgentCollectionInput = {
  sampleSize: 40,
  lookbackDays: 90,
  includeReplies: false
};

const DEFAULT_X_BASE_URL = "https://x.com";
const MIN_USEFUL_SAMPLE_COUNT = 8;

export class XTraditionalNoteAgentService {
  constructor(
    private readonly llmService = new XTraditionalLlmService(),
    private readonly repository = new XTraditionalRagRepository(),
    private readonly browserRuntime = new XBrowserRuntime()
  ) {}

  async generateDraft(account: NoteAgentAccount, input: XTraditionalNoteAgentGenerateInput): Promise<XTraditionalNoteAgentDraft> {
    await this.repository.ensureReady();

    const resolution = await this.repository.resolveAccountLibrary(account);
    if (!resolution.accountKey) {
      throw new Error(`No traditional RAG library mapping found for account ${account.id}.`);
    }

    const accountKey = resolution.accountKey;
    const normalizedInput = normalizeGenerateInput(input);
    const resolvedSourceAccount = resolveSourceAccount(normalizedInput.sourceAccount.handleOrUrl);
    const phaseReports: XTraditionalNoteAgentPhaseReport[] = [];

    const collected = await this.collectSourceSamples(account, accountKey, resolvedSourceAccount, normalizedInput);
    phaseReports.push(collected.phaseReport);

    const styleProfile = await this.distillStyleProfile(
      account,
      accountKey,
      resolution.matchedBy,
      normalizedInput,
      resolvedSourceAccount,
      collected.collectionSummary,
      collected.samples
    );
    phaseReports.push(styleProfile.phaseReport);

    const draftedAssets = await this.draftAccountAssets(
      account,
      accountKey,
      resolution.matchedBy,
      normalizedInput,
      resolvedSourceAccount,
      collected.collectionSummary,
      collected.samples,
      styleProfile.learnedStyleProfileMarkdown
    );
    phaseReports.push(draftedAssets.phaseReport);

    const diagnostics = dedupeStringArray([
      ...collected.collectionSummary.browserDiagnostics,
      ...collected.phaseReport.diagnostics,
      ...styleProfile.diagnostics,
      ...styleProfile.phaseReport.diagnostics,
      ...draftedAssets.diagnostics,
      ...draftedAssets.phaseReport.diagnostics
    ]);
    const operatorNotes = dedupeStringArray([
      ...styleProfile.operatorNotes,
      ...draftedAssets.operatorNotes,
      ...buildCollectionOperatorNotes(collected.collectionSummary, collected.samples.length)
    ]);
    const sourceMapYaml = buildSourceMapYaml({
      account,
      accountKey,
      sourceAccount: resolvedSourceAccount,
      collectionSummary: collected.collectionSummary,
      samples: collected.samples
    });
    const learnedSamplesJsonl = buildLearnedSamplesJsonl(accountKey, resolvedSourceAccount, collected.samples);
    const generatedAt = new Date().toISOString();

    return {
      accountId: account.id,
      accountKey,
      matchedBy: resolution.matchedBy,
      mode: normalizedInput.mode,
      sourceAccount: resolvedSourceAccount,
      summary:
        normalizeSingleLine(draftedAssets.summary) ||
        normalizeSingleLine(styleProfile.summary) ||
        `已为 ${account.name || `@${account.handle}`} 生成账户学习草稿。`,
      diagnostics,
      operatorNotes,
      collectionSummary: collected.collectionSummary,
      phaseReports,
      learnedStyleProfileMarkdown: normalizeMarkdownDocument(
        styleProfile.learnedStyleProfileMarkdown,
        buildStyleProfileFallback({
          account,
          accountKey,
          sourceAccount: resolvedSourceAccount,
          collectionSummary: collected.collectionSummary,
          samples: collected.samples
        }).learnedStyleProfileMarkdown
      ),
      soulCandidateMarkdown: draftedAssets.soulCandidateMarkdown,
      styleRulesMarkdown: draftedAssets.styleRulesMarkdown,
      numberExpressionRulesMarkdown: draftedAssets.numberExpressionRulesMarkdown,
      reviewRubricMarkdown: draftedAssets.reviewRubricMarkdown,
      learnedSamplesJsonl,
      sourceMapYaml,
      samplePreview: buildSamplePreview(collected.samples),
      generatedAt,
      sourcePaths: {
        readme: this.repository.getRootReadmePath(),
        accountConfigDir: this.repository.getAccountConfigDirPath(accountKey),
        ragLibraryDir: this.repository.getAccountLibraryPath(accountKey),
        soulCandidatePath: this.repository.getSoulCandidatePath(accountKey),
        noteAgentAssetDir: this.repository.getAccountNoteAgentDirPath(accountKey)
      }
    };
  }

  async applyDraft(account: NoteAgentAccount, input: XTraditionalNoteAgentApplyInput): Promise<XTraditionalNoteAgentApplyResult> {
    await this.repository.ensureReady();

    const resolution = await this.repository.resolveAccountLibrary(account);
    if (!resolution.accountKey) {
      throw new Error(`No traditional RAG library mapping found for account ${account.id}.`);
    }

    const accountKey = resolution.accountKey;
    const actions = normalizeApplyActions(input.actions);
    if (!actions.writeRagDocs && !actions.saveSoulCandidate && !actions.saveLearnedAssets) {
      throw new Error("Note agent apply requires at least one enabled write action.");
    }

    const draft = input.draft;
    if (draft.accountId !== account.id) {
      throw new Error("Note agent draft accountId does not match the target account.");
    }
    if (draft.accountKey !== accountKey) {
      throw new Error(`Note agent draft accountKey ${draft.accountKey} does not match the resolved library ${accountKey}.`);
    }

    const phaseStartedAt = new Date().toISOString();
    const context = await this.loadPhaseContext(accountKey);
    const diagnostics: string[] = [];
    const validationChecks: XTraditionalNoteAgentValidationCheck[] = [];
    const writeTargets: string[] = [];

    validationChecks.push({
      label: "target_account_matches",
      passed: true,
      severity: "info",
      details: `draft.accountId=${draft.accountId}, draft.accountKey=${draft.accountKey}`
    });

    const writeOperations: Array<Promise<string>> = [];
    if (actions.writeRagDocs) {
      writeTargets.push(
        this.repository.getAccountLibraryDocumentPath(accountKey, "style_rules.md"),
        this.repository.getAccountLibraryDocumentPath(accountKey, "number_expression_rules.md"),
        this.repository.getAccountLibraryDocumentPath(accountKey, "review_rubric.md")
      );
      writeOperations.push(
        this.repository.writeMarkdownDocument(accountKey, "style_rules.md", ensureFileContent(draft.styleRulesMarkdown)),
        this.repository.writeMarkdownDocument(
          accountKey,
          "number_expression_rules.md",
          ensureFileContent(draft.numberExpressionRulesMarkdown)
        ),
        this.repository.writeMarkdownDocument(accountKey, "review_rubric.md", ensureFileContent(draft.reviewRubricMarkdown))
      );
    }

    if (actions.saveSoulCandidate) {
      writeTargets.push(this.repository.getSoulCandidatePath(accountKey));
      writeOperations.push(this.repository.writeSoulCandidate(accountKey, ensureFileContent(draft.soulCandidateMarkdown)));
    }

    if (actions.saveLearnedAssets) {
      writeTargets.push(
        this.repository.getAccountNoteAgentAssetPath(accountKey, "learned_style_profile.md"),
        this.repository.getAccountNoteAgentAssetPath(accountKey, "learned_samples.jsonl"),
        this.repository.getAccountNoteAgentAssetPath(accountKey, "source_map.yaml"),
        this.repository.getAccountNoteAgentAssetPath(accountKey, "last_run.json")
      );
      writeOperations.push(
        this.repository.writeNoteAgentAsset(
          accountKey,
          "learned_style_profile.md",
          ensureFileContent(draft.learnedStyleProfileMarkdown)
        ),
        this.repository.writeNoteAgentAsset(
          accountKey,
          "learned_samples.jsonl",
          ensureTextContent(draft.learnedSamplesJsonl, "learned_samples.jsonl")
        ),
        this.repository.writeNoteAgentAsset(accountKey, "source_map.yaml", ensureTextContent(draft.sourceMapYaml, "source_map.yaml")),
        this.repository.writeNoteAgentAsset(
          accountKey,
          "last_run.json",
          `${JSON.stringify(
            {
              mode: draft.mode,
              accountId: draft.accountId,
              accountKey: draft.accountKey,
              sourceAccount: draft.sourceAccount,
              collectionSummary: draft.collectionSummary,
              generatedAt: draft.generatedAt,
              appliedAt: new Date().toISOString(),
              actionsApplied: actions
            },
            null,
            2
          )}\n`
        )
      );
    }

    validationChecks.push({
      label: "write_paths_match_target_account",
      passed: writeTargets.every((item) => item.includes(`\\${accountKey}\\`) || item.includes(`/${accountKey}/`)),
      severity: "error",
      details: `${writeTargets.length} target files prepared for ${accountKey}.`
    });

    const writtenPaths = await Promise.all(writeOperations);

    const verificationResults = await Promise.all(
      writtenPaths.map(async (filePath) => ({
        path: filePath,
        content: await readPathSnapshot(filePath)
      }))
    );
    const nonEmptyVerificationPassed = verificationResults.every((item) => item.content.exists && item.content.content.trim().length > 0);
    validationChecks.push({
      label: "writeback_reloaded_non_empty",
      passed: nonEmptyVerificationPassed,
      severity: "error",
      details: `${verificationResults.filter((item) => item.content.content.trim().length > 0).length}/${verificationResults.length} files reloaded as non-empty.`
    });
    if (!nonEmptyVerificationPassed) {
      diagnostics.push("One or more files were written but reloaded as empty during verification.");
    }

    const phaseReport = finalizePhaseReport(
      "apply_account_assets",
      phaseStartedAt,
      context.inputsRead,
      validationChecks,
      diagnostics
    );

    return {
      accountId: account.id,
      accountKey,
      appliedAt: phaseReport.finishedAt,
      writtenPaths,
      actionsApplied: actions,
      phaseReport
    };
  }

  private async collectSourceSamples(
    account: NoteAgentAccount,
    accountKey: string,
    sourceAccount: XTraditionalNoteAgentSourceAccount,
    input: XTraditionalNoteAgentGenerateInput
  ) {
    const phaseStartedAt = new Date().toISOString();
    const context = await this.loadPhaseContext(accountKey);
    const diagnostics: string[] = [];
    const validationChecks: XTraditionalNoteAgentValidationCheck[] = [];

    const manualSeedSamples = normalizeManualSeedSamples(input.manualSeedTexts);
    const desiredTimelineCount = Math.min(Math.max(input.collection.sampleSize * 3, input.collection.sampleSize + 12), 120);
    let browserCollectionSucceeded = false;
    let browserDiagnostics: string[] = [];
    let timelineSamples: XReferenceTweetSample[] = [];
    let sourceHandle = sourceAccount.normalizedHandle;
    let sourceUrl = sourceAccount.profileUrl;

    const sessionKey = `x-traditional-note-agent-${account.id}`;
    try {
      const collected = await this.browserRuntime.withSession(
        sessionKey,
        resolveBrowserProfileDir(account),
        account.proxyUrl,
        async (page) => collectAccountTimeline(page, sourceAccount.handleOrUrl, desiredTimelineCount, DEFAULT_X_BASE_URL)
      );
      browserCollectionSucceeded = true;
      timelineSamples = collected.tweets;
      sourceHandle = collected.handle || sourceHandle;
      sourceUrl = collected.link || sourceUrl;
    } catch (error) {
      browserDiagnostics = [
        buildErrorMessage(
          error,
          "Timeline collection failed. Manual seed texts can be used as the fallback sample source."
        )
      ];
    } finally {
      await this.browserRuntime.closeSession(sessionKey).catch(() => undefined);
    }

    const filteredTimelineSamples = filterTimelineSamples(timelineSamples, input.collection);
    const focusProfile = buildSampleFilterFocusProfile(context, filteredTimelineSamples);
    const focusedTimelineSamples = filterTimelineSamplesByLearningFocus(filteredTimelineSamples, focusProfile);
    const combinedSamples = finalizeCollectedSamples(
      focusedTimelineSamples.keptSamples,
      manualSeedSamples,
      input.collection.sampleSize
    );
    const requiredSampleCount = Math.max(3, Math.min(input.collection.sampleSize, MIN_USEFUL_SAMPLE_COUNT));
    const hasEnoughSamples = combinedSamples.length >= requiredSampleCount;
    const emptySampleCount = combinedSamples.filter((item) => !item.text.trim()).length;
    const replyCount = combinedSamples.filter((item) => item.isReply).length;

    validationChecks.push({
      label: "usable_sample_count",
      passed: hasEnoughSamples,
      severity: hasEnoughSamples ? "info" : "warning",
      details: `usable=${combinedSamples.length}, recommended>=${requiredSampleCount}, requested=${input.collection.sampleSize}`
    });
    validationChecks.push({
      label: "dedupe_applied",
      passed: combinedSamples.length === dedupeSampleCount(combinedSamples),
      severity: "info",
      details: `final unique sample count=${combinedSamples.length}`
    });
    validationChecks.push({
      label: "replies_excluded_by_default",
      passed: input.collection.includeReplies || replyCount === 0,
      severity: input.collection.includeReplies ? "info" : "warning",
      details: input.collection.includeReplies
        ? "Reply filtering was explicitly disabled."
        : `reply_count_after_filter=${replyCount}`
    });
    validationChecks.push({
      label: "no_empty_samples",
      passed: emptySampleCount === 0,
      severity: "error",
      details: `empty_sample_count=${emptySampleCount}`
    });
    validationChecks.push({
      label: "focus_filter_applied",
      passed: true,
      severity: "info",
      details:
        `timeline_raw=${filteredTimelineSamples.length}, focus_filtered=${focusedTimelineSamples.filteredOutCount}, ` +
        `kept=${focusedTimelineSamples.keptSamples.length}, sample_filter_terms=${focusProfile.includeTerms.length}, ` +
        `sample_filter_avoid_terms=${focusProfile.avoidTerms.length}, sample_filter_hard_reject_terms=${focusProfile.hardRejectTerms.length}`
    });

    if (!browserCollectionSucceeded) {
      diagnostics.push(...browserDiagnostics);
    }
    if (focusedTimelineSamples.filteredOutCount > 0) {
      diagnostics.push(
        `Applied sample-filter-doc driven sample filter and removed ${focusedTimelineSamples.filteredOutCount} low-relevance timeline samples before style distillation.`
      );
      const filteredReasonSummary = formatFocusFilterReasonCounts(focusedTimelineSamples.filteredReasonCounts);
      if (filteredReasonSummary) {
        diagnostics.push(`Focus filter reasons: ${filteredReasonSummary}`);
      }
    }
    if (!hasEnoughSamples) {
      diagnostics.push("Collected sample count is below the preferred minimum; later phases may be less stable.");
    }
    if (!input.collection.includeReplies && replyCount > 0) {
      diagnostics.push("Reply samples remain after filtering; inspect the collection result manually.");
    }

    const collectionSummary: XTraditionalNoteAgentCollectionSummary = {
      requestedSampleSize: input.collection.sampleSize,
      lookbackDays: input.collection.lookbackDays,
      includeReplies: input.collection.includeReplies,
      timelineRequestedCount: desiredTimelineCount,
      timelineRawSampleCount: filteredTimelineSamples.length,
      timelineSampleCount: focusedTimelineSamples.keptSamples.length,
      focusFilteredCount: focusedTimelineSamples.filteredOutCount,
      manualSeedCount: combinedSamples.filter((item) => item.source === "manual_seed").length,
      collectedSampleCount: combinedSamples.length,
      browserCollectionSucceeded,
      sourceHandle,
      sourceUrl,
      browserDiagnostics
    };

    return {
      samples: combinedSamples,
      collectionSummary,
      phaseReport: finalizePhaseReport(
        "collect_source_samples",
        phaseStartedAt,
        context.inputsRead,
        validationChecks,
        diagnostics
      )
    };
  }

  private async distillStyleProfile(
    account: NoteAgentAccount,
    accountKey: string,
    matchedBy: string | null,
    input: XTraditionalNoteAgentGenerateInput,
    sourceAccount: XTraditionalNoteAgentSourceAccount,
    collectionSummary: XTraditionalNoteAgentCollectionSummary,
    samples: NoteAgentCollectedSample[]
  ) {
    const phaseStartedAt = new Date().toISOString();
    const context = await this.loadPhaseContext(accountKey);
    const fallback = buildStyleProfileFallback({
      account,
      accountKey,
      sourceAccount,
      collectionSummary,
      samples
    });

    const output = await this.llmService.runJson<NoteAgentStyleProfileOutput>(
      "x_traditional_note_agent",
      {
        stage: "distill_style_profile",
        mode: input.mode,
        chain: "x_traditional",
        matchedBy,
        targetAccount: buildTargetAccountPayload(account, accountKey),
        sourceAccount,
        collection: input.collection,
        collectionSummary,
        samples: samples.map((item) => ({
          source: item.source,
          text: item.text,
          tweetUrl: item.tweetUrl,
          publishedAt: item.publishedAt
        })),
        existingAssets: {
          ragReadmeMarkdown: context.ragReadmeMarkdown,
          accountConfig: context.accountConfig,
          existingRagDocs: context.existingRagDocs,
          existingNoteAgentAssets: context.existingNoteAgentAssets
        },
        operatorConstraints: {
          manualTriggerOnly: true,
          independentFromMainAgent: true,
          learnExpressionNotBelief: true,
          doNotCopyViewpoints: true,
          doNotCopyCatchphrases: true,
          requiredSections: STYLE_PROFILE_REQUIRED_SECTIONS
        }
      },
      fallback,
      {
        promptSuffix: NOTE_AGENT_RUNTIME_SUFFIX
      }
    );

    const sanitized = sanitizeStyleProfileOutput(output, fallback);
    const validationChecks = STYLE_PROFILE_REQUIRED_SECTIONS.map((section) => ({
      label: `required_section_${section}`,
      passed: markdownHasSection(sanitized.learnedStyleProfileMarkdown, section),
      severity: "error" as const,
      details: section
    }));

    return {
      summary: sanitized.summary,
      diagnostics: sanitized.diagnostics,
      operatorNotes: sanitized.operatorNotes,
      learnedStyleProfileMarkdown: sanitized.learnedStyleProfileMarkdown,
      phaseReport: finalizePhaseReport(
        "distill_style_profile",
        phaseStartedAt,
        context.inputsRead,
        validationChecks,
        sanitized.diagnostics
      )
    };
  }

  private async draftAccountAssets(
    account: NoteAgentAccount,
    accountKey: string,
    matchedBy: string | null,
    input: XTraditionalNoteAgentGenerateInput,
    sourceAccount: XTraditionalNoteAgentSourceAccount,
    collectionSummary: XTraditionalNoteAgentCollectionSummary,
    samples: NoteAgentCollectedSample[],
    learnedStyleProfileMarkdown: string
  ) {
    const phaseStartedAt = new Date().toISOString();
    const context = await this.loadPhaseContext(accountKey);
    const fallback = buildDraftAssetsFallback({
      account,
      accountKey,
      sourceAccount,
      collectionSummary,
      learnedStyleProfileMarkdown,
      existingRagDocs: context.existingRagDocs,
      existingSoulCandidateMarkdown: context.accountConfig.soulCandidateMarkdown
    });

    const output = await this.llmService.runJson<NoteAgentDraftAssetsOutput>(
      "x_traditional_note_agent",
      {
        stage: "draft_account_assets",
        mode: input.mode,
        chain: "x_traditional",
        matchedBy,
        targetAccount: buildTargetAccountPayload(account, accountKey),
        sourceAccount,
        collection: input.collection,
        collectionSummary,
        learnedStyleProfileMarkdown,
        samplePreview: buildSamplePreview(samples),
        existingAssets: {
          ragReadmeMarkdown: context.ragReadmeMarkdown,
          accountConfig: context.accountConfig,
          existingRagDocs: context.existingRagDocs,
          existingNoteAgentAssets: context.existingNoteAgentAssets
        },
        operatorConstraints: {
          manualTriggerOnly: true,
          independentFromMainAgent: true,
          doNotOverwriteOfficialSoul: true,
          doNotCopyViewpoints: true,
          requiredOutputs: [
            "soulCandidateMarkdown",
            "styleRulesMarkdown",
            "numberExpressionRulesMarkdown",
            "reviewRubricMarkdown"
          ]
        }
      },
      fallback,
      {
        promptSuffix: NOTE_AGENT_RUNTIME_SUFFIX
      }
    );

    const sanitized = sanitizeDraftAssetsOutput(output, fallback);
    const validationChecks: XTraditionalNoteAgentValidationCheck[] = [
      {
        label: "soul_candidate_generated",
        passed: Boolean(sanitized.soulCandidateMarkdown.trim()),
        severity: "error",
        details: "soul_candidate.md"
      },
      {
        label: "style_rules_generated",
        passed: Boolean(sanitized.styleRulesMarkdown.trim()),
        severity: "error",
        details: "style_rules.md"
      },
      {
        label: "number_rules_generated",
        passed: Boolean(sanitized.numberExpressionRulesMarkdown.trim()),
        severity: "error",
        details: "number_expression_rules.md"
      },
      {
        label: "review_rubric_generated",
        passed: Boolean(sanitized.reviewRubricMarkdown.trim()),
        severity: "error",
        details: "review_rubric.md"
      }
    ];

    return {
      ...sanitized,
      phaseReport: finalizePhaseReport(
        "draft_account_assets",
        phaseStartedAt,
        context.inputsRead,
        validationChecks,
        sanitized.diagnostics
      )
    };
  }

  private async loadPhaseContext(accountKey: string): Promise<NoteAgentPhaseContext> {
    const fileSpecs = [
      { label: "rag_readme", path: this.repository.getRootReadmePath() },
      { label: "account_soul", path: this.repository.getAccountConfigFilePath(accountKey, "soul.md") },
      { label: "account_strategy", path: this.repository.getAccountConfigFilePath(accountKey, "strategy.yaml") },
      { label: "account_goals", path: this.repository.getAccountConfigFilePath(accountKey, "goals.yaml") },
      { label: "account_sample_filter", path: this.repository.getAccountConfigFilePath(accountKey, "sample_filter.md") },
      { label: "account_boundaries", path: this.repository.getAccountConfigFilePath(accountKey, "boundaries.yaml") },
      { label: "soul_candidate", path: this.repository.getSoulCandidatePath(accountKey) },
      { label: "style_rules", path: this.repository.getAccountLibraryDocumentPath(accountKey, "style_rules.md") },
      {
        label: "number_expression_rules",
        path: this.repository.getAccountLibraryDocumentPath(accountKey, "number_expression_rules.md")
      },
      { label: "review_rubric", path: this.repository.getAccountLibraryDocumentPath(accountKey, "review_rubric.md") },
      {
        label: "learned_style_profile",
        path: this.repository.getAccountNoteAgentAssetPath(accountKey, "learned_style_profile.md")
      },
      {
        label: "learned_samples",
        path: this.repository.getAccountNoteAgentAssetPath(accountKey, "learned_samples.jsonl")
      },
      {
        label: "source_map",
        path: this.repository.getAccountNoteAgentAssetPath(accountKey, "source_map.yaml")
      }
    ] as const;

    const snapshots = await Promise.all(
      fileSpecs.map(async (spec) => ({
        label: spec.label,
        path: spec.path,
        snapshot: await readPathSnapshot(spec.path)
      }))
    );
    const contentByLabel = new Map(snapshots.map((item) => [item.label, item.snapshot.content]));

    return {
      ragReadmeMarkdown: contentByLabel.get("rag_readme") ?? "",
      accountConfig: {
        soulMarkdown: contentByLabel.get("account_soul") ?? "",
        strategyYaml: contentByLabel.get("account_strategy") ?? "",
        goalsYaml: contentByLabel.get("account_goals") ?? "",
        sampleFilterMarkdown: contentByLabel.get("account_sample_filter") ?? "",
        boundariesMarkdown: contentByLabel.get("account_boundaries") ?? "",
        soulCandidateMarkdown: contentByLabel.get("soul_candidate") ?? ""
      },
      existingRagDocs: {
        styleRulesMarkdown: contentByLabel.get("style_rules") ?? "",
        numberExpressionRulesMarkdown: contentByLabel.get("number_expression_rules") ?? "",
        reviewRubricMarkdown: contentByLabel.get("review_rubric") ?? ""
      },
      existingNoteAgentAssets: {
        learnedStyleProfileMarkdown: contentByLabel.get("learned_style_profile") ?? "",
        learnedSamplesJsonl: contentByLabel.get("learned_samples") ?? "",
        sourceMapYaml: contentByLabel.get("source_map") ?? ""
      },
      inputsRead: snapshots.map((item) => ({
        label: item.label,
        path: item.path,
        exists: item.snapshot.exists
      }))
    };
  }
}

function buildTargetAccountPayload(account: NoteAgentAccount, accountKey: string) {
  return {
    id: account.id,
    accountKey,
    handle: account.handle,
    name: account.name,
    persona: account.persona,
    targetAudience: account.targetAudience,
    styleGuide: account.styleGuide,
    manualNotes: account.manualNotes,
    learningTargets: account.learningTargets
  };
}

function normalizeGenerateInput(input: XTraditionalNoteAgentGenerateInput): XTraditionalNoteAgentGenerateInput {
  return {
    mode: "style_learning",
    sourceAccount: {
      platform: "x",
      handleOrUrl: input.sourceAccount.handleOrUrl.trim()
    },
    collection: {
      sampleSize: normalizePositiveInteger(input.collection.sampleSize, DEFAULT_COLLECTION.sampleSize, 1, 120),
      lookbackDays: normalizePositiveInteger(input.collection.lookbackDays, DEFAULT_COLLECTION.lookbackDays, 1, 365),
      includeReplies: Boolean(input.collection.includeReplies)
    },
    manualSeedTexts: Array.isArray(input.manualSeedTexts)
      ? input.manualSeedTexts.map((item) => item.trim()).filter(Boolean)
      : []
  };
}

function resolveSourceAccount(handleOrUrl: string): XTraditionalNoteAgentSourceAccount {
  const normalizedHandle = extractHandleFromLink(handleOrUrl);
  return {
    platform: "x",
    handleOrUrl,
    normalizedHandle,
    profileUrl: normalizedHandle ? normalizeProfileUrl(normalizedHandle, DEFAULT_X_BASE_URL) : null
  };
}

function normalizeApplyActions(actions?: Partial<XTraditionalNoteAgentApplyActions>): XTraditionalNoteAgentApplyActions {
  return {
    writeRagDocs: actions?.writeRagDocs ?? true,
    saveSoulCandidate: actions?.saveSoulCandidate ?? true,
    saveLearnedAssets: actions?.saveLearnedAssets ?? true
  };
}

function normalizePositiveInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeManualSeedSamples(value: string[] | undefined): NoteAgentCollectedSample[] {
  return dedupeStringArray(value ?? []).map((text, index) => ({
    id: `manual_${String(index + 1).padStart(3, "0")}`,
    source: "manual_seed",
    text,
    tweetUrl: null,
    publishedAt: null,
    isReply: false
  }));
}

function filterTimelineSamples(samples: XReferenceTweetSample[], collection: XTraditionalNoteAgentCollectionInput): NoteAgentCollectedSample[] {
  const cutoffTimestamp = Date.now() - collection.lookbackDays * 24 * 60 * 60 * 1000;
  const filtered: NoteAgentCollectedSample[] = [];

  for (const item of samples) {
    const text = item.text?.trim() ?? "";
    const publishedAt = item.publishedAt ?? null;
    const isReply = item.isReply === true;

    if (!text || text.length < 12) {
      continue;
    }
    if (!collection.includeReplies && isReply) {
      continue;
    }
    if (publishedAt) {
      const parsed = new Date(publishedAt).getTime();
      if (Number.isFinite(parsed) && parsed < cutoffTimestamp) {
        continue;
      }
    }

    filtered.push({
      id: "",
      source: "timeline",
      text,
      tweetUrl: item.tweetUrl ?? null,
      publishedAt,
      isReply
    });
  }

  return filtered;
}

function filterTimelineSamplesByLearningFocus(
  samples: NoteAgentCollectedSample[],
  focusProfile: NoteAgentFocusProfile
): NoteAgentTimelineFocusFilterResult {
  const keptSamples: NoteAgentCollectedSample[] = [];
  const filteredReasonCounts: Record<string, number> = {};

  for (const sample of samples) {
    const evaluation = evaluateTimelineSampleFocus(sample, focusProfile);
    if (evaluation.keep) {
      keptSamples.push(sample);
      continue;
    }

    for (const reason of evaluation.reasons) {
      filteredReasonCounts[reason] = (filteredReasonCounts[reason] ?? 0) + 1;
    }
  }

  return {
    keptSamples,
    filteredOutCount: samples.length - keptSamples.length,
    filteredReasonCounts
  };
}

function finalizeCollectedSamples(
  timelineSamples: NoteAgentCollectedSample[],
  manualSeedSamples: NoteAgentCollectedSample[],
  sampleSize: number
) {
  const deduped = dedupeCollectedSamples([...timelineSamples, ...manualSeedSamples])
    .slice(0, sampleSize)
    .map((item, index) => ({
      ...item,
      id: `${item.source === "timeline" ? "timeline" : "manual"}_${String(index + 1).padStart(3, "0")}`
    }));

  return deduped;
}

function dedupeCollectedSamples(samples: NoteAgentCollectedSample[]) {
  const seen = new Set<string>();
  const deduped: NoteAgentCollectedSample[] = [];

  for (const sample of samples) {
    const fingerprint = `${sample.tweetUrl ?? ""}::${sample.text.replace(/\s+/g, " ").trim().toLowerCase()}`;
    if (!sample.text.trim() || seen.has(fingerprint)) {
      continue;
    }

    seen.add(fingerprint);
    deduped.push(sample);
  }

  return deduped;
}

function dedupeSampleCount(samples: NoteAgentCollectedSample[]) {
  return new Set(samples.map((item) => `${item.tweetUrl ?? ""}::${item.text.replace(/\s+/g, " ").trim().toLowerCase()}`)).size;
}

function buildSamplePreview(samples: NoteAgentCollectedSample[]): XTraditionalNoteAgentSamplePreviewItem[] {
  return samples.slice(0, 8).map((item) => ({
    source: item.source,
    text: item.text,
    publishedAt: item.publishedAt,
    tweetUrl: item.tweetUrl
  }));
}

function buildLearnedSamplesJsonl(
  accountKey: string,
  sourceAccount: XTraditionalNoteAgentSourceAccount,
  samples: NoteAgentCollectedSample[]
) {
  return samples
    .map((item) =>
      JSON.stringify({
        id: item.id,
        accountKey,
        source: item.source,
        sourceAccount: {
          platform: sourceAccount.platform,
          handleOrUrl: sourceAccount.handleOrUrl,
          normalizedHandle: sourceAccount.normalizedHandle,
          profileUrl: sourceAccount.profileUrl
        },
        tweetUrl: item.tweetUrl,
        publishedAt: item.publishedAt,
        text: item.text
      })
    )
    .join("\n")
    .concat(samples.length ? "\n" : "");
}

function buildSourceMapYaml(input: {
  account: NoteAgentAccount;
  accountKey: string;
  sourceAccount: XTraditionalNoteAgentSourceAccount;
  collectionSummary: XTraditionalNoteAgentCollectionSummary;
  samples: NoteAgentCollectedSample[];
}) {
  const sampleLines = input.samples
    .map((item) =>
      [
        "  - id: " + yamlString(item.id),
        "    source: " + yamlString(item.source),
        "    tweetUrl: " + yamlNullable(item.tweetUrl),
        "    publishedAt: " + yamlNullable(item.publishedAt),
        "    preview: " + yamlString(truncateInline(item.text, 140))
      ].join("\n")
    )
    .join("\n");

  return [
    "version: 1",
    `targetAccountId: ${yamlString(input.account.id)}`,
    `targetAccountKey: ${yamlString(input.accountKey)}`,
    `targetHandle: ${yamlString(input.account.handle)}`,
    "sourceAccount:",
    `  platform: ${yamlString(input.sourceAccount.platform)}`,
    `  handleOrUrl: ${yamlString(input.sourceAccount.handleOrUrl)}`,
    `  normalizedHandle: ${yamlNullable(input.sourceAccount.normalizedHandle)}`,
    `  profileUrl: ${yamlNullable(input.sourceAccount.profileUrl)}`,
    "collection:",
    `  requestedSampleSize: ${input.collectionSummary.requestedSampleSize}`,
    `  lookbackDays: ${input.collectionSummary.lookbackDays}`,
    `  includeReplies: ${input.collectionSummary.includeReplies ? "true" : "false"}`,
    `  timelineRequestedCount: ${input.collectionSummary.timelineRequestedCount}`,
    `  timelineRawSampleCount: ${input.collectionSummary.timelineRawSampleCount}`,
    `  timelineSampleCount: ${input.collectionSummary.timelineSampleCount}`,
    `  focusFilteredCount: ${input.collectionSummary.focusFilteredCount}`,
    `  manualSeedCount: ${input.collectionSummary.manualSeedCount}`,
    `  collectedSampleCount: ${input.collectionSummary.collectedSampleCount}`,
    `  browserCollectionSucceeded: ${input.collectionSummary.browserCollectionSucceeded ? "true" : "false"}`,
    "samples:",
    sampleLines || "  []"
  ]
    .filter(Boolean)
    .join("\n")
    .concat("\n");
}

function buildCollectionOperatorNotes(collectionSummary: XTraditionalNoteAgentCollectionSummary, sampleCount: number) {
  const notes = [
    "本次学习结果只服务传统链路，不进入 main/hotspot/zhihu。",
    "学习目标是表达方式，不是复制来源账户的观点、结论和口头禅。"
  ];

  if (!collectionSummary.browserCollectionSucceeded) {
    notes.push("浏览器采样未成功，本轮结果可能更多依赖手动补样本。");
  }
  if (collectionSummary.focusFilteredCount > 0) {
    notes.push(`采样质检已移除 ${collectionSummary.focusFilteredCount} 条低相关样本，避免把生活化或纯情绪化表达带进风格学习。`);
  }
  if (sampleCount < MIN_USEFUL_SAMPLE_COUNT) {
    notes.push("可用样本偏少，建议人工补样本后再生成一轮。");
  }

  return notes;
}

function buildSampleFilterFocusProfile(
  context: NoteAgentPhaseContext,
  timelineSamples: NoteAgentCollectedSample[]
): NoteAgentFocusProfile {
  const markdown = context.accountConfig.sampleFilterMarkdown;
  const includeTerms = normalizeFocusTerms(extractMarkdownSectionPhrases(markdown, SAMPLE_FILTER_INCLUDE_SECTION_NAMES));
  const avoidTerms = normalizeFocusTerms(extractMarkdownSectionPhrases(markdown, SAMPLE_FILTER_AVOID_SECTION_NAMES));
  const hardRejectTerms = normalizeFocusTerms(
    extractMarkdownSectionPhrases(markdown, SAMPLE_FILTER_HARD_REJECT_SECTION_NAMES)
  );
  const recurringPhrases = buildRecurringPhraseCandidates(timelineSamples);

  return {
    includeTerms,
    avoidTerms,
    hardRejectTerms,
    recurringPhrases,
    requireKnowledgeStructure: extractMarkdownBooleanSetting(markdown, "requireKnowledgeStructure") ?? false,
    rejectAssetCentricHotTakes: extractMarkdownBooleanSetting(markdown, "rejectAssetCentricHotTakes") ?? false,
    preferCalmKnowledgeTone: extractMarkdownBooleanSetting(markdown, "preferCalmKnowledgeTone") ?? false,
    rejectLifestyleContent: extractMarkdownBooleanSetting(markdown, "rejectLifestyleContent") ?? false,
    rejectTradeDiaryTone: extractMarkdownBooleanSetting(markdown, "rejectTradeDiaryTone") ?? false,
    rejectBrandSlogans: extractMarkdownBooleanSetting(markdown, "rejectBrandSlogans") ?? false,
    rejectHighlyRepetitiveLines: extractMarkdownBooleanSetting(markdown, "rejectHighlyRepetitiveLines") ?? false
  };
}

function splitFocusPhrases(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\n,，。；;、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractSoulAnchorPhrases(markdown: string) {
  return [
    ...extractMarkdownLeadBlock(markdown, "账号定位一句话："),
    ...extractMarkdownSectionPhrases(markdown, SOUL_DRIVEN_POSITIVE_SECTION_NAMES)
  ];
}

function extractSoulAvoidPhrases(markdown: string) {
  return extractMarkdownSectionPhrases(markdown, SOUL_DRIVEN_NEGATIVE_SECTION_NAMES);
}

function extractMarkdownLeadBlock(markdown: string, label: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const results: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== label) {
      continue;
    }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor].trim();
      if (!line) {
        continue;
      }
      if (/^#+\s/.test(line)) {
        break;
      }
      results.push(line.replace(/^[-*]\s*/, "").trim());
      break;
    }
  }

  return results;
}

function extractMarkdownSectionPhrases(markdown: string, sectionNames: readonly string[]) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const results: string[] = [];
  let activeSection: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headingMatch = line.match(/^##\s+(?:\d+\.\s*)?(.+)$/);
    if (headingMatch) {
      const headingName = headingMatch[1]?.trim() ?? "";
      activeSection = sectionNames.find((item) => headingName.includes(item)) ?? null;
      continue;
    }
    if (!activeSection || !line) {
      continue;
    }
    if (/^#\s+/.test(line)) {
      activeSection = null;
      continue;
    }

    results.push(line.replace(/^[-*]\s*/, "").trim());
  }

  return results;
}

function extractMarkdownBooleanSetting(markdown: string, key: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-*]\s*/, "").trim();
    const match = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*[:=]\s*(.+)$/);
    if (!match || match[1] !== key) {
      continue;
    }

    const normalizedValue = match[2]?.trim().toLowerCase();
    if (["true", "yes", "on", "1"].includes(normalizedValue)) {
      return true;
    }
    if (["false", "no", "off", "0"].includes(normalizedValue)) {
      return false;
    }
  }

  return null;
}

function extractYamlFocusPhrases(yamlText: string, keys: readonly string[]) {
  const lines = yamlText.replace(/\r\n/g, "\n").split("\n");
  const results: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const indent = match[1]?.length ?? 0;
    const key = match[2]?.trim() ?? "";
    const remainder = match[3]?.trim() ?? "";
    if (!keys.includes(key)) {
      continue;
    }

    if (remainder && remainder !== "|" && remainder !== ">") {
      results.push(stripYamlScalar(remainder));
      continue;
    }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nested = lines[cursor];
      const nestedIndent = nested.match(/^(\s*)/)?.[1].length ?? 0;
      if (nested.trim() && nestedIndent <= indent) {
        break;
      }

      const itemMatch = nested.match(/^\s*-\s+(.+)$/);
      if (itemMatch?.[1]) {
        results.push(stripYamlScalar(itemMatch[1]));
      }
    }
  }

  return results;
}

function stripYamlScalar(value: string) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function normalizeFocusTerms(value: string[]) {
  const phrases = value
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const parts = [item, ...item.split(/[()（）,:：，。；;、/]/).map((part) => part.trim())].filter(Boolean);
      const stripped = item.replace(/^(不做|不要|不能|不写|不主动|不把|不)/, "").trim();
      return stripped && stripped !== item ? [...parts, stripped] : parts;
    });

  return dedupeStringArray(
    phrases.filter((item) => item.length >= 2).filter((item) => !NOTE_AGENT_FOCUS_STOP_TERMS.has(item.toLowerCase()))
  );
}

function buildRecurringPhraseCandidates(samples: NoteAgentCollectedSample[]) {
  const phraseCounts = new Map<string, number>();
  const threshold = samples.length >= 24 ? 3 : 2;

  for (const sample of samples) {
    const uniquePhrases = new Set(extractRecurringPhraseLines(sample.text));
    for (const phrase of uniquePhrases) {
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }
  }

  return [...phraseCounts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((left, right) => right[1] - left[1])
    .map(([phrase]) => phrase);
}

function extractRecurringPhraseLines(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .map((line) => line.replace(/\s*x\.com\/\S+$/i, "").trim())
    .filter((line) => line.length >= 6 && line.length <= 32)
    .filter((line) => !/https?:\/\//i.test(line))
    .filter((line) => !/x\.com\//i.test(line))
    .filter((line) => (line.match(/\d/g) ?? []).length <= 2)
    .filter((line) => !/^[A-Z0-9_\-]+$/i.test(line));
}

function countHighlyRepetitiveFragments(text: string) {
  const fragments = text
    .replace(/\r\n/g, "\n")
    .split(/[\n，,、。！？!?；;：:]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 12);
  const fragmentCounts = new Map<string, number>();

  for (const fragment of fragments) {
    fragmentCounts.set(fragment, (fragmentCounts.get(fragment) ?? 0) + 1);
  }

  const repeatedFragmentKinds = [...fragmentCounts.values()].filter((count) => count >= 2).length;
  const repeatedPatternCount = countPatternMatches(text, NOTE_AGENT_REPETITIVE_SIGNAL_PATTERNS);
  return repeatedFragmentKinds + repeatedPatternCount;
}

function hasFocusKeyword(terms: string[], keywords: readonly string[]) {
  return terms.some((term) => keywords.some((keyword) => term.includes(keyword)));
}

function evaluateTimelineSampleFocus(sample: NoteAgentCollectedSample, focusProfile: NoteAgentFocusProfile) {
  const normalizedText = sample.text.replace(/\s+/g, " ").trim();
  const domainSignalCount =
    countPatternMatches(normalizedText, NOTE_AGENT_MARKET_SIGNAL_PATTERNS) +
    countPatternMatches(normalizedText, NOTE_AGENT_ANALYSIS_SIGNAL_PATTERNS);
  const lifestyleSignalCount = countPatternMatches(normalizedText, NOTE_AGENT_LIFESTYLE_SIGNAL_PATTERNS);
  const emotionalSignalCount = countPatternMatches(normalizedText, NOTE_AGENT_EMOTIONAL_SIGNAL_PATTERNS);
  const genericQuoteSignalCount = countPatternMatches(normalizedText, NOTE_AGENT_GENERIC_QUOTE_PATTERNS);
  const educationalSignalCount = countPatternMatches(normalizedText, NOTE_AGENT_EDUCATIONAL_SIGNAL_PATTERNS);
  const tradeDiarySignalCount = countPatternMatches(normalizedText, NOTE_AGENT_TRADE_DIARY_SIGNAL_PATTERNS);
  const recurringSloganCount = countContainedTerms(normalizedText, focusProfile.recurringPhrases);
  const repetitiveFragmentCount = countHighlyRepetitiveFragments(normalizedText);
  const hardRejectSignalCount =
    countPatternMatches(normalizedText, NOTE_AGENT_HARD_REJECT_PATTERNS) +
    countContainedTerms(normalizedText, focusProfile.hardRejectTerms);
  const assetCentricSignalCount =
    countPatternMatches(normalizedText, NOTE_AGENT_ASSET_CENTRIC_SIGNAL_PATTERNS) + countSpecificAssetMentions(normalizedText);
  const includeMatchCount = countContainedTerms(normalizedText, focusProfile.includeTerms);
  const avoidMatchCount = countContainedTerms(normalizedText, focusProfile.avoidTerms);
  const hasNumberSignal = /\d/.test(normalizedText);

  const positiveScore = includeMatchCount * 3 + domainSignalCount + educationalSignalCount * 2 + (hasNumberSignal ? 1 : 0);
  const negativeScore =
    avoidMatchCount * 3 +
    (focusProfile.rejectLifestyleContent ? lifestyleSignalCount * 2 : 0) +
    (focusProfile.preferCalmKnowledgeTone ? emotionalSignalCount : 0) +
    genericQuoteSignalCount * 2 +
    (focusProfile.rejectAssetCentricHotTakes ? assetCentricSignalCount : 0) +
    (focusProfile.rejectTradeDiaryTone ? tradeDiarySignalCount : 0) +
    (focusProfile.rejectBrandSlogans ? recurringSloganCount * 3 : 0) +
    (focusProfile.rejectHighlyRepetitiveLines ? repetitiveFragmentCount * 2 : 0) +
    hardRejectSignalCount * 4;
  const isGenericShortPost = normalizedText.length < 28 && includeMatchCount === 0 && domainSignalCount < 3;
  const isQuoteLikeWithoutAnalysis = genericQuoteSignalCount > 0 && includeMatchCount === 0 && domainSignalCount < 3;
  const isNoiseDominant = negativeScore >= Math.max(5, positiveScore + 2);
  const hasFilterToneConflict =
    focusProfile.preferCalmKnowledgeTone &&
    (emotionalSignalCount >= 2 || (focusProfile.rejectTradeDiaryTone && tradeDiarySignalCount >= 3)) &&
    includeMatchCount + educationalSignalCount === 0;
  const hasFilterLifestyleConflict =
    focusProfile.rejectLifestyleContent && lifestyleSignalCount > 0 && includeMatchCount + educationalSignalCount === 0;
  const lacksKnowledgeStructure =
    focusProfile.requireKnowledgeStructure &&
    educationalSignalCount === 0 &&
    includeMatchCount === 0 &&
    assetCentricSignalCount >= 4;
  const hasAssetCentricHotTake =
    focusProfile.rejectAssetCentricHotTakes &&
    assetCentricSignalCount >= 5 &&
    educationalSignalCount === 0 &&
    includeMatchCount === 0;
  const hasFilterTradeDiaryConflict =
    focusProfile.rejectTradeDiaryTone &&
    tradeDiarySignalCount >= 3 &&
    educationalSignalCount === 0 &&
    includeMatchCount === 0;
  const hasBrandSloganConflict =
    focusProfile.rejectBrandSlogans && recurringSloganCount > 0 && educationalSignalCount === 0 && includeMatchCount === 0;
  const hasHighlyRepetitiveLineConflict =
    focusProfile.rejectHighlyRepetitiveLines && repetitiveFragmentCount > 0 && educationalSignalCount === 0 && includeMatchCount === 0;
  const keep =
    (includeMatchCount > 0 || domainSignalCount >= 3) &&
    !isGenericShortPost &&
    !isQuoteLikeWithoutAnalysis &&
    !isNoiseDominant &&
    hardRejectSignalCount === 0 &&
    !hasAssetCentricHotTake &&
    !hasFilterTradeDiaryConflict &&
    !hasBrandSloganConflict &&
    !hasHighlyRepetitiveLineConflict &&
    !hasFilterToneConflict &&
    !hasFilterLifestyleConflict;

  const reasons: string[] = [];
  if (!keep) {
    if (avoidMatchCount > 0) {
      reasons.push("filter_doc_avoid_overlap");
    }
    if (hasFilterToneConflict) {
      reasons.push("tone_conflict_with_filter_doc");
    }
    if (hasFilterLifestyleConflict) {
      reasons.push("lifestyle_conflict_with_filter_doc");
    }
    if (lacksKnowledgeStructure) {
      reasons.push("missing_knowledge_structure");
    }
    if (hardRejectSignalCount > 0) {
      reasons.push("hard_reject_phrase");
    }
    if (hasBrandSloganConflict) {
      reasons.push("brand_slogan_like");
    }
    if (hasHighlyRepetitiveLineConflict) {
      reasons.push("high_repetition_phrase");
    }
    if (hasAssetCentricHotTake) {
      reasons.push("asset_centric_hot_take");
    }
    if (hasFilterTradeDiaryConflict) {
      reasons.push("trade_diary_conflict");
    }
    if (focusProfile.rejectLifestyleContent && lifestyleSignalCount > 0) {
      reasons.push("lifestyle_noise");
    }
    if (focusProfile.preferCalmKnowledgeTone && emotionalSignalCount > 0) {
      reasons.push("emotion_heavy");
    }
    if (genericQuoteSignalCount > 0) {
      reasons.push("generic_quote");
    }
    if (includeMatchCount === 0 && domainSignalCount < 3) {
      reasons.push("weak_filter_doc_alignment");
    }
    if (!reasons.length) {
      reasons.push("weak_learning_value");
    }
  }

  return {
    keep,
    reasons
  };
}

function countPatternMatches(text: string, patterns: readonly RegExp[]) {
  return patterns.reduce((count, pattern) => (pattern.test(text) ? count + 1 : count), 0);
}

function countSpecificAssetMentions(text: string) {
  const matches = [...text.matchAll(/(?:^|[^A-Za-z0-9])([A-Z]{3,5}|[0-9]{5,6})(?=$|[^A-Za-z0-9])/g)].map(
    (match) => match[1]?.toUpperCase() ?? ""
  );

  return new Set(matches.filter(Boolean)).size;
}

function countContainedTerms(text: string, terms: string[]) {
  return terms.reduce((count, term) => (text.includes(term) ? count + 1 : count), 0);
}

function formatFocusFilterReasonCounts(value: Record<string, number>) {
  return Object.entries(value)
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

function buildStyleProfileFallback(input: {
  account: NoteAgentAccount;
  accountKey: string;
  sourceAccount: XTraditionalNoteAgentSourceAccount;
  collectionSummary: XTraditionalNoteAgentCollectionSummary;
  samples: NoteAgentCollectedSample[];
}): NoteAgentStyleProfileOutput {
  const signals = analyzeSamples(input.samples);
  const sourceLabel = input.sourceAccount.normalizedHandle ? `@${input.sourceAccount.normalizedHandle}` : input.sourceAccount.handleOrUrl;

  return {
    summary: `已为 ${input.account.name || `@${input.account.handle}`} 提炼一份账户学习风格画像，供人工审阅后写回账户级资产。`,
    diagnostics:
      input.samples.length >= MIN_USEFUL_SAMPLE_COUNT
        ? []
        : ["Source sample count is low, so the learned style profile is based on limited evidence."],
    operatorNotes: [
      "优先检查“不可学特征”部分，确认没有把来源账户的人格和结论直接迁移给目标账户。",
      "如果目标账户定位和来源账户风格冲突，以目标账户原有定位为准。"
    ],
    learnedStyleProfileMarkdown: [
      `# ${input.accountKey} Learned Style Profile`,
      "",
      "## 来源概览",
      "",
      `- 目标账户：${input.account.name || `@${input.account.handle}`}`,
      `- 学习来源：${sourceLabel}`,
      `- 可用样本：${input.collectionSummary.collectedSampleCount} 条`,
      `- 浏览器采样：${input.collectionSummary.browserCollectionSucceeded ? "成功" : "受限 / 回退"}`,
      "",
      "## 可学特征",
      "",
      `- ${signals.openingSignal}`,
      `- ${signals.structureSignal}`,
      `- ${signals.constraintSignal}`,
      "",
      "## 不可学特征",
      "",
      "- 不能直接复制来源账户对市场、项目或人物的具体判断。",
      "- 不能照搬来源账户的口头禅、标签、免责声明或固定句型。",
      "- 不能把来源账户的人设直接覆盖到目标账户原有定位上。",
      "",
      "## 数字表达",
      "",
      `- ${signals.numberSignal}`,
      "- 数字只保留最能支撑判断的部分，避免把结构化数据逐列翻译成推文。",
      "",
      "## 开头方式",
      "",
      `- ${signals.openingTemplate}`,
      "- 更适合先抛判断或条件，再补依据，而不是先做背景铺垫。",
      "",
      "## 收尾方式",
      "",
      `- ${signals.endingSignal}`,
      "- 收尾更适合落在边界、条件或执行提醒，不适合鸡汤式升华。",
      "",
      "## 迁移提醒",
      "",
      "- 目标账户应保留自己的题材边界、目标受众和矩阵角色。",
      "- 来源账户只提供表达机制参考，不提供立场授权。"
    ].join("\n")
  };
}

function buildDraftAssetsFallback(input: {
  account: NoteAgentAccount;
  accountKey: string;
  sourceAccount: XTraditionalNoteAgentSourceAccount;
  collectionSummary: XTraditionalNoteAgentCollectionSummary;
  learnedStyleProfileMarkdown: string;
  existingRagDocs: {
    styleRulesMarkdown: string;
    numberExpressionRulesMarkdown: string;
    reviewRubricMarkdown: string;
  };
  existingSoulCandidateMarkdown: string;
}): NoteAgentDraftAssetsOutput {
  const sourceLabel = input.sourceAccount.normalizedHandle ? `@${input.sourceAccount.normalizedHandle}` : input.sourceAccount.handleOrUrl;
  const soulCandidateFallback = [
    `# ${input.accountKey} Soul Candidate`,
    "",
    "## 账户定位",
    "",
    `- 核心身份：${normalizeBulletValue(input.account.persona, "保留目标账户当前的定位，不因学习来源而换人格。")}`,
    `- 目标读者：${normalizeBulletValue(input.account.targetAudience, "面向会在 X 上消费交易判断和市场线索的中文读者。")}`,
    "",
    "## 本轮学习吸收点",
    "",
    `- 学习来源：${sourceLabel}`,
    "- 吸收更成熟的开头方式、判断节奏、数字取舍和边界表达。",
    "- 保留目标账户自己的题材选择和矩阵职责，不复制来源账户立场。",
    "",
    "## 不可覆盖项",
    "",
    "- 不直接覆盖正式 soul.md。",
    "- 不把来源账户的结论、常用口头禅、风险提示原样挪过来。",
    "- 不因为学习来源而让目标账户偏离既定运营策略。",
    "",
    "## 候选表达提醒",
    "",
    "- 先给判断，再补支撑点。",
    "- 收尾落在条件、风险边界或执行提醒，不做口号式拔高。"
  ].join("\n");

  const styleRulesFallback = [
    `# ${input.accountKey} Style Rules`,
    "",
    "## Positioning",
    "",
    `- 目标账户保留自己的定位：${normalizeBulletValue(input.account.persona, "以现有账户定位为准。")}`,
    `- 学习来源 ${sourceLabel} 的是表达机制，不是观点和人格。`,
    "",
    "## Preferred Moves",
    "",
    "- 开头优先先落判断、结论或问题切口，再补支撑。",
    "- 正文只保留最能支撑判断的 1-2 个证据点，避免写成报告。",
    "- 收尾优先落在条件、边界、执行提醒或风险控制。",
    "",
    "## Avoid",
    "",
    "- 不要把来源账户的词口、免责声明和个人立场整段照搬。",
    "- 不要为了显得专业而把所有背景、定义和结论写满。",
    "- 不要因为学习来源而让目标账户失去自己的矩阵角色。"
  ].join("\n");

  const numberRulesFallback = [
    `# ${input.accountKey} Number Expression Rules`,
    "",
    "## Core Rule",
    "",
    "- 数字只保留最能支撑判断的部分，不为完整而完整。",
    "- 如果数字只是证明强弱或方向，优先用区间、方向和自然虚指表达。",
    "",
    "## Keep Exact Numbers When",
    "",
    "- 这个数字直接决定判断是否成立。",
    "- 不写具体数值，结论就会失真。",
    "",
    "## Prefer Natural Reference When",
    "",
    "- 只是想表达变化方向、量级或节奏。",
    "- 同一组数据里只有一小部分真正有必要保留。",
    "",
    "## Hard Avoid",
    "",
    "- 不把表格数据一列列翻译成推文。",
    "- 不在单条里堆太多硬数字，制造 AI 味和报告味。"
  ].join("\n");

  const reviewRubricFallback = [
    `# ${input.accountKey} Review Rubric`,
    "",
    "## Pass Only If",
    "",
    "- 读起来像目标账户本人在表达，而不是来源账户的镜像。",
    "- 结论、数字和边界之间的关系清楚，没有为了完整而补全。",
    "- 能看出学习了表达方式，但看不出复制了来源账户的具体内容。",
    "",
    "## Mark As AI-like If",
    "",
    "- 像在复述结构化数据或热点库条目。",
    "- 开头像摘要，中间像数据表，结尾像标准总结。",
    "- 数字太密、信息太齐、节奏太整，缺少真人判断痕迹。",
    "",
    "## Fix Direction",
    "",
    "- 删掉不影响判断的解释和数字。",
    "- 保留最关键的 1-2 个支撑点。",
    "- 把“复制来源账户”改成“借用表达机制后重新表达目标账户判断”。"
  ].join("\n");

  return {
    summary: `已为 ${input.account.name || `@${input.account.handle}`} 生成账户学习资产草稿。`,
    diagnostics:
      input.collectionSummary.collectedSampleCount >= MIN_USEFUL_SAMPLE_COUNT
        ? []
        : ["Drafted account assets rely on a limited sample pool. Manual review is required."],
    operatorNotes: [
      "正式生效前请先检查 soul_candidate 是否仍然符合目标账户定位。",
      "style_rules / number_expression_rules / review_rubric 才是 writer/review 直接使用的正式资产。"
    ],
    soulCandidateMarkdown: normalizeMarkdownDocument(input.existingSoulCandidateMarkdown, soulCandidateFallback),
    styleRulesMarkdown: normalizeMarkdownDocument(input.existingRagDocs.styleRulesMarkdown, styleRulesFallback),
    numberExpressionRulesMarkdown: normalizeMarkdownDocument(
      input.existingRagDocs.numberExpressionRulesMarkdown,
      numberRulesFallback
    ),
    reviewRubricMarkdown: normalizeMarkdownDocument(input.existingRagDocs.reviewRubricMarkdown, reviewRubricFallback)
  };
}

function sanitizeStyleProfileOutput(
  output: NoteAgentStyleProfileOutput,
  fallback: NoteAgentStyleProfileOutput
): NoteAgentStyleProfileOutput {
  return {
    summary: normalizeSingleLine(output.summary) || fallback.summary,
    diagnostics: dedupeStringArray(Array.isArray(output.diagnostics) ? output.diagnostics : fallback.diagnostics),
    operatorNotes: dedupeStringArray(Array.isArray(output.operatorNotes) ? output.operatorNotes : fallback.operatorNotes),
    learnedStyleProfileMarkdown: normalizeMarkdownDocument(
      output.learnedStyleProfileMarkdown,
      fallback.learnedStyleProfileMarkdown
    )
  };
}

function sanitizeDraftAssetsOutput(
  output: NoteAgentDraftAssetsOutput,
  fallback: NoteAgentDraftAssetsOutput
): NoteAgentDraftAssetsOutput {
  return {
    summary: normalizeSingleLine(output.summary) || fallback.summary,
    diagnostics: dedupeStringArray(Array.isArray(output.diagnostics) ? output.diagnostics : fallback.diagnostics),
    operatorNotes: dedupeStringArray(Array.isArray(output.operatorNotes) ? output.operatorNotes : fallback.operatorNotes),
    soulCandidateMarkdown: normalizeMarkdownDocument(output.soulCandidateMarkdown, fallback.soulCandidateMarkdown),
    styleRulesMarkdown: normalizeMarkdownDocument(output.styleRulesMarkdown, fallback.styleRulesMarkdown),
    numberExpressionRulesMarkdown: normalizeMarkdownDocument(
      output.numberExpressionRulesMarkdown,
      fallback.numberExpressionRulesMarkdown
    ),
    reviewRubricMarkdown: normalizeMarkdownDocument(output.reviewRubricMarkdown, fallback.reviewRubricMarkdown)
  };
}

function finalizePhaseReport(
  phase: XTraditionalNoteAgentPhase,
  startedAt: string,
  inputsRead: XTraditionalNoteAgentDocumentRead[],
  validationChecks: XTraditionalNoteAgentValidationCheck[],
  diagnostics: string[]
): XTraditionalNoteAgentPhaseReport {
  return {
    phase,
    status: resolvePhaseStatus(validationChecks),
    startedAt,
    finishedAt: new Date().toISOString(),
    inputsRead,
    validationChecks,
    diagnostics: dedupeStringArray(diagnostics)
  };
}

function resolvePhaseStatus(validationChecks: XTraditionalNoteAgentValidationCheck[]): XTraditionalNoteAgentPhaseStatus {
  if (validationChecks.some((item) => !item.passed && item.severity === "error")) {
    return "failed";
  }
  if (validationChecks.some((item) => !item.passed)) {
    return "warning";
  }
  return "passed";
}

async function readPathSnapshot(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return {
      exists: true,
      content
    };
  } catch {
    return {
      exists: false,
      content: ""
    };
  }
}

function resolveBrowserProfileDir(account: NoteAgentAccount) {
  const existingProfileDir = account.profileDir?.trim();
  if (existingProfileDir) {
    return existingProfileDir;
  }

  return `note-agent/${sanitizeSlug(account.handle || account.id)}`;
}

function sanitizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function ensureFileContent(value: string) {
  const normalized = normalizeMarkdownDocument(value, "");
  if (!normalized.trim()) {
    throw new Error("Note agent markdown content cannot be empty when applying.");
  }

  return normalized;
}

function ensureTextContent(value: string, label: string) {
  const normalized = normalizeTextDocument(value);
  if (!normalized.trim()) {
    throw new Error(`Note agent ${label} cannot be empty when applying.`);
  }

  return normalized;
}

function normalizeMarkdownDocument(value: string, fallback: string) {
  const normalized = (value || "").replace(/\r\n/g, "\n").trim();
  const nextValue = normalized || fallback.replace(/\r\n/g, "\n").trim();
  return nextValue ? `${nextValue}\n` : "";
}

function normalizeTextDocument(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized ? `${normalized}\n` : "";
}

function normalizeSingleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeStringArray(value: string[]) {
  return Array.from(
    new Set(
      value
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function buildErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function markdownHasSection(markdown: string, section: string) {
  return new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(markdown);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function analyzeSamples(samples: NoteAgentCollectedSample[]) {
  const texts = samples.map((item) => item.text);
  const conditionalCount = countMatches(texts, /(如果|前提|除非|但|但是|不过|只要|unless|if)/i);
  const digitDenseCount = countMatches(texts, /\d/);
  const riskCount = countMatches(texts, /(风险|边界|前提|not financial advice|仅供参考|不是投资建议)/i);
  const averageLength =
    samples.length > 0 ? Math.round(samples.reduce((sum, item) => sum + item.text.length, 0) / samples.length) : 0;

  return {
    openingSignal:
      conditionalCount >= Math.max(2, Math.floor(samples.length / 4))
        ? "样本里经常先抛判断，再补条件和保留。"
        : "样本更适合开门见山给出判断，不适合长背景铺垫。",
    structureSignal:
      averageLength >= 140
        ? "正文偏长段判断型，更像连续推演而不是口号式短句。"
        : "正文偏紧凑，适合先结论后支撑，不适合平铺背景材料。",
    constraintSignal:
      riskCount > 0
        ? "样本会强调边界、前提和风险约束，这种克制感可以学习。"
        : "更适合保留克制表达和条件限制，避免写成绝对判断。",
    numberSignal:
      digitDenseCount >= Math.max(2, Math.floor(samples.length / 3))
        ? "样本会使用数字，但更像为判断服务的证据点，而不是整表翻译。"
        : "数字应该少而有用，只在确实支撑判断时保留。",
    openingTemplate: "可以直接从“我现在更在意的不是 X，而是 Y”或“这件事我先给结论”切入。",
    endingSignal:
      riskCount > 0
        ? "更适合收在条件、风险边界或执行提醒上。"
        : "更适合收在限制条件和后续观察点上，而不是情绪化升华。"
  };
}

function countMatches(texts: string[], pattern: RegExp) {
  return texts.reduce((count, text) => (pattern.test(text) ? count + 1 : count), 0);
}

function normalizeBulletValue(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function yamlNullable(value: string | null) {
  return value ? yamlString(value) : "null";
}

function truncateInline(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

const STYLE_PROFILE_REQUIRED_SECTIONS = ["可学特征", "不可学特征", "数字表达", "开头方式", "收尾方式"] as const;

const NOTE_AGENT_RUNTIME_SUFFIX = [
  "Manual note-agent boundary:",
  "1. This flow serves only the x-traditional chain and is triggered manually.",
  "2. Target account A learns from source account C. Learn expression and structure, not beliefs or catchphrases.",
  "3. Never copy viewpoints, slogans, signature one-liners, or concrete source content.",
  "4. Keep all free-text fields in Simplified Chinese unless preserving URLs, handles, or filenames.",
  "5. Do not overwrite official soul.md. Only produce soul_candidate.md and account-level RAG assets.",
  '6. If stage is "distill_style_profile", return exactly {"summary":"","diagnostics":[],"operatorNotes":[],"learnedStyleProfileMarkdown":""}.',
  '7. If stage is "draft_account_assets", return exactly {"summary":"","diagnostics":[],"operatorNotes":[],"soulCandidateMarkdown":"","styleRulesMarkdown":"","numberExpressionRulesMarkdown":"","reviewRubricMarkdown":""}.'
].join("\n");

const NOTE_AGENT_MARKET_SIGNAL_PATTERNS = [
  /btc/i,
  /eth/i,
  /ema/i,
  /macd/i,
  /rsi/i,
  /比特币/,
  /以太坊/,
  /行情/,
  /市场/,
  /牛市/,
  /熊市/,
  /山寨/,
  /现货/,
  /合约/,
  /仓位/,
  /止损/,
  /盈亏/,
  /回撤/,
  /趋势/,
  /结构/,
  /周期/,
  /赛道/,
  /龙头/,
  /纳斯达克/,
  /标普/,
  /英伟达/,
  /右侧/,
  /左侧/,
  /周线/,
  /日线/,
  /月线/,
  /趋势线/,
  /支撑/,
  /压制/,
  /突破/,
  /底部/,
  /顶部/,
  /流动性/,
  /爆仓/
] as const;

const NOTE_AGENT_ANALYSIS_SIGNAL_PATTERNS = [
  /如果/,
  /前提/,
  /除非/,
  /只有/,
  /条件/,
  /关键/,
  /意味着/,
  /说明/,
  /判断/,
  /确认/,
  /失效/,
  /过滤/,
  /复盘/,
  /拆解/,
  /不是/,
  /而是/,
  /因为/,
  /所以/
] as const;

const NOTE_AGENT_EDUCATIONAL_SIGNAL_PATTERNS = [
  /定义/,
  /误区/,
  /边界/,
  /场景/,
  /框架/,
  /步骤/,
  /拆成/,
  /适用/,
  /不适用/,
  /什么时候/,
  /怎么用/,
  /本质/,
  /核心/,
  /真正/,
  /先看/,
  /再看/
] as const;

const NOTE_AGENT_LIFESTYLE_SIGNAL_PATTERNS = [
  /美食/,
  /今日份/,
  /英语课/,
  /小家伙/,
  /孩子/,
  /父母/,
  /伴侣/,
  /子女/,
  /人生/,
  /心理学/,
  /享受生活/,
  /早餐/,
  /午餐/,
  /晚餐/,
  /旅游/,
  /电影/,
  /音乐/,
  /自拍/
] as const;

const NOTE_AGENT_EMOTIONAL_SIGNAL_PATTERNS = [
  /唉/,
  /真累了/,
  /道心崩/,
  /崩碎/,
  /吃屎/,
  /畜生/,
  /失望/,
  /绝望/,
  /猛猛的干/,
  /我买了点/,
  /求来一波/,
  /十年如梦/,
  /少年/,
  /心力/,
  /心气/,
  /吞噬/,
  /狗日/
] as const;

const NOTE_AGENT_GENERIC_QUOTE_PATTERNS = [
  /修身/,
  /修心/,
  /尊重他人命运/,
  /问心无愧/,
  /听天命/,
  /唯一需要正视的/
] as const;

const NOTE_AGENT_REPETITIVE_SIGNAL_PATTERNS = [
  /([一-龥A-Za-z]{2,8})[，,、。\s…!！?？]{0,2}\1/,
  /([一-龥A-Za-z]{2,8})[，,、。\s…!！?？]{0,2}\1[，,、。\s…!！?？]{0,2}\1/,
  /([一-龥A-Za-z]{2,10})\1/
] as const;

const NOTE_AGENT_TRADE_DIARY_SIGNAL_PATTERNS = [
  /我买了/,
  /我买入/,
  /我卖了/,
  /我看好/,
  /我不看好/,
  /我最高不看好/,
  /我开仓/,
  /我做多/,
  /我做空/,
  /稳赚/,
  /亏钱/,
  /亏时间/,
  /迷茫/,
  /别玩了吧/,
  /难道/
] as const;

const NOTE_AGENT_HARD_REJECT_PATTERNS = [
  /猛猛的干/,
  /我买了点/,
  /求来一波/,
  /抄底[!！]{2,}/,
  /稳?赚/
] as const;

const NOTE_AGENT_ASSET_CENTRIC_SIGNAL_PATTERNS = [
  /目标价/,
  /市值/,
  /财报/,
  /点位/,
  /万刀/,
  /美刀/,
  /阻力/,
  /支撑/,
  /破位/,
  /跌破/,
  /反弹/,
  /上涨/,
  /下跌/,
  /暴涨/,
  /暴跌/,
  /抄底/,
  /做多/,
  /做空/,
  /起飞/,
  /牛市/,
  /熊市/,
  /赛道/,
  /龙头/,
  /中短期/,
  /短线/
] as const;

const SOUL_DRIVEN_POSITIVE_SECTION_NAMES = ["核心身份", "世界观", "证明锚点", "标志性表达动作"] as const;
const SOUL_DRIVEN_NEGATIVE_SECTION_NAMES = ["产品提及边界", "硬边界", "禁用表达"] as const;
const GOAL_POSITIVE_YAML_KEYS = [
  "current_phase",
  "primary_goal",
  "secondary_goal",
  "current_focus",
  "current_experiments",
  "success_definition"
] as const;
const GOAL_NEGATIVE_YAML_KEYS = [
  "not_a_priority_for_now"
] as const;

const NOTE_AGENT_KNOWLEDGE_GOAL_KEYWORDS = [
  "知识",
  "教育",
  "策略",
  "指标",
  "定义",
  "误区",
  "边界",
  "场景",
  "框架",
  "拆解",
  "条件",
  "失效",
  "讲清楚",
  "复盘"
] as const;

const NOTE_AGENT_HOT_TAKE_GOAL_KEYWORDS = [
  "喊单",
  "热点",
  "情绪",
  "吐槽",
  "争议",
  "流量",
  "口号",
  "只讲结论",
  "产品推荐",
  "消息面"
] as const;

const NOTE_AGENT_CALM_TONE_GOAL_KEYWORDS = [
  "冷静",
  "克制",
  "讲清楚",
  "结构感",
  "复用价值",
  "不制造情绪",
  "不要制造情绪",
  "不装神秘",
  "清楚"
] as const;

const SAMPLE_FILTER_INCLUDE_SECTION_NAMES = ["优先保留", "建议保留", "保留信号", "可收样本"] as const;
const SAMPLE_FILTER_AVOID_SECTION_NAMES = ["优先排除", "建议排除", "排除信号", "不收样本"] as const;
const SAMPLE_FILTER_HARD_REJECT_SECTION_NAMES = ["硬排除短语", "硬排除", "一票否决短语"] as const;

const NOTE_AGENT_FOCUS_STOP_TERMS = new Set([
  "",
  "x traditional",
  "x",
  "中文交易者",
  "中文",
  "目标读者",
  "风格学习",
  "写作审核链路测试"
]);
