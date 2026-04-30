"use client";

import Link from "next/link";
import {
  modelCenterGroupDefinitions,
  type ModelCenterAgentBinding,
  type ModelCenterAgentGroup,
  type ModelCenterSavedModel,
  type ModelCenterView
} from "@zhihu-mvp/shared";
import { useDeferredValue, useState, useTransition } from "react";
import { updateModelCenterConfig } from "../../lib/api";
import {
  findBinding,
  formatReasoning,
  formatSourceLabel,
  formatTimeout,
  formatTimestamp,
  formatWireApi,
  getAgentsByGroup,
  getModelUsageAgentNames,
  normalizeBindings,
  resolveAgentPreview,
  serializeBindings,
  type FlashMessage
} from "./model-center-utils";

type AgentBindingCenterProps = {
  initialModelCenter: ModelCenterView;
  group: ModelCenterAgentGroup;
};

export function AgentBindingCenter({ initialModelCenter, group }: AgentBindingCenterProps) {
  const [modelCenter, setModelCenter] = useState(initialModelCenter);
  const [models, setModels] = useState(initialModelCenter.models);
  const [agentBindings, setAgentBindings] = useState(() =>
    normalizeBindings(initialModelCenter.agentBindings, initialModelCenter.models)
  );
  const [selectedAgentName, setSelectedAgentName] = useState(
    getAgentsByGroup(initialModelCenter, group)[0]?.agentName ?? null
  );
  const [search, setSearch] = useState("");
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const groupDefinition = modelCenterGroupDefinitions.find((item) => item.key === group);
  const groupAgents = getAgentsByGroup(modelCenter, group);
  const selectedAgent =
    groupAgents.find((agent) => agent.agentName === selectedAgentName) ?? groupAgents[0] ?? null;
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

  const savedBindingSignature = serializeBindings(modelCenter.agentBindings, modelCenter.models);
  const currentBindingSignature = serializeBindings(agentBindings, models);
  const isDirty = currentBindingSignature !== savedBindingSignature;
  const selectedBinding = selectedAgent ? findBinding(agentBindings, selectedAgent.agentName) : null;
  const selectedModel =
    selectedBinding?.modelId ? models.find((model) => model.id === selectedBinding.modelId) ?? null : null;
  const selectedPreview = selectedAgent ? resolveAgentPreview(selectedAgent, selectedModel) : null;
  const defaultPreview = selectedAgent ? resolveAgentPreview(selectedAgent, null) : null;
  const boundAgentCount = groupAgents.filter((agent) => findBinding(agentBindings, agent.agentName).modelId !== null).length;

  return (
    <div className="stack model-hub">
      <section className={`model-hub-hero model-hub-hero--${group}`}>
        <div className="model-hub-hero__copy">
          <span className="brand-kicker">{groupDefinition?.label ?? "Agent 绑定"}</span>
          <h2>点选模型，直接切换 {groupDefinition?.label ?? "当前链路"} 的 Agent 运行时。</h2>
          <p className="muted">
            每个 Agent 只需要选一个模型条目即可。模型本身的字段和 API Key 统一回到“模型库”维护，绑定页只负责切换关系。
          </p>
          <div className="model-hub-hero__meta">
            <span className="mini-badge mini-badge--accent">最近更新：{formatTimestamp(modelCenter.updatedAt)}</span>
            <span className="mini-badge">{groupAgents.length} 个 Agent</span>
            <span className="mini-badge">{models.length} 个可选模型</span>
          </div>
        </div>

        <div className="model-hub-kpis">
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">已绑定 Agent</span>
            <strong className="model-hub-kpi__value">{boundAgentCount}</strong>
            <span className="helper-text">未绑定时会回退到该链路默认配置</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">当前选中 Agent</span>
            <strong className="model-hub-kpi__value model-hub-kpi__value--compact">
              {selectedAgent?.shortLabel ?? "未选择"}
            </strong>
            <span className="helper-text">{selectedAgent?.label ?? "从左侧选择一个 Agent"}</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">当前绑定模型</span>
            <strong className="model-hub-kpi__value model-hub-kpi__value--compact">
              {selectedModel?.name ?? "继承默认"}
            </strong>
            <span className="helper-text">{selectedModel?.providerLabel ?? "当前未单独绑定模型"}</span>
          </article>
          <article className="model-hub-kpi">
            <span className="model-hub-kpi__label">实际生效模型</span>
            <strong className="model-hub-kpi__value model-hub-kpi__value--compact">
              {selectedPreview?.config.model ?? "未选择"}
            </strong>
            <span className="helper-text">
              {selectedPreview ? formatSourceLabel(selectedPreview.fieldSources.model) : "等待选择 Agent"}
            </span>
          </article>
        </div>
      </section>

      {flashMessage ? (
        <section className={`alert ${flashMessage.tone === "success" ? "alert--success" : "alert--error"}`}>
          {flashMessage.text}
        </section>
      ) : null}

      <section className="binding-workspace">
        <aside className="binding-rail">
          <div className="binding-rail__header">
            <div>
              <span className="brand-kicker">Agent 列表</span>
              <h3>{groupDefinition?.label ?? "当前链路"}</h3>
            </div>
            <Link href="/models" className="button button--ghost button--small">
              去模型库
            </Link>
          </div>

          <div className="binding-agent-list">
            {groupAgents.map((agent) => {
              const binding = findBinding(agentBindings, agent.agentName);
              const boundModel = binding.modelId ? models.find((item) => item.id === binding.modelId) ?? null : null;

              return (
                <button
                  key={agent.agentName}
                  type="button"
                  className={`binding-agent-card ${selectedAgent?.agentName === agent.agentName ? "binding-agent-card--active" : ""}`}
                  onClick={() => setSelectedAgentName(agent.agentName)}
                >
                  <div className="binding-agent-card__top">
                    <strong>{agent.shortLabel}</strong>
                    <span className="mini-badge">{boundModel ? "已绑定" : "默认"}</span>
                  </div>
                  <span className="binding-agent-card__title">{agent.label}</span>
                  <span className="binding-agent-card__meta">{boundModel?.name ?? agent.fallbackConfig.model}</span>
                  <span className="binding-agent-card__desc">{agent.description}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="binding-main">
          {selectedAgent ? (
            <>
              <section className="card binding-preview">
                <div className="card-header">
                  <div>
                    <span className="brand-kicker">{selectedAgent.agentName}</span>
                    <h3>{selectedAgent.label}</h3>
                    <p className="muted">{selectedAgent.description}</p>
                  </div>
                  <div className="binding-preview__chips">
                    <span className="mini-badge mini-badge--accent">{selectedModel?.name ?? "继承默认"}</span>
                    <span className="mini-badge">{selectedPreview?.config.model ?? "--"}</span>
                  </div>
                </div>

                <div className="binding-preview__facts">
                  <div className="model-fact">
                    <span className="model-fact__label">实际模型</span>
                    <span className="model-fact__value">{selectedPreview?.config.model ?? "--"}</span>
                  </div>
                  <div className="model-fact">
                    <span className="model-fact__label">Base URL</span>
                    <span className="model-fact__value">{selectedPreview?.config.baseUrl ?? "--"}</span>
                  </div>
                  <div className="model-fact">
                    <span className="model-fact__label">Wire API</span>
                    <span className="model-fact__value">
                      {selectedPreview ? formatWireApi(selectedPreview.config.wireApi) : "--"}
                    </span>
                  </div>
                  <div className="model-fact">
                    <span className="model-fact__label">Reasoning</span>
                    <span className="model-fact__value">
                      {selectedPreview ? formatReasoning(selectedPreview.config.reasoningEffort) : "--"}
                    </span>
                  </div>
                  <div className="model-fact">
                    <span className="model-fact__label">请求超时</span>
                    <span className="model-fact__value">
                      {selectedPreview ? formatTimeout(selectedPreview.config.requestTimeoutMs) : "--"}
                    </span>
                  </div>
                  <div className="model-fact">
                    <span className="model-fact__label">模型来源</span>
                    <span className="model-fact__value">
                      {selectedPreview ? formatSourceLabel(selectedPreview.fieldSources.model) : "--"}
                    </span>
                  </div>
                  <div className="model-fact">
                    <span className="model-fact__label">鉴权来源</span>
                    <span className="model-fact__value">
                      {selectedPreview
                        ? selectedPreview.hasApiKey
                          ? formatSourceLabel(selectedPreview.fieldSources.apiKey)
                          : "未配置"
                        : "--"}
                    </span>
                  </div>
                </div>
              </section>

              <section className="card binding-selector">
                <div className="card-header">
                  <div>
                    <span className="brand-kicker">模型分配</span>
                    <h3>点击模型卡片即可切换</h3>
                    <p className="muted">这里只做绑定，模型详情和 API Key 请回模型库页维护。</p>
                  </div>
                  <label className="field binding-selector__search">
                    <span>筛选模型</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="按名称、模型名、提供方搜索"
                    />
                  </label>
                </div>

                <div className="model-choice-grid">
                  <button
                    type="button"
                    className={`model-choice-card model-choice-card--inherit ${selectedBinding?.modelId === null ? "model-choice-card--active" : ""}`}
                    onClick={() =>
                      setAgentBindings((current) =>
                        selectedAgent
                          ? normalizeBindings(
                              current.map((binding) =>
                                binding.agentName === selectedAgent.agentName
                                  ? { ...binding, modelId: null }
                                  : binding
                              ),
                              models
                            )
                          : current
                      )
                    }
                  >
                    <div className="model-choice-card__top">
                      <strong>继承默认</strong>
                      <span className="mini-badge">推荐兜底</span>
                    </div>
                    <span className="model-choice-card__subtitle">{selectedAgent.fallbackConfig.model}</span>
                    <span className="model-choice-card__caption">
                      {defaultPreview ? formatSourceLabel(defaultPreview.fieldSources.model) : "按链路默认值生效"}
                    </span>
                    <div className="model-choice-card__facts">
                      <span>{defaultPreview ? formatWireApi(defaultPreview.config.wireApi) : "--"}</span>
                      <span>{defaultPreview ? formatReasoning(defaultPreview.config.reasoningEffort) : "--"}</span>
                      <span>{defaultPreview ? formatTimeout(defaultPreview.config.requestTimeoutMs) : "--"}</span>
                      <span>
                        {defaultPreview?.hasApiKey
                          ? formatSourceLabel(defaultPreview.fieldSources.apiKey)
                          : "未配置 API Key"}
                      </span>
                    </div>
                  </button>

                  {visibleModels.map((model) => {
                    const preview = resolveAgentPreview(selectedAgent, model);
                    const usageNames = getModelUsageAgentNames(agentBindings, model.id);

                    return (
                      <button
                        key={model.id}
                        type="button"
                        className={`model-choice-card ${selectedBinding?.modelId === model.id ? "model-choice-card--active" : ""}`}
                        onClick={() =>
                          setAgentBindings((current) =>
                            normalizeBindings(
                              current.map((binding) =>
                                binding.agentName === selectedAgent.agentName
                                  ? { ...binding, modelId: model.id }
                                  : binding
                              ),
                              models
                            )
                          )
                        }
                      >
                        <div className="model-choice-card__top">
                          <strong>{model.name}</strong>
                          <span className="mini-badge">{usageNames.length} 个 Agent</span>
                        </div>
                        <span className="model-choice-card__subtitle">
                          {model.providerLabel ?? "未填写提供方"} · {preview.config.model}
                        </span>
                        <span className="model-choice-card__caption">
                          {model.overrides.baseUrl ?? "Base URL 留空时继承链路默认"}
                        </span>
                        <div className="model-choice-card__facts">
                          <span>{formatWireApi(preview.config.wireApi)}</span>
                          <span>{formatReasoning(preview.config.reasoningEffort)}</span>
                          <span>{formatTimeout(preview.config.requestTimeoutMs)}</span>
                          <span>
                            {preview.hasApiKey ? formatSourceLabel(preview.fieldSources.apiKey) : "未配置 API Key"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {visibleModels.length === 0 ? (
                  <div className="empty-state empty-state--compact">
                    <p>当前没有匹配的模型条目。</p>
                    <span className="helper-text">可以去模型库新建，或者换一个搜索关键词。</span>
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <section className="card empty-state">
              <p>当前分组还没有可配置的 Agent。</p>
            </section>
          )}
        </div>
      </section>

      <section className={`model-save-bar ${isDirty ? "model-save-bar--active" : ""}`}>
        <div>
          <strong>{isDirty ? "有未保存的绑定变更" : "当前没有未保存的绑定变更"}</strong>
          <p className="muted">点击模型卡片只会修改当前页面草稿，保存后才会正式写入中控配置。</p>
        </div>

        <div className="button-row">
          <button
            className="button button--ghost"
            disabled={!isDirty || isPending}
            onClick={() => {
              setAgentBindings(normalizeBindings(modelCenter.agentBindings, modelCenter.models));
              setModels(modelCenter.models);
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
                void saveBindingChanges({
                  models,
                  agentBindings,
                  imageRuntimeOverrides: modelCenter.imageRuntime.overrides,
                  setModelCenter,
                  setModels,
                  setAgentBindings,
                  setFlashMessage
                });
              })
            }
          >
            {isPending ? "保存中..." : "保存当前绑定"}
          </button>
        </div>
      </section>
    </div>
  );
}

async function saveBindingChanges({
  models,
  agentBindings,
  imageRuntimeOverrides,
  setModelCenter,
  setModels,
  setAgentBindings,
  setFlashMessage
}: {
  models: ModelCenterSavedModel[];
  agentBindings: ModelCenterAgentBinding[];
  imageRuntimeOverrides: ModelCenterView["imageRuntime"]["overrides"];
  setModelCenter: (value: ModelCenterView) => void;
  setModels: (value: ModelCenterSavedModel[]) => void;
  setAgentBindings: (value: ModelCenterAgentBinding[]) => void;
  setFlashMessage: (value: FlashMessage | null) => void;
}) {
  try {
    const nextModelCenter = await updateModelCenterConfig({
      imageRuntime: imageRuntimeOverrides,
      models,
      agentBindings: normalizeBindings(agentBindings, models)
    });

    setModelCenter(nextModelCenter);
    setModels(nextModelCenter.models);
    setAgentBindings(normalizeBindings(nextModelCenter.agentBindings, nextModelCenter.models));
    setFlashMessage({
      tone: "success",
      text: "Agent 绑定已保存，后续新请求会按新的模型分配执行。"
    });
  } catch (error) {
    setFlashMessage({
      tone: "error",
      text: error instanceof Error ? error.message : "Agent 绑定保存失败。"
    });
  }
}
