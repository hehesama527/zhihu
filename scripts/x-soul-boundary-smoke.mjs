import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import {
  XAccountSoulService,
  XLlmService,
  XMainAgentService,
  XWorkspaceRepository,
  XWriterService,
  getDefaultXPromptSeed,
  getXAppConfig
} from "../packages/x-core/src/index.ts";
import { resolveLlmRuntimeConfig } from "@zhihu-mvp/core";

const taskInput = {
  key: "new_project_boundary",
  title: "新项目第一波热度不是不能做，是你得先想清楚自己赚的是流动性的钱还是认知的�?,
  brief:
    "写一条偏新项目观察的单条动态。重点是会看新项目，但更偏短线执行，不迷信叙事，讲清楚什么情况下会看、什么情况下宁愿不碰。不要假装掌握内幕，也不要写成行业媒体口吻�?,
  goal: "测试 Soul 边界 + 跳过通用纪律安全模版 + 新项目任务对�?,
  preferredMode: "single"
};

const config = getXAppConfig();
const repository = new XWorkspaceRepository();
const soulService = new XAccountSoulService(repository);
const llmService = new XLlmService();
const mainAgentService = new XMainAgentService(llmService);
const writerService = new XWriterService(llmService);

await repository.ensureReady();

const account = await pickAccount("demonduand75418");
const soulDocument = await soulService.ensureSoulDocument(account);
const promptSnapshot = await loadPromptSnapshot(account);
const  = buildSanitized(account.id);
const recentPublishedSignals = (await repository.listRecentPublishedTasks(account.id, 8)).map((item) => ({
  title: item.title,
  publishedAt: item.publishResult?.publishedAt ?? item.finishedAt,
  mode: item.publishPlan?.mode ?? null,
  action: item.publishPlan?.action ?? null,
  contentStyle: item.publishPlan?.contentStyle ?? null,
  targetTweetUrl: item.publishPlan?.targetTweetUrl ?? null
}));

const task = buildVirtualTask(account.id, taskInput, , soulDocument);

console.log(`[${taskInput.key}] plan:start`);
const mainAgentPlan = await mainAgentService.planTask({
  account,
  task,
    accountSoulMarkdown: soulDocument.markdown,
  hotspotCandidates: [],
  candidateTweetTargets: [],
  recentPublishedSignals,
  promptSnapshot
});
console.log(`[${taskInput.key}] plan:done ${mainAgentPlan.decision}/${mainAgentPlan.contentStyle}/${mainAgentPlan.preferredMode}`);

const debugTimings = {};
let draftPack = null;
if (mainAgentPlan.decision !== "block" && mainAgentPlan.shouldWrite) {
  console.log(`[${taskInput.key}] write:start`);
  draftPack = await writerService.writeDraft({
    account,
    task,
        accountSoulMarkdown: soulDocument.markdown,
    revisionInstructions: [],
    mainAgentPlan,
    selectedHotspots: [],
    promptSnapshot,
    debugTimings
  });
  console.log(`[${taskInput.key}] write:done posts=${draftPack.posts.length}`);
}

const finishedAt = new Date().toISOString();
const reportPath = path.join(
  config.dataDir,
  "test-runs",
  `demonduan-new_project-boundary-smoke-${finishedAt.replace(/[:.]/g, "-")}.json`
);

