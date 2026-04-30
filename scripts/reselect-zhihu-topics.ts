import fs from "node:fs";
import path from "node:path";
import {
  AccountRepository,
  AccountSoulService,
  BrowserSkillService,
  JobRepository,
  LlmService,
  PlaywrightToolRuntime,
  PromptRepository,
  SessionService,
  TopicBatchPlannerService,
  TopicDiscoveryService,
  TopicRepository,
  applySchemaMigrations,
  getMysqlPool
} from "@zhihu-mvp/core";

loadEnvFile(".env.local");
loadEnvFile(".env");

const accountId = Number(process.argv[2] ?? 1);

const pool = getMysqlPool();
await applySchemaMigrations(pool);

const promptRepository = new PromptRepository(pool);
const llmService = new LlmService(promptRepository);
const jobRepository = new JobRepository(pool);
const accountRepository = new AccountRepository(pool);
const topicRepository = new TopicRepository(pool);
const accountSoulService = new AccountSoulService();
const runtime = new PlaywrightToolRuntime(jobRepository);
const browserSkillService = new BrowserSkillService(runtime, jobRepository);
const sessionService = new SessionService(browserSkillService, llmService);
const topicDiscoveryService = new TopicDiscoveryService(topicRepository, browserSkillService, sessionService, llmService);
const topicBatchPlannerService = new TopicBatchPlannerService(llmService, topicRepository);

const account = await accountRepository.getAccount(accountId);
if (!account?.profileDir) {
  throw new Error(`Account ${accountId} is missing or has no profileDir.`);
}

const openCandidates = await topicRepository.listOpenCandidates(50, accountId);
for (const candidate of openCandidates) {
  await topicRepository.markCandidateBlocked(candidate.id, "manual topic reselection: replaced by a fresh 10-topic batch");
}

const soulDocument = await accountSoulService.ensureSoulDocument(account);
const harvested = await topicDiscoveryService.harvestCandidates({
  accountId: account.id,
  profileDir: account.profileDir,
  accountContext: {
    accountId: account.id,
    accountName: account.name,
    zhihuUserName: account.zhihuUserName
  },
  accountSoulMarkdown: soulDocument.markdown
});

const candidates = await topicRepository.listOpenCandidates(10, accountId);
const plan = await topicBatchPlannerService.getCurrentBatchPlan(undefined, {
  accountId,
  accountContext: {
    accountId: account.id,
    accountName: account.name,
    zhihuUserName: account.zhihuUserName
  },
  accountSoulMarkdown: soulDocument.markdown
});

console.log(
  JSON.stringify(
    {
      accountId,
      harvested,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        status: candidate.status,
        title: candidate.questionTitle,
        url: candidate.questionUrl,
        sourceType: candidate.sourceType,
        priority: candidate.priority,
        fitScore: candidate.fitScore,
        questionType: candidate.questionType,
        personaMode: candidate.personaMode,
        validityStatus: candidate.validityStatus,
        validityReason: candidate.validityReason,
        mustAvoid: candidate.mustAvoid,
        riskNotes: candidate.riskNotes
      })),
      plan
    },
    null,
    2
  )
);

await pool.end();

function loadEnvFile(fileName: string) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
