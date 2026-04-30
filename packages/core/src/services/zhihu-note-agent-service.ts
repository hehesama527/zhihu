import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type {
  AccountListItem,
  ZhihuNoteAgentApplyActions,
  ZhihuNoteAgentApplyInput,
  ZhihuNoteAgentApplyResult,
  ZhihuNoteAgentCollectionSummary,
  ZhihuNoteAgentDraft,
  ZhihuNoteAgentGenerateInput,
  ZhihuNoteAgentPhase,
  ZhihuNoteAgentPhaseReport,
  ZhihuNoteAgentPhaseStatus,
  ZhihuNoteAgentSourceAccount,
  ZhihuNoteAgentValidationCheck,
  ZhihuSampleQuality
} from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";
import { ZhihuAccountLibraryRepository } from "../repositories/zhihu-account-library-repository.js";
import { getStealthLaunchOptions } from "../utils/browser.js";
import { getStealthInitScripts } from "../utils/stealth-inject.js";
import { AccountSoulService } from "./account-soul-service.js";
import { LlmService } from "./llm-service.js";

type NoteAgentAccount = Pick<AccountListItem, "id" | "name" | "zhihuUserName">;

type CollectedSample = {
  id: string;
  answerUrl: string | null;
  questionTitle: string;
  questionUrl: string | null;
  createdAt: string | null;
  excerpt: string;
  text: string;
  fingerprint: string;
  qualityScore: number;
};

type SampleCollectorResult = {
  samples: Array<{
    answerUrl: string | null;
    questionTitle: string;
    questionUrl: string | null;
    createdAt: string | null;
    excerpt: string;
    text: string;
  }>;
  diagnostics: string[];
  collectionSucceeded: boolean;
};

type CollectedSamplePhaseResult = {
  sourceAccount: ZhihuNoteAgentSourceAccount;
  samples: CollectedSample[];
  diagnostics: string[];
  collectionSummary: ZhihuNoteAgentCollectionSummary;
  phaseReport: ZhihuNoteAgentPhaseReport;
};

type NoteAgentPhaseContext = {
  accountSoulMarkdown: string;
  existingSoulCandidateMarkdown: string;
  inputsRead: Array<{
    path: string;
    label: string;
    exists: boolean;
  }>;
};

type NoteAgentSoulCandidateOutput = {
  summary: string;
  diagnostics: string[];
  operatorNotes: string[];
  soulCandidateMarkdown: string;
};

export type ZhihuSourceSampleCollector = (
  sourceAccount: ZhihuNoteAgentSourceAccount,
  input: Pick<ZhihuNoteAgentGenerateInput, "sampleLimit" | "manualSeedTexts">
) => Promise<SampleCollectorResult>;

export class ZhihuNoteAgentService {
  constructor(
    private readonly llmService: Pick<LlmService, "runJson">,
    private readonly repository = new ZhihuAccountLibraryRepository(),
    private readonly accountSoulService = new AccountSoulService(),
    private readonly sampleCollector: ZhihuSourceSampleCollector = collectZhihuSourceSamples
  ) {}

  async generateDraft(account: NoteAgentAccount, input: ZhihuNoteAgentGenerateInput): Promise<ZhihuNoteAgentDraft> {
    await this.repository.ensureReady();

    const resolution = await this.repository.ensureAccountNoteAgentStorageForAccount(account);
    const accountKey = resolution.accountKey;
    const normalizedInput = normalizeGenerateInput(input);
    const phaseReports: ZhihuNoteAgentPhaseReport[] = [];

    const collected = await this.collectSourceSamples(account, accountKey, normalizedInput);
    phaseReports.push(collected.phaseReport);

    if (collected.samples.length === 0) {
      throw new Error("Zhihu note agent found 0 usable samples after filtering.");
    }

    const soulCandidate = await this.draftSoulCandidate(
      account,
      accountKey,
      resolution.matchedBy,
      normalizedInput,
      collected.sourceAccount,
      collected.collectionSummary,
      collected.samples
    );
    phaseReports.push(soulCandidate.phaseReport);

    const diagnostics = dedupeStringArray([...collected.diagnostics, ...soulCandidate.diagnostics]);
    const operatorNotes = dedupeStringArray([
      ...soulCandidate.operatorNotes,
      ...buildCollectionOperatorNotes(collected.collectionSummary)
    ]);
    const generatedAt = new Date().toISOString();

    return {
      accountId: account.id,
      accountKey,
      matchedBy: resolution.matchedBy,
      mode: normalizedInput.mode,
      sourceAccount: collected.sourceAccount,
      summary: normalizeSingleLine(soulCandidate.summary) || `Generated a Zhihu Soul candidate for ${account.name}.`,
      diagnostics,
      operatorNotes,
      sampleQuality: collected.collectionSummary.sampleQuality,
      collectionSummary: collected.collectionSummary,
      phaseReports,
      soulCandidateMarkdown: soulCandidate.soulCandidateMarkdown,
      samplePreview: buildSamplePreview(collected.samples),
      generatedAt,
      sourcePaths: {
        accountMapPath: this.repository.getAccountMapPath(),
        noteAgentAssetDir: this.repository.getAccountNoteAgentDirPath(accountKey),
        soulCandidatePath: this.repository.getAccountNoteAgentAssetPath(accountKey, "soul_candidate.md")
      }
    };
  }

