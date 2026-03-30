import type {
  AccountListItem,
  AccountStatusView,
  ArtifactSummary,
  DashboardSummary,
  DraftListItem,
  JobDetail,
  JobListItem,
  OpsIncidentDetail,
  OpsIncidentSummary,
  OpsScanSummary,
  OpsSummary,
  PromptSetName,
  PromptSetView,
  PublishAttemptSummary,
  ScheduleSlot,
  SkillRunSummary,
  ToolTraceSummary,
  TopicBatchPlan,
  TopicListItem,
  WorkerTickSummary
} from "@zhihu-mvp/shared";
import { buildNetworkErrorMessage } from "./http";

const API_BASE_URL =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787";

export type CreateJobResponse = {
  jobId: number;
  status: string;
  displayStatus: string;
  currentStage: string | null;
  scheduledAt: string | null;
  message: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Dynamic server usage") || error.message.includes("Route /"))
    ) {
      throw error;
    }

    throw new Error(buildNetworkErrorMessage(path, error));
  }

  const text = await response.text();
  const payload = safeParseRecord(text);

  if (!response.ok) {
    const errorMessage =
      typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message ?? "")
        : text || `Request failed: ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

export async function getDashboardSummary() {
  const data = await apiFetch<{ summary: DashboardSummary }>(buildPathWithAccountId("/dashboard/summary"));
  return data.summary;
}

export async function getTodaySchedule() {
  const data = await apiFetch<{ slots: ScheduleSlot[] }>("/schedule/today");
  return data.slots;
}

export async function getWeekSchedule() {
  const data = await apiFetch<{ slots: ScheduleSlot[] }>("/schedule/week");
  return data.slots;
}

export async function getTopics(accountId?: number | null) {
  const data = await apiFetch<{ topics: TopicListItem[] }>(buildPathWithAccountId("/topics", accountId));
  return data.topics;
}

export async function getTopicBatchPlan(accountId?: number | null) {
  const data = await apiFetch<{ plan: TopicBatchPlan }>(buildPathWithAccountId("/topics/batch-plan", accountId));
  return data.plan;
}

export async function getDrafts(accountId?: number | null) {
  const data = await apiFetch<{ drafts: DraftListItem[] }>(buildPathWithAccountId("/drafts", accountId));
  return data.drafts;
}

export async function getJobs() {
  const data = await apiFetch<{ jobs: JobListItem[] }>("/jobs");
  return data.jobs;
}

export async function getPublishJobs() {
  const data = await apiFetch<{ jobs: JobListItem[] }>("/publish-jobs");
  return data.jobs;
}

export async function getJob(jobId: number) {
  const data = await apiFetch<{ job: JobDetail | null }>(`/jobs/${jobId}`);
  return data.job;
}

export async function getJobAttempts(jobId: number) {
  const data = await apiFetch<{ attempts: PublishAttemptSummary[] }>(`/jobs/${jobId}/publish-attempts`);
  return data.attempts;
}

export async function getJobArtifacts(jobId: number) {
  const data = await apiFetch<{ artifacts: ArtifactSummary[] }>(`/jobs/${jobId}/artifacts`);
  return data.artifacts;
}

export async function getJobToolTraces(jobId: number) {
  const data = await apiFetch<{ traces: ToolTraceSummary[] }>(`/jobs/${jobId}/tool-traces`);
  return data.traces;
}

export async function getJobSkillRuns(jobId: number) {
  const data = await apiFetch<{ skillRuns: SkillRunSummary[] }>(`/jobs/${jobId}/skill-runs`);
  return data.skillRuns;
}

export async function getDashboardSummaryForAccount(accountId?: number | null) {
  const data = await apiFetch<{ summary: DashboardSummary }>(buildPathWithAccountId("/dashboard/summary", accountId));
  return data.summary;
}

export async function getAccounts() {
  const data = await apiFetch<{ accounts: AccountListItem[] }>("/accounts");
  return data.accounts;
}

export async function getAccountStatus(accountId?: number | null) {
  const data = await apiFetch<{ account: AccountStatusView | null }>(buildPathWithAccountId("/account/status", accountId));
  return data.account;
}

export async function getPromptSets() {
  const data = await apiFetch<{ promptSets: PromptSetView[] }>("/prompt-sets");
  return data.promptSets;
}

export async function getPromptSet(name: PromptSetName) {
  const data = await apiFetch<{ promptSet: PromptSetView | null }>(`/prompt-sets/${name}`);
  return data.promptSet;
}

export async function postJson<T>(path: string, body?: unknown, method = "POST") {
  return apiFetch<T>(path, {
    method,
    body: body ? JSON.stringify(body) : undefined
  });
}

export async function createJob(accountId: number) {
  return postJson<CreateJobResponse>("/jobs", { accountId });
}

export async function retryJob(jobId: number) {
  return postJson<{ ok: true }>(`/jobs/${jobId}/retry`, {});
}

export async function reselectTopic(jobId: number) {
  return postJson<{ ok: true }>(`/jobs/${jobId}/reselect-topic`, {});
}

export async function runWorkerTick() {
  const data = await postJson<{ summary: WorkerTickSummary }>("/worker/tick");
  return data.summary;
}

export async function getOpsSummary() {
  const data = await apiFetch<{ summary: OpsSummary }>("/ops/summary");
  return data.summary;
}

export async function getOpsIncidents() {
  const data = await apiFetch<{ incidents: OpsIncidentSummary[] }>("/ops/incidents");
  return data.incidents;
}

export async function getOpsIncident(id: number) {
  const data = await apiFetch<{ incident: OpsIncidentDetail | null }>(`/ops/incidents/${id}`);
  return data.incident;
}

export async function runOpsScan() {
  const data = await postJson<{ summary: OpsScanSummary }>("/ops/scan");
  return data.summary;
}

function safeParseRecord(text: string) {
  if (!text) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function buildPathWithAccountId(path: string, accountId?: number | null) {
  if (!accountId) {
    return path;
  }

  const searchParams = new URLSearchParams({
    accountId: String(accountId)
  });

  return `${path}?${searchParams.toString()}`;
}
