import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type { ToolTraceAction, ToolTraceStage } from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";
import { JobRepository } from "../repositories/job-repository.js";
import { resolveBrowserProfileDir } from "../utils/browser.js";

type RuntimeSession = {
  context: BrowserContext;
  page: Page;
  profileDir: string;
  lockPath: string;
  lockOwner: string;
};

export type RuntimeTraceContext = {
  sessionKey: string;
  profileDir: string;
  publishJobId?: number | null;
  publishAttemptId?: number | null;
  stage?: ToolTraceStage;
  traceGroupId?: string;
};

type ClickInput = {
  names?: string[];
  roles?: Array<"button" | "link">;
  selectors?: string[];
  exact?: boolean;
};

type FocusInput = {
  selectors: string[];
};

type TypeInput = {
  text: string;
  delay?: number;
};

type PressInput = {
  key: string;
};

type OpenInput = {
  url: string;
};

type WaitInput = {
  ms: number;
};

type ScreenshotInput = {
  label: string;
};

export type PageSnapshot = {
  url: string;
  title: string;
  visibleTexts: string[];
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  questionLinks: Array<{ text: string; href: string }>;
  editorContent: string | null;
  editorContentLength: number;
};

export class PlaywrightToolRuntime {
  private readonly sessions = new Map<string, RuntimeSession>();

  constructor(private readonly jobRepository?: JobRepository) {}

