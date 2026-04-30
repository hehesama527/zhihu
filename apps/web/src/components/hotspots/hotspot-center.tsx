"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { StatusChip } from "../status-chip";
import {
  createHotspotWatchlistItem,
  createTaskFromHotspot,
  deleteHotspotWatchlistItem,
  getHotspot,
  getHotspotAccounts,
  getHotspotWatchlists,
  getHotspots,
  runHotspotResearch,
  scanHotspots,
  updateHotspot,
  updateHotspotWatchlistItem,
  type Hotspot,
  type HotspotAccount,
  type HotspotDetail,
  type HotspotPriority,
  type HotspotSourceType,
  type HotspotStatus,
  type HotspotWatchlist,
  type HotspotWatchlistItem
} from "../../lib/hotspots/api";
import {
  buildTwitterProfileUrl,
  formatTwitterAccountHandle,
  getDefaultTwitterAccountLabel,
  normalizeTwitterAccountValue
} from "../../lib/twitter/x-account";

type FilterState = {
  priority: "all" | HotspotPriority;
  status: "all" | HotspotStatus;
  sourceType: "all" | HotspotSourceType;
  includeExpired: boolean;
};

type TaskBridgeForm = {
  accountId: string;
  preferredMode: "auto" | "single" | "thread";
  forceResearch: boolean;
};

type MonitorForm = {
  value: string;
  label: string;
  enabled: boolean;
  priority: number;
  notes: string;
};

const DEFAULT_FILTERS: FilterState = {
  priority: "all",
  status: "all",
  sourceType: "all",
  includeExpired: false
};

const DEFAULT_MONITOR_FORM: MonitorForm = {
  value: "",
  label: "",
  enabled: true,
  priority: 80,
  notes: ""
};

