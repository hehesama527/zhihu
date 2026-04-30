"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { StatusChip } from "../status-chip";
import {
  createHotspotWatchlist,
  createHotspotWatchlistItem,
  deleteHotspotWatchlist,
  deleteHotspotWatchlistItem,
  getHotspotWatchlists,
  updateHotspotWatchlist,
  updateHotspotWatchlistItem,
  type HotspotWatchlist,
  type HotspotWatchlistItem,
  type HotspotWatchlistItemType
} from "../../lib/hotspots/api";
import {
  buildTwitterProfileUrl,
  formatTwitterAccountHandle,
  getDefaultTwitterAccountLabel,
  normalizeTwitterAccountValue
} from "../../lib/twitter/x-account";

type WatchlistForm = {
  name: string;
  description: string;
  enabled: boolean;
};

type WatchlistItemForm = {
  type: HotspotWatchlistItemType;
  value: string;
  label: string;
  enabled: boolean;
  priority: number;
  notes: string;
};

const DEFAULT_WATCHLIST_FORM: WatchlistForm = {
  name: "",
  description: "",
  enabled: true
};

const DEFAULT_ITEM_FORM: WatchlistItemForm = {
  type: "keyword",
  value: "",
  label: "",
  enabled: true,
  priority: 60,
  notes: ""
};

