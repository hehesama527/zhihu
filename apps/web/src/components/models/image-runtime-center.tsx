"use client";

import type { ModelCenterView } from "@zhihu-mvp/shared";
import { useState, useTransition } from "react";
import { updateModelCenterConfig } from "../../lib/api";
import {
  formatSourceLabel,
  formatTimeout,
  formatTimestamp,
  normalizeImageDraft,
  resolveImageRuntimePreview,
  serializeImageDraft,
  type FlashMessage
} from "./model-center-utils";

type ImageRuntimeCenterProps = {
  initialModelCenter: ModelCenterView;
};

export function ImageRuntimeCenter({ initialModelCenter }: ImageRuntimeCenterProps) {
  const [modelCenter, setModelCenter] = useState(initialModelCenter);
  const [imageDraft, setImageDraft] = useState(() => normalizeImageDraft(initialModelCenter.imageRuntime.overrides));
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null);
  const [isPending, startTransition] = useTransition();

  const preview = resolveImageRuntimePreview(modelCenter.imageRuntime, imageDraft);
  const savedImageDraftSignature = serializeImageDraft(modelCenter.imageRuntime.overrides);
  const imageDraftSignature = serializeImageDraft(imageDraft);
  const isDirty = imageDraftSignature !== savedImageDraftSignature;
  const ollamaModelCount = modelCenter.models.filter((model) => model.providerLabel === "Ollama").length;

  return (
    <div className="stack model-hub">
      <section className="model-hub-hero">
        <div className="model-hub-hero__copy">
          <span className="brand-kicker">配图中心</span>
          <h2>独立维护图片分析链路的 Ollama 运行时，和模型库保持同级中控。</h2>
          <p className="muted">
            这里管理图库分析、OCR 和 OCR Judge 的模型与 Ollama 地址。保存后，当前使用中的模型会自动同步到模型库页面，便于统一查看和复用。
          </p>
          <div className="model-hub-hero__meta">
            <span className="mini-badge mini-badge--accent">最近更新：{formatTimestamp(modelCenter.updatedAt)}</span>
            <span className="mini-badge">当前同步到模型库的 Ollama 条目：{ollamaModelCount}</span>
            <span className="mini-badge">运行时与模型库共用 control-api</span>
          </div>
        </div>

        <div className="model-hub-kpis">
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">主分析模型</span>
            <strong className="model-hub-kpi__value model-hub-kpi__value--compact">
              {preview.config.imageAnalysisModel}
            </strong>
            <span className="helper-text">{formatSourceLabel(preview.fieldSources.imageAnalysisModel)}</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">OCR 模型</span>
            <strong className="model-hub-kpi__value model-hub-kpi__value--compact">
              {preview.config.imageOcrModel}
            </strong>
            <span className="helper-text">{formatSourceLabel(preview.fieldSources.imageOcrModel)}</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">OCR Judge</span>
            <strong className="model-hub-kpi__value model-hub-kpi__value--compact">
              {preview.config.imageOcrJudgeModel}
            </strong>
            <span className="helper-text">{formatSourceLabel(preview.fieldSources.imageOcrJudgeModel)}</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">分析超时</span>
            <strong className="model-hub-kpi__value model-hub-kpi__value--compact">
              {formatTimeout(preview.config.imageAnalysisTimeoutMs)}
            </strong>
            <span className="helper-text">{formatSourceLabel(preview.fieldSources.imageAnalysisTimeoutMs)}</span>
          </article>
        </div>
      </section>

      {flashMessage ? (
        <section className={`alert ${flashMessage.tone === "success" ? "alert--success" : "alert--error"}`}>
          {flashMessage.text}
        </section>
      ) : null}

      <section className="catalog-main">
        <section className="card runtime-editor">
          <div className="card-header">
            <div>
              <span className="brand-kicker">运行时编辑</span>
              <h3>配置图库分析链路</h3>
              <p className="muted">这些字段只影响后续新发起的图片分析任务，不会中途改写正在执行的任务。</p>
            </div>
          </div>

          <div className="catalog-editor__grid">
            <label className="field">
              <span>主分析模型</span>
              <input
                value={imageDraft.imageAnalysisModel ?? ""}
                onChange={(event) => setImageDraft(updateImageDraftField(imageDraft, "imageAnalysisModel", event.target.value))}
                placeholder={modelCenter.imageRuntime.fallbackConfig.imageAnalysisModel}
              />
              <small className="helper-text">
                留空则继承 {modelCenter.imageRuntime.fallbackConfig.imageAnalysisModel}（
                {formatSourceLabel(modelCenter.imageRuntime.fallbackFieldSources.imageAnalysisModel)}）
              </small>
            </label>

            <label className="field">
              <span>OCR 模型</span>
              <input
                value={imageDraft.imageOcrModel ?? ""}
                onChange={(event) => setImageDraft(updateImageDraftField(imageDraft, "imageOcrModel", event.target.value))}
                placeholder={modelCenter.imageRuntime.fallbackConfig.imageOcrModel}
              />
              <small className="helper-text">
                留空则继承 {modelCenter.imageRuntime.fallbackConfig.imageOcrModel}（
                {formatSourceLabel(modelCenter.imageRuntime.fallbackFieldSources.imageOcrModel)}）
              </small>
            </label>

            <label className="field">
              <span>OCR Judge 模型</span>
              <input
                value={imageDraft.imageOcrJudgeModel ?? ""}
                onChange={(event) =>
                  setImageDraft(updateImageDraftField(imageDraft, "imageOcrJudgeModel", event.target.value))
                }
                placeholder={modelCenter.imageRuntime.fallbackConfig.imageOcrJudgeModel}
              />
              <small className="helper-text">
                留空则继承 {modelCenter.imageRuntime.fallbackConfig.imageOcrJudgeModel}（
                {formatSourceLabel(modelCenter.imageRuntime.fallbackFieldSources.imageOcrJudgeModel)}）
              </small>
            </label>

            <label className="field">
              <span>Ollama Base URL</span>
              <input
                value={imageDraft.ollamaBaseUrl ?? ""}
                onChange={(event) => setImageDraft(updateImageDraftField(imageDraft, "ollamaBaseUrl", event.target.value))}
                placeholder={modelCenter.imageRuntime.fallbackConfig.ollamaBaseUrl}
              />
              <small className="helper-text">
                留空则继承 {modelCenter.imageRuntime.fallbackConfig.ollamaBaseUrl}（
                {formatSourceLabel(modelCenter.imageRuntime.fallbackFieldSources.ollamaBaseUrl)}）
              </small>
            </label>

            <label className="field">
              <span>分析超时（毫秒）</span>
              <input
                type="number"
                min={1}
                value={imageDraft.imageAnalysisTimeoutMs ?? ""}
                onChange={(event) =>
                  setImageDraft(updateImageDraftField(imageDraft, "imageAnalysisTimeoutMs", event.target.value))
                }
                placeholder={String(modelCenter.imageRuntime.fallbackConfig.imageAnalysisTimeoutMs)}
              />
              <small className="helper-text">
                留空则继承 {formatTimeout(modelCenter.imageRuntime.fallbackConfig.imageAnalysisTimeoutMs)}（
                {formatSourceLabel(modelCenter.imageRuntime.fallbackFieldSources.imageAnalysisTimeoutMs)}）
              </small>
            </label>
          </div>
        </section>

        <section className="card binding-preview">
          <div className="card-header">
            <div>
              <span className="brand-kicker">生效预览</span>
              <h3>当前图库运行时</h3>
              <p className="muted">保存后，下面这组配置会成为后续图片分析任务的生效参数。</p>
            </div>
          </div>

          <div className="binding-preview__facts">
            <div className="model-fact">
              <span className="model-fact__label">主分析模型</span>
              <span className="model-fact__value">{preview.config.imageAnalysisModel}</span>
            </div>
            <div className="model-fact">
              <span className="model-fact__label">OCR 模型</span>
              <span className="model-fact__value">{preview.config.imageOcrModel}</span>
            </div>
            <div className="model-fact">
              <span className="model-fact__label">OCR Judge</span>
              <span className="model-fact__value">{preview.config.imageOcrJudgeModel}</span>
            </div>
            <div className="model-fact">
              <span className="model-fact__label">Ollama Base URL</span>
              <span className="model-fact__value">{preview.config.ollamaBaseUrl}</span>
            </div>
            <div className="model-fact">
              <span className="model-fact__label">分析超时</span>
              <span className="model-fact__value">{formatTimeout(preview.config.imageAnalysisTimeoutMs)}</span>
            </div>
            <div className="model-fact">
              <span className="model-fact__label">模型库同步</span>
              <span className="model-fact__value">保存后会自动把这三种模型带入模型库</span>
            </div>
          </div>
        </section>
      </section>

      <section className={`model-save-bar ${isDirty ? "model-save-bar--active" : ""}`}>
        <div>
          <strong>{isDirty ? "有未保存的配图运行时改动" : "当前没有未保存的配图运行时改动"}</strong>
          <p className="muted">保存后，模型库视图会同步刷新，当前主分析和 OCR 模型会自动出现在模型库中。</p>
        </div>

        <div className="button-row">
          <button
            className="button button--ghost"
            disabled={!isDirty || isPending}
            onClick={() => {
              setImageDraft(normalizeImageDraft(modelCenter.imageRuntime.overrides));
              setFlashMessage(null);
            }}
          >
            撤销改动
          </button>
          <button
            className="button"
            disabled={!isDirty || isPending}
            onClick={() =>
              startTransition(() => {
                void saveImageRuntimeChanges({
                  modelCenter,
                  imageDraft,
                  setModelCenter,
                  setImageDraft,
                  setFlashMessage
                });
              })
            }
          >
            {isPending ? "保存中..." : "保存配图中心"}
          </button>
        </div>
      </section>
    </div>
  );
}