  async applyDraft(account: NoteAgentAccount, input: ZhihuNoteAgentApplyInput): Promise<ZhihuNoteAgentApplyResult> {
    await this.repository.ensureReady();

    const resolution = await this.repository.ensureAccountNoteAgentStorageForAccount(account);
    const accountKey = resolution.accountKey;
    const actions = normalizeApplyActions(input.actions);

    if (!actions.saveSoulCandidate) {
      throw new Error("Zhihu note agent apply requires saveSoulCandidate=true.");
    }

    const draft = input.draft;
    if (draft.accountId !== account.id) {
      throw new Error("Zhihu note agent draft accountId does not match the target account.");
    }
    if (draft.accountKey !== accountKey) {
      throw new Error(`Zhihu note agent draft accountKey ${draft.accountKey} does not match ${accountKey}.`);
    }

    const phaseStartedAt = new Date().toISOString();
    const context = await this.loadPhaseContext(account, accountKey);
    const validationChecks: ZhihuNoteAgentValidationCheck[] = [
      {
        label: "target_account_matches",
        passed: true,
        severity: "info",
        details: `draft.accountId=${draft.accountId}, draft.accountKey=${draft.accountKey}`
      },
      {
        label: "soul_candidate_non_empty",
        passed: Boolean(draft.soulCandidateMarkdown.trim()),
        severity: "error",
        details: "note-agent/soul_candidate.md"
      }
    ];

    const targetPath = this.repository.getAccountNoteAgentAssetPath(accountKey, "soul_candidate.md");
    validationChecks.push({
      label: "write_paths_match_target_account",
      passed: targetPath.includes(`${path.sep}${accountKey}${path.sep}`),
      severity: "error",
      details: `1 target file prepared for ${accountKey}.`
    });

    const writtenPaths = [
      await this.repository.writeNoteAgentAsset(accountKey, "soul_candidate.md", ensureMarkdownContent(draft.soulCandidateMarkdown))
    ];
    const verification = await Promise.all(
      writtenPaths.map(async (filePath) => ({ path: filePath, snapshot: await readPathSnapshot(filePath) }))
    );
    const nonEmptyVerificationPassed = verification.every((item) => item.snapshot.exists && item.snapshot.content.trim().length > 0);
    validationChecks.push({
      label: "writeback_reloaded_non_empty",
      passed: nonEmptyVerificationPassed,
      severity: "error",
      details: `${verification.filter((item) => item.snapshot.content.trim().length > 0).length}/${verification.length} files reloaded as non-empty.`
    });

    const phaseReport = finalizePhaseReport(
      "apply_soul_candidate",
      phaseStartedAt,
      context.inputsRead,
      validationChecks,
      nonEmptyVerificationPassed ? [] : ["Zhihu note-agent soul candidate was written but reloaded as empty."]
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
    input: ZhihuNoteAgentGenerateInput
  ): Promise<CollectedSamplePhaseResult> {
    const phaseStartedAt = new Date().toISOString();
    const context = await this.loadPhaseContext(account, accountKey);
    const sourceAccount = resolveSourceAccount(input.sourceAccount.handleOrUrl);
    const collected = await this.sampleCollector(sourceAccount, {
      sampleLimit: input.sampleLimit,
      manualSeedTexts: input.manualSeedTexts
    });

    const evaluated = evaluateCollectedSamples(collected.samples, {
      targetPositioning: buildTargetPositioning(account, context.accountSoulMarkdown),
      sampleFilterMarkdown: ""
    });
    const keptSamples = evaluated
      .filter((item) => item.keep)
      .sort((left, right) => right.sample.qualityScore - left.sample.qualityScore)
      .slice(0, Math.min(input.sampleLimit, 12))
      .map((item, index) => ({
        ...item.sample,
        id: `sample_${String(index + 1).padStart(3, "0")}`
      }));
    const sampleQuality = resolveSampleQuality(keptSamples.length);
    const filterReasonCounts = summarizeFilterReasons(evaluated);
    const diagnostics = dedupeStringArray([
      ...collected.diagnostics,
      ...buildSamplingDiagnostics(collected.samples.length, keptSamples.length, sampleQuality, filterReasonCounts)
    ]);
    const collectionSummary: ZhihuNoteAgentCollectionSummary = {
      requestedSampleSize: input.sampleLimit,
      fetchedSampleCount: collected.samples.length,
      filteredOutCount: Math.max(0, collected.samples.length - keptSamples.length),
      keptSampleCount: keptSamples.length,
      sampleQuality,
      sourceHandle: sourceAccount.normalizedUserName,
      sourceUrl: sourceAccount.profileUrl,
      collectionSucceeded: collected.collectionSucceeded,
      browserDiagnostics: collected.diagnostics,
      filterReasonCounts
    };

    const validationChecks: ZhihuNoteAgentValidationCheck[] = [
      {
        label: "collection_attempt_completed",
        passed: collected.collectionSucceeded,
        severity: "warning",
        details: collected.collectionSucceeded ? "collection succeeded" : "collection finished with diagnostics"
      },
      {
        label: "non_zero_samples_after_filter",
        passed: keptSamples.length > 0,
        severity: "error",
        details: `${keptSamples.length} samples kept`
      },
      {
        label: "useful_sample_quality",
        passed: sampleQuality === "strong" || sampleQuality === "ok",
        severity: "warning",
        details: sampleQuality
      }
    ];

    return {
      sourceAccount,
      samples: keptSamples,
      diagnostics,
      collectionSummary,
      phaseReport: finalizePhaseReport("collect_source_samples", phaseStartedAt, context.inputsRead, validationChecks, diagnostics)
    };
  }

  private async draftSoulCandidate(
    account: NoteAgentAccount,
    accountKey: string,
    matchedBy: ZhihuNoteAgentDraft["matchedBy"],
    input: ZhihuNoteAgentGenerateInput,
    sourceAccount: ZhihuNoteAgentSourceAccount,
    collectionSummary: ZhihuNoteAgentCollectionSummary,
    samples: CollectedSample[]
  ) {
    const phaseStartedAt = new Date().toISOString();
    const context = await this.loadPhaseContext(account, accountKey);
    const fallback = buildSoulCandidateFallback({
      account,
      accountKey,
      collectionSummary,
      samples,
      accountSoulMarkdown: context.accountSoulMarkdown,
      existingSoulCandidateMarkdown: context.existingSoulCandidateMarkdown
    });

    const output = await this.llmService.runJson<NoteAgentSoulCandidateOutput>(
      "zhihu_note_agent",
      {
        stage: "draft_soul_candidate",
        mode: input.mode,
        chain: "zhihu",
        matchedBy,
        targetAccount: buildTargetAccountPayload(account, accountKey, context.accountSoulMarkdown),
        sourceAccount,
        sampleLimit: input.sampleLimit,
        filterConfigVersion: input.filterConfigVersion,
        collectionSummary,
        samplePreview: buildSamplePreview(samples),
        existingSoulCandidateMarkdown: context.existingSoulCandidateMarkdown,
        operatorConstraints: {
          manualTriggerOnly: true,
          doNotOverwriteOfficialSoul: true,
          doNotWriteRag: true,
          requiredOutputs: ["soulCandidateMarkdown"]
        }
      },
      fallback,
      {
        promptSuffix: NOTE_AGENT_RUNTIME_SUFFIX
      }
    );

    const sanitized = sanitizeSoulCandidateOutput(output, fallback);
    const validationChecks: ZhihuNoteAgentValidationCheck[] = [
      {
        label: "soul_candidate_generated",
        passed: Boolean(sanitized.soulCandidateMarkdown.trim()),
        severity: "error",
        details: "note-agent/soul_candidate.md"
      }
    ];

    return {
      ...sanitized,
      phaseReport: finalizePhaseReport(
        "draft_soul_candidate",
        phaseStartedAt,
        context.inputsRead,
        validationChecks,
        sanitized.diagnostics
      )
    };
  }

  private async loadPhaseContext(account: NoteAgentAccount, accountKey: string): Promise<NoteAgentPhaseContext> {
    const soulDocument = await this.accountSoulService.ensureSoulDocument(account);
    const fileSpecs = [
      { label: "account_map", path: this.repository.getAccountMapPath() },
      { label: "soul_candidate", path: this.repository.getAccountNoteAgentAssetPath(accountKey, "soul_candidate.md") }
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
      accountSoulMarkdown: soulDocument.markdown,
      existingSoulCandidateMarkdown: contentByLabel.get("soul_candidate") ?? "",
      inputsRead: snapshots.map((item) => ({
        label: item.label,
        path: item.path,
        exists: item.snapshot.exists
      }))
    };
  }
}

export function evaluateCollectedSamples(
  samples: SampleCollectorResult["samples"],
  input: {
    targetPositioning: string;
    sampleFilterMarkdown: string;
  }
) {
  const dedupeFingerprints = new Set<string>();
  const openingFingerprints = new Set<string>();
  const closingFingerprints = new Set<string>();
  const targetTokens = extractTargetTokens(input.targetPositioning);

  return samples.map((sample) => {
    const normalizedText = normalizeSampleText(sample.text);
    const excerpt = normalizeSampleText(sample.excerpt);
    const fingerprint = buildSampleFingerprint(normalizedText || excerpt);
    const reasons: string[] = [];

    if (!normalizedText || normalizedText.length < MIN_SAMPLE_LENGTH) {
      reasons.push("low_information");
    }
    if (SLOGAN_PATTERN.test(normalizedText)) {
      reasons.push("brand_slogan");
    }
    if (ANNOUNCEMENT_PATTERN.test(normalizedText)) {
      reasons.push("pure_announcement");
    }
    if (IDENTITY_ANCHOR_PATTERN.test(normalizedText.slice(0, 100)) && targetTokens.length > 0) {
      const openingWindow = normalizedText.slice(0, 100).toLowerCase();
      if (!targetTokens.some((token) => openingWindow.includes(token))) {
        reasons.push("source_specific_identity");
      }
    }
    if (dedupeFingerprints.has(fingerprint)) {
      reasons.push("near_duplicate");
    } else {
      dedupeFingerprints.add(fingerprint);
    }

    const openingKey = normalizeStructureWindow(normalizedText.slice(0, 100));
    if (openingKey && openingFingerprints.has(openingKey)) {
      reasons.push("repeated_opening");
    } else if (openingKey) {
      openingFingerprints.add(openingKey);
    }

    const closingKey = normalizeStructureWindow(normalizedText.slice(-100));
    if (closingKey && closingFingerprints.has(closingKey)) {
      reasons.push("repeated_closing");
    } else if (closingKey) {
      closingFingerprints.add(closingKey);
    }

    return {
      keep: reasons.length === 0,
      reasons,
      sample: {
        id: "",
        answerUrl: normalizeOptionalString(sample.answerUrl),
        questionTitle: sample.questionTitle.trim() || "Untitled answer",
        questionUrl: normalizeOptionalString(sample.questionUrl),
        createdAt: normalizeOptionalString(sample.createdAt),
        excerpt: excerpt || truncateInline(normalizedText, 160),
        text: normalizedText || excerpt,
        fingerprint,
        qualityScore: scoreSample(normalizedText, input.sampleFilterMarkdown)
      } satisfies CollectedSample
    };
  });
}

export async function collectZhihuSourceSamples(
  sourceAccount: ZhihuNoteAgentSourceAccount,
  input: Pick<ZhihuNoteAgentGenerateInput, "sampleLimit" | "manualSeedTexts">
): Promise<SampleCollectorResult> {
  const manualSeedSamples = normalizeManualSeedSamples(input.manualSeedTexts);
  if (!sourceAccount.profileUrl) {
    return {
      samples: manualSeedSamples,
      diagnostics: ["Source account handle or URL could not be normalized into a Zhihu profile URL."],
      collectionSucceeded: manualSeedSamples.length > 0
    };
  }

  const profileSeed = sourceAccount.normalizedUserName || sanitizeSlug(sourceAccount.handleOrUrl);
  const profileDir = path.join(getAppConfig().dataDir, "zhihu-note-agent", "browser", profileSeed || "default");
  const launchOptions = getStealthLaunchOptions(getAppConfig().browserChannel, profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: getAppConfig().browserChannel,
    headless: true,
    viewport: {
      width: 1440,
      height: 900
    },
    ignoreDefaultArgs: ["--enable-automation"],
    args: launchOptions.args,
    userAgent: launchOptions.userAgent,
    locale: launchOptions.locale,
    timezoneId: launchOptions.timezoneId
  });

