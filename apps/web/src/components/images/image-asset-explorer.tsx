"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { ImageAssetCandidate } from "@zhihu-mvp/shared";
import { getImageAssets } from "../../lib/api";
import { StatusChip } from "../status-chip";
import { extractTagLabels } from "./image-asset-form-utils";

type FilterState = {
  query: string;
  anchorKeyword: string;
  entity: string;
  platformScope: string;
  assetType: string;
  hasText: string;
  aspectRatio: string;
  riskLevel: string;
  status: string;
};

type ExplorerPreset = "search" | "library";

type SelectOption = {
  label: string;
  value: string;
};

const DEFAULT_FILTERS: FilterState = {
  query: "",
  anchorKeyword: "",
  entity: "",
  platformScope: "all",
  assetType: "all",
  hasText: "all",
  aspectRatio: "all",
  riskLevel: "all",
  status: "active"
};

const LIBRARY_FILTERS: FilterState = {
  ...DEFAULT_FILTERS,
  status: "active"
};

const SEARCH_STATUS_OPTIONS: SelectOption[] = [
  { label: "已启用", value: "active" },
  { label: "待审核", value: "pending_review" },
  { label: "已停用", value: "disabled" },
  { label: "已拒绝", value: "rejected" },
  { label: "全部", value: "all" }
];

const LIBRARY_STATUS_OPTIONS: SelectOption[] = [
  { label: "已启用", value: "active" },
  { label: "已停用", value: "disabled" },
  { label: "已拒绝", value: "rejected" },
  { label: "全部", value: "all" }
];

const PRESET_CONFIG: Record<
  ExplorerPreset,
  {
    title: string;
    description: string;
    filters: FilterState;
    emptyText: string;
  }
> = {
  search: {
    title: "图片搜索",
    description: "按关键词、OCR、标签和平台范围找图。搜索结果默认只展示已启用图片。",
    filters: DEFAULT_FILTERS,
    emptyText: "当前没有命中结果。可以先去导入页导入测试图片，再回来搜索。"
  },
  library: {
    title: "已入库",
    description: "这里默认只展示已启用图片。待人工确认的内容统一放在待审核页处理，不混在库视图里。",
    filters: LIBRARY_FILTERS,
    emptyText: "当前还没有已启用的入库图片。可以先去导入页导入测试图片。"
  }
};

