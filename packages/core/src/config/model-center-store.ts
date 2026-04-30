import fs from "node:fs";
import path from "node:path";
import {
  modelCenterStoredConfigSchema,
  updateModelCenterSchema,
  type ModelCenterAgentBindingInput,
  type ModelCenterAgentOverrideInput,
  type ModelCenterSavedModelInput,
  type ModelCenterStoredConfigInput
} from "@zhihu-mvp/shared";
import type {
  ImageModelCenterOverrideFields,
  ModelCenterAgentBinding,
  ModelCenterAgentName,
  ModelCenterAgentOverride,
  ModelCenterAgentOverrideFields,
  ModelCenterSavedModel,
  ModelCenterStoredConfig,
  UpdateModelCenterInput
} from "@zhihu-mvp/shared";
import { modelCenterAgentDefinitions } from "@zhihu-mvp/shared";
import { getAppConfig } from "./env.js";

const MODEL_CENTER_CONFIG_VERSION = 2;

export function getModelCenterConfigPath() {
  return path.join(getAppConfig().dataDir, "model-center.json");
}

export function createEmptyModelCenterOverrideFields(): ModelCenterAgentOverrideFields {
  return {
    model: null,
    baseUrl: null,
    apiKey: null,
    reasoningEffort: null,
    wireApi: null,
    requestTimeoutMs: null
  };
}

export function createEmptyImageModelCenterOverrideFields(): ImageModelCenterOverrideFields {
  return {
    imageAnalysisModel: null,
    imageOcrModel: null,
    imageOcrJudgeModel: null,
    ollamaBaseUrl: null,
    imageAnalysisTimeoutMs: null
  };
}

export function hasModelCenterOverrideValue(fields: ModelCenterAgentOverrideFields) {
  return Object.values(fields).some((value) => value !== null);
}

export function hasImageModelCenterOverrideValue(fields: ImageModelCenterOverrideFields) {
  return Object.values(fields).some((value) => value !== null);
}

export function normalizeModelCenterOverrideFields(
  input?: Partial<ModelCenterAgentOverrideFields> | null
): ModelCenterAgentOverrideFields {
  const normalized = createEmptyModelCenterOverrideFields();

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

  const requestTimeoutMs = normalizeOptionalPositiveInteger(input.requestTimeoutMs);
  if (requestTimeoutMs != null) {
    normalized.requestTimeoutMs = requestTimeoutMs;
  }

  return normalized;
}

export function normalizeImageModelCenterOverrideFields(
  input?: Partial<ImageModelCenterOverrideFields> | null
): ImageModelCenterOverrideFields {
  const normalized = createEmptyImageModelCenterOverrideFields();

  if (!input) {
    return normalized;
  }

  const imageAnalysisModel = normalizeOptionalString(input.imageAnalysisModel);
  if (imageAnalysisModel) {
    normalized.imageAnalysisModel = imageAnalysisModel;
  }

  const imageOcrModel = normalizeOptionalString(input.imageOcrModel);
  if (imageOcrModel) {
    normalized.imageOcrModel = imageOcrModel;
  }

  const imageOcrJudgeModel = normalizeOptionalString(input.imageOcrJudgeModel);
  if (imageOcrJudgeModel) {
    normalized.imageOcrJudgeModel = imageOcrJudgeModel;
  }

  const ollamaBaseUrl = normalizeOptionalString(input.ollamaBaseUrl);
  if (ollamaBaseUrl) {
    normalized.ollamaBaseUrl = ollamaBaseUrl.replace(/\/+$/, "");
  }

  const imageAnalysisTimeoutMs = normalizeOptionalPositiveInteger(input.imageAnalysisTimeoutMs);
  if (imageAnalysisTimeoutMs != null) {
    normalized.imageAnalysisTimeoutMs = imageAnalysisTimeoutMs;
  }

  return normalized;
}