  for (const script of getStealthInitScripts(profileDir)) {
    await context.addInitScript(script);
  }

  const page = context.pages()[0] ?? (await context.newPage());
  const diagnostics: string[] = [];
  const collectedSamples: SampleCollectorResult["samples"] = [];

  try {
    await page.goto(buildAnswersUrl(sourceAccount.profileUrl), {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });
    await page.waitForTimeout(3_000);

    for (let attempt = 0; attempt < 5 && collectedSamples.length < input.sampleLimit; attempt += 1) {
      const visibleCards = await extractVisibleAnswerCards(page);
      for (const sample of visibleCards) {
        const fingerprint = buildSampleFingerprint(normalizeSampleText(sample.text) || normalizeSampleText(sample.excerpt));
        if (
          !collectedSamples.some((item) => item.answerUrl === sample.answerUrl || buildSampleFingerprint(item.text) === fingerprint)
        ) {
          collectedSamples.push(sample);
        }
      }

      if (collectedSamples.length >= input.sampleLimit) {
        break;
      }

      await page.mouse.wheel(0, 2200).catch(() => undefined);
      await page.waitForTimeout(1500);
    }

    const visibleText = (await page.locator("body").innerText().catch(() => "")).slice(0, 2000);
    if (/login|sign in|captcha|verify/i.test(visibleText)) {
      diagnostics.push("Zhihu exposed a login or verification shell; answer items may be incomplete.");
    }
    if (collectedSamples.length === 0) {
      diagnostics.push("No visible Zhihu answer cards were extracted from the profile answers page.");
    }
  } catch (error) {
    diagnostics.push(buildErrorMessage(error, "Zhihu browser collection failed."));
  } finally {
    await context.close().catch(() => undefined);
  }