export function ImageAssetExplorer({ preset = "search" }: { preset?: ExplorerPreset }) {
  const config = PRESET_CONFIG[preset];
  const [filters, setFilters] = useState<FilterState>(config.filters);
  const [items, setItems] = useState<ImageAssetCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void hydrate(config.filters);
    setFilters(config.filters);
  }, [preset]);

  function withAction(action: () => Promise<void>) {
    startTransition(() => {
      void (async () => {
        try {
          setMessage("");
          await action();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "配图中心加载失败。");
        }
      })();
    });
  }

  async function hydrate(nextFilters = filters) {
    const responseItems = await getImageAssets({
      ...nextFilters,
      limit: 5000
    });
    setItems(filterPresetItems(responseItems, preset));
  }

  const statusOptions = preset === "library" ? LIBRARY_STATUS_OPTIONS : SEARCH_STATUS_OPTIONS;

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>{config.title}</h2>
          <p className="muted">{config.description}</p>
        </div>

        <div className="button-row">
          {preset === "search" ? (
            <Link href="/images/library" className="button button--ghost">
              去已入库
            </Link>
          ) : (
            <Link href="/images" className="button button--ghost">
              去搜索
            </Link>
          )}
          <Link href="/images/import" className="button button--ghost">
            去导入
          </Link>
          <Link href="/images/review" className="button button--ghost">
            去待审核
          </Link>
        </div>
      </section>

      <section className="grid grid--three">
        <article className="card">
          <p className="muted">当前结果</p>
          <div className="metric-value">{items.length}</div>
        </article>
        <article className="card">
          <p className="muted">含字图片</p>
          <div className="metric-value">{items.filter((item) => item.asset.hasText).length}</div>
        </article>
        <article className="card">
          <p className="muted">已生成自动描述</p>
          <div className="metric-value">
            {items.filter((item) => Boolean(item.asset.captionShort ?? item.asset.autoCaption)).length}
          </div>
        </article>
      </section>

      <section className="card">
        <div className="image-filter-grid">
          <label className="field">
            <span>搜索词</span>
            <input
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="例如：害怕、三连、学习、天气"
            />
          </label>

          <label className="field">
            <span>主关键词</span>
            <input
              value={filters.anchorKeyword}
              onChange={(event) => setFilters((current) => ({ ...current, anchorKeyword: event.target.value }))}
              placeholder="例如：奥特曼、熊猫人、暴跌"
            />
          </label>

          <label className="field">
            <span>实体 / IP</span>
            <input
              value={filters.entity}
              onChange={(event) => setFilters((current) => ({ ...current, entity: event.target.value }))}
              placeholder="例如：米老鼠、金馆长"
            />
          </label>

          <label className="field">
            <span>平台</span>
            <select
              value={filters.platformScope}
              onChange={(event) => setFilters((current) => ({ ...current, platformScope: event.target.value }))}
            >
              <option value="all">全部</option>
              <option value="zhihu">知乎</option>
              <option value="x">X</option>
              <option value="both">通用</option>
              <option value="unknown">未标注</option>
            </select>
          </label>

          <label className="field">
            <span>类型</span>
            <select
              value={filters.assetType}
              onChange={(event) => setFilters((current) => ({ ...current, assetType: event.target.value }))}
            >
              <option value="all">全部</option>
              <option value="meme">表情包</option>
              <option value="illustration">场景图</option>
              <option value="cover">封面图</option>
              <option value="screenshot">截图</option>
              <option value="other">其他</option>
            </select>
          </label>

          <label className="field">
            <span>含字</span>
            <select
              value={filters.hasText}
              onChange={(event) => setFilters((current) => ({ ...current, hasText: event.target.value }))}
            >
              <option value="all">全部</option>
              <option value="yes">是</option>
              <option value="no">否</option>
            </select>
          </label>

          <label className="field">
            <span>版式</span>
            <select
              value={filters.aspectRatio}
              onChange={(event) => setFilters((current) => ({ ...current, aspectRatio: event.target.value }))}
            >
              <option value="all">全部</option>
              <option value="landscape">横版</option>
              <option value="portrait">竖版</option>
              <option value="square">方图</option>
            </select>
          </label>

          <label className="field">
            <span>风险</span>
            <select
              value={filters.riskLevel}
              onChange={(event) => setFilters((current) => ({ ...current, riskLevel: event.target.value }))}
            >
              <option value="all">全部</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="unknown">未标注</option>
            </select>
          </label>

          <label className="field">
            <span>状态</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="button-row">
          <button className="button" disabled={pending} onClick={() => withAction(() => hydrate())}>
            {pending ? "搜索中..." : "执行搜索"}
          </button>
          <button
            className="button button--ghost"
            disabled={pending}
            onClick={() =>
              withAction(async () => {
                setFilters(config.filters);
                await hydrate(config.filters);
              })
            }
          >
            重置
          </button>
        </div>

        {message ? <p className="helper-text">{message}</p> : null}
      </section>

      <section className="image-gallery">
        {items.length ? (
          items.map((item) => (
            <article key={item.asset.id} className="card image-card">
              <Link href={`/images/${item.asset.id}`} className="image-card__thumb">
                {item.asset.thumbnailUrl ? (
                  <img src={item.asset.thumbnailUrl} alt={item.asset.fileName} />
                ) : (
                  <div className="empty-state">暂无缩略图</div>
                )}
              </Link>

              <div className="stack stack--tight">
                <div className="card-header">
                  <strong>{item.asset.fileName}</strong>
                  <StatusChip status={item.asset.status} />
                </div>

                <div className="inline-row">
                  <span className="mini-badge">{formatAssetType(item.asset.assetType)}</span>
                  <span className="mini-badge">{formatPlatformScope(item.asset.platformScope)}</span>
                  {item.asset.anchorKeyword ? <span className="mini-badge">锚点 {item.asset.anchorKeyword}</span> : null}
                  <span className="mini-badge">命中分 {item.score.toFixed(1)}</span>
                </div>

                <p className="muted">{item.asset.manualCaption ?? item.asset.captionShort ?? item.asset.autoCaption ?? "暂无描述"}</p>
                <p className="helper-text">长描述：{trimText(item.asset.captionLong, 56)}</p>
                <p className="helper-text">OCR：{trimText(item.asset.ocrText)}</p>
                <p className="helper-text">路径：{item.asset.sourcePath ?? "未记录"}</p>
                <p className="helper-text">命中原因：{item.hitReasons.length ? item.hitReasons.join(" / ") : "无"}</p>

                <div className="image-tag-list">
                  {[
                    ...extractTagLabels(item.asset.entityTags),
                    ...extractTagLabels(item.asset.topicTags),
                    ...extractTagLabels(item.asset.emotionTags),
                    ...extractTagLabels(item.asset.sceneTags)
                  ]
                    .slice(0, 8)
                    .map((tag, index) => (
                      <span key={`${item.asset.id}-${tag}-${index}`} className="mini-badge">
                        {tag}
                      </span>
                    ))}
                </div>

                <div className="button-row">
                  <Link href={`/images/${item.asset.id}`} className="button button--ghost button--small">
                    查看详情
                  </Link>
                  {item.asset.status === "pending_review" ? (
                    <Link href={`/images/review?assetId=${item.asset.id}`} className="button button--ghost button--small">
                      去审核
                    </Link>
                  ) : null}
                  <a href={item.asset.storageUrl} className="button button--ghost button--small" target="_blank" rel="noreferrer">
                    原图
                  </a>
                </div>
              </div>
            </article>
          ))
        ) : (
          <article className="card">
            <p className="muted">{config.emptyText}</p>
          </article>
        )}
      </section>
    </div>
  );
}

function filterPresetItems(items: ImageAssetCandidate[], preset: ExplorerPreset) {
  if (preset !== "library") {
    return items;
  }

  return items.filter((item) => item.asset.status !== "pending_review");
}

function formatAssetType(value: string) {
  const map: Record<string, string> = {
    meme: "表情包",
    illustration: "场景图",
    cover: "封面图",
    screenshot: "截图",
    other: "其他"
  };
  return map[value] ?? value;
}

function formatPlatformScope(value: string) {
  const map: Record<string, string> = {
    zhihu: "知乎",
    x: "X",
    both: "通用",
    unknown: "未标注"
  };
  return map[value] ?? value;
}

function trimText(value: string | null, max = 42) {
  if (!value) {
    return "无";
  }

  return value.length > max ? `${value.slice(0, max)}...` : value;
}