export function WatchlistCenter() {
  const [watchlists, setWatchlists] = useState<HotspotWatchlist[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<number | null>(null);
  const [watchlistForm, setWatchlistForm] = useState<WatchlistForm>(DEFAULT_WATCHLIST_FORM);
  const [itemForm, setItemForm] = useState<WatchlistItemForm>(DEFAULT_ITEM_FORM);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const selectedWatchlist = watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? null;

  useEffect(() => {
    void loadWatchlists();
  }, []);

  useEffect(() => {
    if (!selectedWatchlist) {
      setWatchlistForm(DEFAULT_WATCHLIST_FORM);
      return;
    }

    setWatchlistForm({
      name: selectedWatchlist.name,
      description: selectedWatchlist.description,
      enabled: selectedWatchlist.enabled
    });
  }, [selectedWatchlist?.id, selectedWatchlist?.name, selectedWatchlist?.description, selectedWatchlist?.enabled]);

  async function loadWatchlists(preferredWatchlistId?: number | null) {
    setLoading(true);
    try {
      const nextWatchlists = await getHotspotWatchlists();
      setWatchlists(nextWatchlists);
      const nextSelectedId = pickWatchlistId(nextWatchlists, preferredWatchlistId ?? selectedWatchlistId);
      setSelectedWatchlistId(nextSelectedId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载监控配置失败。");
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
        setMessage(error instanceof Error ? error.message : "watchlist 操作失败。");
      }
    });
  }

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>监控配置</h2>
          <p className="muted">
            watchlist 是热点中心的配置层。关键词、币种、来源和 `x_account` 都在这里统一维护，热点扫描与研究链会按这份规则持续运行。
          </p>
        </div>

        <div className="button-row">
          <Link href="/hotspots" className="button button--ghost">
            返回热点池
          </Link>
          <Link href="/twitter" className="button button--ghost">
            返回 X 工作台
          </Link>
          <button className="button button--ghost" disabled={pending} onClick={() => void loadWatchlists(selectedWatchlistId)}>
            {pending ? "刷新中..." : "刷新"}
          </button>
        </div>
      </section>

      {message ? (
        <div className="card">
          <p className="helper-text">{message}</p>
        </div>
      ) : null}

      <div className="grid grid--two">
        <article className="card">
          <div className="stack stack--tight">
            <h3>新建 Watchlist</h3>
            <p className="muted">通常只需要 1 个全局 watchlist，也支持按主题再拆分。</p>
          </div>

          <label className="field">
            <span>名称</span>
            <input value={watchlistForm.name} onChange={(event) => setWatchlistForm((current) => ({ ...current, name: event.target.value }))} />
          </label>

          <label className="field">
            <span>描述</span>
            <textarea value={watchlistForm.description} onChange={(event) => setWatchlistForm((current) => ({ ...current, description: event.target.value }))} rows={3} />
          </label>

          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={watchlistForm.enabled}
                onChange={(event) => setWatchlistForm((current) => ({ ...current, enabled: event.target.checked }))}
                style={{ marginRight: "0.5rem" }}
              />
              启用
            </span>
          </label>

          <div className="button-row">
            <button
              className="button"
              disabled={pending || !watchlistForm.name.trim()}
              onClick={() =>
                withAction(async () => {
                  if (selectedWatchlist) {
                    const watchlist = await updateHotspotWatchlist(selectedWatchlist.id, watchlistForm);
                    await loadWatchlists(watchlist.id);
                    setMessage("watchlist 已保存。");
                    return;
                  }

                  const watchlist = await createHotspotWatchlist(watchlistForm);
                  setWatchlistForm(DEFAULT_WATCHLIST_FORM);
                  await loadWatchlists(watchlist.id);
                  setMessage("watchlist 已创建。");
                })
              }
            >
              {pending ? "处理中..." : selectedWatchlist ? "保存当前 Watchlist" : "创建 Watchlist"}
            </button>
            {selectedWatchlist ? (
              <button
                className="button button--ghost"
                disabled={pending}
                onClick={() =>
                  withAction(async () => {
                    await deleteHotspotWatchlist(selectedWatchlist.id);
                    await loadWatchlists(null);
                    setMessage("watchlist 已删除。");
                  })
                }
              >
                删除当前 Watchlist
              </button>
            ) : null}
          </div>

          <div className="twitter-task-list" style={{ marginTop: "1rem" }}>
            {loading ? (
              <p className="muted">正在加载 watchlists...</p>
            ) : watchlists.length ? (
              watchlists.map((watchlist) => (
                <button
                  key={watchlist.id}
                  className={`twitter-task-card ${selectedWatchlistId === watchlist.id ? "twitter-task-card--active" : ""}`}
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", marginBottom: "0.75rem" }}
                  onClick={() => setSelectedWatchlistId(watchlist.id)}
                >
                  <div className="card-header">
                    <div className="stack stack--tight">
                      <strong>{watchlist.name}</strong>
                      <span className="muted">{watchlist.description || "暂无描述"}</span>
                      <span className="helper-text">{watchlist.items.length} 个监控项</span>
                    </div>
                    <StatusChip status={watchlist.enabled ? "active" : "paused"} />
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state">
                <p>当前还没有 watchlist</p>
              </div>
            )}
          </div>
        </article>

        <article className="card">
          {selectedWatchlist ? (
            <div className="stack">
              <div className="card-header">
                <div>
                  <h3>{selectedWatchlist.name}</h3>
                  <p className="muted">{selectedWatchlist.description || "暂无描述"}</p>
                </div>
                <StatusChip status={selectedWatchlist.enabled ? "active" : "paused"} />
              </div>

              <section className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <h4 style={{ margin: 0 }}>新增监控项</h4>
                  <p className="muted">`symbol`、`keyword`、`source` 会直接参与扫描加权；`x_account` 会复用已登录浏览器会话抓取最近时间线。</p>
                </div>

                <label className="field">
                  <span>类型</span>
                  <select value={itemForm.type} onChange={(event) => setItemForm((current) => ({ ...current, type: event.target.value as WatchlistItemForm["type"] }))}>
                    <option value="keyword">keyword</option>
                    <option value="symbol">symbol</option>
                    <option value="source">source</option>
                    <option value="x_account">x_account</option>
                  </select>
                </label>

                <label className="field">
                  <span>值</span>
                  <input
                    value={itemForm.value}
                    onChange={(event) => setItemForm((current) => ({ ...current, value: event.target.value }))}
                    placeholder={itemForm.type === "x_account" ? "@lookonchain / https://x.com/lookonchain" : "例如 BTC / 巨鲸 / BlockBeats"}
                  />
                </label>

                {itemForm.type === "x_account" ? <p className="helper-text">`x_account` 填账号主页即可，内部会统一保存成 `https://x.com/&lt;handle&gt;`。</p> : null}

                <label className="field">
                  <span>标签</span>
                  <input
                    value={itemForm.label}
                    onChange={(event) => setItemForm((current) => ({ ...current, label: event.target.value }))}
                    placeholder={itemForm.type === "x_account" ? "可留空，默认显示为 @handle" : "可留空，默认等于值"}
                  />
                </label>

                <label className="field">
                  <span>优先级</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={itemForm.priority}
                    onChange={(event) => setItemForm((current) => ({ ...current, priority: Number(event.target.value || 60) }))}
                  />
                </label>

                <label className="field">
                  <span>备注</span>
                  <textarea value={itemForm.notes} onChange={(event) => setItemForm((current) => ({ ...current, notes: event.target.value }))} rows={3} />
                </label>

                <label className="field" style={{ marginBottom: 0 }}>
                  <span>
                    <input
                      type="checkbox"
                      checked={itemForm.enabled}
                      onChange={(event) => setItemForm((current) => ({ ...current, enabled: event.target.checked }))}
                      style={{ marginRight: "0.5rem" }}
                    />
                    启用
                  </span>
                </label>

                <div className="button-row" style={{ marginTop: "1rem" }}>
                  <button
                    className="button"
                    disabled={pending || !getNormalizedWatchlistItemValue(itemForm)}
                    onClick={() =>
                      withAction(async () => {
                        const normalizedItem = normalizeWatchlistItemForm(itemForm);
                        await createHotspotWatchlistItem(selectedWatchlist.id, normalizedItem);
                        setItemForm(DEFAULT_ITEM_FORM);
                        await loadWatchlists(selectedWatchlist.id);
                        setMessage(
                          normalizedItem.type === "x_account"
                            ? `监控账号 ${normalizedItem.label || formatTwitterAccountHandle(normalizedItem.value)} 已加入 watchlist。`
                            : "监控项已加入 watchlist。"
                        );
                      })
                    }
                  >
                    {pending ? "保存中..." : "添加监控项"}
                  </button>
                </div>
              </section>

              <section className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <h4 style={{ margin: 0 }}>监控项列表</h4>
                  {selectedWatchlist.items.length ? (
                    selectedWatchlist.items.map((item) => (
                      <WatchlistItemRow
                        key={item.id}
                        item={item}
                        pending={pending}
                        onToggle={() =>
                          withAction(async () => {
                            await updateHotspotWatchlistItem(selectedWatchlist.id, item.id, { enabled: !item.enabled });
                            await loadWatchlists(selectedWatchlist.id);
                          })
                        }
                        onDelete={() =>
                          withAction(async () => {
                            await deleteHotspotWatchlistItem(selectedWatchlist.id, item.id);
                            await loadWatchlists(selectedWatchlist.id);
                          })
                        }
                      />
                    ))
                  ) : (
                    <p className="muted">这个 watchlist 还没有监控项。</p>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="empty-state">
              <p>请选择一个 watchlist 查看详情。</p>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function WatchlistItemRow({
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
  const isXAccount = item.type === "x_account";
  const primaryText = isXAccount ? formatTwitterAccountHandle(item.value) : item.label || item.value;
  const secondaryText = isXAccount ? buildTwitterProfileUrl(item.value) : item.value;

  return (
    <div className="card" style={{ padding: "0.9rem" }}>
      <div className="card-header">
        <div className="stack stack--tight">
          {isXAccount ? (
            <a href={secondaryText} target="_blank" rel="noreferrer" className="twitter-monitor-handle">
              {primaryText}
            </a>
          ) : (
            <strong>{primaryText}</strong>
          )}
          {isXAccount && item.label && item.label !== primaryText ? <span className="helper-text">{item.label}</span> : null}
          <span className="muted">
            {item.type} | value={secondaryText} | priority={item.priority}
          </span>
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

function pickWatchlistId(watchlists: HotspotWatchlist[], preferredId?: number | null) {
  if (preferredId && watchlists.some((watchlist) => watchlist.id === preferredId)) {
    return preferredId;
  }

  return watchlists[0]?.id ?? null;
}

function getNormalizedWatchlistItemValue(itemForm: WatchlistItemForm) {
  if (itemForm.type !== "x_account") {
    return itemForm.value.trim();
  }

  return normalizeTwitterAccountValue(itemForm.value);
}

function normalizeWatchlistItemForm(itemForm: WatchlistItemForm): WatchlistItemForm {
  const normalizedValue = getNormalizedWatchlistItemValue(itemForm);
  const normalizedLabel =
    itemForm.type === "x_account"
      ? itemForm.label.trim() || getDefaultTwitterAccountLabel(normalizedValue)
      : itemForm.label.trim();

  return {
    ...itemForm,
    value: normalizedValue,
    label: normalizedLabel,
    notes: itemForm.notes.trim()
  };
}