  return {
    samples: dedupeCollectedSamples([...collectedSamples, ...manualSeedSamples]).slice(0, input.sampleLimit),
    diagnostics: dedupeStringArray(diagnostics),
    collectionSucceeded: collectedSamples.length > 0 || manualSeedSamples.length > 0
  };
}

async function extractVisibleAnswerCards(page: Page): Promise<SampleCollectorResult["samples"]> {
  const cards = await page.evaluate(() => {
    const cardSelectors = [
      ".Profile-main .List-item",
      ".Profile-main .ContentItem",
      "[data-za-module='AnswerItem']",
      ".AnswerItem",
      ".Profile-answers .List-item"
    ];
    const nodes = cardSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const uniqueNodes = Array.from(new Set(nodes));

    return uniqueNodes
      .map((node) => {
        const answerLink = node.querySelector<HTMLAnchorElement>("a[href*='/answer/']");
        const questionLink =
          node.querySelector<HTMLAnchorElement>("a[href*='/question/'][href*='/answer/']") ||
          node.querySelector<HTMLAnchorElement>("a[href*='/question/']");
        const title = (questionLink?.textContent || "").replace(/\s+/g, " ").trim();
        const richContent =
          (node.querySelector(".RichContent-inner") as HTMLElement | null)?.innerText ||
          (node.querySelector(".RichText") as HTMLElement | null)?.innerText ||
          (node as HTMLElement).innerText ||
          "";
        const excerpt = richContent.replace(/\s+/g, " ").trim();
        const createdAt =
          node.querySelector<HTMLTimeElement>("time")?.getAttribute("datetime") ||
          node.querySelector<HTMLMetaElement>("meta[itemprop='dateCreated']")?.getAttribute("content") ||
          null;

        return {
          answerUrl: answerLink?.href || questionLink?.href || null,
          questionTitle: title,
          questionUrl: questionLink?.href || null,
          createdAt,
          excerpt: excerpt.slice(0, 220),
          text: excerpt
        };
      })
      .filter((item) => item.questionTitle || item.text);
  });

  return cards.map((item) => ({
    answerUrl: normalizeOptionalString(item.answerUrl),
    questionTitle: item.questionTitle.trim() || "Untitled answer",
    questionUrl: normalizeOptionalString(item.questionUrl),
    createdAt: normalizeOptionalString(item.createdAt),
    excerpt: item.excerpt.trim(),
    text: item.text.trim()
  }));
}

