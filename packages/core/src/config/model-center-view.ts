import { modelCenterAgentDefinitions } from "@zhihu-mvp/shared";
import type {
  ImageModelCenterRuntimeConfig,
  ModelCenterAgentBinding,
  ModelCenterAgentView,
  ModelCenterRuntimeEditableConfig,
  ModelCenterSavedModel,
  ModelCenterStoredConfig,
  ModelCenterView,
  UpdateModelCenterInput
} from "@zhihu-mvp/shared";
import { resolveImageRuntimeConfig } from "./image-runtime-config.js";
import { resolveLlmRuntimeConfig } from "./llm-provider.js";
import {
  readModelCenterStoredConfig,
  saveModelCenterConfig
} from "./model-center-store.js";

export function getModelCenterView(): ModelCenterView {
  const storedConfig = readModelCenterStoredConfig();
  const imageRuntime = resolveImageRuntimeConfig();
  const catalog = resolveCatalogState(storedConfig, imageRuntime.runtime);

  return {
    updatedAt: storedConfig.updatedAt,
    imageRuntime: {
      overrides: imageRuntime.overrides,
      fallbackConfig: imageRuntime.fallbackRuntime,
      fallbackFieldSources: imageRuntime.fallbackFieldSources,
      effectiveConfig: imageRuntime.runtime,
      fieldSources: imageRuntime.fieldSources
    },
    models: catalog.models,
    agentBindings: catalog.agentBindings,
    agents: modelCenterAgentDefinitions.map((definition) => {
      const resolved = resolveLlmRuntimeConfig(definition.name);

      return {
        agentName: definition.name,
        label: definition.label,
        shortLabel: definition.shortLabel,
        group: definition.group,
        scope: definition.scope,
        description: definition.description,
        overrides: resolved.overrides,
        fallbackConfig: mapEditableRuntimeConfig(resolved.fallbackRuntime),
        fallbackFieldSources: resolved.fallbackFieldSources,
        effectiveConfig: mapEditableRuntimeConfig(resolved.runtime),
        fieldSources: resolved.fieldSources
      } satisfies ModelCenterAgentView;
    })
  };
}

export function updateModelCenterView(input: UpdateModelCenterInput) {
  saveModelCenterConfig(input);
  return getModelCenterView();
}

function resolveCatalogState(
  storedConfig: ModelCenterStoredConfig,
  imageRuntime: ImageModelCenterRuntimeConfig
): {
  models: ModelCenterSavedModel[];
  agentBindings: ModelCenterAgentBinding[];
} {
  const hasStoredCatalog =
    storedConfig.models.length > 0 || storedConfig.agentBindings.some((binding) => binding.modelId !== null);

  if (hasStoredCatalog) {
    return {
      models: mergeImageRuntimeModels(storedConfig.models, imageRuntime),
      agentBindings: storedConfig.agentBindings
    };
  }

  const bootstrapGroups = new Map<
    string,
    {
      id: string;
      providerLabel: string | null;
      runtime: ModelCenterRuntimeEditableConfig;
      agentLabels: string[];
    }
  >();

  const agentBindings = modelCenterAgentDefinitions.map((definition) => {
    const resolved = resolveLlmRuntimeConfig(definition.name);
    const runtime = mapEditableRuntimeConfig(resolved.runtime);
    const providerLabel = inferProviderLabel(runtime.baseUrl, resolved.providerName);
    const signature = JSON.stringify({
      providerLabel,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      reasoningEffort: runtime.reasoningEffort,
      wireApi: runtime.wireApi,
      requestTimeoutMs: runtime.requestTimeoutMs
    });

    const existing = bootstrapGroups.get(signature);
    if (existing) {
      existing.agentLabels.push(definition.label);
      return {
        agentName: definition.name,
        modelId: existing.id
      };
    }

    const id = createBootstrapModelId(runtime.model, bootstrapGroups.size + 1);
    bootstrapGroups.set(signature, {
      id,
      providerLabel,
      runtime,
      agentLabels: [definition.label]
    });

    return {
      agentName: definition.name,
      modelId: id
    };
  });

  const models = Array.from(bootstrapGroups.values()).map((group) => ({
    id: group.id,
    name: group.runtime.model,
    providerLabel: group.providerLabel,
    notes: buildBootstrapNotes(group.agentLabels),
    overrides: {
      model: group.runtime.model,
      baseUrl: group.runtime.baseUrl,
      apiKey: null,
      reasoningEffort: group.runtime.reasoningEffort,
      wireApi: group.runtime.wireApi,
      requestTimeoutMs: group.runtime.requestTimeoutMs
    }
  }));

  return {
    models: mergeImageRuntimeModels(models, imageRuntime),
    agentBindings
  };
}

