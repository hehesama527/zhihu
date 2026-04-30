import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface XAppConfig {
  workspaceRoot: string;
  dataDir: string;
  apiPort: number;
  apiBaseUrl: string;
  webBaseUrl: string;
  workerIntervalMs: number;
  publishMode: "dry_run" | "browser";
  browserChannel: string;
  browserProfileRoot: string;
  browserProxyUrl: string | null;
  browserHeadless: boolean;
  xBaseUrl: string;
  xFeishuBotWebhookUrl: string | null;
  xFeishuBotSecret: string | null;
  antiDetectionV3Enabled: boolean;
}

let envLoaded = false;
let cachedWorkspaceRoot: string | null = null;

export function getXAppConfig(): XAppConfig {
  const workspaceRoot = findWorkspaceRoot();
  ensureWorkspaceEnvLoaded(workspaceRoot);

  return {
    workspaceRoot,
    dataDir: process.env.X_DATA_DIR ?? path.join(workspaceRoot, "data-x"),
    apiPort: Number(process.env.X_API_PORT ?? 8788),
    apiBaseUrl: process.env.X_API_BASE_URL ?? "http://127.0.0.1:8788",
    webBaseUrl: process.env.X_WEB_BASE_URL ?? "http://localhost:3000/twitter",
    workerIntervalMs: Number(process.env.X_WORKER_INTERVAL_MS ?? 45_000),
    publishMode: normalizePublishMode(process.env.X_PUBLISH_MODE),
    browserChannel: normalizeOptionalValue(process.env.X_BROWSER_CHANNEL) ?? normalizeOptionalValue(process.env.BROWSER_CHANNEL) ?? "msedge",
    browserProfileRoot: process.env.X_BROWSER_PROFILE_ROOT ?? path.join(workspaceRoot, "data-x", "profiles"),
    browserProxyUrl: normalizeOptionalValue(process.env.X_BROWSER_PROXY_URL) ?? normalizeOptionalValue(process.env.ALL_PROXY),
    browserHeadless: normalizeBoolean(process.env.X_BROWSER_HEADLESS),
    xBaseUrl: process.env.X_BASE_URL ?? "https://x.com",
    xFeishuBotWebhookUrl: normalizeOptionalValue(process.env.X_FEISHU_BOT_WEBHOOK_URL),
    xFeishuBotSecret: normalizeOptionalValue(process.env.X_FEISHU_BOT_SECRET),
    antiDetectionV3Enabled: process.env.ANTI_DETECTION_V3_ENABLED !== "false"
  };
}

function ensureWorkspaceEnvLoaded(workspaceRoot: string) {
  if (envLoaded) {
    return;
  }

  envLoaded = true;

  const envFiles = new Set<string>([...findEnvFiles(workspaceRoot), ...findEnvFiles(process.cwd())]);
  for (const filePath of envFiles) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = unquoteEnvValue(rawValue);
    }
  }
}

function findWorkspaceRoot() {
  if (cachedWorkspaceRoot) {
    return cachedWorkspaceRoot;
  }

  const searchStarts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const startDir of searchStarts) {
    const found = findUp(startDir, (candidate) => {
      const packageJsonPath = path.join(candidate, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        return false;
      }

      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
          workspaces?: unknown;
        };
        return Array.isArray(pkg.workspaces);
      } catch {
        return false;
      }
    });

    if (found) {
      cachedWorkspaceRoot = found;
      return found;
    }
  }

  cachedWorkspaceRoot = process.cwd();
  return cachedWorkspaceRoot;
}

function findUp(startDir: string, predicate: (candidate: string) => boolean) {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (predicate(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function findEnvFiles(startDir: string) {
  const candidates: string[] = [];
  let currentDir = path.resolve(startDir);

  while (true) {
    candidates.push(path.join(currentDir, ".env"));
    candidates.push(path.join(currentDir, ".env.local"));

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return candidates;
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizePublishMode(value: string | undefined): "dry_run" | "browser" {
  return value?.trim().toLowerCase() === "browser" ? "browser" : "dry_run";
}

function normalizeOptionalValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeBoolean(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