function normalizeGenerateInput(input: ZhihuNoteAgentGenerateInput): ZhihuNoteAgentGenerateInput {
  return {
    mode: "zhihu_answer_style_learning",
    sourceAccount: {
      platform: "zhihu",
      handleOrUrl: input.sourceAccount.handleOrUrl.trim()
    },
    sampleLimit: normalizePositiveInteger(input.sampleLimit, 35, 1, 60),
    filterConfigVersion: input.filterConfigVersion.trim() || "v1",
    manualSeedTexts: Array.isArray(input.manualSeedTexts)
      ? input.manualSeedTexts.map((item) => normalizeSampleText(item)).filter(Boolean)
      : []
  };
}

function normalizeApplyActions(actions?: Partial<ZhihuNoteAgentApplyActions>): ZhihuNoteAgentApplyActions {
  return {
    saveSoulCandidate: actions?.saveSoulCandidate ?? true
  };
}

function resolveSourceAccount(handleOrUrl: string): ZhihuNoteAgentSourceAccount {
  const normalizedUserName = extractZhihuUserName(handleOrUrl);
  return {
    platform: "zhihu",
    handleOrUrl,
    normalizedUserName,
    profileUrl: normalizedUserName ? `${getAppConfig().zhihuBaseUrl}/people/${normalizedUserName}` : null
  };
}