async function saveImageRuntimeChanges({
  modelCenter,
  imageDraft,
  setModelCenter,
  setImageDraft,
  setFlashMessage
}: {
  modelCenter: ModelCenterView;
  imageDraft: ModelCenterView["imageRuntime"]["overrides"];
  setModelCenter: (value: ModelCenterView) => void;
  setImageDraft: (value: ModelCenterView["imageRuntime"]["overrides"]) => void;
  setFlashMessage: (value: FlashMessage | null) => void;
}) {
  try {
    const nextModelCenter = await updateModelCenterConfig({
      imageRuntime: normalizeImageDraft(imageDraft),
      models: modelCenter.models,
      agentBindings: modelCenter.agentBindings
    });

    setModelCenter(nextModelCenter);
    setImageDraft(normalizeImageDraft(nextModelCenter.imageRuntime.overrides));
    setFlashMessage({
      tone: "success",
      text: "配图中心已保存，模型库里的 Ollama 条目也已同步刷新。"
    });
  } catch (error) {
    setFlashMessage({
      tone: "error",
      text: error instanceof Error ? error.message : "配图中心保存失败。"
    });
  }
}

function updateImageDraftField(
  draft: ModelCenterView["imageRuntime"]["overrides"],
  field: keyof ModelCenterView["imageRuntime"]["overrides"],
  rawValue: string
) {
  return normalizeImageDraft({
    ...draft,
    [field]: parseImageDraftField(field, rawValue)
  });
}

function parseImageDraftField(
  field: keyof ModelCenterView["imageRuntime"]["overrides"],
  rawValue: string
) {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return null;
  }

  if (field === "imageAnalysisTimeoutMs") {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
  }

  return field === "ollamaBaseUrl" ? trimmed.replace(/\/+$/, "") : trimmed;
}
