import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import type { ScheduleSlot } from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";

dayjs.extend(utc);
dayjs.extend(timezone);

type ScheduleRow = RowDataPacket & {
  id: number;
  scheduled_at: Date;
  status: "pending" | "in_progress" | "published" | "failed" | "manual_login_required";
  publish_job_id: number | null;
  title: string | null;
};

export class ScheduleRepository {
  constructor(private readonly pool: Pool) {}

  async ensureDailySchedule(date = dayjs().tz(getAppConfig().timezone).format("YYYY-MM-DD")) {
    const weekday = dayjs.tz(date, getAppConfig().timezone).day();
    if (weekday === 0 || weekday === 6) {
      return 0;
    }

    const [existing] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM daily_publish_schedule WHERE schedule_date = ?`,
      [date]
    );
    if (Number(existing[0]?.count ?? 0) > 0) {
      return 0;
    }

    const slotCount = Math.random() < 0.5 ? 3 : 4;
    const slots = generateSlots(date, slotCount);

    for (const slot of slots) {
      await this.pool.query(
        `INSERT INTO daily_publish_schedule (schedule_date, scheduled_at, status) VALUES (?, ?, 'pending')`,
        [date, slot.toDate()]
      );
    }

    return slots.length;
  }

  async listScheduleForToday(): Promise<ScheduleSlot[]> {
    const today = dayjs().tz(getAppConfig().timezone).format("YYYY-MM-DD");
    return this.listScheduleForRange(today, today);
  }

  async listScheduleForWeek(): Promise<ScheduleSlot[]> {
    const now = dayjs().tz(getAppConfig().timezone);
    const startOfWeek = now.day() === 0 ? now.startOf("day") : now.startOf("week").add(1, "day");
    const endOfWeek = startOfWeek.add(4, "day").endOf("day");
    return this.listScheduleForRange(startOfWeek.format("YYYY-MM-DD"), endOfWeek.format("YYYY-MM-DD"));
  }

  async getNextUnassignedSlot() {
    const [rows] = await this.pool.query<ScheduleRow[]>(
      `SELECT s.id, s.scheduled_at, s.status, s.publish_job_id, pj.title
       FROM daily_publish_schedule s
       LEFT JOIN publish_jobs pj ON pj.id = s.publish_job_id
       WHERE s.publish_job_id IS NULL
       ORDER BY s.scheduled_at ASC
       LIMIT 1`
    );

    return rows[0]
      ? {
          id: rows[0].id,
          scheduledAt: rows[0].scheduled_at.toISOString(),
          status: rows[0].status,
          publishJobId: rows[0].publish_job_id,
          title: rows[0].title
        }
      : null;
  }

  async assignJobToSlot(slotId: number, jobId: number) {
    await this.pool.query(`UPDATE daily_publish_schedule SET publish_job_id = ? WHERE id = ?`, [jobId, slotId]);
  }

  async createAdhocSlot(scheduledAt: Date, status: ScheduleSlot["status"] = "pending") {
    const date = dayjs(scheduledAt).tz(getAppConfig().timezone);
    const [result] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO daily_publish_schedule (schedule_date, scheduled_at, status)
       VALUES (?, ?, ?)`,
      [date.format("YYYY-MM-DD"), scheduledAt, status]
    );

    return result.insertId;
  }

  async getDueSlots(now = new Date()) {
    const [rows] = await this.pool.query<ScheduleRow[]>(
      `SELECT s.id, s.scheduled_at, s.status, s.publish_job_id, pj.title
       FROM daily_publish_schedule s
       LEFT JOIN publish_jobs pj ON pj.id = s.publish_job_id
       WHERE s.publish_job_id IS NOT NULL
         AND s.scheduled_at <= ?
         AND s.status IN ('pending', 'manual_login_required')
       ORDER BY s.scheduled_at ASC`,
      [now]
    );

    return rows.map((row) => ({
      id: row.id,
      scheduledAt: row.scheduled_at.toISOString(),
      status: row.status,
      publishJobId: row.publish_job_id,
      title: row.title
    }));
  }

  async updateSlotStatus(slotId: number, status: ScheduleSlot["status"]) {
    await this.pool.query(`UPDATE daily_publish_schedule SET status = ? WHERE id = ?`, [status, slotId]);
  }

  async getSlotByJobId(jobId: number) {
    const [rows] = await this.pool.query<ScheduleRow[]>(
      `SELECT s.id, s.scheduled_at, s.status, s.publish_job_id, pj.title
       FROM daily_publish_schedule s
       LEFT JOIN publish_jobs pj ON pj.id = s.publish_job_id
       WHERE s.publish_job_id = ?
       LIMIT 1`,
      [jobId]
    );

    const row = rows[0];
    return row
      ? {
          id: row.id,
          scheduledAt: row.scheduled_at.toISOString(),
          status: row.status,
          publishJobId: row.publish_job_id,
          title: row.title
        }
      : null;
  }

  private async listScheduleForRange(startDate: string, endDate: string): Promise<ScheduleSlot[]> {
    const [rows] = await this.pool.query<ScheduleRow[]>(
      `SELECT s.id, s.scheduled_at, s.status, s.publish_job_id, pj.title
       FROM daily_publish_schedule s
       LEFT JOIN publish_jobs pj ON pj.id = s.publish_job_id
       WHERE s.schedule_date BETWEEN ? AND ?
       ORDER BY s.scheduled_at ASC`,
      [startDate, endDate]
    );

    return rows.map((row) => ({
      id: row.id,
      scheduledAt: row.scheduled_at.toISOString(),
      status: row.status,
      publishJobId: row.publish_job_id,
      title: row.title
    }));
  }
}

function generateSlots(date: string, slotCount: number) {
  const timezoneName = getAppConfig().timezone;
  const start = dayjs.tz(`${date} 08:00`, timezoneName);
  const end = dayjs.tz(`${date} 20:00`, timezoneName);
  const slots: dayjs.Dayjs[] = [];

  while (slots.length < slotCount) {
    const offsetMinutes = Math.floor(Math.random() * end.diff(start, "minute"));
    const candidate = start.add(offsetMinutes, "minute").second(0).millisecond(0);
    const conflict = slots.some((slot) => Math.abs(slot.diff(candidate, "minute")) < 90);

    if (!conflict) {
      slots.push(candidate);
    }
  }

  return slots.sort((left, right) => left.valueOf() - right.valueOf());
}
