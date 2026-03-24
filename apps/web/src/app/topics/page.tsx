import Link from "next/link";
import { getDrafts, getTopicBatchPlan, getTopics } from "../../lib/api";

export default async function TopicsPage() {
  const [topics, drafts, batchPlanResult] = await Promise.all([
    getTopics(),
    getDrafts(),
    getTopicBatchPlan()
      .then((plan) => ({ ok: true as const, plan }))
      .catch((error) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : "批次排序获取失败。"
      }))
  ]);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>Topics / Drafts</h2>
          <p className="muted">查看题目池、有效性校验、重复性拦截结果和草稿审核状态。</p>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>当前批次排序</h3>
            <p className="muted">这一段只验证当前 10 个候选题的排序和首题选择，不推进到写作与发布。</p>
          </div>
        </div>

        {batchPlanResult.ok ? (
          <div className="stack">
            <div className="stack stack--tight">
              <p>
                当前首题：
                {batchPlanResult.plan.selectedTitle ? (
                  <strong>{batchPlanResult.plan.selectedTitle}</strong>
                ) : (
                  "暂无"
                )}
              </p>
              <p className="muted">{batchPlanResult.plan.summary}</p>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>排序</th>
                    <th>题目</th>
                    <th>来源</th>
                    <th>优先级</th>
                    <th>适配分</th>
                    <th>批次分</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {batchPlanResult.plan.ranking.length ? (
                    batchPlanResult.plan.ranking.map((item) => (
                      <tr key={item.candidateId}>
                        <td>{item.selected ? `#${item.rank} 当前首题` : `#${item.rank}`}</td>
                        <td>
                          <div className="stack stack--tight">
                            <Link href={item.questionUrl}>{item.questionTitle}</Link>
                            <span className="muted">{item.questionType ?? "未分类"} / {item.personaMode ?? "未设人设"}</span>
                          </div>
                        </td>
                        <td>{item.sourceType}</td>
                        <td>{item.priority ?? "-"}</td>
                        <td>{item.fitScore ?? "-"}</td>
                        <td>{item.selectionScore}</td>
                        <td>{item.reason}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>当前没有可排序的候选题。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="muted">{batchPlanResult.message}</p>
        )}
      </section>

      <section className="card">
        <h3>题目池</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>题目</th>
                <th>来源</th>
                <th>优先级</th>
                <th>适配分</th>
                <th>有效性</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {topics.length ? (
                topics.map((topic) => (
                  <tr key={topic.id}>
                    <td>
                      <div className="stack stack--tight">
                        <Link href={topic.questionUrl}>{topic.questionTitle}</Link>
                        <span className="muted">{topic.topicSummary ?? "暂无题目卡摘要"}</span>
                      </div>
                    </td>
                    <td>{topic.sourceType}</td>
                    <td>{topic.priority ?? "-"}</td>
                    <td>{topic.fitScore ?? "-"}</td>
                    <td>{formatValidity(topic.validityStatus, topic.validityReason)}</td>
                    <td>{topic.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>还没有题目数据。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>草稿与审核</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>问题</th>
                <th>审核状态</th>
                <th>可发布</th>
                <th>摘要</th>
              </tr>
            </thead>
            <tbody>
              {drafts.length ? (
                drafts.map((draft) => (
                  <tr key={draft.id}>
                    <td>
                      <div className="stack stack--tight">
                        <Link href={draft.questionUrl}>{draft.questionTitle}</Link>
                        <span className="muted">Topic Card #{draft.topicCardId}</span>
                      </div>
                    </td>
                    <td>{draft.reviewStatus ?? "-"}</td>
                    <td>{draft.canPublish ? "允许" : "不允许"}</td>
                    <td>{draft.reviewSummary ?? "暂无"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>还没有草稿数据。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatValidity(status: string, reason: string | null) {
  if (status === "valid") {
    return "有效";
  }

  if (status === "invalid") {
    return reason ?? "无效";
  }

  return "待校验";
}
