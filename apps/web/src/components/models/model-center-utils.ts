import {
  modelCenterAgentDefinitions,
  type ImageModelCenterFieldSources,
  type ImageModelCenterOverrideFields,
  type ImageModelCenterRuntimeConfig,
  type ModelCenterAgentBinding,
  type ModelCenterAgentGroup,
  type ModelCenterAgentOverrideFields,
  type ModelCenterAgentView,
  type ModelCenterFieldSource,
  type ModelCenterFieldSources,
  type ModelCenterRuntimeEditableConfig,
  type ModelCenterSavedModel,
  type ModelCenterView
} from "@zhihu-mvp/shared";

export type FlashMessage = {
  tone: "success" | "error";
  text: string;
};

export function createEmptyModelOverrideFields(): ModelCenterAgentOverrideFields {
  return {
    model: null,
    baseUrl: null,
    apiKey: null,
    reasoningEffort: null,
    wireApi: null,
    requestTimeoutMs: null
  };
}

export function createEmptyImageOverrideFields(): ImageModelCenterOverrideFields {
  return {
    imageAnalysisModel: null,
    imageOcrModel: null,
    imageOcrJudgeModel: null,
    ollamaBaseUrl: null,
    imageAnalysisTimeoutMs: null
  };
}

export function createEmptySavedModel(id: string, name: string): ModelCenterSavedModel {
  return {
    id,
    name,
    providerLabel: null,
    notes: null,
    overrides: createEmptyModelOverrideFields()
  };
}

