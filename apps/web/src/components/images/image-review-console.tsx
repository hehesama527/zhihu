"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ImageAssetCandidate, ImageAssetDetail, ImageAssetReanalyzeProgress } from "@zhihu-mvp/shared";
import {
  getImageAsset,
  getImageAssetReanalyzeProgress,
  getImageAssets,
  pauseImageAssetReanalyze,
  reanalyzeImageAsset,
  reanalyzeImageAssets,
  resumeImageAssetReanalyze,
  updateImageAsset
} from "../../lib/api";
import { StatusChip } from "../status-chip";
import {
  buildImageAssetEditorForm,
  buildImageAssetUpdatePayload,
  formatEmotionTagsDetailed,
  formatEntityTagsDetailed,
  formatImageAssetTags,
  formatWeightedTagsDetailed,
  type ImageAssetEditorFormState,
  updateImageAssetEditorForm
} from "./image-asset-form-utils";
import { ImageAnalysisSuggestionPanel } from "./image-analysis-suggestion-panel";

const REVIEW_LIST_LIMIT = 5000;
const PROGRESS_POLL_INTERVAL_MS = 1500;

export function ImageReviewConsole({ initialAssetId }: { initialAssetId?: string | null }) {
  const [items, setItems] = useState<ImageAssetCandidate[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(initialAssetId ?? null);
  const [asset, setAsset] = useState<ImageAssetDetail | null>(null);
  const [form, setForm] = useState<ImageAssetEditorFormState | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<ImageAssetReanalyzeProgress | null>(null);
  const [pending, startTransition] = useTransition();
  const lastProgressStatusRef = useRef<ImageAssetReanalyzeProgress["status"] | null>(null);

  useEffect(() => {
    void hydrate(initialAssetId ?? null);
  }, [initialAssetId]);

  useEffect(() => {
    void hydrateProgress();

    const timer = window.setInterval(() => {
      void hydrateProgress();
    }, PROGRESS_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [selectedAssetId]);

  useEffect(() => {
    if (!selectedAssetId) {
      setAsset(null);
      setForm(null);
      return;
    }

    void loadAsset(selectedAssetId);
  }, [selectedAssetId]);

  function withAction(action: () => Promise<void>) {
    startTransition(() => {
      void (async () => {
        try {
          setMessage("");
          await action();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "审核操作失败。");
        }
      })();
    });
  }

  async function hydrate(preferredAssetId: string | null) {
    const nextItems = await getImageAssets({
      status: "pending_review",
      limit: REVIEW_LIST_LIMIT
    });
    setItems(nextItems);

    const nextSelectedAssetId =
      preferredAssetId && nextItems.some((item) => item.asset.id === preferredAssetId)
        ? preferredAssetId
        : nextItems[0]?.asset.id ?? null;

    setSelectedAssetId(nextSelectedAssetId);
    if (!nextSelectedAssetId) {
      setAsset(null);
      setForm(null);
    }
  }

  async function hydrateProgress() {
    const nextProgress = await getImageAssetReanalyzeProgress();
    const previousStatus = lastProgressStatusRef.current;
    lastProgressStatusRef.current = nextProgress.status;
    setProgress(nextProgress);

    if (previousStatus && previousStatus !== "completed" && nextProgress.status === "completed") {
      await hydrate(selectedAssetId);
      if (selectedAssetId) {
        await loadAsset(selectedAssetId);
      }
    }
  }

  async function loadAsset(assetId: string) {
    const nextAsset = await getImageAsset(assetId);
    setAsset(nextAsset);
    setForm(nextAsset ? buildImageAssetEditorForm(nextAsset) : null);
  }

  async function clearPendingReviewItems() {
    if (!items.length) {
      setMessage("当前没有待审核图片。");
      return;
    }

    const confirmed = window.confirm(`确认清空当前 ${items.length} 张待审核图片吗？清空后会统一标记为已拒绝。`);
    if (!confirmed) {
      return;
    }

    for (const item of items) {
      await updateImageAsset(item.asset.id, {
        status: "rejected"
      });
    }

    setSelectedAssetId(null);
    setAsset(null);
    setForm(null);
    await hydrate(null);
    setMessage(`已清空 ${items.length} 张待审核图片。`);
  }

  async function rerunAllPendingReviewItems() {
    if (!items.length) {
      setMessage("当前没有可重跑的待审核图片。");
      return;
    }

    const confirmed = window.confirm(
      `确认重跑当前 ${items.length} 张待审核图片吗？系统会后台串行重跑，一次只处理一张图。`
    );
    if (!confirmed) {
      return;
    }

    const nextProgress = await reanalyzeImageAssets({
      status: "pending_review",
      limit: REVIEW_LIST_LIMIT
    });

    setProgress(nextProgress);
    lastProgressStatusRef.current = nextProgress.status;
    setMessage(
      nextProgress.requestedCount
        ? `已开始后台重跑，共 ${nextProgress.requestedCount} 张。页面会持续展示总进度和当前图片进度。`
        : "当前没有可重跑的待审核图片。"
    );
  }

  async function pauseRerunQueue() {
    const nextProgress = await pauseImageAssetReanalyze();
    setProgress(nextProgress);
    lastProgressStatusRef.current = nextProgress.status;
    setMessage(
      nextProgress.currentAsset && nextProgress.pauseRequested
        ? "已请求暂停。当前这张图处理完后，队列会停住。"
        : "已暂停全部重跑。"
    );
  }

  async function resumeRerunQueue() {
    const nextProgress = await resumeImageAssetReanalyze();
    setProgress(nextProgress);
    lastProgressStatusRef.current = nextProgress.status;
    setMessage("已继续后台重跑。");
  }

  const processedCount = (progress?.completedCount ?? 0) + (progress?.failedCount ?? 0);
  const overallProgressPercent = progress?.requestedCount
    ? Math.min(100, Math.round((processedCount / progress.requestedCount) * 100))
    : 0;
  const currentItemProgressPercent = progress?.queue.currentProgressPercent ?? 0;
  const currentItemStageLabel = progress?.queue.currentStageLabel ?? "等待开始";
  const currentItemProgressText =
    progress?.queue.totalSteps && progress.queue.currentStep
      ? `${progress.queue.currentStep} / ${progress.queue.totalSteps}`
      : "未开始";
  const hasActiveQueue = Boolean(
    progress && (progress.status === "running" || progress.status === "paused" || progress.queue.pendingCount > 0)
  );

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>待审核</h2>
          <p className="muted">这里只处理高风险、分析失败、自动跳过，或需要人工兜底确认的图片。</p>
        </div>
      </section>

      {message ? (
        <article className="card">
          <p className="helper-text">{message}</p>
        </article>
      ) : null}

      <article className="card">
        <div className="card-header">
          <div>
            <h3>重跑进度</h3>
            <p className="muted">
              {hasActiveQueue
                ? "这里同时展示整体进度，以及当前这张图片的阶段进度。"
                : "当前没有后台重跑任务。单张分析触发后，这里也会显示当前图片进度。"}
            </p>
          </div>

          <div className="button-row">
            {progress?.status === "running" ? (
              <button className="button button--ghost" disabled={pending} onClick={() => withAction(pauseRerunQueue)}>
                {pending ? "处理中..." : "暂停"}
              </button>
            ) : null}
            {progress?.status === "paused" ? (
              <button className="button button--ghost" disabled={pending} onClick={() => withAction(resumeRerunQueue)}>
                {pending ? "处理中..." : "继续"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid--three">
          <div className="card" style={{ padding: "1rem" }}>
            <p className="muted">当前状态</p>
            <div className="metric-value">{formatProgressStatus(progress)}</div>
            {progress?.pauseRequested && progress.status === "running" ? (
              <p className="helper-text">暂停已请求，当前图片完成后生效。</p>
            ) : null}
          </div>

          <div className="card" style={{ padding: "1rem" }}>
            <p className="muted">已完成 / 总数</p>
            <div className="metric-value">
              {processedCount} / {progress?.requestedCount ?? 0}
            </div>
            <p className="helper-text">
              成功 {progress?.completedCount ?? 0}，失败 {progress?.failedCount ?? 0}，剩余 {progress?.remainingCount ?? 0}
            </p>
          </div>

          <div className="card" style={{ padding: "1rem" }}>
            <p className="muted">分析队列</p>
            <div className="metric-value">{progress?.queue.pendingCount ?? 0}</div>
            <p className="helper-text">
              运行中 {progress?.queue.runningCount ?? 0}，排队中 {progress?.queue.queuedCount ?? 0}
            </p>
          </div>
        </div>

        <div className="grid grid--two" style={{ marginTop: "1rem" }}>
          <div className="card" style={{ padding: "1rem" }}>
            <p className="muted">总进度</p>
            <div
              aria-hidden="true"
              style={{
                width: "100%",
                height: "10px",
                borderRadius: "999px",
                background: "rgba(15, 23, 42, 0.08)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${overallProgressPercent}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #0f766e 0%, #14b8a6 100%)",
                  transition: "width 200ms ease"
                }}
              />
            </div>
            <p className="helper-text" style={{ marginTop: "0.5rem" }}>
              当前整体进度 {overallProgressPercent}%
            </p>
          </div>

          <div className="card" style={{ padding: "1rem" }}>
            <p className="muted">当前图片进度</p>
            <div
              aria-hidden="true"
              style={{
                width: "100%",
                height: "10px",
                borderRadius: "999px",
                background: "rgba(15, 23, 42, 0.08)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${currentItemProgressPercent}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #1d4ed8 0%, #38bdf8 100%)",
                  transition: "width 200ms ease"
                }}
              />
            </div>
            <p className="helper-text" style={{ marginTop: "0.5rem" }}>
              {currentItemStageLabel}，阶段进度 {currentItemProgressPercent}%（{currentItemProgressText}）
            </p>
          </div>
        </div>

        {progress?.currentAsset ? (
          <div className="card" style={{ marginTop: "1rem", padding: "1rem" }}>
            <div className="card-header">
              <div>
                <strong>当前正在跑</strong>
                <p className="muted">{progress.currentAsset.sourcePath ?? "未记录来源路径"}</p>
              </div>
              <div className="button-row">
                <StatusChip status={progress.currentAsset.analysisStatus} />
                <StatusChip status={progress.currentAsset.status} />
              </div>
            </div>

            <div className="inline-row" style={{ alignItems: "center", marginTop: "0.75rem" }}>
              {progress.currentAsset.thumbnailUrl ? (
                <img
                  src={progress.currentAsset.thumbnailUrl}
                  alt={progress.currentAsset.fileName}
                  style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "0.75rem" }}
                />
              ) : null}
              <div className="stack stack--tight">
                <strong>{progress.currentAsset.fileName}</strong>
                <span className="helper-text">
                  {progress.queue.currentStartedAt ? `开始于 ${new Date(progress.queue.currentStartedAt).toLocaleString("zh-CN")}` : "已进入处理"}
                </span>
                <span className="helper-text">{currentItemStageLabel}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="helper-text" style={{ marginTop: "1rem" }}>
            当前没有正在运行的图片。
          </p>
        )}
      </article>

      <section className="image-review-layout">
        <aside className="card image-review-list">
          <div className="card-header">
            <div>
              <h3>待审核图片</h3>
              <p className="muted">共 {items.length} 张</p>
            </div>
            <div className="button-row">
              <button
                className="button button--ghost"
                disabled={pending || !items.length}
                onClick={() => withAction(rerunAllPendingReviewItems)}
              >
                {pending ? "处理中..." : "全部重跑"}
              </button>
              <button
                className="button button--ghost"
                disabled={pending || !items.length || Boolean(progress && progress.status !== "idle" && progress.status !== "completed")}
                onClick={() => withAction(clearPendingReviewItems)}
              >
                {pending ? "处理中..." : "清空待审核"}
              </button>
            </div>
          </div>

          <div className="image-review-list__items">
            {items.length ? (
              items.map((item) => (
                <button
                  key={item.asset.id}
                  className={`image-review-list__item ${selectedAssetId === item.asset.id ? "image-review-list__item--active" : ""}`}
                  onClick={() => setSelectedAssetId(item.asset.id)}
                >
                  <div className="image-review-list__thumb">
                    {item.asset.thumbnailUrl ? <img src={item.asset.thumbnailUrl} alt={item.asset.fileName} /> : null}
                  </div>
                  <div className="stack stack--tight">
                    <strong>{item.asset.fileName}</strong>
                    <span className="helper-text">{item.asset.sourcePath ?? "未记录来源路径"}</span>
                    <span className="helper-text">
                      {item.asset.anchorKeyword ?? item.asset.captionShort ?? item.asset.autoCaption ?? item.asset.ocrText ?? "暂无自动信息"}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <p className="muted">当前没有待审核图片。</p>
            )}
          </div>
        </aside>

        <div className="stack">
          {asset && form ? (
            <>
              <article className="card">
                <div className="card-header">
                  <div>
                    <h3>{asset.fileName}</h3>
                    <p className="muted">{asset.sourcePath ?? "未记录来源路径"}</p>
                  </div>
                  <div className="button-row">
                    <StatusChip status={asset.analysisStatus} />
                    <StatusChip status={asset.status} />
                  </div>
                </div>

                <div className="image-review-preview">
                  {asset.storageUrl ? <img src={asset.storageUrl} alt={asset.fileName} /> : null}
                </div>

                <div className="grid grid--two" style={{ marginTop: "1rem" }}>
                  <div className="card" style={{ padding: "1rem" }}>
                    <ImageAnalysisSuggestionPanel asset={asset} />
                  </div>

                  <div className="card" style={{ padding: "1rem" }}>
                    <div className="stack stack--tight">
                      <strong>当前资产状态</strong>
                      <p className="helper-text">主关键词：{asset.anchorKeyword || "无"}</p>
                      <p className="helper-text">短描述：{asset.captionShort || asset.autoCaption || "无"}</p>
                      <p className="helper-text">长描述：{asset.captionLong || "无"}</p>
                      <p className="helper-text">实体标签：{formatEntityTagsDetailed(asset.entityTags)}</p>
                      <p className="helper-text">主主题：{asset.primaryTopic ? formatImageAssetTags([asset.primaryTopic]) : "无"}</p>
                      <p className="helper-text">主情绪：{asset.primaryEmotion ? formatImageAssetTags([asset.primaryEmotion]) : "无"}</p>
                      <p className="helper-text">主题标签：{formatWeightedTagsDetailed(asset.topicTags)}</p>
                      <p className="helper-text">情绪标签：{formatEmotionTagsDetailed(asset.emotionTags)}</p>
                      <p className="helper-text">平台：{asset.platformScope}</p>
                      <p className="helper-text">类型：{asset.assetType}</p>
                      <p className="helper-text">用途：{asset.usageScope}</p>
                      <p className="helper-text">风险：{asset.riskLevel}</p>
                      <p className="helper-text">
                        人工锁定字段：{asset.manualOverrideFields.length ? asset.manualOverrideFields.join(", ") : "无"}
                      </p>
                    </div>
                  </div>
                </div>
              </article>

              <article className="card">
                <div className="card-header">
                  <div>
                    <h3>人工确认</h3>
                    <p className="muted">保存后会锁定当前字段，后续重跑分析不会默认覆盖。</p>
                  </div>
                </div>

                <div className="image-form-grid">
                  <label className="field">
                    <span>图片类型</span>
                    <select
                      value={form.assetType}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "assetType", event.target.value)}
                    >
                      <option value="meme">表情包</option>
                      <option value="illustration">场景图</option>
                      <option value="cover">封面图</option>
                      <option value="screenshot">截图</option>
                      <option value="other">其他</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>平台范围</span>
                    <select
                      value={form.platformScope}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "platformScope", event.target.value)}
                    >
                      <option value="zhihu">知乎</option>
                      <option value="x">X</option>
                      <option value="both">通用</option>
                      <option value="unknown">未标注</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>用途范围</span>
                    <select
                      value={form.usageScope}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "usageScope", event.target.value)}
                    >
                      <option value="zhihu_answer">知乎回答</option>
                      <option value="x_post">X 帖文</option>
                      <option value="cover">封面</option>
                      <option value="reaction">互动回复</option>
                      <option value="general">通用</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>风险等级</span>
                    <select
                      value={form.riskLevel}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "riskLevel", event.target.value)}
                    >
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                      <option value="unknown">未标注</option>
                    </select>
                  </label>

                  <label className="field image-form-grid__full">
                    <span>OCR 文本</span>
                    <textarea
                      value={form.ocrText}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "ocrText", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>主关键词</span>
                    <input
                      value={form.anchorKeyword}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "anchorKeyword", event.target.value)}
                    />
                  </label>

                  <label className="field image-form-grid__full">
                    <span>短描述</span>
                    <textarea
                      value={form.captionShort}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "captionShort", event.target.value)}
                    />
                  </label>

                  <label className="field image-form-grid__full">
                    <span>长描述</span>
                    <textarea
                      value={form.captionLong}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "captionLong", event.target.value)}
                    />
                  </label>

                  <label className="field image-form-grid__full">
                    <span>人工描述</span>
                    <textarea
                      value={form.manualCaption}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "manualCaption", event.target.value)}
                    />
                  </label>

                  <label className="field image-form-grid__full">
                    <span>实体标签</span>
                    <input
                      value={form.entityTags}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "entityTags", event.target.value)}
                      placeholder="格式：奥特曼|ip_character, 熊猫人|meme_archetype"
                    />
                  </label>

                  <label className="field">
                    <span>主题标签</span>
                    <input
                      value={form.topicTags}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "topicTags", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>情绪标签</span>
                    <input
                      value={form.emotionTags}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "emotionTags", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>场景标签</span>
                    <input
                      value={form.sceneTags}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "sceneTags", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>风格标签</span>
                    <input
                      value={form.styleTags}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "styleTags", event.target.value)}
                    />
                  </label>

                  <label className="field image-form-grid__full">
                    <span>风险备注</span>
                    <textarea
                      value={form.riskNotes}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "riskNotes", event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>状态</span>
                    <select
                      value={form.status}
                      onChange={(event) => updateImageAssetEditorForm(setForm, "status", event.target.value)}
                    >
                      <option value="pending_review">待审核</option>
                      <option value="active">启用</option>
                      <option value="disabled">停用</option>
                      <option value="rejected">拒绝</option>
                    </select>
                  </label>
                </div>

                <div className="button-row">
                  <button
                    className="button"
                    disabled={pending}
                    onClick={() =>
                      withAction(async () => {
                        const payload = buildImageAssetUpdatePayload(asset, form);
                        if (!Object.keys(payload).length) {
                          setMessage("没有需要保存的修改。");
                          return;
                        }

                        const updated = await updateImageAsset(asset.id, payload);

                        if (updated) {
                          setAsset(updated);
                          setForm(buildImageAssetEditorForm(updated));
                        }

                        await hydrate(asset.id);
                        setMessage("审核结果已保存。");
                      })
                    }
                  >
                    {pending ? "保存中..." : "保存审核结果"}
                  </button>

                  <button
                    className="button button--ghost"
                    disabled={pending}
                    onClick={() =>
                      withAction(async () => {
                        const refreshed = await reanalyzeImageAsset(asset.id);
                        if (refreshed) {
                          setAsset(refreshed);
                          setForm(buildImageAssetEditorForm(refreshed));
                        }

                        await hydrate(asset.id);
                        await hydrateProgress();
                        setMessage("已重新触发分析。");
                      })
                    }
                  >
                    重跑分析
                  </button>
                </div>
              </article>
            </>
          ) : (
            <article className="card">
              <p className="muted">请选择左侧待审核图片。</p>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}

function formatProgressStatus(progress: ImageAssetReanalyzeProgress | null) {
  if (!progress) {
    return "加载中";
  }

  if (progress.status === "idle") {
    return progress.queue.pendingCount > 0 ? "队列运行中" : "空闲";
  }

  if (progress.status === "running") {
    return progress.pauseRequested ? "暂停中" : "运行中";
  }

  if (progress.status === "paused") {
    return "已暂停";
  }

  return "已完成";
}
