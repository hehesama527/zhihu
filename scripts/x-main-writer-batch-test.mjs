import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import {
  buildCandidateTweetTargets,
  XAccountSoulService,
  XLlmService,
  XHotspotScoutService,
  XMainAgentService,
  XReviewAgentService,
  XWriterService,
  XWorkspaceRepository,
  getDefaultXPromptSeed,
  getXAppConfig
} from "../packages/x-core/dist/x-core/src/index.js";

const config = getXAppConfig();
const repository = new XWorkspaceRepository();
const accountSoulService = new XAccountSoulService(repository);
const llmService = new XLlmService();
const hotspotScoutService = new XHotspotScoutService(llmService);
const mainAgentService = new XMainAgentService(llmService);
const reviewAgentService = new XReviewAgentService(llmService);
const writerService = new XWriterService(llmService);
const MAX_BATCH_REVISIONS = 3;
const SKIP_HOTSPOTS = isTruthyEnv(process.env.X_BATCH_SKIP_HOTSPOTS);
const USE_DEFAULT_PROMPTS = isTruthyEnv(process.env.X_BATCH_USE_DEFAULT_PROMPTS);

const TEST_TASKS = [
  {
    title: "�?@lookonchain 那条 20x 做空 ETH 的单子，我更关心的不是爆仓，而是这种仓位结构本身",
    brief:
      "结合热点做一个判断：ETH 重回 2100 上方后，新钱包在 Hyperliquid 开 20x 空单，这种动作更像是情绪化顶格表达，还是有清晰的风险收益逻辑？如果适合，可以借热点，但不要复读新闻。参考链接：https://x.com/lookonchain/status/2040953749280366747",
    goal: "测试热点引用 + 强观点单�?,
    preferredMode: "auto"
  },
  {
    title: "James Wynn 两周六次爆仓，这不是八卦，是一个风险管理样�?,
    brief:
      "围绕 lookonchain 那条 James Wynn 爆仓信息，判断是否适合做引用转发。重点不是嘲讽人，而是拆解为什么高杠杆总会把判断优势变成执行劣势。参考链接：https://x.com/lookonchain/status/2040957189012275339",
    goal: "测试热点判断 + 反脆弱表�?,
    preferredMode: "auto"
  },
  {
    title: "QCP 说市场开始淡化伊朗风险，我不太愿意直接把这理解成 risk-on 回来�?,
    brief:
      "结合宏观热点写一条观点，重点是讲市场为何会对同类消息逐步脱敏，以及这种反弹为什么还需要二次验证。可以借热点，但不要写成新闻播报�?,
    goal: "测试宏观热点转译",
    preferredMode: "single"
  },
  {
    title: "Perp DEX 连续五个月降温，这个信号比表面数据更值得�?,
    brief:
      "结合链上永续合约成交量回落的热点，讲清楚风险偏好和杠杆需求在怎么变，不要堆数字�?,
    goal: "测试数据转译",
    preferredMode: "single"
  },
  {
    title: "Strategy 继续增持 BTC，我更愿意把这看成成本与信心的表�?,
    brief:
      "围绕机构持续增持 BTC 这个热点，讲成本线、仓位信心和长期表达，不要写成单向看多�?,
    goal: "测试机构动作解读",
    preferredMode: "single"
  },
  {
    title: "很多人一看到反弹就开始追，真正的问题不是方向，是你有没有余地",
    brief:
      "不强依赖热点，写一条像交易手记的碎碎念。核心是风险管理，不要教育用户�?,
    goal: "测试非热点单�?,
    preferredMode: "single"
  },
  {
    title: "如果 BTC 只是回测关键支撑，不代表弱；如果直接突破，也不代表可以闭眼追",
    brief:
      "做一个小感悟或短 thread，围绕回�?vs 突破的双情景分析，保持冷静和诚实推测�?,
    goal: "测试情景分析",
    preferredMode: "thread"
  },
  {
    title: "我越来越不喜欢那种把一条链上异动直接写成‘趋势反转’的内容",
    brief:
      "写一条行业吐槽，批评新闻搬运和过度解读，但不要上价值过猛�?,
    goal: "测试 industry_talk",
    preferredMode: "single"
  },
  {
    title: "如果让你在‘看对方向’和‘活到下一次机会’里选一个，我其实知道大多数人会选错",
    brief:
      "写一条互动问答，主动发起讨论，带出风险管理�?,
    goal: "测试 interactive_qa",
    preferredMode: "single"
  },
  {
    title: "回复这条‘ETH 上去就该追多’的推文",
    brief:
      "这条任务就是要做一个回复，不是原创长文。目标推文：https://x.com/lookonchain/status/2040953749280366747 你可以不同意这种追涨逻辑，但语气要像真人回复，不要像公告�?,
    goal: "测试 reply/quote 判定和回复写�?,
    preferredMode: "single"
  }
];