  async open(traceContext: RuntimeTraceContext, input: OpenInput) {
    return this.runWithTrace(traceContext, "open", input, async (page) => {
      await page.goto(input.url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000
      });
      return {
        url: page.url()
      };
    });
  }

  async snapshot(traceContext: RuntimeTraceContext) {
    return this.runWithTrace(traceContext, "snapshot", {}, async (page) => this.readSnapshot(page));
  }

  async click(traceContext: RuntimeTraceContext, input: ClickInput) {
    return this.runWithTrace(traceContext, "click", input, async (page) => {
      const result = await tryClick(page, input);
      if (!result.ok) {
        throw new Error("没有找到可点击的目标。");
      }
      return result;
    });
  }

  async focus(traceContext: RuntimeTraceContext, input: FocusInput) {
    return this.runWithTrace(traceContext, "focus", input, async (page) => {
      for (const selector of input.selectors) {
        const locator = page.locator(selector).first();
        if ((await locator.count()) > 0) {
          await locator.scrollIntoViewIfNeeded();
          await locator.click();
          return {
            ok: true,
            selector
          };
        }
      }

      throw new Error("未找到可聚焦的输入区域。");
    });
  }

  async pasteText(traceContext: RuntimeTraceContext, input: TypeInput) {
    return this.runWithTrace(traceContext, "paste_text", { length: input.text.length }, async (page) => {
      await page.keyboard.insertText(input.text);
      return {
        ok: true,
        insertedLength: input.text.length
      };
    });
  }

  async type(traceContext: RuntimeTraceContext, input: TypeInput) {
    return this.runWithTrace(traceContext, "type", { length: input.text.length, delay: input.delay ?? 0 }, async (page) => {
      await page.keyboard.type(input.text, {
        delay: input.delay ?? 20
      });
      return {
        ok: true,
        typedLength: input.text.length
      };
    });
  }

  async press(traceContext: RuntimeTraceContext, input: PressInput) {
    return this.runWithTrace(traceContext, "press", input, async (page) => {
      await page.keyboard.press(input.key);
      return {
        ok: true,
        key: input.key
      };
    });
  }

  async wait(traceContext: RuntimeTraceContext, input: WaitInput) {
    return this.runWithTrace(traceContext, "wait", input, async (page) => {
      await page.waitForTimeout(input.ms);
      return {
        ok: true,
        waitedMs: input.ms,
        url: page.url()
      };
    });
  }

  async getUrl(traceContext: RuntimeTraceContext) {
    return this.runWithTrace(traceContext, "get_url", {}, async (page) => ({
      url: page.url()
    }));
  }

  async screenshot(traceContext: RuntimeTraceContext, input: ScreenshotInput) {
    return this.runWithTrace(traceContext, "screenshot", input, async (page) => {
      const screenshotDir = path.join(getAppConfig().dataDir, "screenshots");
      await fs.mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.join(
        screenshotDir,
        `${sanitizeFileSegment(input.label)}-${Date.now()}.png`
      );

      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });

      return {
        ok: true,
        screenshotPath
      };
    });
  }

  async closeSession(sessionKey: string) {
    await this.disposeSession(sessionKey, {
      closeContext: true
    });
  }

  hasSession(sessionKey: string) {
    return this.sessions.has(sessionKey);
  }

  async restartSession(traceContext: RuntimeTraceContext) {
    await this.disposeSession(traceContext.sessionKey, {
      closeContext: true
    });
    await wait(500);
    await this.ensureSession(traceContext);
  }

  private async ensureSession(traceContext: RuntimeTraceContext) {
    const existing = this.sessions.get(traceContext.sessionKey);
    if (existing) {
      if (!existing.page.isClosed()) {
        return existing;
      }

      await this.disposeSession(traceContext.sessionKey, {
        closeContext: true
      });
    }

    const browserChannel = getAppConfig().browserChannel;
    const resolvedProfileDir = resolveBrowserProfileDir(traceContext.profileDir, browserChannel);
    await fs.mkdir(resolvedProfileDir, { recursive: true });

    const lockOwner = `${process.pid}:${traceContext.sessionKey}`;
    const lockPath = path.join(resolvedProfileDir, ".playwright-profile.lock");
    await acquireProfileLock(lockPath, lockOwner);

    try {
      const context = await chromium.launchPersistentContext(resolvedProfileDir, {
        channel: browserChannel,
        headless: false,
        viewport: null,
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--start-maximized", "--disable-blink-features=AutomationControlled"]
      });

      const page = context.pages()[0] ?? (await context.newPage());
      const session: RuntimeSession = {
        context,
        page,
        profileDir: resolvedProfileDir,
        lockPath,
        lockOwner
      };

      this.sessions.set(traceContext.sessionKey, session);
      return session;
    } catch (error) {
      await releaseProfileLock(lockPath, lockOwner);
      throw error;
    }
  }

  private async disposeSession(sessionKey: string, options?: { closeContext?: boolean }) {
    const existing = this.sessions.get(sessionKey);
    if (!existing) {
      return;
    }

    this.sessions.delete(sessionKey);

    try {
      if (options?.closeContext !== false) {
        await existing.context.close().catch(() => undefined);
      }
    } finally {
      await releaseProfileLock(existing.lockPath, existing.lockOwner).catch(() => undefined);
    }
  }

  private async runWithTrace<T>(
    traceContext: RuntimeTraceContext,
    action: ToolTraceAction,
    input: Record<string, unknown>,
    operation: (page: Page) => Promise<T>
  ) {
    const traceId = `${traceContext.traceGroupId ?? randomUUID()}:${action}:${Date.now()}`;
    const startedAt = Date.now();
    const session = await this.ensureSession(traceContext);

    try {
      const result = await operation(session.page);
      const artifactPath = extractArtifactPath(result);
      await this.recordTrace({
        traceContext,
        traceId,
        action,
        input,
        result,
        artifactPath,
        durationMs: Date.now() - startedAt,
        success: true,
        errorMessage: null
      });
      return result;
    } catch (error) {
      if (isPageOrContextClosedError(error)) {
        await this.disposeSession(traceContext.sessionKey, {
          closeContext: true
        });
      }

      await this.recordTrace({
        traceContext,
        traceId,
        action,
        input,
        result: null,
        artifactPath: null,
        durationMs: Date.now() - startedAt,
        success: false,
        errorMessage: error instanceof Error ? error.message : "Unknown runtime error"
      });
      throw error;
    }
  }

  private async recordTrace(input: {
    traceContext: RuntimeTraceContext;
    traceId: string;
    action: ToolTraceAction;
    input: Record<string, unknown>;
    result: unknown;
    artifactPath: string | null;
    durationMs: number;
    success: boolean;
    errorMessage: string | null;
  }) {
    if (this.jobRepository && input.traceContext.publishJobId) {
      await this.jobRepository.createToolTrace({
        publishJobId: input.traceContext.publishJobId ?? null,
        publishAttemptId: input.traceContext.publishAttemptId ?? null,
        traceId: input.traceId,
        stage: input.traceContext.stage ?? "unknown",
        toolName: "playwright",
        action: input.action,
        inputJson: JSON.stringify(input.input),
        resultJson: input.result ? JSON.stringify(input.result) : null,
        artifactPath: input.artifactPath,
        durationMs: input.durationMs,
        success: input.success,
        errorMessage: input.errorMessage
      });

      await this.jobRepository.updateJobRuntimeContext(input.traceContext.publishJobId, {
        lastTraceId: input.traceId,
        currentStage: mapRuntimeStageToJobStage(input.traceContext.stage)
      });
      return;
    }

    console.log(
      JSON.stringify({
        type: "tool_trace",
        traceId: input.traceId,
        stage: input.traceContext.stage ?? "unknown",
        action: input.action,
        success: input.success,
        artifactPath: input.artifactPath,
        errorMessage: input.errorMessage
      })
    );
  }

  private async readSnapshot(page: Page): Promise<PageSnapshot> {
    const [editorButtons, buttons, submitButtons, visibleTexts, headings, links, questionLinks, editorContent] = await Promise.all([
      collectTexts(
        page,
        [
          ".AnswerForm button",
          ".DraftEditor-root button",
          "[class*='AnswerForm'] button",
          "[class*='DraftEditor'] button"
        ],
        20
      ),
      collectTexts(page, ["button", "[role='button']"], 40),
      collectMatchedTexts(
        page,
        [".AnswerForm button", "[class*='AnswerForm'] button", "button", "[role='button']"],
        /发布回答|提交回答|更新回答|保存修改|发布修改/,
        12,
        200
      ),
      collectTexts(page, ["h1", "h2", "h3", "p", "button", "a", "[contenteditable='true']"], 90),
      collectTexts(page, ["h1", "h2", "h3"], 12),
      collectLinks(page, "a[href]", 30),
      collectLinks(page, "a[href*='/question/']", 80),
      collectEditorContent(page)
    ]);

    const dedupedTexts = dedupeStrings([...headings, ...visibleTexts]).slice(0, 90);

    return {
      url: page.url(),
      title: await page.title(),
      visibleTexts: dedupedTexts,
      buttons: dedupeStrings([...submitButtons, ...editorButtons, ...buttons]).slice(0, 48),
      links,
      questionLinks,
      editorContent,
      editorContentLength: editorContent?.length ?? 0
    };
  }
}