const report = {
  task: taskInput,
  account: {
    id: account.id,
    handle: account.handle,
    soulVersion: soulDocument.version
  },
  runtime: {
    xMain: summarizeRuntime(resolveLlmRuntimeConfig("x_main_agent")),
    xWriter: summarizeRuntime(resolveLlmRuntimeConfig("x_writer_agent"))
  },
  promptSnapshotLoadError: promptSnapshot.__loadError ?? null,
  mainAgentPlan,
  draftPack,
  debugTimings,
  finishedAt
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log(
  JSON.stringify(
    {
      reportPath,
      runtime: report.runtime,
      plan: {
        decision: mainAgentPlan.decision,
        contentStyle: mainAgentPlan.contentStyle,
        preferredMode: mainAgentPlan.preferredMode,
        usedFallback: mainAgentPlan.usedFallback,
        qualityNotes: mainAgentPlan.qualityNotes
      },
      posts: draftPack?.posts ?? [],
      notes: draftPack?.notes ?? []
    },
    null,
    2
  )
);

async function pickAccount(accountHint) {
  const accounts = await repository.listAccounts();
  const normalizedHint = accountHint.trim().replace(/^@+/, "").toLowerCase();
  const matched = accounts.find((item) => item.id === normalizedHint || item.handle.toLowerCase() === normalizedHint);
  if (!matched) {
    throw new Error(`Account not found: ${accountHint}`);
  }
  return matched;
}

async function loadPromptSnapshot(account) {
  const promptSnapshot = {};
  let connection = null;

  try {
    connection = await createMysqlConnection();
    const promptRows = [];
    if (account.mainPromptVersionId) promptRows.push(account.mainPromptVersionId);
    if (account.writerPromptVersionId) promptRows.push(account.writerPromptVersionId);
    if (account.reviewPromptVersionId) promptRows.push(account.reviewPromptVersionId);

    if (promptRows.length > 0) {
      const [rows] = await connection.query(
        `SELECT ps.name AS prompt_set_name, pv.id, pv.version, pv.label, pv.content
         FROM prompt_versions pv
         INNER JOIN prompt_sets ps ON ps.id = pv.prompt_set_id
         WHERE pv.id IN (${promptRows.map(() => "?").join(", ")})`,
        promptRows
      );

      for (const row of rows) {
        promptSnapshot[row.prompt_set_name] = {
          promptSetName: row.prompt_set_name,
          promptVersionId: row.id,
          version: row.version,
          label: row.label,
          content: row.content
        };
      }
    }
  } catch (error) {
    promptSnapshot.__loadError = error instanceof Error ? error.message : String(error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }

  for (const name of ["x_main_agent", "x_writer_agent", "x_review_agent"]) {
    if (!promptSnapshot[name]) {
      const seed = getDefaultXPromptSeed(name);
      promptSnapshot[name] = {
        promptSetName: name,
        promptVersionId: null,
        version: null,
        label: seed?.label ?? `${name} default`,
        content: seed?.content ?? ""
      };
    }
  }

  return promptSnapshot;
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

function buildVirtualTask(accountId, input, , soulDocument) {
  const now = new Date().toISOString();
  return {
    id: `test-${Math.random().toString(36).slice(2, 10)}`,
    accountId,
    imageAssetId: null,
    title: input.title,
    brief: input.brief,
    goal: input.goal,
    preferredMode: input.preferredMode,
    status: "planned",
    currentStage: "planned",
    researchVersion: .version,
    researchMarkdownSnapshot: .markdown,
    soulVersion: soulDocument.version,
    soulMarkdownSnapshot: soulDocument.markdown,
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

function buildSanitized(accountId) {
  const now = new Date().toISOString();
  const markdown = `# Account Context

## Account Basics

- 这是一个中�?Web3 交易员账号，内容以短线执行、结构判断、真实复盘为主�?
- 核心表达是交易手记，不是媒体播报，不是研究院周报，也不是喊单群主口吻�?
- 关注位置、结构、风险收益、资金行为、新项目流动性和执行纪律�?
- 这次任务必须围绕“新项目观察”展开，不能退回成通用交易纪律贴�?

## Writing Moves

- 开头直接落判断，不要先讲行业背景�?
- 如果任务是新项目观察，必须讨论项目热度、流动性、叙事与短线执行边界�?
- 可以有口语和交易员情绪，但不能把主题写成“空仓、克制、活得久”�?

## Review Checklist

- 是否仍然在讲新项目，而不是泛化风险纪律�?
- 是否有第一人称交易员视角�?
- 是否自然保留 demonduan �?Soul 口吻。`;

  return {
    accountId,
    markdown,
    version: 1002,
    lastUpdatedAt: now,
    updateReason: "soul_boundary_smoke_baseline",
    updatedBy: "user",
    userEditedAt: now,
    lastGeneratedAt: null
  };
}

function summarizeRuntime(resolved) {
  return {
    model: resolved.runtime.model,
    baseUrl: resolved.runtime.baseUrl,
    wireApi: resolved.runtime.wireApi,
    fieldSources: resolved.fieldSources
  };
}

