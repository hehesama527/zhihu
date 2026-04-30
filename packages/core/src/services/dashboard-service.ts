import type { AccountStatusView, DashboardSummary } from "@zhihu-mvp/shared";
import { AccountRepository } from "../repositories/account-repository.js";
import { JobRepository } from "../repositories/job-repository.js";
import { ScheduleRepository } from "../repositories/schedule-repository.js";
import { TopicRepository } from "../repositories/topic-repository.js";
import { safeParseJson } from "../utils/json.js";
import { ScheduleService } from "./schedule-service.js";

export class DashboardService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly scheduleService: ScheduleService,
    private readonly scheduleRepository: ScheduleRepository,
    private readonly jobRepository: JobRepository,
    private readonly topicRepository: TopicRepository
  ) {}

  async getAccountView(accountId?: number): Promise<AccountStatusView | null> {
    const resolvedAccountId = accountId ?? (await this.accountRepository.getPrimaryAccount())?.id;
    if (!resolvedAccountId) {
      return null;
    }

    const [account, blockedJobs] = await Promise.all([
      this.accountRepository.getAccount(resolvedAccountId),
      this.jobRepository.listBlockedJobs(resolvedAccountId)
    ]);

    if (!account) {
      return null;
    }

    const expectedProfileDir = this.accountRepository.getExpectedProfileDir(account.id);
    const profileDirWarning =
      account.profileDir && account.profileDir !== expectedProfileDir
        ? `当前账号仍绑定历史 Profile 目录：${account.profileDir}。按当前矩阵口径，它应该落在 ${expectedProfileDir}。这通常表示这个账号沿用了早期单账号阶段的浏览器资产，可能出现账号资料和真实登录态不一致的问题。`
        : null;

    const primaryBlockedJob = blockedJobs[0] ?? null;
    const resumeAnchor = primaryBlockedJob
      ? safeParseJson<Record<string, unknown>>(primaryBlockedJob.resumeAnchorJson ?? "{}", {})
      : {};
    const coolingDown = isCoolingDown(account.cooldownUntil);

    return {
      ...account,
      coolingDown,
      recoveryRequired:
        account.status === "manual_login_required" || account.status === "session_expired" || blockedJobs.length > 0,
      recoveryReason: primaryBlockedJob?.failureReason ?? account.statusReason ?? null,
      resumeStage: primaryBlockedJob?.currentStage ?? null,
      returnUrl: typeof resumeAnchor.currentUrl === "string" ? resumeAnchor.currentUrl : null,
      expectedProfileDir,
      profileDirWarning,
      blockedJobs
    };
  }

  async getSummary(accountId?: number): Promise<DashboardSummary> {
    await this.scheduleService.bootstrapTodaySchedule();

    const [account, todaySchedule, weekSchedule, recentJobs, recentTopics] = await Promise.all([
      this.getAccountView(accountId),
      this.scheduleRepository.listScheduleForToday(accountId),
      this.scheduleRepository.listScheduleForWeek(accountId),
      this.jobRepository.listJobs(accountId),
      this.topicRepository.listTopics(8, accountId)
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

function isCoolingDown(value: string | null) {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).valueOf();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}
