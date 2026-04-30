import type {
  ImageModelCenterFieldSources,
  ImageModelCenterOverrideFields,
  ImageModelCenterRuntimeConfig
} from "@zhihu-mvp/shared";
import { getAppConfig } from "./env.js";
import { createEmptyImageModelCenterOverrideFields, readImageModelCenterOverride } from "./model-center-store.js";

export type ResolvedImageRuntimeConfig = {
  runtime: ImageModelCenterRuntimeConfig;
  fallbackRuntime: ImageModelCenterRuntimeConfig;
  overrides: ImageModelCenterOverrideFields;
  fieldSources: ImageModelCenterFieldSources;
  fallbackFieldSources: ImageModelCenterFieldSources;
};

export function resolveImageRuntimeConfig(): ResolvedImageRuntimeConfig {
  const appConfig = getAppConfig();
  const overrides = readImageModelCenterOverride();
  const fallbackRuntime: ImageModelCenterRuntimeConfig = {
    imageAnalysisModel: appConfig.imageAnalysisModel,
    imageOcrModel: appConfig.imageOcrModel,
    imageOcrJudgeModel: appConfig.imageOcrJudgeModel,
    ollamaBaseUrl: appConfig.ollamaBaseUrl,
    imageAnalysisTimeoutMs: appConfig.imageAnalysisTimeoutMs
  };
  const fallbackFieldSources: ImageModelCenterFieldSources = {
    imageAnalysisModel: hasEnvValue("IMAGE_ANALYSIS_MODEL") ? "env" : "default",
    imageOcrModel: hasEnvValue("IMAGE_OCR_MODEL") || hasEnvValue("IMAGE_ANALYSIS_MODEL") ? "env" : "default",
    imageOcrJudgeModel:
      hasEnvValue("IMAGE_OCR_JUDGE_MODEL") || hasEnvValue("IMAGE_OCR_MODEL") || hasEnvValue("IMAGE_ANALYSIS_MODEL")
        ? "env"
        : "default",
    ollamaBaseUrl: hasEnvValue("OLLAMA_BASE_URL") ? "env" : "default",
    imageAnalysisTimeoutMs: hasEnvValue("IMAGE_ANALYSIS_TIMEOUT_MS") ? "env" : "default"
  };

  return {
    runtime: {
      imageAnalysisModel: overrides.imageAnalysisModel ?? fallbackRuntime.imageAnalysisModel,
      imageOcrModel: overrides.imageOcrModel ?? fallbackRuntime.imageOcrModel,
      imageOcrJudgeModel: overrides.imageOcrJudgeModel ?? fallbackRuntime.imageOcrJudgeModel,
      ollamaBaseUrl: overrides.ollamaBaseUrl ?? fallbackRuntime.ollamaBaseUrl,
      imageAnalysisTimeoutMs: overrides.imageAnalysisTimeoutMs ?? fallbackRuntime.imageAnalysisTimeoutMs
    },
    fallbackRuntime,
    overrides: overrides ?? createEmptyImageModelCenterOverrideFields(),
    fieldSources: {
      imageAnalysisModel: overrides.imageAnalysisModel ? "override" : fallbackFieldSources.imageAnalysisModel,
      imageOcrModel: overrides.imageOcrModel ? "override" : fallbackFieldSources.imageOcrModel,
      imageOcrJudgeModel: overrides.imageOcrJudgeModel ? "override" : fallbackFieldSources.imageOcrJudgeModel,
      ollamaBaseUrl: overrides.ollamaBaseUrl ? "override" : fallbackFieldSources.ollamaBaseUrl,
      imageAnalysisTimeoutMs: overrides.imageAnalysisTimeoutMs ? "override" : fallbackFieldSources.imageAnalysisTimeoutMs
    },
    fallbackFieldSources
  };
}

export function readImageRuntimeConfig() {
  return resolveImageRuntimeConfig().runtime;
}

function hasEnvValue(name: string) {
  return typeof process.env[name] === "string" && process.env[name]?.trim().length > 0;
}
