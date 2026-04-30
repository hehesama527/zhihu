import path from "node:path";
import { getXAppConfig, type XAppConfig } from "@zhihu-mvp/x-core";

export function getXTraditionalAppConfig(): XAppConfig {
  const base = getXAppConfig();
  const dataDir = process.env.X_TRADITIONAL_DATA_DIR ?? path.join(base.workspaceRoot, "data-x-traditional");

  return {
    ...base,
    dataDir,
    apiPort: Number(process.env.X_TRADITIONAL_API_PORT ?? 8791),
    apiBaseUrl: process.env.X_TRADITIONAL_API_BASE_URL ?? "http://127.0.0.1:8791",
    webBaseUrl: process.env.X_TRADITIONAL_WEB_BASE_URL ?? "http://localhost:3000/twitter/traditional",
    workerIntervalMs: Number(process.env.X_TRADITIONAL_WORKER_INTERVAL_MS ?? base.workerIntervalMs),
    publishMode: normalizePublishMode(process.env.X_TRADITIONAL_PUBLISH_MODE),
    browserProfileRoot:
      process.env.X_TRADITIONAL_BROWSER_PROFILE_ROOT ?? path.join(dataDir, "profiles"),
    browserProxyUrl:
      normalizeOptionalValue(process.env.X_TRADITIONAL_BROWSER_PROXY_URL) ?? base.browserProxyUrl,
    xFeishuBotWebhookUrl:
      normalizeOptionalValue(process.env.X_TRADITIONAL_FEISHU_BOT_WEBHOOK_URL) ?? base.xFeishuBotWebhookUrl,
    xFeishuBotSecret:
      normalizeOptionalValue(process.env.X_TRADITIONAL_FEISHU_BOT_SECRET) ?? base.xFeishuBotSecret
  };
}

function normalizePublishMode(value: string | undefined): "dry_run" | "browser" {
  return value?.trim().toLowerCase() === "browser" ? "browser" : "dry_run";
}

function normalizeOptionalValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
