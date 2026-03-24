import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { getAppConfig } from "../config/env.js";
import { resolveBrowserExecutable, resolveBrowserProfileDir } from "./browser.js";

type LaunchManualChromeResult = {
  executablePath: string;
  pid: number | undefined;
  targetUrl: string;
  profileDir: string;
};

export async function launchManualBrowser(profileDir: string, targetUrl: string): Promise<LaunchManualChromeResult> {
  const browserChannel = getAppConfig().browserChannel;
  const resolvedProfileDir = resolveBrowserProfileDir(profileDir, browserChannel);
  await fs.mkdir(resolvedProfileDir, { recursive: true });

  const executablePath = resolveBrowserExecutable(browserChannel);
  const baseArgs = [
    `--user-data-dir=${resolvedProfileDir}`,
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check"
  ];

  const child = spawn(executablePath, baseArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });

  child.unref();

  await wait(1500);

  const targetChild = spawn(executablePath, [`--user-data-dir=${resolvedProfileDir}`, targetUrl], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });

  targetChild.unref();

  return {
    executablePath,
    pid: child.pid,
    targetUrl,
    profileDir: resolvedProfileDir
  };
}

export async function launchManualChrome(profileDir: string, targetUrl: string): Promise<LaunchManualChromeResult> {
  return launchManualBrowser(profileDir, targetUrl);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