export function normalizeModelOverrideFields(
  input?: Partial<ModelCenterAgentOverrideFields> | null
): ModelCenterAgentOverrideFields {
  const normalized = createEmptyModelOverrideFields();

  if (!input) {
    return normalized;
  }

  const model = normalizeOptionalString(input.model);
  if (model) {
    normalized.model = model;
  }

  const baseUrl = normalizeOptionalString(input.baseUrl);
  if (baseUrl) {
    normalized.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  const apiKey = normalizeOptionalString(input.apiKey);
  if (apiKey) {
    normalized.apiKey = apiKey;
  }

  if (input.reasoningEffort === "low" || input.reasoningEffort === "medium" || input.reasoningEffort === "high") {
    normalized.reasoningEffort = input.reasoningEffort;
  }

  if (input.wireApi === "responses" || input.wireApi === "chat_completions") {
    normalized.wireApi = input.wireApi;
  }

  const requestTimeoutMs = normalizePositiveInteger(input.requestTimeoutMs);
  if (requestTimeoutMs != null) {
    normalized.requestTimeoutMs = requestTimeoutMs;
  }

  return normalized;
}

export function normalizeSavedModel(model: ModelCenterSavedModel): ModelCenterSavedModel {
  return {
    id: normalizeOptionalString(model.id) ?? model.id,
    name: normalizeOptionalString(model.name) ?? model.name,
    providerLabel: normalizeOptionalString(model.providerLabel),
    notes: normalizeOptionalString(model.notes),
    overrides: normalizeModelOverrideFields(model.overrides)
  };
}

export function normalizeImageDraft(draft: ImageModelCenterOverrideFields): ImageModelCenterOverrideFields {
  return {
    imageAnalysisModel: normalizeOptionalString(draft.imageAnalysisModel),
    imageOcrModel: normalizeOptionalString(draft.imageOcrModel),
    imageOcrJudgeModel: normalizeOptionalString(draft.imageOcrJudgeModel),
    ollamaBaseUrl: normalizeOptionalString(draft.ollamaBaseUrl)?.replace(/\/+$/, "") ?? null,
    imageAnalysisTimeoutMs: normalizePositiveInteger(draft.imageAnalysisTimeoutMs)
  };
}

export function normalizeBindings(
  bindings: ModelCenterAgentBinding[],
  models: ModelCenterSavedModel[]
): ModelCenterAgentBinding[] {
  const modelIds = new Set(models.map((model) => model.id));
  const bindingMap = new Map(bindings.map((binding) => [binding.agentName, binding] as const));

  return modelCenterAgentDefinitions.map((definition) => {
    const binding = bindingMap.get(definition.name);
    return {
      agentName: definition.name,
      modelId: binding?.modelId && modelIds.has(binding.modelId) ? binding.modelId : null
    };
  });
}

export function findBinding(
  bindings: ModelCenterAgentBinding[],
  agentName: ModelCenterAgentBinding["agentName"]
) {
  return bindings.find((binding) => binding.agentName === agentName) ?? {
    agentName,
    modelId: null
  };
}

export function serializeModels(models: ModelCenterSavedModel[]) {
  return JSON.stringify(models.map((model) => normalizeSavedModel(model)));
}

export function serializeBindings(bindings: ModelCenterAgentBinding[], models: ModelCenterSavedModel[]) {
  return JSON.stringify(normalizeBindings(bindings, models));
}

export function serializeImageDraft(draft: ImageModelCenterOverrideFields) {
  return JSON.stringify(normalizeImageDraft(draft));
}

export function resolveAgentPreview(agent: ModelCenterAgentView, savedModel: ModelCenterSavedModel | null) {
  const overrides = savedModel ? normalizeModelOverrideFields(savedModel.overrides) : createEmptyModelOverrideFields();

  return {
    config: {
      model: overrides.model ?? agent.fallbackConfig.model,
      baseUrl: overrides.baseUrl ?? agent.fallbackConfig.baseUrl,
      reasoningEffort: overrides.reasoningEffort ?? agent.fallbackConfig.reasoningEffort,
      wireApi: overrides.wireApi ?? agent.fallbackConfig.wireApi,
      requestTimeoutMs: overrides.requestTimeoutMs ?? agent.fallbackConfig.requestTimeoutMs
    } satisfies ModelCenterRuntimeEditableConfig,
    fieldSources: {
      model: overrides.model ? "override" : agent.fallbackFieldSources.model,
      baseUrl: overrides.baseUrl ? "override" : agent.fallbackFieldSources.baseUrl,
      apiKey: overrides.apiKey ? "override" : agent.fallbackFieldSources.apiKey,
      reasoningEffort: overrides.reasoningEffort ? "override" : agent.fallbackFieldSources.reasoningEffort,
      wireApi: overrides.wireApi ? "override" : agent.fallbackFieldSources.wireApi,
      requestTimeoutMs: overrides.requestTimeoutMs ? "override" : agent.fallbackFieldSources.requestTimeoutMs
    } satisfies ModelCenterFieldSources,
    hasApiKey: Boolean(overrides.apiKey) || agent.fallbackFieldSources.apiKey !== "default"
  };
}

export function resolveImageRuntimePreview(model: ModelCenterView["imageRuntime"], draft: ImageModelCenterOverrideFields) {
  const normalized = normalizeImageDraft(draft);

  return {
    config: {
      imageAnalysisModel: normalized.imageAnalysisModel ?? model.fallbackConfig.imageAnalysisModel,
      imageOcrModel: normalized.imageOcrModel ?? model.fallbackConfig.imageOcrModel,
      imageOcrJudgeModel: normalized.imageOcrJudgeModel ?? model.fallbackConfig.imageOcrJudgeModel,
      ollamaBaseUrl: normalized.ollamaBaseUrl ?? model.fallbackConfig.ollamaBaseUrl,
      imageAnalysisTimeoutMs: normalized.imageAnalysisTimeoutMs ?? model.fallbackConfig.imageAnalysisTimeoutMs
    } satisfies ImageModelCenterRuntimeConfig,
    fieldSources: {
      imageAnalysisModel: normalized.imageAnalysisModel ? "override" : model.fallbackFieldSources.imageAnalysisModel,
      imageOcrModel: normalized.imageOcrModel ? "override" : model.fallbackFieldSources.imageOcrModel,
      imageOcrJudgeModel: normalized.imageOcrJudgeModel ? "override" : model.fallbackFieldSources.imageOcrJudgeModel,
      ollamaBaseUrl: normalized.ollamaBaseUrl ? "override" : model.fallbackFieldSources.ollamaBaseUrl,
      imageAnalysisTimeoutMs:
        normalized.imageAnalysisTimeoutMs ? "override" : model.fallbackFieldSources.imageAnalysisTimeoutMs
    } satisfies ImageModelCenterFieldSources
  };
}

export function getAgentsByGroup(modelCenter: ModelCenterView, group: ModelCenterAgentGroup) {
  return modelCenter.agents.filter((agent) => agent.group === group);
}

export function getModelUsageAgentNames(bindings: ModelCenterAgentBinding[], modelId: string) {
  const definitions = new Map(modelCenterAgentDefinitions.map((definition) => [definition.name, definition] as const));

  return bindings.flatMap((binding) => {
    if (binding.modelId !== modelId) {
      return [];
    }

    const definition = definitions.get(binding.agentName);
    return [definition?.label ?? binding.agentName];
  });
}

export function formatTimestamp(value: string | null) {
  if (!value) {
    return "尚未保存";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatTimeout(value: number) {
  if (value >= 60_000) {
    return `${Math.round(value / 1000)} 秒`;
  }

  return `${value} ms`;
}

export function formatWireApi(value: ModelCenterRuntimeEditableConfig["wireApi"]) {
  return value === "chat_completions" ? "Chat Completions" : "Responses";
}

export function formatReasoning(value: ModelCenterRuntimeEditableConfig["reasoningEffort"]) {
  return `Reasoning ${value}`;
}

export function formatSourceLabel(value: ModelCenterFieldSource) {
  if (value === "override") {
    return "模型库配置";
  }

  if (value === "env") {
    return "环境变量";
  }

  if (value === "codex_config") {
    return "Codex 配置";
  }

  if (value === "codex_auth") {
    return "Codex Auth";
  }

  return "系统默认";
}

export function buildNextModelName(models: ModelCenterSavedModel[]) {
  return `新模型 ${models.length + 1}`;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.round(numeric);
}
