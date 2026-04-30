import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getAppConfig } from "../config/env.js";
import { getProfileUserAgent } from "./stealth-inject.js";

export type SupportedBrowserChannel = "chrome" | "msedge";

export function normalizeBrowserChannel(value?: string | null): SupportedBrowserChannel {
  return value === "chrome" ? "chrome" : "msedge";
}

export function getBrowserDisplayName(channel: SupportedBrowserChannel) {
  return channel === "msedge" ? "Edge" : "Chrome";
}

export function resolveBrowserProfileDir(profileDir: string, channel: SupportedBrowserChannel) {
  return path.join(profileDir, channel);
}

export function resolveBrowserExecutable(channel: SupportedBrowserChannel) {
  const envCandidate = process.env.BROWSER_PATH ?? process.env.CHROME_PATH;
  if (envCandidate) {
    return envCandidate;
  }

  const platform = process.platform;
  const candidates = getExecutableCandidates(platform, channel);
  for (const candidate of candidates) {
    if (existsSyncSafe(candidate)) {
      return candidate;
    }
  }

  const pathResolved = resolveFromPath(platform, channel);
  if (pathResolved) {
    return pathResolved;
  }

  throw new Error(`未找到 ${getBrowserDisplayName(channel)} 可执行文件。可以配置 BROWSER_PATH 后重试。`);
}

function getExecutableCandidates(platform: NodeJS.Platform, channel: SupportedBrowserChannel) {
  if (platform === "win32") {
    return getWindowsCandidates(channel);
  }

  if (platform === "darwin") {
    return channel === "msedge"
      ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }

  return channel === "msedge"
    ? ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
}

function getWindowsCandidates(channel: SupportedBrowserChannel) {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  if (channel === "msedge") {
    return [
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
    ];
  }

  return [
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
  ];
}

function resolveFromPath(platform: NodeJS.Platform, channel: SupportedBrowserChannel) {
  const command = platform === "win32" ? "where.exe" : "which";
  const binary =
    platform === "win32"
      ? channel === "msedge"
        ? "msedge.exe"
        : "chrome.exe"
      : channel === "msedge"
        ? "microsoft-edge"
        : "google-chrome";

  const result = spawnSync(command, [binary], {
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    return null;
  }

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);

  return firstLine ?? null;
}

function existsSyncSafe(filePath: string) {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Stealth launch options for Phase 1 anti-detection - PER PROFILE.
 * profileDir is used as seed to generate consistent but different UA and window-size per account.
 * Same profileDir always gets the same fingerprint configuration.
 * Follows 知乎反检测优化落地方案.md v3.0 + "每个账户指纹固定但不同" requirement.
 */
export function getStealthLaunchOptions(channel: SupportedBrowserChannel, profileDir?: string) {
  const config = getAppConfig();
  if (!config.antiDetectionV3Enabled) {
    return {
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
      userAgent: undefined as string | undefined,
      locale: undefined as string | undefined,
    };
  }

  const profileSeed = profileDir || 'default';

  // 20+ anti-detection args - use profile seed for window size variation
  const hash = profileSeed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const windowPresets = ['1920,1080', '1366,768', '1440,900', '1536,864'];
  const windowSize = windowPresets[Math.abs(hash) % windowPresets.length];

  const stealthArgs = [
    "--start-maximized",
    "--disable-blink-features=AutomationControlled",
    "--disable-blink-features=SiteIsolationTrials,Translate",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-features=AudioServiceOutOfProcess",
    "--lang=zh-CN",
    "--accept-lang=zh-CN,zh,en-US",
    `--window-size=${windowSize}`,
    "--force-device-scale-factor=1",
    "--disable-gpu",
    "--enable-features=NetworkService,NetworkServiceInProcess",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ];

  return {
    args: stealthArgs,
    userAgent: getProfileUserAgent(profileSeed),
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  };
}

/**
 * Get random realistic Edge UA from pool (for future UA rotation).
 */
export function getRandomUserAgent(): string {
  const uaPool = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
  ];
  return uaPool[Math.floor(Math.random() * uaPool.length)];
}