function mapRuntimeStageToJobStage(stage: RuntimeTraceContext["stage"]) {
  if (
    stage === "topic_discovery" ||
    stage === "login_checking" ||
    stage === "publishing" ||
    stage === "publish_verify"
  ) {
    return stage;
  }

  return null;
}

async function tryClick(page: Page, input: ClickInput) {
  for (const role of input.roles ?? ["button", "link"]) {
    for (const name of input.names ?? []) {
      const locator = page.getByRole(role, {
        name,
        exact: input.exact ?? false
      });

      const matched = await clickFirstUsableLocator(locator, `${role}:${name}`);
      if (matched) {
        return {
          ok: true,
          matchedBy: matched.matchedBy,
          url: page.url()
        };
      }
    }
  }

  for (const selector of input.selectors ?? []) {
    const locator = page.locator(selector);
    const matched = await clickFirstUsableLocator(locator, `selector:${selector}`);
    if (matched) {
      return {
        ok: true,
        matchedBy: matched.matchedBy,
        url: page.url()
      };
    }
  }

  throw new Error("未找到点击目标。");
}

async function clickFirstUsableLocator(locator: Locator, matchPrefix: string) {
  const count = await locator.count();
  const interceptedIndexes: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible())) {
      continue;
    }

    try {
      const clickMode = await clickLocator(candidate);
      return {
        matchedBy: `${matchPrefix}:${index}:${clickMode}`
      };
    } catch (error) {
      if (isPointerInterceptedError(error)) {
        interceptedIndexes.push(index);
        continue;
      }

      throw error;
    }
  }

  for (const index of interceptedIndexes) {
    const candidate = locator.nth(index);
    const clickMode = await clickLocator(candidate, {
      forceOnIntercept: true
    });
    return {
      matchedBy: `${matchPrefix}:${index}:${clickMode}`
    };
  }

  return null;
}

async function clickLocator(locator: Locator, options?: { forceOnIntercept?: boolean }) {
  await locator.scrollIntoViewIfNeeded();

  try {
    await locator.click();
    return "default";
  } catch (error) {
    if (!options?.forceOnIntercept || !isPointerInterceptedError(error)) {
      throw error;
    }

    await locator.click({
      force: true
    });
    return "force";
  }
}

async function collectTexts(page: Page, selectors: string[], limit: number) {
  const texts: string[] = [];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    const indexes = buildSampleIndexes(count, limit);

    for (const index of indexes) {
      const text = (await locator.nth(index).textContent())?.replace(/\s+/g, " ").trim();
      if (text) {
        texts.push(text);
      }
      if (texts.length >= limit) {
        return dedupeStrings(texts).slice(0, limit);
      }
    }
  }

  return dedupeStrings(texts).slice(0, limit);
}