function buildBootstrapNotes(agentLabels: string[]) {
  if (agentLabels.length <= 3) {
    return `系统按当前生效配置自动带入。当前绑定：${agentLabels.join("、")}`;
  }

  return `系统按当前生效配置自动带入。当前绑定：${agentLabels.slice(0, 3).join("、")} 等 ${agentLabels.length} 个 Agent`;
}

function inferProviderLabel(baseUrl: string, providerName: string) {
  const normalizedBaseUrl = baseUrl.toLowerCase();
  const normalizedProvider = providerName.trim().toLowerCase();

  if (normalizedBaseUrl.includes("11434") || normalizedBaseUrl.includes("ollama")) {
    return "Ollama";
  }

  if (normalizedBaseUrl.includes("openai.com")) {
    return "OpenAI";
  }

  if (normalizedBaseUrl.includes("vpsairobot.com") || normalizedProvider === "sub2api") {
    return "Sub2API";
  }

  if (!normalizedProvider) {
    return null;
  }

  if (normalizedProvider.length <= 4) {
    return normalizedProvider.toUpperCase();
  }

  return normalizedProvider[0].toUpperCase() + normalizedProvider.slice(1);
}

function createBootstrapModelId(model: string, index: number) {
  const slug = model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `bootstrap-${slug || "model"}-${index}`;
}

function mergeImageRuntimeModels(models: ModelCenterSavedModel[], imageRuntime: ImageModelCenterRuntimeConfig) {
  const baseUrl = imageRuntime.ollamaBaseUrl.trim();
  const merged = [...models];
  const existingSignatures = new Set(merged.map((model) => buildModelSignature(model.overrides.model ?? model.name, model.overrides.baseUrl ?? baseUrl)));

  const imageModelEntries = [
    {
      kind: "主分析",
      modelName: imageRuntime.imageAnalysisModel
    },
    {
      kind: "OCR",
      modelName: imageRuntime.imageOcrModel
    },
    {
      kind: "OCR Judge",
      modelName: imageRuntime.imageOcrJudgeModel
    }
  ];

  for (const entry of imageModelEntries) {
    const modelName = entry.modelName.trim();
    if (!modelName) {
      continue;
    }

    const signature = buildModelSignature(modelName, baseUrl);
    if (existingSignatures.has(signature)) {
      continue;
    }

    existingSignatures.add(signature);
    merged.push({
      id: createBootstrapModelId(`image-${entry.kind}-${modelName}`, merged.length + 1),
      name: modelName,
      providerLabel: "Ollama",
      notes: `配图中心当前${entry.kind}模型自动带入。若要绑定给 Agent，请确认接口兼容性和鉴权方式。`,
      overrides: {
        model: modelName,
        baseUrl,
        apiKey: null,
        reasoningEffort: null,
        wireApi: null,
        requestTimeoutMs: null
      }
    });
  }

  return merged;
}

function buildModelSignature(model: string, baseUrl: string) {
  return JSON.stringify({
    model: model.trim(),
    baseUrl: baseUrl.trim()
  });
}

function mapEditableRuntimeConfig(runtime: {
  model: string;
  baseUrl: string;
  reasoningEffort: ModelCenterRuntimeEditableConfig["reasoningEffort"];
  wireApi: ModelCenterRuntimeEditableConfig["wireApi"];
  requestTimeoutMs: number;
}): ModelCenterRuntimeEditableConfig {
  return {
    model: runtime.model,
    baseUrl: runtime.baseUrl,
    reasoningEffort: runtime.reasoningEffort,
    wireApi: runtime.wireApi,
    requestTimeoutMs: runtime.requestTimeoutMs
  };
}
