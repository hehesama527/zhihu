import { AccountRepository } from "../repositories/account-repository.js";
import { ScheduleRepository } from "../repositories/schedule-repository.js";

export class ScheduleService {
  constructor(
    private readonly scheduleRepository: ScheduleRepository,
    private readonly accountRepository: AccountRepository
  ) {}

  async bootstrapTodaySchedule() {
    const accounts = await this.accountRepository.listAccounts();
    if (!accounts.length) {
      return 0;
    }

    const fallbackAccountId = accounts[0]?.id;
    if (fallbackAccountId) {
      await this.scheduleRepository.backfillLegacySlots(fallbackAccountId);
    }

    const targetAccounts = accounts.filter((account) => Boolean(account.profileDir));
    const accountIds = (targetAccounts.length ? targetAccounts : accounts).map((account) => account.id);

    return this.scheduleRepository.ensureDailySchedule({
      accountIds
    });
  }

  async getTodaySchedule(accountId?: number) {
    await this.bootstrapTodaySchedule();
    return this.scheduleRepository.listScheduleForToday(accountId);
  }

  async getWeekSchedule(accountId?: number) {
    await this.bootstrapTodaySchedule();
    return this.scheduleRepository.listScheduleForWeek(accountId);
  }

  async getNextUnassignedSlot(accountId: number) {
    await this.bootstrapTodaySchedule();
    return this.scheduleRepository.getNextUnassignedSlot(accountId);
  }
}