function extractZhihuUserName(handleOrUrl: string) {
  const trimmed = handleOrUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed, getAppConfig().zhihuBaseUrl);
    const match = url.pathname.match(/\/people\/([^/?#]+)/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  } catch {
    // Fallback below.
  }

  return trimmed.replace(/^@+/, "").replace(/^people\//i, "").replace(/\/answers$/i, "").trim() || null;
}

function buildAnswersUrl(profileUrl: string) {
  return profileUrl.endsWith("/answers") ? profileUrl : `${profileUrl.replace(/\/+$/, "")}/answers`;
}

function normalizePositiveInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeManualSeedSamples(seedTexts: string[] | undefined): SampleCollectorResult["samples"] {
  return (seedTexts ?? []).map((text, index) => ({
    answerUrl: null,
    questionTitle: `Manual seed #${index + 1}`,
    questionUrl: null,
    createdAt: null,
    excerpt: truncateInline(text, 220),
    text
  }));
}

function dedupeCollectedSamples(samples: SampleCollectorResult["samples"]) {
  const seen = new Set<string>();
  const deduped: SampleCollectorResult["samples"] = [];

  for (const sample of samples) {
    const fingerprint = sample.answerUrl || buildSampleFingerprint(normalizeSampleText(sample.text) || normalizeSampleText(sample.excerpt));
    if (!fingerprint || seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    deduped.push(sample);
  }

  return deduped;
}

function buildTargetAccountPayload(account: NoteAgentAccount, accountKey: string, accountSoulMarkdown: string) {
  return {
    id: account.id,
    accountKey,
    name: account.name,
    zhihuUserName: account.zhihuUserName,
    accountSoulMarkdown
  };
}

function buildTargetPositioning(account: NoteAgentAccount, accountSoulMarkdown: string) {
  return [account.name.trim(), account.zhihuUserName?.trim() ?? "", accountSoulMarkdown.trim()].filter(Boolean).join("\n");
}

function buildSoulCandidateFallback(input: {
  account: NoteAgentAccount;
  accountKey: string;
  collectionSummary: ZhihuNoteAgentCollectionSummary;
  samples: CollectedSample[];
  accountSoulMarkdown: string;
  existingSoulCandidateMarkdown: string;
}): NoteAgentSoulCandidateOutput {
  const signals = analyzeSamples(input.samples);
  const sampleTitles = input.samples
    .slice(0, 5)
    .map((sample) => `- ${sample.questionTitle}`)
    .join("\n");

  return {
    summary: `Generated a Zhihu Soul candidate for ${input.account.name}.`,
    diagnostics:
      input.collectionSummary.sampleQuality === "strong" || input.collectionSummary.sampleQuality === "ok"
        ? []
        : ["Soul candidate fallback is based on a limited Zhihu sample pool. Manual review is required."],
    operatorNotes: [
      "Only note-agent/soul_candidate.md will be saved.",
      "No Zhihu account-library or RAG documents will be generated, written, or injected into Writer/Review."
    ],
    soulCandidateMarkdown: normalizeMarkdownDocument(
      input.existingSoulCandidateMarkdown,
      [
        `# ${input.accountKey} Soul Candidate`,
        "",
        "## Boundary",
        "",
        "- This is a candidate Soul for manual review. It does not overwrite the official Soul.",
        "- Learn expression rhythm, openings, paragraph pacing, evidence handling, and endings only.",
        "- Do not copy source viewpoints, identity narrative, slogans, or private experiences.",
        "- Writer and Review keep using the official Soul unless a human merges this candidate later.",
        "",
        "## Transferable Signals",
        "",
        `- ${signals.openingSignal}`,
        `- ${signals.structureSignal}`,
        `- ${signals.evidenceSignal}`,
        "",
        "## Suggested Account Adjustments",
        "",
        "- Start closer to the judgment or the concrete problem.",
        "- Keep middle paragraphs grounded in conditions, counterexamples, or operating boundaries.",
        "- End with scope, caveats, or execution reminders instead of slogan-like summaries.",
        "",
        "## Sample References",
        "",
        sampleTitles || "- No retained sample titles.",
        "",
        "## Current Official Soul Snapshot",
        "",
        truncateInline(input.accountSoulMarkdown || "No current Soul document.", 900)
      ].join("\n")
    )
  };
}

function sanitizeSoulCandidateOutput(
  output: NoteAgentSoulCandidateOutput,
  fallback: NoteAgentSoulCandidateOutput
): NoteAgentSoulCandidateOutput {
  return {
    summary: normalizeSingleLine(output.summary) || fallback.summary,
    diagnostics: dedupeStringArray(Array.isArray(output.diagnostics) ? output.diagnostics : fallback.diagnostics),
    operatorNotes: dedupeStringArray(Array.isArray(output.operatorNotes) ? output.operatorNotes : fallback.operatorNotes),
    soulCandidateMarkdown: normalizeMarkdownDocument(output.soulCandidateMarkdown, fallback.soulCandidateMarkdown)
  };
}

function buildSamplePreview(samples: CollectedSample[]) {
  return samples.slice(0, 8).map((sample) => ({
    answerUrl: sample.answerUrl,
    questionTitle: sample.questionTitle,
    createdAt: sample.createdAt,
    excerpt: sample.excerpt,
    text: truncateInline(sample.text, 320)
  }));
}

function buildCollectionOperatorNotes(collectionSummary: ZhihuNoteAgentCollectionSummary) {
  const notes = [
    "This Note Agent run only produces a Soul candidate.",
    "Writer and Review do not receive RAG/account-library material from this run."
  ];
  if (!collectionSummary.collectionSucceeded) {
    notes.push("Browser collection did not fully succeed; manual seed samples may dominate this result.");
  }
  if (collectionSummary.filteredOutCount > 0) {
    notes.push(`Filtered out ${collectionSummary.filteredOutCount} low-value or duplicate sample(s).`);
  }
  if (collectionSummary.sampleQuality === "weak" || collectionSummary.sampleQuality === "insufficient") {
    notes.push("Sample quality is limited; review the candidate conservatively.");
  }
  return notes;
}

function buildSamplingDiagnostics(
  fetchedSampleCount: number,
  keptSampleCount: number,
  sampleQuality: ZhihuSampleQuality,
  filterReasonCounts: Record<string, number>
) {
  const diagnostics = [
    `Fetched ${fetchedSampleCount} raw Zhihu samples.`,
    `Kept ${keptSampleCount} filtered Zhihu samples.`,
    `Sample quality: ${sampleQuality}.`
  ];
  for (const [reason, count] of Object.entries(filterReasonCounts)) {
    diagnostics.push(`Filtered ${count} sample(s) for reason=${reason}.`);
  }
  return diagnostics;
}

function summarizeFilterReasons(evaluations: ReturnType<typeof evaluateCollectedSamples>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of evaluations) {
    for (const reason of item.reasons) {
      result[reason] = (result[reason] ?? 0) + 1;
    }
  }
  return result;
}

function resolveSampleQuality(sampleCount: number): ZhihuSampleQuality {
  if (sampleCount >= 12) {
    return "strong";
  }
  if (sampleCount >= 8) {
    return "ok";
  }
  if (sampleCount >= 4) {
    return "weak";
  }
  return "insufficient";
}

function finalizePhaseReport(
  phase: ZhihuNoteAgentPhase,
  startedAt: string,
  inputsRead: NoteAgentPhaseContext["inputsRead"],
  validationChecks: ZhihuNoteAgentValidationCheck[],
  diagnostics: string[]
): ZhihuNoteAgentPhaseReport {
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

function resolvePhaseStatus(validationChecks: ZhihuNoteAgentValidationCheck[]): ZhihuNoteAgentPhaseStatus {
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
    return { exists: true, content };
  } catch {
    return { exists: false, content: "" };
  }
}

function ensureMarkdownContent(value: string) {
  const normalized = normalizeMarkdownDocument(value, "");
  if (!normalized.trim()) {
    throw new Error("Zhihu note agent markdown content cannot be empty when applying.");
  }
  return normalized;
}

function normalizeMarkdownDocument(value: string, fallback: string) {
  const normalized = (value || "").replace(/\r\n/g, "\n").trim();
  const nextValue = normalized || fallback.replace(/\r\n/g, "\n").trim();
  return nextValue ? `${nextValue}\n` : "";
}

function normalizeSingleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSampleText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeStringArray(value: string[]) {
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

function extractTargetTokens(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fa5]+/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2)
    )
  );
}

