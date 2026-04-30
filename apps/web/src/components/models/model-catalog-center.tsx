"use client";

import type {
  ModelCenterAgentBinding,
  ModelCenterAgentOverrideFields,
  ModelCenterSavedModel,
  ModelCenterView
} from "@zhihu-mvp/shared";
import { useDeferredValue, useState, useTransition } from "react";
import { updateModelCenterConfig } from "../../lib/api";
import {
  buildNextModelName,
  createEmptySavedModel,
  formatReasoning,
  formatTimeout,
  formatTimestamp,
  formatWireApi,
  getModelUsageAgentNames,
  normalizeBindings,
  normalizeModelOverrideFields,
  normalizeSavedModel,
  serializeBindings,
  serializeModels,
  type FlashMessage
} from "./model-center-utils";

type ModelCatalogCenterProps = {
  initialModelCenter: ModelCenterView;
};

export function ModelCatalogCenter({ initialModelCenter }: ModelCatalogCenterProps) {
  const [modelCenter, setModelCenter] = useState(initialModelCenter);
  const [models, setModels] = useState(initialModelCenter.models);
  const [agentBindings, setAgentBindings] = useState(() =>
    normalizeBindings(initialModelCenter.agentBindings, initialModelCenter.models)
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(initialModelCenter.models[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const visibleModels = models.filter((model) => {
    if (!deferredSearch) {
      return true;
    }

    const haystack = [
      model.name,
      model.providerLabel,
      model.notes,
      model.overrides.model,
      model.overrides.baseUrl
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(deferredSearch);
  });

  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? visibleModels[0] ?? models[0] ?? null;
  const selectedUsageNames = selectedModel ? getModelUsageAgentNames(agentBindings, selectedModel.id) : [];
  const boundAgentCount = agentBindings.filter((binding) => binding.modelId !== null).length;
  const configuredApiKeyCount = models.filter((model) => normalizeModelOverrideFields(model.overrides).apiKey).length;
  const completeFieldCount = models.filter((model) => {
    const normalized = normalizeModelOverrideFields(model.overrides);
    return Boolean(model.providerLabel && normalized.model && normalized.baseUrl);
  }).length;
  const modelSignature = serializeModels(models);
  const savedModelSignature = serializeModels(modelCenter.models);
  const bindingSignature = serializeBindings(agentBindings, models);
  const savedBindingSignature = serializeBindings(modelCenter.agentBindings, modelCenter.models);
  const isDirty = modelSignature !== savedModelSignature || bindingSignature !== savedBindingSignature;
  const selectedOverrides = selectedModel ? normalizeModelOverrideFields(selectedModel.overrides) : null;
  const isImageSyncedModel = Boolean(selectedModel?.notes?.includes("配图中心当前"));

  return (
    <div className="stack model-hub">
      <section className="model-hub-hero">
        <div className="model-hub-hero__copy">
          <span className="brand-kicker">模型库</span>
          <h2>统一维护模型资产，再把绑定关系交给各条 Agent 链路独立切换。</h2>
          <p className="muted">
            这里负责模型本身的元信息、运行时字段和专用 API Key，不在同一页重复展开每个 Agent 的细节。
            绑定动作放在左侧对应页面里，用点选模型卡片的方式完成。
          </p>
          <p className="helper-text">
            当前已经生效的模型会自动带入列表。配图中心正在使用的 Ollama 模型也会同步显示到这里，方便统一检索和复用。
          </p>
          <div className="model-hub-hero__meta">
            <span className="mini-badge mini-badge--accent">配置文件：data/model-center.json</span>
            <span className="mini-badge">最近更新：{formatTimestamp(modelCenter.updatedAt)}</span>
            <span className="mini-badge">配图中心与模型中心共用同一套 control-api</span>
          </div>
        </div>

        <div className="model-hub-kpis">
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">已登记模型</span>
            <strong className="model-hub-kpi__value">{models.length}</strong>
            <span className="helper-text">模型名、提供方和运行时字段统一在这里维护</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">已绑定 Agent</span>
            <strong className="model-hub-kpi__value">{boundAgentCount}</strong>
            <span className="helper-text">删除模型时会自动清理失效绑定</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">已配 API Key</span>
            <strong className="model-hub-kpi__value">{configuredApiKeyCount}</strong>
            <span className="helper-text">为特定模型单独写入鉴权时会覆盖默认来源</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">核心字段完整</span>
            <strong className="model-hub-kpi__value">{completeFieldCount}</strong>
            <span className="helper-text">已补齐提供方、模型名和 Base URL 的条目数</span>
          </article>
        </div>
      </section>

      {flashMessage ? (
        <section className={`alert ${flashMessage.tone === "success" ? "alert--success" : "alert--error"}`}>
          {flashMessage.text}
        </section>
      ) : null}

      <section className="catalog-workspace">
        <aside className="catalog-rail">
          <div className="catalog-rail__header">
            <div>
              <span className="brand-kicker">模型列表</span>
              <h3>统一维护模型条目</h3>
            </div>
            <button
              className="button button--ghost button--small"
              onClick={() => {
                const nextModel = createEmptySavedModel(createLocalModelId(), buildNextModelName(models));
                setModels((current) => [...current, nextModel]);
                setSelectedModelId(nextModel.id);
                setFlashMessage(null);
              }}
            >
              新建模型
            </button>
          </div>

          <label className="field">
            <span>筛选模型</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="按名称、提供方、模型名或地址搜索"
            />
          </label>

          <div className="catalog-list">
            {visibleModels.length > 0 ? (
              visibleModels.map((model) => {
                const usageCount = agentBindings.filter((binding) => binding.modelId === model.id).length;
                const normalized = normalizeModelOverrideFields(model.overrides);

                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`catalog-list__item ${selectedModel?.id === model.id ? "catalog-list__item--active" : ""}`}
                    onClick={() => setSelectedModelId(model.id)}
                  >
                    <div className="catalog-list__item-top">
                      <strong>{model.name || "未命名模型"}</strong>
                      <span className="mini-badge">{usageCount} 个 Agent</span>
                    </div>
                    <span className="catalog-list__item-subtitle">
                      {model.providerLabel ?? "未填写提供方"} · {normalized.model ?? "未填写模型名"}
                    </span>
                    <span className="catalog-list__item-caption">
                      {normalized.baseUrl ?? "Base URL 留空时，绑定后会继承链路默认配置"}
                    </span>
                    <span className="catalog-list__item-caption">
                      {normalized.apiKey ? "已配置专用 API Key" : "未配置专用 API Key"}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="empty-state empty-state--compact">
                <p>没有匹配到模型。</p>
                <span className="helper-text">可以换个关键词，或者直接新建一个模型条目。</span>
              </div>
            )}
          </div>
        </aside>

        <div className="catalog-main">
          {selectedModel ? (
            <section className="catalog-editor card">
              <div className="card-header">
                <div>
                  <span className="brand-kicker">模型详情</span>
                  <h3>{selectedModel.name || "未命名模型"}</h3>
                  <p className="muted">模型基础信息只在这里维护一次，绑定页只负责点一下切换。</p>
                </div>
                <button
                  className="button button--ghost button--small"
                  onClick={() => {
                    const remainingModels = models.filter((model) => model.id !== selectedModel.id);
                    const nextBindings = normalizeBindings(
                      agentBindings.map((binding) =>
                        binding.modelId === selectedModel.id ? { ...binding, modelId: null } : binding
                      ),
                      remainingModels
                    );

                    setModels(remainingModels);
                    setAgentBindings(nextBindings);
                    setSelectedModelId(remainingModels[0]?.id ?? null);
                    setFlashMessage(null);
                  }}
                >
                  删除模型
                </button>
              </div>

              <div className="catalog-editor__usage">
                <span className="mini-badge mini-badge--accent">当前被 {selectedUsageNames.length} 个 Agent 使用</span>
                <span className="helper-text">
                  {selectedUsageNames.length > 0
                    ? selectedUsageNames.join("、")
                    : "当前还没有 Agent 绑定到这个模型。"}
                </span>
                {isImageSyncedModel ? (
                  <span className="helper-text">这条目来自配图中心当前运行时设置，若要移除请去“配图中心”更换模型。</span>
                ) : null}
              </div>

              <div className="catalog-editor__grid">
                <label className="field">
                  <span>展示名称</span>
                  <input
                    value={selectedModel.name}
                    onChange={(event) => {
                      const value = event.target.value;
                      setModels((current) =>
                        current.map((model) =>
                          model.id === selectedModel.id
                            ? {
                                ...model,
                                name: value
                              }
                            : model
                        )
                      );
                    }}
                    placeholder="例如 Qwen 3.5 主模型"
                  />
                </label>

                <label className="field">
                  <span>提供方</span>
                  <input
                    value={selectedModel.providerLabel ?? ""}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      setModels((current) =>
                        current.map((model) =>
                          model.id === selectedModel.id
                            ? {
                                ...model,
                                providerLabel: value || null
                              }
                            : model
                        )
                      );
                    }}
                    placeholder="例如 Ollama、OpenAI、Sub2API"
                  />
                </label>

                <label className="field">
                  <span>模型名</span>
                  <input
                    value={selectedOverrides?.model ?? ""}
                    onChange={(event) =>
                      updateSelectedOverrideField(setModels, selectedModel.id, "model", event.target.value)
                    }
                    placeholder="例如 qwen3.5、gpt-5.4"
                  />
                </label>

                <label className="field">
                  <span>Base URL</span>
                  <input
                    value={selectedOverrides?.baseUrl ?? ""}
                    onChange={(event) =>
                      updateSelectedOverrideField(setModels, selectedModel.id, "baseUrl", event.target.value)
                    }
                    placeholder="例如 http://127.0.0.1:11434/v1"
                  />
                </label>

                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={selectedOverrides?.apiKey ?? ""}
                    onChange={(event) =>
                      updateSelectedOverrideField(setModels, selectedModel.id, "apiKey", event.target.value)
                    }
                    placeholder="留空时继承绑定链路的默认鉴权"
                  />
                </label>

                <label className="field">
                  <span>Wire API</span>
                  <select
                    value={selectedOverrides?.wireApi ?? ""}
                    onChange={(event) =>
                      updateSelectedOverrideField(setModels, selectedModel.id, "wireApi", event.target.value)
                    }
                  >
                    <option value="">留空，绑定时继承默认</option>
                    <option value="responses">Responses</option>
                    <option value="chat_completions">Chat Completions</option>
                  </select>
                </label>

                <label className="field">
                  <span>Reasoning</span>
                  <select
                    value={selectedOverrides?.reasoningEffort ?? ""}
                    onChange={(event) =>
                      updateSelectedOverrideField(setModels, selectedModel.id, "reasoningEffort", event.target.value)
                    }
                  >
                    <option value="">留空，绑定时继承默认</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>

                <label className="field">
                  <span>请求超时（毫秒）</span>
                  <input
                    type="number"
                    min={1}
                    value={selectedOverrides?.requestTimeoutMs ?? ""}
                    onChange={(event) =>
                      updateSelectedOverrideField(setModels, selectedModel.id, "requestTimeoutMs", event.target.value)
                    }
                    placeholder="留空时继承默认"
                  />
                </label>

                <label className="field catalog-editor__notes">
                  <span>备注</span>
                  <textarea
                    value={selectedModel.notes ?? ""}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      setModels((current) =>
                        current.map((model) =>
                          model.id === selectedModel.id
                            ? {
                                ...model,
                                notes: value || null
                              }
                            : model
                        )
                      );
                    }}
                    placeholder="记录这个模型适合哪个 Agent、是否走本地 Ollama、是否偏重推理等。"
                  />
                </label>
              </div>

              <div className="catalog-preview-grid">
                <div className="catalog-preview-card">
                  <span className="catalog-preview-card__label">运行时摘要</span>
                  <strong>{selectedOverrides?.model ?? "未填写模型名"}</strong>
                  <span className="helper-text">
                    {selectedModel.providerLabel ?? "未填写提供方"} ·{" "}
                    {selectedOverrides?.baseUrl ?? "Base URL 将在绑定后继承默认链路"}
                  </span>
                </div>

                <div className="catalog-preview-card">
                  <span className="catalog-preview-card__label">接口与推理</span>
                  <strong>
                    {selectedOverrides?.wireApi ? formatWireApi(selectedOverrides.wireApi) : "继承默认接口"}
                  </strong>
                  <span className="helper-text">
                    {selectedOverrides?.reasoningEffort
                      ? formatReasoning(selectedOverrides.reasoningEffort)
                      : "Reasoning 留空时继承默认"}
                    {" · "}
                    {selectedOverrides?.requestTimeoutMs
                      ? formatTimeout(selectedOverrides.requestTimeoutMs)
                      : "超时继承默认"}
                  </span>
                </div>

                <div className="catalog-preview-card">
                  <span className="catalog-preview-card__label">鉴权状态</span>
                  <strong>{selectedOverrides?.apiKey ? "已配置专用 API Key" : "继承默认鉴权"}</strong>
                  <span className="helper-text">
                    {selectedOverrides?.apiKey
                      ? "绑定到 Agent 后会优先使用这里写入的 API Key。"
                      : "未写入专用 API Key，绑定后将继承 Agent 所在链路的默认鉴权。"}
                  </span>
                </div>
              </div>
            </section>
          ) : (
            <section className="card empty-state">
              <p>当前还没有模型条目。</p>
              <span className="helper-text">先在这里创建模型，再去左侧绑定页给 Agent 点选切换。</span>
            </section>
          )}
        </div>
      </section>

      <section className={`model-save-bar ${isDirty ? "model-save-bar--active" : ""}`}>
        <div>
          <strong>{isDirty ? "有未保存的模型库改动" : "当前没有未保存的改动"}</strong>
          <p className="muted">
            保存后会同步更新模型库和 Agent 绑定关系。配图中心的 Ollama 运行时模型会继续自动合流显示到模型库里。
          </p>
        </div>

        <div className="button-row">
          <button
            className="button button--ghost"
            disabled={!isDirty || isPending}
            onClick={() => {
              setModels(modelCenter.models);
              setAgentBindings(normalizeBindings(modelCenter.agentBindings, modelCenter.models));
              setSelectedModelId(modelCenter.models[0]?.id ?? null);
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
                void saveCatalogChanges({
                  models,
                  agentBindings,
                  imageRuntimeOverrides: modelCenter.imageRuntime.overrides,
                  selectedModelId,
                  setModelCenter,
                  setModels,
                  setAgentBindings,
                  setSelectedModelId,
                  setFlashMessage
                });
              })
            }
          >
            {isPending ? "保存中..." : "保存模型库"}
          </button>
        </div>
      </section>
    </div>
  );
}

