import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
