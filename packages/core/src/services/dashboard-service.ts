import type { AccountStatusView, DashboardSummary } from "@zhihu-mvp/shared";
import { AccountRepository } from "../repositories/account-repository.js";
import { JobRepository } from "../repositories/job-repository.js";
import { ScheduleRepository } from "../repositories/schedule-repository.js";
import { TopicRepository } from "../repositories/topic-repository.js";
import { safeParseJson } from "../utils/json.js";

export class DashboardService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly scheduleRepository: ScheduleRepository,
    private readonly jobRepository: JobRepository,
    private readonly topicRepository: TopicRepository
  ) {}

  async getAccountView(accountId = 1): Promise<AccountStatusView | null> {
    const [account, blockedJobs] = await Promise.all([
      this.accountRepository.getAccount(accountId),
      this.jobRepository.listBlockedJobs(accountId)
    ]);

    if (!account) {
      return null;
    }

    const primaryBlockedJob = blockedJobs[0] ?? null;
    const resumeAnchor = primaryBlockedJob
      ? safeParseJson<Record<string, unknown>>(primaryBlockedJob.resumeAnchorJson ?? "{}", {})
      : {};

    return {
      ...account,
      recoveryRequired:
        account.status === "manual_login_required" || account.status === "session_expired" || blockedJobs.length > 0,
      recoveryReason: primaryBlockedJob?.failureReason ?? account.statusReason ?? null,
      resumeStage: primaryBlockedJob?.currentStage ?? null,
      returnUrl: typeof resumeAnchor.currentUrl === "string" ? resumeAnchor.currentUrl : null,
      blockedJobs
    };
  }

  async getSummary(): Promise<DashboardSummary> {
    await this.scheduleRepository.ensureDailySchedule();

    const [account, todaySchedule, weekSchedule, recentJobs, recentTopics] = await Promise.all([
      this.getAccountView(),
      this.scheduleRepository.listScheduleForToday(),
      this.scheduleRepository.listScheduleForWeek(),
      this.jobRepository.listJobs(),
      this.topicRepository.listTopics(8)
    ]);

    return {
      account,
      todaySchedule,
      weekSchedule,
      recentJobs,
      recentTopics,
      metrics: {
        totalJobs: recentJobs.length,
        publishedJobs: recentJobs.filter((job) => job.status === "published").length,
        manualLoginJobs: recentJobs.filter((job) => job.status === "manual_login_required").length,
        failedJobs: recentJobs.filter((job) => job.status === "failed_terminal").length,
        readyToPublishJobs: recentJobs.filter((job) => job.displayStatus === "ready_to_publish").length
      }
    };
  }
}
