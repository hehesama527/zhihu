"use client";

import { useEffect, useState } from "react";
import { getTwitterTasks, getTwitterAccounts, type TwitterTask } from "../../../../lib/twitter/api";

type PublishRecord = {
  id: string;
  title: string;
  accountId: string;
  accountName: string;
  tweetUrls: string[];
  publishedAt: string;
  publishMode: "single" | "thread";
  engagement: {
    likes: number | null;
    retweets: number | null;
    replies: number | null;
  } | null;
};

function taskToPublishRecord(task: TwitterTask, accountName: string): PublishRecord | null {
  // 只有已发布的任务才算是发布记录
  if (!task.publishResult || task.status !== "published") {
    return null;
  }

  return {
    id: task.id,
    title: task.title,
    accountId: task.accountId,
    accountName,
    tweetUrls: task.publishResult.urls || [],
    publishedAt: task.publishResult.publishedAt,
    publishMode: task.publishPlan?.mode || "single",
    engagement: null // 暂时不支持互动数据
  };
}

export default function TwitterPublishHistoryPage() {
  const [records, setRecords] = useState<PublishRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "single" | "thread">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecords();
  }, []);

  async function loadRecords() {
    setLoading(true);
    try {
      const [tasks, accounts] = await Promise.all([
        getTwitterTasks(),
        getTwitterAccounts()
      ]);
      
      const namesMap = new Map<string, string>();
      for (const account of accounts) {
        namesMap.set(account.id, account.name || `@${account.handle}`);
      }

      const recordList = tasks
        .map((task) => taskToPublishRecord(task, namesMap.get(task.accountId) || `未知账号`))
        .filter((record): record is PublishRecord => record !== null);

      setRecords(recordList);
    } catch (error) {
      console.error("加载发布记录失败:", error);
    } finally {
      setLoading(false);
    }
  }

  const filteredRecords = filter === "all" ? records : records.filter((r) => r.publishMode === filter);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>发布记录</h2>
          <p className="muted">
            查看历史发布记录和互动数据。复盘哪些内容更受欢迎，优化后续的写作方向。
          </p>
        </div>

        <div className="button-row">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="button button--ghost"
          >
            <option value="all">全部</option>
            <option value="single">单帖</option>
            <option value="thread">线程</option>
          </select>

          <button className="button button--ghost" disabled={loading} onClick={() => loadRecords()}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </section>

      <article className="card">
        <div className="card-header">
          <div>
            <h3>发布历史</h3>
            <p className="muted">共 {records.length} 条记录</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>账号</th>
                <th>类型</th>
                <th>发布时间</th>
                <th>互动数据</th>
                <th>链接</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <p>正在加载发布记录...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredRecords.length > 0 ? (
                filteredRecords.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>{record.title}</strong>
                    </td>
                    <td>
                      <span className="muted">{record.accountName}</span>
                    </td>
                    <td>
                      <span className="mini-badge mini-badge--accent">
                        {record.publishMode === "single" ? "单帖" : `${record.tweetUrls.length} 条线程`}
                      </span>
                    </td>
                    <td>
                      {new Date(record.publishedAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td>
                      {record.engagement ? (
                        <div className="inline-row" style={{ gap: "1rem" }}>
                          <span>❤️ {record.engagement.likes}</span>
                          <span>🔁 {record.engagement.retweets}</span>
                          <span>💬 {record.engagement.replies}</span>
                        </div>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <div className="stack stack--tight">
                        {record.tweetUrls.map((url, index) => (
                          <a
                            key={index}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--accent)", textDecoration: "underline", fontSize: "0.85rem" }}
                          >
                            查看推文 {index + 1} →
                          </a>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <p>还没有发布记录</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card">
        <div className="stack stack--tight">
          <h3>数据说明</h3>
          
          <div className="grid grid--three">
            <div>
              <h4>互动数据</h4>
              <p className="muted">
                互动数据（点赞、转发、回复）会在发布后 24 小时内自动同步。
                数据来源于 Twitter API，可能有 1-2 小时的延迟。
              </p>
            </div>

            <div>
              <h4>复盘建议</h4>
              <p className="muted">
                定期查看发布记录，分析哪些主题和写作风格更受欢迎。
                将高互动内容的特征应用到后续的写作中。
              </p>
            </div>

            <div>
              <h4>导出数据</h4>
              <p className="muted">
                后续会支持导出发布记录为 CSV 或 Excel 格式，
                方便进行更详细的数据分析和报告生成。
              </p>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