async function main() {
  await repository.ensureReady();
  if (!SKIP_HOTSPOTS) {
    await hotspotScoutService.ensureReady();
  }

  const account = await pickAccount(process.argv[2]);
  const  = (await repository.get(account.id)) ?? (await repository.ensure(account.id));
  const accountSoul = await accountSoulService.ensureSoulDocument(account);
  const promptSnapshot = USE_DEFAULT_PROMPTS ? buildDefaultPromptSnapshot(account) : await loadPromptSnapshot(account);
  const recentPublishedTasks = await repository.listRecentPublishedTasks(account.id, 8);
  const existingPublishedSignals = (await repository.listRecentPublishedTasks(account.id, 8)).map((item) => ({
    title: item.title,
    publishedAt: item.publishResult?.publishedAt ?? item.finishedAt,
    mode: item.publishPlan?.mode ?? null,
    action: item.publishPlan?.action ?? null,
    contentStyle: item.publishPlan?.contentStyle ?? null,
    targetTweetUrl: item.publishPlan?.targetTweetUrl ?? null
  }));

  const startedAt = new Date().toISOString();
  const results = [];
  const selectedTasks = selectTasks(TEST_TASKS);
  const outputDir = path.join(config.dataDir, "test-runs");
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const reportPath = path.join(outputDir, `x-main-writer-batch-${stamp}.json`);

  console.log(
    JSON.stringify(
      {
        batchSelection: {
          indexesEnv: process.env.X_BATCH_INDEXES ?? null,
          limitEnv: process.env.X_BATCH_LIMIT ?? null,
          selectedTaskIndexes: selectedTasks.map((item) => item.__testIndex),
          selectedTaskCount: selectedTasks.length,
          skipHotspots: SKIP_HOTSPOTS,
          useDefaultPrompts: USE_DEFAULT_PROMPTS,
          soulVersion: accountSoul.version
        }
      },
      null,
      2
    )
  );
  await writeReportSnapshot({
    reportPath,
    account,
    startedAt,
    endedAt: startedAt,
    results,
    status: "running"
  });

  for (const [index, input] of selectedTasks.entries()) {
    const task = buildVirtualTask(account.id, input, , accountSoul);
    const stageTimings = {
      hotspotCandidatesMs: 0,
      hotspotDetailsMs: 0,
      planMs: 0,
      reviewAgentMs: [],
      mainReviewMs: [],
      writePasses: []
    };
    const hotspotCandidateStartedAt = Date.now();
    const hotspotCandidates = SKIP_HOTSPOTS ? [] : await hotspotScoutService.listRelevantPlanningHotspots(task, 6);
    stageTimings.hotspotCandidatesMs = Date.now() - hotspotCandidateStartedAt;
    const candidateTweetTargets = buildCandidateTweetTargets(task, hotspotCandidates);

    try {
      const planStartedAt = Date.now();
      const mainAgentPlan = await mainAgentService.planTask({
        account,
        task,
                accountSoulMarkdown: accountSoul.markdown,
        hotspotCandidates,
        candidateTweetTargets,
        recentPublishedSignals: existingPublishedSignals,
        promptSnapshot
      });
      stageTimings.planMs = Date.now() - planStartedAt;

      const hotspotDetailsStartedAt = Date.now();
      const selectedHotspots = mainAgentPlan.selectedHotspotIds.length
        ? await hotspotScoutService.getHotspotDetailsByIds(mainAgentPlan.selectedHotspotIds)
        : [];
      stageTimings.hotspotDetailsMs = Date.now() - hotspotDetailsStartedAt;

      const shouldWrite = mainAgentPlan.decision !== "block" && mainAgentPlan.shouldWrite;
      let draftPack = null;
      if (shouldWrite) {
        const debugTimings = {};
        const writeStartedAt = Date.now();
        draftPack = await writerService.writeDraft({
          account,
          task,
                    accountSoulMarkdown: accountSoul.markdown,
          revisionInstructions: [],
          mainAgentPlan,
          selectedHotspots,
          promptSnapshot,
          debugTimings
        });
        stageTimings.writePasses.push({
          pass: 1,
          source: "initial",
          totalMs: Date.now() - writeStartedAt,
          writerLlmMs: debugTimings.writerLlmMs ?? null,
          humanizerMs: debugTimings.humanizerMs ?? null,
          humanizerPerPostMs: debugTimings.humanizerPerPostMs ?? []
        });
      }
      let reviewAgentResult = null;
      let mainReviewResult = null;
      let rewriteApplied = false;
      let revisionRounds = 0;

      while (draftPack) {
        const reviewTask = buildReviewTaskState(task, mainAgentPlan, draftPack, revisionRounds);

        const reviewAgentStartedAt = Date.now();
        reviewAgentResult = await reviewAgentService.reviewDraft({
          account,
          task: reviewTask,
                    accountSoulMarkdown: accountSoul.markdown,
          draftPack,
          recentPublishedTitles: recentPublishedTasks.map((item) => item.title),
          promptSnapshot
        });
        stageTimings.reviewAgentMs.push(Date.now() - reviewAgentStartedAt);

        if (
          mainAgentPlan.usedFallback &&
          mainAgentPlan.fallbackStage === "plan" &&
          revisionRounds === 0 &&
          reviewAgentResult.verdict !== "block"
        ) {
          const revisionInstructions = buildPlanningFallbackRewriteInstructions(mainAgentPlan, reviewAgentResult);
          const debugTimings = {};
          const rewriteStartedAt = Date.now();
          draftPack = await writerService.writeDraft({
            account,
            task,
                        accountSoulMarkdown: accountSoul.markdown,
            revisionInstructions,
            mainAgentPlan,
            selectedHotspots,
            promptSnapshot,
            debugTimings
          });
          stageTimings.writePasses.push({
            pass: revisionRounds + 2,
            source: "planning_fallback_rewrite",
            totalMs: Date.now() - rewriteStartedAt,
            writerLlmMs: debugTimings.writerLlmMs ?? null,
            humanizerMs: debugTimings.humanizerMs ?? null,
            humanizerPerPostMs: debugTimings.humanizerPerPostMs ?? []
          });
          rewriteApplied = true;
          revisionRounds += 1;
          continue;
        }

        const mainReviewStartedAt = Date.now();
        mainReviewResult = await mainAgentService.reviewTask({
          account,
          task: reviewTask,
                    accountSoulMarkdown: accountSoul.markdown,
          draftPack,
          reviewAgentResult,
          recentPublishedSignals: existingPublishedSignals,
          promptSnapshot
        });
        stageTimings.mainReviewMs.push(Date.now() - mainReviewStartedAt);

        if (mainReviewResult.reviewResult.decision !== "revise") {
          break;
        }

        if (revisionRounds >= MAX_BATCH_REVISIONS) {
          throw new Error(
            `Reached ${MAX_BATCH_REVISIONS} review rewrite rounds without approval: ${mainReviewResult.reviewResult.reason}`
          );
        }

        const debugTimings = {};
        const rewriteStartedAt = Date.now();
        draftPack = await writerService.writeDraft({
          account,
          task,
                    accountSoulMarkdown: accountSoul.markdown,
          revisionInstructions: buildWriterRevisionInstructions(mainReviewResult.reviewResult),
          mainAgentPlan,
          selectedHotspots,
          promptSnapshot,
          debugTimings
        });
        stageTimings.writePasses.push({
          pass: revisionRounds + 2,
          source: "review_rewrite",
          totalMs: Date.now() - rewriteStartedAt,
          writerLlmMs: debugTimings.writerLlmMs ?? null,
          humanizerMs: debugTimings.humanizerMs ?? null,
          humanizerPerPostMs: debugTimings.humanizerPerPostMs ?? []
        });
        rewriteApplied = true;
        revisionRounds += 1;
      }

      results.push({
        index: input.__testIndex,
        stageTimings: finalizeStageTimings(stageTimings),
        input,
        hotspotCandidates: hotspotCandidates.map((item) => ({
          id: item.id,
          title: item.title,
          priority: item.priority,
          canonicalUrl: item.canonicalUrl
        })),
        mainAgentPlan,
        reviewAgentResult,
        mainReviewResult,
        rewriteApplied,
        revisionRounds,
        selectedHotspots: selectedHotspots.map((item) => ({
          id: item.id,
          title: item.title,
          priority: item.priority,
          canonicalUrl: item.canonicalUrl
        })),
        draftPack,
        error: null
      });
    } catch (error) {
      results.push({
        index: input.__testIndex,
        stageTimings: finalizeStageTimings(stageTimings),
        input,
        hotspotCandidates: hotspotCandidates.map((item) => ({
          id: item.id,
          title: item.title,
          priority: item.priority,
          canonicalUrl: item.canonicalUrl
        })),
        mainAgentPlan: null,
        reviewAgentResult: null,
        mainReviewResult: null,
        rewriteApplied: false,
        revisionRounds: 0,
        selectedHotspots: [],
        draftPack: null,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    await writeReportSnapshot({
      reportPath,
      account,
      startedAt,
      endedAt: new Date().toISOString(),
      results,
      status: "running"
    });
  }

  const endedAt = new Date().toISOString();
  await writeReportSnapshot({
    reportPath,
    account,
    startedAt,
    endedAt,
    results,
    status: "completed"
  });

  console.log(
    JSON.stringify(
      {
        summary: buildSummary(account, startedAt, endedAt, results),
        reportPath
      },
      null,
      2
    )
  );
}

async function pickAccount(accountHint) {
  const accounts = await repository.listAccounts();
  const normalizedHint = accountHint?.trim().replace(/^@+/, "").toLowerCase();

  if (normalizedHint) {
    const matched = accounts.find(
      (item) => item.id === normalizedHint || item.handle.toLowerCase() === normalizedHint
    );
    if (matched) {
      return matched;
    }
  }

  const activeAccount = accounts.find((item) => item.status === "active");
  if (activeAccount) {
    return activeAccount;
  }

  if (accounts[0]) {
    return accounts[0];
  }

  throw new Error("No X account found for the batch test.");
}

async function loadPromptSnapshot(account) {
  const connection = await createMysqlConnection();
  const promptSnapshot = {};

  try {
    const promptRows = [];
    if (account.mainPromptVersionId) {
      promptRows.push(account.mainPromptVersionId);
    }
    if (account.writerPromptVersionId) {
      promptRows.push(account.writerPromptVersionId);
    }
    if (account.reviewPromptVersionId) {
      promptRows.push(account.reviewPromptVersionId);
    }

    let rows = [];
    if (promptRows.length > 0) {
      const [result] = await connection.query(
        `SELECT ps.name AS prompt_set_name, pv.id, pv.version, pv.label, pv.content
         FROM prompt_versions pv
         INNER JOIN prompt_sets ps ON ps.id = pv.prompt_set_id
         WHERE pv.id IN (${promptRows.map(() => "?").join(", ")})`,
        promptRows
      );
      rows = result;
    }

    for (const row of rows) {
      promptSnapshot[row.prompt_set_name] = {
        promptSetName: row.prompt_set_name,
        promptVersionId: row.id,
        version: row.version,
        label: row.label,
        content: row.content
      };
    }

    if (!promptSnapshot.x_main_agent) {
      const seed = getDefaultXPromptSeed("x_main_agent");
      promptSnapshot.x_main_agent = {
        promptSetName: "x_main_agent",
        promptVersionId: null,
        version: null,
        label: seed?.label ?? "x_main_agent default",
        content: seed?.content ?? ""
      };
    }

    if (account.writerPromptSource === "database" && !promptSnapshot.x_writer_agent) {
      const seed = getDefaultXPromptSeed("x_writer_agent");
      promptSnapshot.x_writer_agent = {
        promptSetName: "x_writer_agent",
        promptVersionId: null,
        version: null,
        label: seed?.label ?? "x_writer_agent default",
        content: seed?.content ?? ""
      };
    }

    if (!promptSnapshot.x_review_agent) {
      const seed = getDefaultXPromptSeed("x_review_agent");
      promptSnapshot.x_review_agent = {
        promptSetName: "x_review_agent",
        promptVersionId: null,
        version: null,
        label: seed?.label ?? "x_review_agent default",
        content: seed?.content ?? ""
      };
    }

    return promptSnapshot;
  } finally {
    await connection.end();
  }
}

function buildDefaultPromptSnapshot(account) {
  const snapshot = {};
  for (const name of ["x_main_agent", "x_review_agent"]) {
    const seed = getDefaultXPromptSeed(name);
    snapshot[name] = {
      promptSetName: name,
      promptVersionId: null,
      version: null,
      label: seed?.label ?? `${name} default`,
      content: seed?.content ?? ""
    };
  }

  if (account.writerPromptSource === "database") {
    const seed = getDefaultXPromptSeed("x_writer_agent");
    snapshot.x_writer_agent = {
      promptSetName: "x_writer_agent",
      promptVersionId: null,
      version: null,
      label: seed?.label ?? "x_writer_agent default",
      content: seed?.content ?? ""
    };
  }

  return snapshot;
}

function buildVirtualTask(accountId, input, , accountSoul) {
  const now = new Date().toISOString();

  return {
    id: `test-${Math.random().toString(36).slice(2, 10)}`,
    accountId,
    title: input.title,
    brief: input.brief,
    goal: input.goal,
    preferredMode: input.preferredMode,
    status: "planned",
    currentStage: "planned",
    researchVersion: .version,
    researchMarkdownSnapshot: .markdown,
    soulVersion: accountSoul.version,
    soulMarkdownSnapshot: accountSoul.markdown,
    draftPack: null,
    mainAgentPlan: null,
    reviewAgentResult: null,
    reviewResult: null,
    publishPlan: null,
    publishResult: null,
    promptVersionSnapshotJson: null,
    revisionCount: 0,
    scheduledAt: null,
    failureStage: null,
    failureType: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null
  };
}

function selectTasks(tasks) {
  const indexedTasks = tasks.map((item, index) => ({
    ...item,
    __testIndex: index + 1
  }));
  const indexes = String(process.env.X_BATCH_INDEXES ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);

  if (indexes.length > 0) {
    const wanted = new Set(indexes);
    return indexedTasks.filter((item) => wanted.has(item.__testIndex));
  }

  const limit = Number(process.env.X_BATCH_LIMIT ?? "");
  if (Number.isInteger(limit) && limit > 0) {
    return indexedTasks.slice(0, limit);
  }

  return indexedTasks;
}

function isTruthyEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function mapHotspotRow(row) {
  return {
    id: Number(row.id),
    hotspotKey: row.hotspot_key,
    title: row.title,
    summaryText: row.summary_text,
    sourceType: row.source_type,
    topicType: row.topic_type,
    symbols: parseJsonArray(row.symbols_json),
    keywords: parseJsonArray(row.keywords_json),
    matchedWatchlistValues: parseJsonArray(row.matched_watchlist_values_json),
    canonicalUrl: row.canonical_url,
    score: Number(row.score ?? 0),
    priority: row.priority,
    status: row.status,
    researchStatus: row.research_status,
    sourceCount: Number(row.source_count ?? 0),
    firstSeenAt: normalizeDate(row.first_seen_at),
    lastSeenAt: normalizeDate(row.last_seen_at),
    eventTime: normalizeNullableDate(row.event_time),
    expiresAt: normalizeDate(row.expires_at),
    taskLinkedAt: normalizeNullableDate(row.task_linked_at),
    researchSummaryText: row.research_summary_text,
    researchUpdatedAt: normalizeNullableDate(row.research_updated_at),
    suggestedTaskTitle: row.suggested_task_title,
    suggestedTaskBrief: row.suggested_task_brief,
    angles: parseJsonArray(row.angles_json),
    risks: parseJsonArray(row.risks_json),
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeDate(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function normalizeNullableDate(value) {
  if (!value) {
    return null;
  }

  return normalizeDate(value);
}

async function createMysqlConnection() {
  const url = new URL(process.env.MYSQL_URL);
  return mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectTimeout: 5000
  });
}

function buildSummary(account, startedAt, endedAt, results) {
  const succeeded = results.filter((item) => !item.error);
  const wrote = succeeded.filter((item) => item.draftPack);
  const blocked = succeeded.filter((item) => item.mainAgentPlan?.decision === "block");
  const hotspotUsed = succeeded.filter((item) => item.mainAgentPlan?.useHotspot);
  const fallbackPlans = succeeded.filter((item) => item.mainAgentPlan?.usedFallback);
  const rewriteApplied = succeeded.filter((item) => item.rewriteApplied);
  const multiRoundRewrite = succeeded.filter((item) => (item.revisionRounds ?? 0) >= 2);
  const maxRevisionRounds = succeeded.reduce((max, item) => Math.max(max, item.revisionRounds ?? 0), 0);
  const actionBreakdown = countBy(succeeded, (item) => item.mainAgentPlan?.publishAction ?? "none");
  const styleBreakdown = countBy(succeeded, (item) => item.mainAgentPlan?.contentStyle ?? "none");
  const decisionBreakdown = countBy(succeeded, (item) => item.mainAgentPlan?.decision ?? "error");
  const reviewDecisionBreakdown = countBy(
    succeeded.filter((item) => item.mainReviewResult),
    (item) => item.mainReviewResult?.reviewResult?.decision ?? "none"
  );
  const hotspotCandidateBreakdown = countBy(results, (item) => String(item.hotspotCandidates?.length ?? 0));

  return {
    accountHandle: account.handle,
    writerPromptSource: account.writerPromptSource,
    startedAt,
    endedAt,
    totalTasks: results.length,
    successCount: succeeded.length,
    wroteCount: wrote.length,
    blockedCount: blocked.length,
    fallbackPlanCount: fallbackPlans.length,
    rewriteAppliedCount: rewriteApplied.length,
    multiRoundRewriteCount: multiRoundRewrite.length,
    maxRevisionRounds,
    hotspotCandidateBreakdown,
    hotspotUsedCount: hotspotUsed.length,
    decisionBreakdown,
    reviewDecisionBreakdown,
    actionBreakdown,
    styleBreakdown
  };
}

function finalizeStageTimings(stageTimings) {
  const writeTotalMs = stageTimings.writePasses.reduce((sum, item) => sum + item.totalMs, 0);
  const reviewAgentTotalMs = stageTimings.reviewAgentMs.reduce((sum, value) => sum + value, 0);
  const mainReviewTotalMs = stageTimings.mainReviewMs.reduce((sum, value) => sum + value, 0);

  return {
    ...stageTimings,
    writeTotalMs,
    reviewAgentTotalMs,
    mainReviewTotalMs,
    taskTotalMs:
      stageTimings.hotspotCandidatesMs +
      stageTimings.hotspotDetailsMs +
      stageTimings.planMs +
      writeTotalMs +
      reviewAgentTotalMs +
      mainReviewTotalMs
  };
}

async function writeReportSnapshot(input) {
  const report = {
    status: input.status,
    summary: buildSummary(input.account, input.startedAt, input.endedAt, input.results),
    taskScopedHotspots: true,
    results: input.results
  };

  await fs.writeFile(input.reportPath, JSON.stringify(report, null, 2), "utf8");
}

function countBy(items, keyFn) {
  const counter = {};

  for (const item of items) {
    const key = keyFn(item);
    counter[key] = (counter[key] ?? 0) + 1;
  }

  return counter;
}

function buildPlanningFallbackRewriteInstructions(mainAgentPlan, reviewAgentResult) {
  return [
    ...normalizeStringArray(reviewAgentResult?.suggestedFixes ?? []),
    "这轮�?planning fallback 后的审稿改写，必须重新对齐原任务，不要沿用泛化兜底写法�?,
    "所有改写必须锚定原任务�?title、brief、goal，不要擅自引入任务里没有明确要求的新热点、新主体或新叙事�?,
    "重新检�?publishAction、contentStyle、targetTweetUrl、useHotspot �?writerBrief 是否真的匹配任务�?,
    mainAgentPlan?.publishAction === "reply"
      ? "首句必须像真人在回这条具体推文，不能写成独立发帖�?
      : mainAgentPlan?.publishAction === "quote"
        ? "首句必须像借目标推文表达观点，不能假装没有目标推文�?
        : "正文必须像原生独立发帖，不要误写�?quote �?reply 口吻�?
  ];
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function buildReviewTaskState(task, mainAgentPlan, draftPack, revisionRounds) {
  return {
    ...task,
    mainAgentPlan,
    draftPack,
    revisionCount: revisionRounds
  };
}

function buildWriterRevisionInstructions(reviewResult) {
  const evidence = normalizeStringArray([
    reviewResult?.reason ?? "",
    ...(reviewResult?.revisionInstructions ?? []),
    ...(reviewResult?.qualityNotes ?? [])
  ]).join("\n");
  const instructions = [...normalizeStringArray(reviewResult?.revisionInstructions ?? [])];

  if (containsAnyReviewSignal(evidence, ["具体数字", "数字作为核心", "堆数�?, "时间数字", "倍数", "数据堆砌"])) {
    instructions.push("删除所有具体数字、倍数、次数、月份和日期表达，不要把它们作为论据中心。统一改写成定性表达，例如“连续一段时间”“高杠杆”“反复试错”“明显降温”�?);
  }

  if (containsAnyReviewSignal(evidence, ["过于绝对", "绝对�?, "诚实推测", "确定性过�?, "语气过满"])) {
    instructions.push("去掉绝对化判断和结论口气，避免“正在、一定、必然、就是”这类写法。优先改成“我更愿意理解为”“更像是”“可能在”“至少现在看”�?);
  }

  if (containsAnyReviewSignal(evidence, ["说教", "建议�?, "教育用户", "通用建议"])) {
    instructions.push("把建议口气改回个人经验或个人观察，不要教别人怎么做。优先使用“对我来说”“我现在更在意”“我不接受的其实是”�?);
  }

  if (containsAnyReviewSignal(evidence, ["新闻播报", "复述新闻", "搬运", "数据转译"])) {
    instructions.push("不要复述新闻句式，不要按资讯播报顺序展开。直接写你的判断，再用少量背景支撑�?);
  }

  if (containsAnyReviewSignal(evidence, ["逻辑链条", "因果解释", "转译", "第一人称锚定不足", "第一人称不足"])) {
    instructions.push("按“现�?-> 我怎么理解 -> 为什么会这样 -> 这意味着什么”重组正文，避免只并列结论词。必须把因果链写出来�?);
    instructions.push("至少两处明确使用第一人称锚定，例如“我更愿意理解为”“我现在更在意的不是…而是…”，不要让观点像匿名旁白�?);
  }

  return normalizeStringArray(Array.from(new Set(instructions)));
}

function containsAnyReviewSignal(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

await main();
process.exit(0);