export function HotspotCenter() {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [accounts, setAccounts] = useState<HotspotAccount[]>([]);
  const [watchlists, setWatchlists] = useState<HotspotWatchlist[]>([]);
  const [selectedHotspotId, setSelectedHotspotId] = useState<number | null>(null);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<number | null>(null);
  const [selectedHotspot, setSelectedHotspot] = useState<HotspotDetail | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [taskForm, setTaskForm] = useState<TaskBridgeForm>({
    accountId: "",
    preferredMode: "auto",
    forceResearch: false
  });
  const [monitorForm, setMonitorForm] = useState<MonitorForm>(DEFAULT_MONITOR_FORM);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const selectedWatchlist = watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? null;
  const monitoredAccounts = selectedWatchlist
    ? selectedWatchlist.items
        .filter((item) => item.type === "x_account")
        .sort((left, right) => {
          if (left.enabled !== right.enabled) {
            return left.enabled ? -1 : 1;
          }
          if (left.priority !== right.priority) {
            return right.priority - left.priority;
          }
          return left.value.localeCompare(right.value, "en");
        })
    : [];
  const activeMonitorCount = monitoredAccounts.filter((item) => item.enabled).length;
  const otherRuleCount = selectedWatchlist ? selectedWatchlist.items.length - monitoredAccounts.length : 0;

  useEffect(() => {
    void loadPage();
  }, [filters.priority, filters.status, filters.sourceType, filters.includeExpired]);

  async function loadPage(preferredHotspotId?: number | null, preferredWatchlistId?: number | null) {
    setLoading(true);
    try {
      const [nextHotspots, nextAccounts, nextWatchlists] = await Promise.all([
        getHotspots({
          priority: filters.priority === "all" ? null : filters.priority,
          status: filters.status === "all" ? null : filters.status,
          sourceType: filters.sourceType === "all" ? null : filters.sourceType,
          includeExpired: filters.includeExpired
        }),
        getHotspotAccounts(),
        getHotspotWatchlists()
      ]);

      setHotspots(nextHotspots);
      setAccounts(nextAccounts);
      setWatchlists(nextWatchlists);

      const nextSelectedAccountId =
        taskForm.accountId && nextAccounts.some((account) => account.id === taskForm.accountId)
          ? taskForm.accountId
          : nextAccounts[0]?.id ?? "";
      setTaskForm((current) => ({
        ...current,
        accountId: nextSelectedAccountId
      }));

      const nextWatchlistId = pickWatchlistId(nextWatchlists, preferredWatchlistId ?? selectedWatchlistId);
      setSelectedWatchlistId(nextWatchlistId);

      const nextHotspotId = pickHotspotId(nextHotspots, preferredHotspotId ?? selectedHotspotId);
      setSelectedHotspotId(nextHotspotId);

      if (nextHotspotId) {
        setSelectedHotspot(await getHotspot(nextHotspotId));
      } else {
        setSelectedHotspot(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载热点中心失败。");
    } finally {
      setLoading(false);
    }
  }

  function withAction(action: () => Promise<void>) {
    setMessage("");
    startTransition(async () => {
      try {
        await action();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "热点操作失败。");
      }
    });
  }

  const counts = hotspots.reduce(
    (accumulator, hotspot) => {
      accumulator.total += 1;
      accumulator[hotspot.priority] += 1;
      return accumulator;
    },
    { total: 0, P0: 0, P1: 0, P2: 0, DROP: 0 }
  );

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>热点中心</h2>
          <p className="muted">
            X 热点池、补研究、监控账号和转任务入口已经从 X 工作台提升到中控层。这里负责维护最近 72 小时内的事件对象，再把高价值热点桥接回任务链。
          </p>
        </div>

        <div className="button-row">
          <Link href="/hotspots/watchlists" className="button button--ghost">
            监控配置
          </Link>
          <Link href="/twitter" className="button button--ghost">
            返回 X 工作台
          </Link>
          <button
            className="button button--ghost"
            disabled={pending}
            onClick={() =>
              withAction(async () => {
                await loadPage(selectedHotspotId, selectedWatchlistId);
              })
            }
          >
            {pending ? "刷新中..." : "刷新"}
          </button>
          <button
            className="button"
            disabled={pending}
            onClick={() =>
              withAction(async () => {
                const summary = await scanHotspots({
                  force: true,
                  includeResearch: true
                });
                await loadPage(selectedHotspotId, selectedWatchlistId);
                setMessage(
                  `热点扫描完成：触发 ${summary.triggeredSources.length} 个来源，新增 ${summary.createdCount}，更新 ${summary.updatedCount}，补研究 ${summary.researchCount}。`
                );
              })
            }
          >
            {pending ? "扫描中..." : "立即扫描"}
          </button>
        </div>
      </section>

      {message ? (
        <div className="card">
          <p className="helper-text">{message}</p>
        </div>
      ) : null}

      <section className="grid grid--two twitter-hotspots-grid">
        <article className="card">
          <div className="grid grid--two">
            <MetricCard label="热点总数" value={String(counts.total)} />
            <MetricCard label="P0" value={String(counts.P0)} />
            <MetricCard label="P1" value={String(counts.P1)} />
            <MetricCard label="P2" value={String(counts.P2)} />
          </div>

          <div className="button-row" style={{ marginTop: "1rem" }}>
            <select
              value={filters.priority}
              onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value as FilterState["priority"] }))}
            >
              <option value="all">全部优先级</option>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="DROP">DROP</option>
            </select>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as FilterState["status"] }))}
            >
              <option value="all">全部状态</option>
              <option value="active">active</option>
              <option value="ignored">ignored</option>
              <option value="tasked">tasked</option>
              <option value="expired">expired</option>
            </select>
            <select
              value={filters.sourceType}
              onChange={(event) => setFilters((current) => ({ ...current, sourceType: event.target.value as FilterState["sourceType"] }))}
            >
              <option value="all">全部来源</option>
              <option value="news">news</option>
              <option value="market">market</option>
              <option value="watchlist">watchlist</option>
            </select>
          </div>

          <label className="field" style={{ marginTop: "1rem", marginBottom: 0 }}>
            <span>
              <input
                type="checkbox"
                checked={filters.includeExpired}
                onChange={(event) => setFilters((current) => ({ ...current, includeExpired: event.target.checked }))}
                style={{ marginRight: "0.5rem" }}
              />
              包含已过期热点
            </span>
          </label>

          <div className="twitter-task-list" style={{ marginTop: "1rem" }}>
            {loading ? (
              <p className="muted">正在加载热点...</p>
            ) : hotspots.length ? (
              hotspots.map((hotspot) => (
                <button
                  key={hotspot.id}
                  className={`twitter-task-card ${selectedHotspotId === hotspot.id ? "twitter-task-card--active" : ""}`}
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", marginBottom: "0.75rem" }}
                  onClick={() =>
                    withAction(async () => {
                      setSelectedHotspotId(hotspot.id);
                      setSelectedHotspot(await getHotspot(hotspot.id));
                    })
                  }
                >
                  <div className="card-header">
                    <div className="stack stack--tight">
                      <strong>{hotspot.title}</strong>
                      <span className="muted">
                        {hotspot.sourceType} | 分数 {hotspot.score} | 来源 {hotspot.sourceCount}
                      </span>
                      <span className="muted">
                        最近命中：{formatDateTime(hotspot.lastSeenAt)} | 过期：{formatDateTime(hotspot.expiresAt)}
                      </span>
                    </div>
                    <div className="stack stack--tight" style={{ alignItems: "flex-end" }}>
                      <span className="mini-badge mini-badge--accent">{hotspot.priority}</span>
                      <StatusChip status={hotspot.status} />
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state">
                <p>当前没有符合筛选条件的热点</p>
              </div>
            )}
          </div>

          <section className="card" style={{ marginTop: "1rem", padding: "1rem" }}>
            {selectedHotspot ? (
              <div className="stack">
                <div className="card-header">
                  <div>
                    <h3>{selectedHotspot.title}</h3>
                    <p className="muted">
                      {selectedHotspot.sourceType} / {selectedHotspot.topicType} / score {selectedHotspot.score}
                    </p>
                  </div>
                  <div className="button-row">
                    <span className="mini-badge mini-badge--accent">{selectedHotspot.priority}</span>
                    <StatusChip status={selectedHotspot.status} />
                    <StatusChip status={selectedHotspot.researchStatus} />
                  </div>
                </div>

                <div className="grid grid--two">
                  <div className="stack stack--tight">
                    <strong>摘要</strong>
                    <p className="muted">{selectedHotspot.summaryText || "暂无摘要"}</p>
                  </div>
                  <div className="stack stack--tight">
                    <strong>命中信息</strong>
                    <span className="helper-text">Symbols：{selectedHotspot.symbols.join("，") || "无"}</span>
                    <span className="helper-text">关键词：{selectedHotspot.keywords.join("，") || "无"}</span>
                    <span className="helper-text">Watchlist：{selectedHotspot.matchedWatchlistValues.join("，") || "无"}</span>
                  </div>
                </div>

                <div className="button-row">
                  <button
                    className="button button--ghost"
                    disabled={pending}
                    onClick={() =>
                      withAction(async () => {
                        const hotspot = await runHotspotResearch(selectedHotspot.id);
                        setSelectedHotspot(hotspot);
                        await loadPage(hotspot.id, selectedWatchlistId);
                        setMessage("热点研究已刷新。");
                      })
                    }
                  >
                    {pending ? "处理中..." : "补研究"}
                  </button>
                  <button
                    className="button button--ghost"
                    disabled={pending}
                    onClick={() =>
                      withAction(async () => {
                        await updateHotspot(selectedHotspot.id, {
                          status: selectedHotspot.status === "ignored" ? "active" : "ignored"
                        });
                        await loadPage(selectedHotspot.id, selectedWatchlistId);
                        setMessage(selectedHotspot.status === "ignored" ? "热点已恢复。" : "热点已忽略。");
                      })
                    }
                  >
                    {selectedHotspot.status === "ignored" ? "恢复热点" : "忽略热点"}
                  </button>
                </div>

                <section className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <h4 style={{ margin: 0 }}>热点研究</h4>
                    {selectedHotspot.latestResearchRun ? (
                      <>
                        <p className="muted">{selectedHotspot.latestResearchRun.summary}</p>
                        <p className="helper-text">为什么现在：{selectedHotspot.latestResearchRun.whyNow || "未给出"}</p>
                        <p className="helper-text">推荐动作：{selectedHotspot.latestResearchRun.recommendedAction}</p>
                        <p className="helper-text">角度：{selectedHotspot.latestResearchRun.angles.join("；") || "无"}</p>
                        <p className="helper-text">风险：{selectedHotspot.latestResearchRun.risks.join("；") || "无"}</p>
                        <p className="helper-text">运营提示：{selectedHotspot.latestResearchRun.operatorHints.join("；") || "无"}</p>
                      </>
                    ) : (
                      <p className="muted">当前还没有研究结果。可以手动点击“补研究”。</p>
                    )}
                  </div>
                </section>

                <section className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <h4 style={{ margin: 0 }}>转任务</h4>
                    <p className="muted">把当前热点快照写入 X 任务链，随后由 MainAgent 接管写作、审核和发布。</p>
                  </div>

                  <label className="field">
                    <span>账号</span>
                    <select value={taskForm.accountId} onChange={(event) => setTaskForm((current) => ({ ...current, accountId: event.target.value }))}>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name || `@${account.handle}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>偏好模式</span>
                    <select
                      value={taskForm.preferredMode}
                      onChange={(event) =>
                        setTaskForm((current) => ({ ...current, preferredMode: event.target.value as TaskBridgeForm["preferredMode"] }))
                      }
                    >
                      <option value="auto">自动判断</option>
                      <option value="single">单帖</option>
                      <option value="thread">线程</option>
                    </select>
                  </label>

                  <label className="field" style={{ marginBottom: 0 }}>
                    <span>
                      <input
                        type="checkbox"
                        checked={taskForm.forceResearch}
                        onChange={(event) => setTaskForm((current) => ({ ...current, forceResearch: event.target.checked }))}
                        style={{ marginRight: "0.5rem" }}
                      />
                      转任务后强制刷新账号 research
                    </span>
                  </label>

                  <div className="button-row" style={{ marginTop: "1rem" }}>
                    <button
                      className="button"
                      disabled={pending || !taskForm.accountId}
                      onClick={() =>
                        withAction(async () => {
                          const result = await createTaskFromHotspot(selectedHotspot.id, taskForm);
                          await loadPage(selectedHotspot.id, selectedWatchlistId);
                          setMessage(`已从热点创建任务《${result.task.title}》。`);
                        })
                      }
                    >
                      {pending ? "创建中..." : "创建任务"}
                    </button>
                  </div>
                </section>

                <section className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <h4 style={{ margin: 0 }}>原始来源</h4>
                    {selectedHotspot.sources.length ? (
                      selectedHotspot.sources.map((source) => (
                        <div key={source.id} className="card" style={{ padding: "0.85rem" }}>
                          <strong>{source.title}</strong>
                          <p className="muted" style={{ marginTop: "0.5rem" }}>
                            {source.summaryText}
                          </p>
                          <p className="helper-text">
                            {source.sourceLabel} | {formatDateTime(source.detectedAt)} | 分值贡献 {source.scoreDelta}
                          </p>
                          {source.sourceUrl ? (
                            <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="button button--ghost button--small">
                              打开原文
                            </a>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="muted">当前没有来源明细。</p>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <div className="empty-state">
                <p>请选择上面的热点查看详情。</p>
              </div>
            )}
          </section>
        </article>

        <article className="card">
          <div className="stack">
            <div className="card-header">
              <div>
                <h3>监控的 X/Twitter 账号</h3>
                <p className="muted">热点链的高频入口保留在这里，只做 `x_account` 的增删启停；完整 watchlist 规则请去独立配置页。</p>
              </div>
              <Link href="/hotspots/watchlists" className="button button--ghost button--small">
                完整配置
              </Link>
            </div>

            {selectedWatchlist ? (
              <>
                <div className="grid grid--two">
                  <MetricCard label="监控账号" value={String(monitoredAccounts.length)} />
                  <MetricCard label="启用中" value={String(activeMonitorCount)} />
                </div>

                <div className="card" style={{ padding: "1rem" }}>
                  <p className="helper-text" style={{ marginBottom: "0.35rem" }}>
                    当前 watchlist
                  </p>
                  <strong>{selectedWatchlist.name}</strong>
                  <p className="helper-text" style={{ marginTop: "0.5rem" }}>
                    其他规则 {otherRuleCount} 条，完整规则总数 {selectedWatchlist.items.length} 条
                  </p>
                </div>

                {watchlists.length > 1 ? (
                  <label className="field">
                    <span>切换 watchlist</span>
                    <select value={selectedWatchlistId ?? ""} onChange={(event) => setSelectedWatchlistId(Number(event.target.value))}>
                      {watchlists.map((watchlist) => (
                        <option key={watchlist.id} value={watchlist.id}>
                          {watchlist.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <section className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <h4 style={{ margin: 0 }}>添加监控账号</h4>
                    <p className="muted">支持 `@handle`、`x.com/handle` 或完整链接，内部统一保存成 `https://x.com/&lt;handle&gt;`。</p>
                  </div>

                  <label className="field">
                    <span>账号</span>
                    <input
                      value={monitorForm.value}
                      onChange={(event) => setMonitorForm((current) => ({ ...current, value: event.target.value }))}
                      placeholder="@lookonchain / https://x.com/lookonchain"
                    />
                  </label>

                  <p className="helper-text">填账号主页即可，不需要填单条推文链接。</p>

                  <label className="field">
                    <span>显示标签</span>
                    <input
                      value={monitorForm.label}
                      onChange={(event) => setMonitorForm((current) => ({ ...current, label: event.target.value }))}
                      placeholder="可留空，默认显示为 @handle"
                    />
                  </label>

                  <label className="field">
                    <span>优先级</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={monitorForm.priority}
                      onChange={(event) => setMonitorForm((current) => ({ ...current, priority: Number(event.target.value || 80) }))}
                    />
                  </label>

                  <label className="field">
                    <span>备注</span>
                    <textarea
                      rows={3}
                      value={monitorForm.notes}
                      onChange={(event) => setMonitorForm((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>

                  <label className="field" style={{ marginBottom: 0 }}>
                    <span>
                      <input
                        type="checkbox"
                        checked={monitorForm.enabled}
                        onChange={(event) => setMonitorForm((current) => ({ ...current, enabled: event.target.checked }))}
                        style={{ marginRight: "0.5rem" }}
                      />
                      新增后立即启用
                    </span>
                  </label>

                  <div className="button-row" style={{ marginTop: "1rem" }}>
                    <button
                      className="button"
                      disabled={pending || !normalizeTwitterAccountValue(monitorForm.value)}
                      onClick={() =>
                        withAction(async () => {
                          const normalizedValue = normalizeTwitterAccountValue(monitorForm.value);
                          const normalizedLabel = monitorForm.label.trim() || getDefaultTwitterAccountLabel(normalizedValue);
                          await createHotspotWatchlistItem(selectedWatchlist.id, {
                            type: "x_account",
                            value: normalizedValue,
                            label: normalizedLabel,
                            enabled: monitorForm.enabled,
                            priority: monitorForm.priority,
                            notes: monitorForm.notes.trim()
                          });
                          setMonitorForm(DEFAULT_MONITOR_FORM);
                          await loadPage(selectedHotspotId, selectedWatchlist.id);
                          setMessage(`监控账号 ${normalizedLabel} 已加入。`);
                        })
                      }
                    >
                      {pending ? "保存中..." : "添加账号"}
                    </button>
                  </div>
                </section>

                <section className="card" style={{ padding: "1rem" }}>
                  <div className="stack stack--tight">
                    <h4 style={{ margin: 0 }}>当前监控列表</h4>
                    <p className="muted">这里只展示 `x_account`，适合日常加减监控对象。</p>
                  </div>

                  {monitoredAccounts.length ? (
                    <div className="twitter-monitor-list">
                      {monitoredAccounts.map((item) => (
                        <MonitorAccountRow
                          key={item.id}
                          item={item}
                          pending={pending}
                          onToggle={() =>
                            withAction(async () => {
                              await updateHotspotWatchlistItem(selectedWatchlist.id, item.id, { enabled: !item.enabled });
                              await loadPage(selectedHotspotId, selectedWatchlist.id);
                            })
                          }
                          onDelete={() =>
                            withAction(async () => {
                              await deleteHotspotWatchlistItem(selectedWatchlist.id, item.id);
                              await loadPage(selectedHotspotId, selectedWatchlist.id);
                              setMessage(`监控账号 ${formatTwitterAccountHandle(item.value)} 已删除。`);
                            })
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <p>当前还没有监控账号。</p>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="empty-state">
                <p>没有可用的 watchlist，请先在完整配置页创建。</p>
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: "1rem" }}>
      <div className="helper-text">{label}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function pickHotspotId(hotspots: Hotspot[], preferredHotspotId?: number | null) {
  if (preferredHotspotId && hotspots.some((hotspot) => hotspot.id === preferredHotspotId)) {
    return preferredHotspotId;
  }

  return hotspots[0]?.id ?? null;
}

function pickWatchlistId(watchlists: HotspotWatchlist[], preferredWatchlistId?: number | null) {
  if (preferredWatchlistId && watchlists.some((watchlist) => watchlist.id === preferredWatchlistId)) {
    return preferredWatchlistId;
  }

  return watchlists[0]?.id ?? null;
}

function MonitorAccountRow({
  item,
  pending,
  onToggle,
  onDelete
}: {
  item: HotspotWatchlistItem;
  pending: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const handle = formatTwitterAccountHandle(item.value);
  const profileUrl = buildTwitterProfileUrl(item.value);

  return (
    <div className="twitter-monitor-row">
      <div className="card-header">
        <div className="stack stack--tight">
          <a href={profileUrl} target="_blank" rel="noreferrer" className="twitter-monitor-handle">
            {handle}
          </a>
          {item.label && item.label !== handle ? <span className="helper-text">{item.label}</span> : null}
          <span className="helper-text">优先级 {item.priority}</span>
          {item.notes ? <span className="helper-text">{item.notes}</span> : null}
        </div>
        <StatusChip status={item.enabled ? "active" : "paused"} />
      </div>

      <div className="button-row" style={{ marginTop: "0.75rem" }}>
        <button className="button button--ghost button--small" disabled={pending} onClick={onToggle}>
          {item.enabled ? "停用" : "启用"}
        </button>
        <button className="button button--ghost button--small" disabled={pending} onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "未记录";
  }

  return new Date(value).toLocaleString("zh-CN");
}
