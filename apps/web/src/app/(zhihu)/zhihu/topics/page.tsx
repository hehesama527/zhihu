import Link from "next/link";
import { AccountSwitcher } from "../../../../components/account-switcher";
import { getAccounts, getDrafts, getTopicBatchPlan, getTopics } from "../../../../lib/api";

type TopicsPageProps = {
  searchParams?: Promise<{
    accountId?: string;
  }>;
};

export default async function TopicsPage({ searchParams }: TopicsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const accounts = await getAccounts();
  const requestedAccountId = parseAccountId(resolvedSearchParams?.accountId);
  const selectedAccount = accounts.find((account) => account.id === requestedAccountId) ?? accounts[0] ?? null;
  const selectedAccountId = selectedAccount?.id ?? null;

  const [topics, drafts, batchPlanResult] = await Promise.all([
    getTopics(selectedAccountId),
    getDrafts(selectedAccountId),
    getTopicBatchPlan(selectedAccountId)
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
          <h2>选题 / 草稿</h2>
          <p className="muted">切到不同账号后，这一页只展示该账号自己的题目池、批次排序和草稿审核结果。</p>
        </div>
      </section>

      <AccountSwitcher
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        basePath="/zhihu/topics"
        title="账号题库视图"
        description="这里按账号隔离查看选题和草稿。切换账号后，题目池、批次排序和审核状态都会跟着切换。"
      />

      <section className="card">
        <div className="grid grid--three">
          <article className="stack stack--tight">
            <h3>当前账号</h3>
            <p>{selectedAccount?.name ?? "暂无账号"}</p>
            <p className="muted">{selectedAccount?.zhihuUserName ?? "未填写知乎账号名"}</p>
          </article>

          <article className="stack stack--tight">
            <h3>题目池数量</h3>
            <p>{topics.length}</p>
            <p className="muted">这里只统计当前账号名下的题目候选。</p>
          </article>

          <article className="stack stack--tight">
            <h3>草稿数量</h3>
            <p>{drafts.length}</p>
            <p className="muted">这里只展示当前账号走到草稿与审核阶段的数据。</p>
          </article>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>当前批次排序</h3>
            <p className="muted">这段只验证当前账号视角下 10 个候选题的排序和首题选择，不推进到写作与发布。</p>
          </div>
        </div>

        {batchPlanResult.ok ? (
          <div className="stack">
            <div className="stack stack--tight">
              <p>
                当前首题：
                {batchPlanResult.plan.selectedTitle ? <strong>{batchPlanResult.plan.selectedTitle}</strong> : "暂无"}
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
                            <span className="muted">
                              {item.questionType ?? "未分类"} / {item.personaMode ?? "未设人设"}
                            </span>
                          </div>
                        </td>
                        <td>{formatTopicSource(item.sourceType)}</td>
                        <td>{item.priority ?? "-"}</td>
                        <td>{item.fitScore ?? "-"}</td>
                        <td>{item.selectionScore}</td>
                        <td>{item.reason}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>当前账号还没有可排序的候选题。</td>
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
                        <span className="muted">{topic.topicSummary ?? "暂无题目摘要"}</span>
                      </div>
                    </td>
                    <td>{formatTopicSource(topic.sourceType)}</td>
                    <td>{topic.priority ?? "-"}</td>
                    <td>{topic.fitScore ?? "-"}</td>
                    <td>{formatValidity(topic.validityStatus, topic.validityReason)}</td>
                    <td>{formatTopicStatus(topic.status)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>当前账号还没有题目数据。</td>
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
                    <td>{formatDraftReviewStatus(draft.reviewStatus)}</td>
                    <td>{draft.canPublish ? "允许" : "不允许"}</td>
                    <td>{draft.reviewSummary ?? "暂无"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>当前账号还没有草稿数据。</td>
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

function parseAccountId(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatTopicSource(value: string | null) {
  const map: Record<string, string> = {
    manual: "人工录入",
    hot: "热点发现",
    search: "搜索发现",
    related: "关联扩展",
    history: "历史复盘",
    competitor: "对标账号",
    research: "调研补充"
  };

  return value ? map[value] ?? value : "暂无来源";
}

function formatTopicStatus(value: string | null) {
  const map: Record<string, string> = {
    new: "新入池",
    queued: "待处理",
    ranked: "已排序",
    drafted: "已出草稿",
    reviewed: "已审核",
    invalid: "无效",
    skipped: "已跳过"
  };

  return value ? map[value] ?? value : "暂无";
}

function formatDraftReviewStatus(value: string | null) {
  const map: Record<string, string> = {
    pending: "待审核",
    approved: "审核通过",
    rejected: "审核驳回",
    revise: "需修改",
    blocked: "已拦截"
  };

  return value ? map[value] ?? value : "-";
}
