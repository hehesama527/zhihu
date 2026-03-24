import { ScheduleRepository } from "../repositories/schedule-repository.js";

export class ScheduleService {
  constructor(private readonly scheduleRepository: ScheduleRepository) {}

  async bootstrapTodaySchedule() {
    return this.scheduleRepository.ensureDailySchedule();
  }

  async getTodaySchedule() {
    await this.bootstrapTodaySchedule();
    return this.scheduleRepository.listScheduleForToday();
  }

  async getWeekSchedule() {
    await this.bootstrapTodaySchedule();
    return this.scheduleRepository.listScheduleForWeek();
  }

  async getNextUnassignedSlot() {
    await this.bootstrapTodaySchedule();
    return this.scheduleRepository.getNextUnassignedSlot();
  }
}
