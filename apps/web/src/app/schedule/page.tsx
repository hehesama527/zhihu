import Link from "next/link";
import { StatusChip } from "../../components/status-chip";
import { getTodaySchedule, getWeekSchedule } from "../../lib/api";

export default async function SchedulePage() {
  const [todaySchedule, weekSchedule] = await Promise.all([getTodaySchedule(), getWeekSchedule()]);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>排期中心</h2>
          <p className="muted">固定工作日发布，每个账号 08:00 到 20:00 随机 3-4 篇，周末休息。</p>
        </div>
      </section>

      <section className="card">
        <h3>今日排期</h3>
        <ScheduleTable slots={todaySchedule} />
      </section>

      <section className="card">
        <h3>本周排期</h3>
        <ScheduleTable slots={weekSchedule} />
      </section>
    </div>
  );
}

function ScheduleTable({ slots }: { slots: Awaited<ReturnType<typeof getWeekSchedule>> }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>账号</th>
            <th>时间</th>
            <th>状态</th>
            <th>任务</th>
          </tr>
        </thead>
        <tbody>
          {slots.length ? (
            slots.map((slot) => (
              <tr key={slot.id}>
                <td>{slot.accountName ?? `账号 #${slot.accountId ?? "-"}`}</td>
                <td>{new Date(slot.scheduledAt).toLocaleString("zh-CN")}</td>
                <td>
                  <StatusChip status={slot.status} />
                </td>
                <td>
                  {slot.publishJobId ? (
                    <Link href={`/jobs/${slot.publishJobId}`}>{slot.title ?? `任务 #${slot.publishJobId}`}</Link>
                  ) : (
                    "待分配"
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4}>当前范围内没有排期。</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
