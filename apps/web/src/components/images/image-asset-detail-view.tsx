"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { ImageAssetDetail, ImageAssetUsageRecord } from "@zhihu-mvp/shared";
import { getImageAssetDetail, reanalyzeImageAsset, updateImageAsset } from "../../lib/api";
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

export function ImageAssetDetailView({ assetId }: { assetId: string }) {
  const [asset, setAsset] = useState<ImageAssetDetail | null>(null);
  const [usageRecords, setUsageRecords] = useState<ImageAssetUsageRecord[]>([]);
  const [form, setForm] = useState<ImageAssetEditorFormState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void hydrate(assetId);
  }, [assetId]);

  function withAction(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        setMessage("");
        await action();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "图片详情操作失败。");
      }
    });
  }

  async function hydrate(id: string) {
    setLoaded(false);
    const detail = await getImageAssetDetail(id);
    setAsset(detail.asset);
    setUsageRecords(detail.usageRecords);
    setForm(detail.asset ? buildImageAssetEditorForm(detail.asset) : null);
    setLoaded(true);
  }

  if (!loaded) {
    return (
      <div className="stack">
        <section className="page-header">
          <div>
            <h2>图片详情</h2>
            <p className="muted">正在加载图片详情、标签和使用记录。</p>
          </div>
        </section>
      </div>
    );
  }

  if (!asset || !form) {
    return (
      <div className="stack">
        <section className="page-header">
          <div>
            <h2>图片详情</h2>
            <p className="muted">当前图片不存在，或者还没有完成首轮入库。</p>
          </div>
        </section>

        {message ? (
          <article className="card">
            <p className="helper-text">{message}</p>
          </article>
        ) : null}

        <article className="card">
          <div className="button-row">
            <Link href="/images" className="button button--ghost">
              返回检索页
            </Link>
            <Link href="/images/review" className="button button--ghost">
              去待审核页
            </Link>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>{asset.fileName}</h2>
          <p className="muted">{asset.sourcePath ?? "未记录来源路径"}</p>
        </div>

        <div className="button-row">
          <Link href="/images" className="button button--ghost">
            返回检索页
          </Link>
          {asset.status === "pending_review" ? (
            <Link href={`/images/review?assetId=${asset.id}`} className="button button--ghost">
              去审核页
            </Link>
          ) : null}
          <a href={asset.storageUrl} className="button button--ghost" target="_blank" rel="noreferrer">
            打开原图
          </a>
          <StatusChip status={asset.analysisStatus} />
          <StatusChip status={asset.status} />
        </div>
      </section>

      {message ? (
        <article className="card">
          <p className="helper-text">{message}</p>
        </article>
      ) : null}

      <section className="image-detail-layout">
        <article className="card stack">
          <div className="image-review-preview">
            <img src={asset.storageUrl} alt={asset.fileName} />
          </div>

          <div className="grid grid--two">
            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>文件信息</strong>
                <p className="helper-text">文件名：{asset.fileName}</p>
                <p className="helper-text">MIME：{asset.mimeType}</p>
                <p className="helper-text">大小：{formatBytes(asset.fileSize)}</p>
                <p className="helper-text">尺寸：{formatDimensions(asset.width, asset.height)}</p>
                <p className="helper-text">版式：{formatAspectRatio(asset.aspectRatio)}</p>
                <p className="helper-text">Hash：{asset.fileHash}</p>
                <p className="helper-text">存储路径：{asset.storagePath}</p>
                <p className="helper-text">原始路径：{asset.sourcePath ?? "无"}</p>
              </div>
            </div>

            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>状态信息</strong>
                <p className="helper-text">平台：{formatPlatformScope(asset.platformScope)}</p>
                <p className="helper-text">类型：{formatAssetType(asset.assetType)}</p>
                <p className="helper-text">用途：{formatUsageScope(asset.usageScope)}</p>
                <p className="helper-text">风险：{formatRiskLevel(asset.riskLevel)}</p>
                <p className="helper-text">含字：{asset.hasText ? "是" : "否"}</p>
                <p className="helper-text">使用次数：{asset.useCount}</p>
                <p className="helper-text">最近使用：{formatTime(asset.lastUsedAt)}</p>
                <p className="helper-text">
                  人工锁定字段：{asset.manualOverrideFields.length ? asset.manualOverrideFields.join(", ") : "无"}
                </p>
              </div>
            </div>
          </div>
        </article>

        <div className="stack">
          <article className="card">
            <div className="card-header">
              <div>
                <h3>内容与标签</h3>
                <p className="muted">这里集中展示 OCR、描述、标签、风险和来源说明。</p>
              </div>
            </div>

            <div className="grid grid--two">
              <div className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <strong>识别结果</strong>
                  <p className="helper-text">OCR：{asset.ocrText || "无"}</p>
                  <p className="helper-text">主关键词：{asset.anchorKeyword || "无"}</p>
                  <p className="helper-text">短描述：{asset.captionShort || asset.autoCaption || "无"}</p>
                  <p className="helper-text">长描述：{asset.captionLong || "无"}</p>
                  <p className="helper-text">自动描述：{asset.autoCaption || asset.captionShort || "无"}</p>
                  <p className="helper-text">人工描述：{asset.manualCaption || "无"}</p>
                  <p className="helper-text">实体标签：{formatEntityTagsDetailed(asset.entityTags)}</p>
                  <p className="helper-text">主主题：{asset.primaryTopic ? formatImageAssetTags([asset.primaryTopic]) : "无"}</p>
                  <p className="helper-text">主情绪：{asset.primaryEmotion ? formatImageAssetTags([asset.primaryEmotion]) : "无"}</p>
                  <p className="helper-text">风险备注：{asset.riskNotes || "无"}</p>
                  <p className="helper-text">来源说明：{asset.copyrightSource || "无"}</p>
                  {asset.analysisError ? <p className="helper-text">分析错误：{asset.analysisError}</p> : null}
                </div>
              </div>

              <div className="card" style={{ padding: "1rem" }}>
                <div className="stack stack--tight">
                  <ImageAnalysisSuggestionPanel asset={asset} />
                  <p className="helper-text">当前主题：{formatWeightedTagsDetailed(asset.topicTags)}</p>
                  <p className="helper-text">当前情绪：{formatEmotionTagsDetailed(asset.emotionTags)}</p>
                  <p className="helper-text">当前场景：{formatWeightedTagsDetailed(asset.sceneTags)}</p>
                  <p className="helper-text">当前风格：{formatWeightedTagsDetailed(asset.styleTags)}</p>
                </div>
              </div>
            </div>
          </article>

          <article className="card">
            <div className="card-header">
              <div>
                <h3>编辑资产</h3>
                <p className="muted">保存后会锁定人工字段，后续重跑分析不会默认覆盖。</p>
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

              <label className="field image-form-grid__full">
                <span>来源说明</span>
                <input
                  value={form.copyrightSource}
                  onChange={(event) => updateImageAssetEditorForm(setForm, "copyrightSource", event.target.value)}
                />
              </label>

              <label className="field">
                <span>状态</span>
                <select value={form.status} onChange={(event) => updateImageAssetEditorForm(setForm, "status", event.target.value)}>
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
                    setMessage("图片详情已保存。");
                  })
                }
              >
                {pending ? "保存中..." : "保存修改"}
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
                    setMessage("已重新触发分析。");
                  })
                }
              >
                重跑分析
              </button>
            </div>
          </article>

          <article className="card">
            <div className="card-header">
              <div>
                <h3>使用记录</h3>
                <p className="muted">任务侧只保存 `asset_id`，这里用于回查平台、账号、任务和用途。</p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>平台</th>
                    <th>任务</th>
                    <th>账号</th>
                    <th>用途</th>
                    <th>选图方式</th>
                    <th>备注</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {usageRecords.length ? (
                    usageRecords.map((record) => (
                      <tr key={record.id}>
                        <td>{record.platform}</td>
                        <td>{record.taskId ?? "-"}</td>
                        <td>{record.accountId ?? "-"}</td>
                        <td>{record.usageType}</td>
                        <td>{record.selectedBy}</td>
                        <td>{record.note ?? "-"}</td>
                        <td>{new Date(record.createdAt).toLocaleString("zh-CN")}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>当前图片还没有使用记录。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
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

function formatUsageScope(value: string) {
  const map: Record<string, string> = {
    zhihu_answer: "知乎回答",
    x_post: "X 帖文",
    cover: "封面",
    reaction: "互动回复",
    general: "通用"
  };
  return map[value] ?? value;
}

function formatRiskLevel(value: string) {
  const map: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
    unknown: "未标注"
  };
  return map[value] ?? value;
}

function formatAspectRatio(value: string) {
  const map: Record<string, string> = {
    landscape: "横版",
    portrait: "竖版",
    square: "方图",
    unknown: "未标注"
  };
  return map[value] ?? value;
}

function formatDimensions(width: number | null, height: number | null) {
  if (!width || !height) {
    return "未知";
  }

  return `${width} x ${height}`;
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}
