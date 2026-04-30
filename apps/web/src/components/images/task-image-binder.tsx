"use client";

import { useEffect, useState, useTransition } from "react";
import type { ImageAssetCandidate, ImageAssetDetail } from "@zhihu-mvp/shared";
import { getImageAsset, suggestImageAssets } from "../../lib/api";
import { StatusChip } from "../status-chip";

type TaskImageBinderProps = {
  platform: "zhihu" | "x";
  title: string;
  taskLabel: string;
  initialAssetId: string | null;
  onBind: (assetId: string | null) => Promise<string | null | void>;
};

export function TaskImageBinder({ platform, title, taskLabel, initialAssetId, onBind }: TaskImageBinderProps) {
  const [assetId, setAssetId] = useState<string | null>(initialAssetId);
  const [asset, setAsset] = useState<ImageAssetDetail | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ImageAssetCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setAssetId(initialAssetId);
  }, [initialAssetId]);

  useEffect(() => {
    void loadCurrentAsset(assetId);
  }, [assetId]);

  useEffect(() => {
    void hydrateSuggestions("");
  }, [platform]);

  function withAction(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        setMessage("");
        await action();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "任务配图操作失败。");
      }
    });
  }

  async function loadCurrentAsset(nextAssetId: string | null) {
    if (!nextAssetId) {
      setAsset(null);
      return;
    }

    setAsset(await getImageAsset(nextAssetId));
  }

  async function hydrateSuggestions(nextQuery: string) {
    setResults(
      await suggestImageAssets({
        query: nextQuery,
        platform,
        limit: 8
      })
    );
  }

  return (
    <article className="card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p className="muted">{taskLabel}</p>
        </div>
        {asset ? <StatusChip status={asset.status} /> : null}
      </div>

      {asset ? (
        <div className="image-usage-cell" style={{ marginTop: "1rem" }}>
          {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt={asset.fileName} /> : null}
          <div className="stack stack--tight">
            <strong>{asset.fileName}</strong>
            <span className="helper-text">{asset.manualCaption ?? asset.captionShort ?? asset.autoCaption ?? "暂无描述"}</span>
            <span className="helper-text">{asset.anchorKeyword ? `主关键词：${asset.anchorKeyword}` : "无主关键词"}</span>
            <span className="helper-text">{asset.sourcePath ?? "未记录来源路径"}</span>
          </div>
        </div>
      ) : (
        <p className="helper-text" style={{ marginTop: "1rem" }}>
          当前任务还没有绑定图片。
        </p>
      )}

      <div className="image-filter-grid" style={{ marginTop: "1rem" }}>
        <label className="field image-form-grid__full">
          <span>候选检索</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入关键词，例如：暴跌、吐槽、学习、天气"
          />
        </label>
      </div>

      <div className="button-row">
        <button className="button" disabled={pending} onClick={() => withAction(() => hydrateSuggestions(query))}>
          {pending ? "检索中..." : "刷新候选"}
        </button>
        <button
          className="button button--ghost"
          disabled={pending || !assetId}
          onClick={() =>
            withAction(async () => {
              const nextAssetId = (await onBind(null)) ?? null;
              setAssetId(nextAssetId);
              setMessage("已清空任务配图。");
            })
          }
        >
          清空绑定
        </button>
      </div>

      {message ? <p className="helper-text">{message}</p> : null}

      <div className="image-gallery" style={{ marginTop: "1rem" }}>
        {results.length ? (
          results.map((item) => (
            <div key={item.asset.id} className="card image-card">
              <div className="image-card__thumb">
                {item.asset.thumbnailUrl ? <img src={item.asset.thumbnailUrl} alt={item.asset.fileName} /> : null}
              </div>

              <div className="stack stack--tight">
                <strong>{item.asset.fileName}</strong>
                <span className="helper-text">
                  {item.asset.manualCaption ?? item.asset.captionShort ?? item.asset.autoCaption ?? "暂无描述"}
                </span>
                <span className="helper-text">{item.asset.anchorKeyword ? `主关键词：${item.asset.anchorKeyword}` : "无主关键词"}</span>
                <span className="helper-text">命中：{item.hitReasons.join(" / ") || "无"}</span>
                <div className="button-row">
                  <button
                    className="button button--ghost button--small"
                    disabled={pending}
                    onClick={() =>
                      withAction(async () => {
                        const nextAssetId = (await onBind(item.asset.id)) ?? item.asset.id;
                        setAssetId(nextAssetId);
                        setMessage(`已绑定图片：${item.asset.fileName}`);
                      })
                    }
                  >
                    绑定
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">当前没有候选结果。可以换一个关键词再试。</p>
          </div>
        )}
      </div>
    </article>
  );
}
