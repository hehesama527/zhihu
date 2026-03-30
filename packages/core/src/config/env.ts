import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBrowserChannel, type SupportedBrowserChannel } from "../utils/browser.js";

export interface AppConfig {
  mysqlUrl: string;
  apiPort: number;
  webUrl: string;
  apiUrl: string;
  feishuBotWebhookUrl: string | null;
  feishuBotSecret: string | null;
  timezone: string;
  workspaceRoot: string;
  dataDir: string;
  codexHome: string;
  codexConfigPath: string;
  codexAuthPath: string;
  humanizerSkillPath: string;
  browserChannel: SupportedBrowserChannel;
  workerIntervalMs: number;
  opsAgentIntervalMs: number;
  topicKeywords: string[];
  zhihuBaseUrl: string;
}

let envLoaded = false;
let cachedWorkspaceRoot: string | null = null;

export function getAppConfig(): AppConfig {
  const workspaceRoot = findWorkspaceRoot();
  ensureWorkspaceEnvLoaded(workspaceRoot);
  const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");

  return {
    mysqlUrl: process.env.MYSQL_URL ?? "mysql://root:password@127.0.0.1:6306/zhihu_mvp",
    apiPort: Number(process.env.API_PORT ?? 8787),
    webUrl: process.env.WEB_URL ?? "http://localhost:3000",
    apiUrl: process.env.API_URL ?? "http://localhost:8787",
    feishuBotWebhookUrl: normalizeOptionalEnvValue(process.env.FEISHU_BOT_WEBHOOK_URL),
    feishuBotSecret: normalizeOptionalEnvValue(process.env.FEISHU_BOT_SECRET),
    timezone: process.env.APP_TIMEZONE ?? "Asia/Shanghai",
    workspaceRoot,
    dataDir: process.env.DATA_DIR ?? path.join(workspaceRoot, "data"),
    codexHome,
    codexConfigPath: process.env.CODEX_CONFIG_PATH ?? path.join(codexHome, "config.toml"),
    codexAuthPath: process.env.CODEX_AUTH_PATH ?? path.join(codexHome, "auth.json"),
    humanizerSkillPath:
      process.env.HUMANIZER_SKILL_PATH ?? path.join(codexHome, "skills", "humanizer-zh", "SKILL.md"),
    browserChannel: normalizeBrowserChannel(process.env.BROWSER_CHANNEL),
    workerIntervalMs: Number(process.env.WORKER_INTERVAL_MS ?? 45_000),
    opsAgentIntervalMs: Number(process.env.OPS_AGENT_INTERVAL_MS ?? 60_000),
    topicKeywords: (process.env.TOPIC_KEYWORDS ??
      "币圈新手,加密货币市场,币圈交易,交易策略,止盈止损,趋势和震荡判断,量化回测,策略验证,可视化回测")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    zhihuBaseUrl: process.env.ZHIHU_BASE_URL ?? "https://www.zhihu.com"
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
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { workspaces?: unknown };
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

function normalizeOptionalEnvValue(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