export function readModelCenterStoredConfig(): ModelCenterStoredConfig {
  const filePath = getModelCenterConfigPath();

  if (!fs.existsSync(filePath)) {
    return createEmptyStoredConfig();
  }

  try {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const rawParsed = JSON.parse(rawContent) as ModelCenterStoredConfigInput;
    const parsed = modelCenterStoredConfigSchema.parse(rawParsed);

    const models = normalizeStoredModels(parsed.models);
    const agentBindings = normalizeStoredAgentBindings(parsed.agentBindings, models);
    const agents = normalizeStoredAgentOverrides(parsed.agents);

    return {
      version: MODEL_CENTER_CONFIG_VERSION,
      updatedAt: parsed.updatedAt ?? null,
      imageRuntime: normalizeImageModelCenterOverrideFields(parsed.imageRuntime),
      models,
      agentBindings,
      agents
    };
  } catch (error) {
    console.warn(
      `[model-center] failed to read ${filePath}, falling back to env defaults: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return createEmptyStoredConfig();
  }
}

export function readModelCenterAgentOverrides() {
  const result = {} as Partial<Record<ModelCenterAgentName, ModelCenterAgentOverrideFields>>;

  for (const item of readModelCenterStoredConfig().agents) {
    result[item.agentName] = extractOverrideFields(item);
  }

  return result;
}

export function readImageModelCenterOverride() {
  return readModelCenterStoredConfig().imageRuntime;
}

export function readModelCenterAgentOverride(agentName: ModelCenterAgentName) {
  const match = readModelCenterStoredConfig().agents.find((item) => item.agentName === agentName);
  return match ? extractOverrideFields(match) : createEmptyModelCenterOverrideFields();
}

export function saveModelCenterConfig(input: UpdateModelCenterInput): ModelCenterStoredConfig {
  const parsed = updateModelCenterSchema.parse(input);
  const filePath = getModelCenterConfigPath();
  const normalizedModels = normalizeStoredModels(parsed.models);
  const normalizedBindings = normalizeStoredAgentBindings(parsed.agentBindings, normalizedModels);
  const normalizedAgents =
    normalizedModels.length > 0 || normalizedBindings.some((binding) => binding.modelId)
      ? synthesizeAgentOverrides(normalizedModels, normalizedBindings)
      : normalizeStoredAgentOverrides(parsed.agents ?? []).filter((item) => hasModelCenterOverrideValue(extractOverrideFields(item)));

  const nextConfig: ModelCenterStoredConfig = {
    version: MODEL_CENTER_CONFIG_VERSION,
    updatedAt: new Date().toISOString(),
    imageRuntime: normalizeImageModelCenterOverrideFields(parsed.imageRuntime),
    models: normalizedModels,
    agentBindings: normalizedBindings,
    agents: normalizedAgents
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  return nextConfig;
}

function createEmptyStoredConfig(): ModelCenterStoredConfig {
  return {
    version: MODEL_CENTER_CONFIG_VERSION,
    updatedAt: null,
    imageRuntime: createEmptyImageModelCenterOverrideFields(),
    models: [],
    agentBindings: modelCenterAgentDefinitions.map((definition) => ({
      agentName: definition.name,
      modelId: null
    })),
    agents: []
  };
}

function normalizeStoredModels(entries: ModelCenterSavedModelInput[]): ModelCenterSavedModel[] {
  const map = new Map<string, ModelCenterSavedModel>();

  for (const entry of entries) {
    const id = normalizeOptionalString(entry.id);
    const name = normalizeOptionalString(entry.name);
    if (!id || !name) {
      continue;
    }

    map.set(id, {
      id,
      name,
      providerLabel: normalizeOptionalString(entry.providerLabel),
      notes: normalizeOptionalString(entry.notes),
      overrides: normalizeModelCenterOverrideFields(entry.overrides)
    });
  }

  return Array.from(map.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function normalizeStoredAgentBindings(
  entries: ModelCenterAgentBindingInput[],
  models: ModelCenterSavedModel[]
): ModelCenterAgentBinding[] {
  const modelIds = new Set(models.map((item) => item.id));
  const map = new Map<ModelCenterAgentName, ModelCenterAgentBinding>();

  for (const entry of entries) {
    map.set(entry.agentName, {
      agentName: entry.agentName,
      modelId: entry.modelId && modelIds.has(entry.modelId) ? entry.modelId : null
    });
  }

  return modelCenterAgentDefinitions.map((definition) => ({
    agentName: definition.name,
    modelId: map.get(definition.name)?.modelId ?? null
  }));
}

function synthesizeAgentOverrides(
  models: ModelCenterSavedModel[],
  bindings: ModelCenterAgentBinding[]
): ModelCenterAgentOverride[] {
  const modelMap = new Map(models.map((item) => [item.id, item] as const));

  return bindings.flatMap((binding) => {
    if (!binding.modelId) {
      return [];
    }

    const matchedModel = modelMap.get(binding.modelId);
    if (!matchedModel) {
      return [];
    }

    const overrides = normalizeModelCenterOverrideFields(matchedModel.overrides);
    if (!hasModelCenterOverrideValue(overrides)) {
      return [];
    }

    return [
      {
        agentName: binding.agentName,
        ...overrides
      }
    ] satisfies ModelCenterAgentOverride[];
  });
}

function normalizeStoredAgentOverrides(entries: ModelCenterAgentOverrideInput[]): ModelCenterAgentOverride[] {
  const map = new Map<ModelCenterAgentName, ModelCenterAgentOverride>();

  for (const entry of entries) {
    map.set(entry.agentName, {
      agentName: entry.agentName,
      ...normalizeModelCenterOverrideFields(entry)
    });
  }

  return modelCenterAgentDefinitions.flatMap((definition) => {
    const item = map.get(definition.name);
    return item ? [item] : [];
  });
}

function extractOverrideFields(value: ModelCenterAgentOverride): ModelCenterAgentOverrideFields {
  return {
    model: value.model,
    baseUrl: value.baseUrl,
    apiKey: value.apiKey,
    reasoningEffort: value.reasoningEffort,
    wireApi: value.wireApi,
    requestTimeoutMs: value.requestTimeoutMs
  };
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOptionalPositiveInteger(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.round(numeric);
}