function normalizeStructureWindow(value: string) {
  return value.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

function scoreSample(text: string, sampleFilterMarkdown: string) {
  let score = Math.min(100, Math.max(20, text.length / 4));
  if (/[.!?;:，。！？；：]/.test(text)) {
    score += 8;
  }
  if (/\d/.test(text)) {
    score += 4;
  }
  if (/(example|for instance|condition|boundary|比如|例如|前提|不过|但是|姣斿|渚嬪|鍓嶆彁|涓嶈繃)/i.test(text)) {
    score += 8;
  }
  if (SLOGAN_PATTERN.test(text)) {
    score -= 20;
  }
  if (sampleFilterMarkdown.includes("Remove")) {
    score += 0;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildSampleFingerprint(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function truncateInline(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sanitizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function buildErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function analyzeSamples(samples: CollectedSample[]) {
  const texts = samples.map((item) => item.text);
  const averageLength = texts.length > 0 ? Math.round(texts.reduce((sum, item) => sum + item.length, 0) / texts.length) : 0;

  return {
    openingSignal:
      countMatches(texts, /(first|my experience|conclusion|先说结论|经验|鎴戜細|缁撹|缁忛獙)/i) > 0
        ? "Samples often start with a judgment or experience signal before explanation."
        : "Samples are better transferred as direct problem entry without long background setup.",
    structureSignal:
      averageLength >= 180
        ? "Samples read like naturally developed Zhihu answers rather than short slogans."
        : "Samples are concise and should transfer as fast entry plus compact paragraphs.",
    evidenceSignal:
      countMatches(texts, /(example|data|number|condition|caveat|比如|例如|数字|前提|姣斿|渚嬪|鏁板瓧|鍓嶆彁)/i) > 0
        ? "Samples use limited examples, numbers, or conditions to support judgment."
        : "Samples rely more on restrained observation; avoid adding fake evidence density."
  };
}

function countMatches(texts: string[], pattern: RegExp) {
  return texts.reduce((count, text) => (pattern.test(text) ? count + 1 : count), 0);
}

const MIN_SAMPLE_LENGTH = 120;
const SLOGAN_PATTERN =
  /(follow|subscribe|like|share|contact me|course|community|slogan|关注|点赞|收藏|私信|公众号|课程|训练营|鍏虫敞|鐐硅禐|鏀惰棌|绉佷俊|鍏紬|璇剧▼|璁粌|娆㈣繋)/i;
const ANNOUNCEMENT_PATTERN =
  /(announcement|activity|event|signup|recruit|notice|公告|通知|活动|报名|福利|招生|介绍|娲诲姩|閫氱煡|鎶ュ悕|绂忓埄|鎷涚敓|浠嬬粛)/i;
const IDENTITY_ANCHOR_PATTERN = /^(i am|as a|我是|作为|从业|这些年|鎴戞槸|浣滀负|浠庝笟|杩欎簺骞)/i;
const NOTE_AGENT_RUNTIME_SUFFIX = [
  "Runtime rules:",
  "1. This note-agent run is manual-only.",
  "2. Generate only soulCandidateMarkdown.",
  "3. Do not write or suggest RAG/account-library assets.",
  "4. Keep humanizer in the main chain.",
  "5. Return valid JSON only."
].join("\n");