async function saveCatalogChanges({
  models,
  agentBindings,
  imageRuntimeOverrides,
  selectedModelId,
  setModelCenter,
  setModels,
  setAgentBindings,
  setSelectedModelId,
  setFlashMessage
}: {
  models: ModelCenterSavedModel[];
  agentBindings: ModelCenterAgentBinding[];
  imageRuntimeOverrides: ModelCenterView["imageRuntime"]["overrides"];
  selectedModelId: string | null;
  setModelCenter: (value: ModelCenterView) => void;
  setModels: (value: ModelCenterSavedModel[]) => void;
  setAgentBindings: (value: ModelCenterAgentBinding[]) => void;
  setSelectedModelId: (value: string | null) => void;
  setFlashMessage: (value: FlashMessage | null) => void;
}) {
  try {
    const nextModelCenter = await updateModelCenterConfig({
      imageRuntime: imageRuntimeOverrides,
      models: models.map((model) => normalizeSavedModel(model)),
      agentBindings: normalizeBindings(agentBindings, models)
    });

    setModelCenter(nextModelCenter);
    setModels(nextModelCenter.models);
    setAgentBindings(normalizeBindings(nextModelCenter.agentBindings, nextModelCenter.models));
    setSelectedModelId(
      nextModelCenter.models.some((model) => model.id === selectedModelId)
        ? selectedModelId
        : nextModelCenter.models[0]?.id ?? null
    );
    setFlashMessage({
      tone: "success",
      text: "模型库已保存，后续新请求会按新的中控配置生效。"
    });
  } catch (error) {
    setFlashMessage({
      tone: "error",
      text: error instanceof Error ? error.message : "模型库保存失败。"
    });
  }
}

function createLocalModelId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `model-${crypto.randomUUID()}`;
  }

  return `model-${Date.now()}`;
}

function updateSelectedOverrideField(
  setModels: React.Dispatch<React.SetStateAction<ModelCenterSavedModel[]>>,
  modelId: string,
  field: keyof ModelCenterAgentOverrideFields,
  rawValue: string
) {
  setModels((current) =>
    current.map((model) => {
      if (model.id !== modelId) {
        return model;
      }

      return {
        ...model,
        overrides: normalizeModelOverrideFields({
          ...model.overrides,
          [field]: parseOverrideField(field, rawValue)
        })
      };
    })
  );
}

function parseOverrideField(field: keyof ModelCenterAgentOverrideFields, rawValue: string) {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return null;
  }

  if (field === "requestTimeoutMs") {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
  }

  if (field === "reasoningEffort") {
    return trimmed === "low" || trimmed === "medium" || trimmed === "high" ? trimmed : null;
  }

  if (field === "wireApi") {
    return trimmed === "responses" || trimmed === "chat_completions" ? trimmed : null;
  }

  return field === "baseUrl" ? trimmed.replace(/\/+$/, "") : trimmed;
}
