import fs from "node:fs";
import type { Agent } from "node:http";
import { createRequire } from "node:module";
import { OpenAI } from "openai";
import toml from "toml";
import { getAppConfig } from "./env.js";

type CodexProviderConfig = {
  model_provider?: string;
  model?: string;
  model_reasoning_effort?: string;
  model_providers?: Record<string, { base_url?: string; wire_api?: string }>;
};

type CodexAuthConfig = {
  OPENAI_API_KEY?: string;
};

export interface LlmRuntimeConfig {
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  baseUrl: string;
  apiKey: string;
  proxyUrl: string | null;
  wireApi: "responses" | "chat_completions";
  requestTimeoutMs: number;
}

const require = createRequire(import.meta.url);

export type LlmConfigScope = "zhihu" | "ops";

export function readLlmRuntimeConfig(scope: LlmConfigScope = "zhihu"): LlmRuntimeConfig {
  const config = getAppConfig();
  const parsedToml = readCodexToml(config.codexConfigPath);
  const parsedAuth = readCodexAuth(config.codexAuthPath);
  const providerName = readScopedEnv(scope, "PROVIDER") ?? parsedToml.model_provider ?? "sub2api";
  const providerConfig = parsedToml.model_providers?.[providerName] ?? {};
  const baseUrl = readScopedEnv(scope, "BASE_URL") ?? providerConfig.base_url ?? "https://vpsairobot.com";
  const apiKey = readScopedEnv(scope, "API_KEY") ?? parsedAuth.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing LLM_API_KEY in project env or OPENAI_API_KEY in ~/.codex/auth.json");
  }

  return {
    model: readScopedEnv(scope, "MODEL") ?? parsedToml.model ?? "gpt-5.4",
    reasoningEffort: normalizeReasoning(readScopedEnv(scope, "REASONING_EFFORT") ?? parsedToml.model_reasoning_effort),
    baseUrl,
    apiKey,
    proxyUrl: resolveProxyUrl(),
    wireApi: normalizeWireApi(readScopedEnv(scope, "WIRE_API") ?? providerConfig.wire_api),
    requestTimeoutMs: normalizeRequestTimeout(readScopedEnv(scope, "REQUEST_TIMEOUT_MS"))
  };
}

function readCodexToml(filePath: string): CodexProviderConfig {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return toml.parse(fs.readFileSync(filePath, "utf8")) as CodexProviderConfig;
}

function readCodexAuth(filePath: string): CodexAuthConfig {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as CodexAuthConfig;
}

function readScopedEnv(scope: LlmConfigScope, name: string) {
  const candidates =
    scope === "ops"
      ? [`OPS_AGENT_${name}`, `LLM_${name}`]
      : [`ZHIHU_AGENT_${name}`, `LLM_${name}`];

  for (const key of candidates) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeReasoning(value?: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "high";
}

function normalizeWireApi(value?: string): "responses" | "chat_completions" {
  if (value === "chat_completions") {
    return "chat_completions";
  }

  return "responses";
}

export function createOpenAiClient(scope: LlmConfigScope = "zhihu") {
  const runtime = readLlmRuntimeConfig(scope);
  return new OpenAI({
    apiKey: runtime.apiKey,
    baseURL: runtime.baseUrl,
    httpAgent: createProxyAgent(runtime.proxyUrl),
    timeout: runtime.requestTimeoutMs
  });
}

function resolveProxyUrl() {
  const proxyValue = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.ALL_PROXY;
  if (!proxyValue) {
    return null;
  }

  return normalizeProxyUrl(proxyValue);
}

function normalizeProxyUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return `http://127.0.0.1:${trimmed}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function createProxyAgent(proxyUrl: string | null): Agent | undefined {
  if (!proxyUrl) {
    return undefined;
  }

  const proxyModule = require("next/dist/compiled/https-proxy-agent");
  const HttpsProxyAgent = proxyModule.HttpsProxyAgent ?? proxyModule.default?.HttpsProxyAgent;
  if (!HttpsProxyAgent) {
    throw new Error("Missing HttpsProxyAgent runtime.");
  }

  return new HttpsProxyAgent(proxyUrl) as Agent;
}

function normalizeRequestTimeout(value: string | null) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }

  return 3_600_000;
}