async function collectMatchedTexts(page: Page, selectors: string[], pattern: RegExp, limit: number, sampleLimit: number) {
  const texts: string[] = [];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    const indexes = buildSampleIndexes(count, sampleLimit);

    for (const index of indexes) {
      const text = (await locator.nth(index).textContent())?.replace(/\s+/g, " ").trim();
      if (!text || !pattern.test(text)) {
        continue;
      }

      texts.push(text);
      if (texts.length >= limit) {
        return dedupeStrings(texts).slice(0, limit);
      }
    }
  }

  return dedupeStrings(texts).slice(0, limit);
}

function buildSampleIndexes(count: number, limit: number) {
  if (count <= 0 || limit <= 0) {
    return [];
  }

  if (count <= limit) {
    return Array.from({ length: count }, (_, index) => index);
  }

  const headCount = Math.ceil(limit * 0.6);
  const tailCount = Math.max(0, limit - headCount);
  const indexes: number[] = [];

  for (let index = 0; index < Math.min(count, headCount); index += 1) {
    indexes.push(index);
  }

  for (let index = Math.max(headCount, count - tailCount); index < count; index += 1) {
    indexes.push(index);
  }

  return Array.from(new Set(indexes)).slice(0, limit);
}

async function collectLinks(page: Page, selector: string, limit: number) {
  const locator = page.locator(selector);
  const count = Math.min(await locator.count(), limit);
  const links: Array<{ text: string; href: string }> = [];

  for (let index = 0; index < count; index += 1) {
    const link = locator.nth(index);
    const href = await link.getAttribute("href");
    const text = (await link.textContent())?.replace(/\s+/g, " ").trim();
    if (!href || !text) {
      continue;
    }

    links.push({
      text,
      href
    });
  }

  return links;
}

async function collectEditorContent(page: Page) {
  const selectors = [
    ".public-DraftEditor-content",
    ".DraftEditor-root div[contenteditable='true']",
    "[role='textbox']",
    "[contenteditable='true']"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible())) {
        continue;
      }

      const text = normalizeEditorText((await candidate.textContent()) ?? "");
      return text;
    }
  }

  return null;
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeEditorText(value: string) {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractArtifactPath(result: unknown) {
  if (!result || typeof result !== "object") {
    return null;
  }

  if ("screenshotPath" in result && typeof result.screenshotPath === "string") {
    return result.screenshotPath;
  }

  return null;
}

function sanitizeFileSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function acquireProfileLock(lockPath: string, lockOwner: string) {
  const timeoutMs = 30_000;
  const intervalMs = 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({
          owner: lockOwner,
          pid: process.pid,
          createdAt: new Date().toISOString()
        })
      );
      await handle.close();
      return;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const reclaimed = await tryReclaimStaleLock(lockPath, lockOwner);
      if (reclaimed) {
        continue;
      }

      await wait(intervalMs);
    }
  }

  throw new Error("浏览器 profile 正在被占用，请稍后再试。");
}

async function releaseProfileLock(lockPath: string, lockOwner: string) {
  try {
    const content = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(content) as { owner?: string };
    if (parsed.owner && parsed.owner !== lockOwner) {
      return;
    }
  } catch {
    return;
  }

  await fs.rm(lockPath, { force: true });
}

async function tryReclaimStaleLock(lockPath: string, lockOwner: string) {
  try {
    const content = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(content) as { owner?: string; pid?: number; createdAt?: string };

    if (parsed.owner === lockOwner) {
      await fs.rm(lockPath, { force: true });
      return true;
    }

    const createdAt = parsed.createdAt ? new Date(parsed.createdAt).getTime() : 0;
    const isExpired = !createdAt || Date.now() - createdAt > 10 * 60 * 1000;
    const pidAlive = typeof parsed.pid === "number" ? isProcessAlive(parsed.pid) : false;

    if (!pidAlive || isExpired) {
      await fs.rm(lockPath, { force: true });
      return true;
    }
  } catch {
    await fs.rm(lockPath, { force: true });
    return true;
  }

  return false;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isAlreadyExistsError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EEXIST");
}

function isPointerInterceptedError(error: unknown) {
  return Boolean(
    error instanceof Error &&
      (error.message.includes("intercepts pointer events") || error.message.includes("another element"))
  );
}

function isPageOrContextClosedError(error: unknown) {
  return Boolean(
    error instanceof Error &&
      (error.message.includes("Target page, context or browser has been closed") ||
        error.message.includes("Target closed") ||
        error.message.includes("Browser has been closed"))
  );
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
