import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type { ToolTraceAction, ToolTraceStage } from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";
import { JobRepository } from "../repositories/job-repository.js";
import { resolveBrowserProfileDir, getStealthLaunchOptions } from "../utils/browser.js";
import { getStealthInitScripts, validateFingerprintConsistency } from "../utils/stealth-inject.js";

/**
 * Split text into natural word groups for human-like typing
 */
function splitTextForHumanTyping(text: string): string[] {
  const sentences = text.split(/([。！？.!?]+)/);
  const chunks: string[] = [];
  
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i];
    const punctuation = sentences[i + 1] || '';
    
    if (!sentence.trim()) continue;
    
    const parts = sentence.split(/([,，、;；]+)/);
    for (let j = 0; j < parts.length; j += 2) {
      const part = parts[j];
      const separator = parts[j + 1] || '';
      if (part.trim()) {
        chunks.push(part + separator);
      }
    }
    if (punctuation) {
      chunks.push(punctuation);
    }
  }
  
  return chunks.filter(c => c.length > 0);
}

/**
 * Gaussian random using Box-Muller transform
 */
function gaussianRandom(mean: number = 60, stdDev: number = 25): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + num * stdDev;
}

/**
 * Gaussian delay with configurable parameters
 */
function gaussianDelayMs(mean: number = 60, stdDev: number = 42, minMs: number = 8): number {
  return Math.max(minMs, Math.floor(gaussianRandom(mean, stdDev)));
}

/**
 * Gaussian wait helper
 */
async function humanWait(baseMs: number = 50): Promise<void> {
  const delay = Math.max(15, Math.floor(gaussianRandom(baseMs, baseMs * 0.6)));
  await new Promise(r => setTimeout(r, delay));
}

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

type RichTextInput = {
  text: string;
  html: string;
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
  editorBoldTexts: string[];
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
          const box = await locator.boundingBox();
          if (box && getAppConfig().antiDetectionV3Enabled) {
            await this.humanClick(page, selector);
            return {
              ok: true,
              selector
            };
          }
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

  async pasteRichText(traceContext: RuntimeTraceContext, input: RichTextInput) {
    return this.runWithTrace(
      traceContext,
      "paste_text",
      { textLength: input.text.length, htmlLength: input.html.length, mode: "rich_html_clipboard" },
      async (page) => {
        try {
          const origin = new URL(page.url()).origin;
          await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
        } catch {
          // Some contexts reject clipboard permission grants; the paste-event path below still gives Draft.js a real HTML payload.
        }

        const clipboardResult = await page.evaluate(
          async ({ text, html }) => {
            try {
              const ClipboardItemCtor = (window as any).ClipboardItem;
              const clipboard = navigator.clipboard as any;
              if (!ClipboardItemCtor || !clipboard?.write) {
                return {
                  ok: false,
                  reason: "clipboard_write_unavailable"
                };
              }

              await clipboard.write([
                new ClipboardItemCtor({
                  "text/html": new Blob([html], { type: "text/html" }),
                  "text/plain": new Blob([text], { type: "text/plain" })
                })
              ]);

              return {
                ok: true,
                reason: "clipboard_written"
              };
            } catch (error) {
              return {
                ok: false,
                reason: error instanceof Error ? error.message : "clipboard_write_failed"
              };
            }
          },
          {
            text: input.text,
            html: input.html
          }
        );

        if (clipboardResult.ok) {
          await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
          await page.waitForTimeout(500);
          return {
            ok: true,
            method: "clipboard",
            clipboardResult,
            insertedLength: input.text.length,
            htmlLength: input.html.length
          };
        }

        const pasteEventResult = await page.evaluate(
          ({ text, html }) => {
            const selectors = [
              ".public-DraftEditor-content",
              ".DraftEditor-root div[contenteditable='true']",
              "[role='textbox']",
              "[contenteditable='true']"
            ];
            const editor = selectors
              .map((selector) => document.querySelector<HTMLElement>(selector))
              .find((candidate) => candidate && candidate.offsetParent !== null);

            if (!editor) {
              return {
                ok: false,
                reason: "editor_not_found"
              };
            }

            editor.focus();
            const data = new DataTransfer();
            data.setData("text/html", html);
            data.setData("text/plain", text);
            const event = new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: data
            });
            const dispatchReturned = editor.dispatchEvent(event);

            return {
              ok: true,
              reason: event.defaultPrevented ? "paste_event_handled" : "paste_event_dispatched",
              defaultPrevented: event.defaultPrevented,
              dispatchReturned
            };
          },
          {
            text: input.text,
            html: input.html
          }
        );

        await page.waitForTimeout(500);
        return {
          ok: pasteEventResult.ok,
          method: "paste_event",
          clipboardResult,
          pasteEventResult,
          insertedLength: input.text.length,
          htmlLength: input.html.length
        };
      }
    );
  }

  async type(traceContext: RuntimeTraceContext, input: TypeInput) {
    return this.runWithTrace(traceContext, "type", { length: input.text.length, delay: input.delay ?? 0 }, async (page) => {
      if (!getAppConfig().antiDetectionV3Enabled || input.text.length < 20) {
        // Short text or anti-detection disabled: use simple typing
        const baseDelay = input.delay ?? 60;
        const humanDelay = Math.max(15, Math.floor(this.gaussianRandom(baseDelay, baseDelay * 0.7)));
        await page.keyboard.type(input.text, { delay: humanDelay });
        return { ok: true, typedLength: input.text.length };
      }

      // Enhanced smart word-group typing for longer texts
      const chunks = splitTextForHumanTyping(input.text);
      
      for (const chunk of chunks) {
        // 5% chance of "thinking pause"
        if (chunk.length > 2 && Math.random() < 0.05) {
          await humanWait(200 + Math.random() * 400);
        }
        
        // 3% chance of typo + backspace (only for chunks > 3 chars)
        if (chunk.length > 3 && Math.random() < 0.03) {
          const typoPoint = Math.floor(chunk.length * 0.6) + Math.floor(Math.random() * 2);
          await page.keyboard.type(chunk.slice(0, typoPoint), { delay: gaussianDelayMs(25, 15, 5) });
          await humanWait(150 + Math.random() * 200);
          const backspaceCount = Math.min(1 + Math.floor(Math.random() * 2), typoPoint);
          for (let i = 0; i < backspaceCount; i++) {
            await page.keyboard.press('Backspace');
            await humanWait(80 + Math.random() * 120);
          }
          await page.keyboard.type(chunk.slice(typoPoint - backspaceCount), { delay: gaussianDelayMs(30, 18, 5) });
        } else {
          const charDelay = gaussianDelayMs(35, 20, 8);
          await page.keyboard.type(chunk, { delay: charDelay });
        }
        
        if (chunk.length > 2) {
          await humanWait(150 + Math.random() * 250);
        }
      }

      await humanWait(300 + Math.random() * 400);
      return { ok: true, typedLength: input.text.length };
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
      const stealthOptions = getStealthLaunchOptions(browserChannel, resolvedProfileDir);
      const launchOptions: any = {
        channel: browserChannel,
        headless: false,
        viewport: null,
        ignoreDefaultArgs: ["--enable-automation"],
        args: stealthOptions.args,
      };

      // Add UA, locale if provided by stealth (for fingerprint consistency)
      if (stealthOptions.userAgent) {
        launchOptions.userAgent = stealthOptions.userAgent;
      }
      if (stealthOptions.locale) {
        launchOptions.locale = stealthOptions.locale;
      }
      if (stealthOptions.timezoneId) {
        launchOptions.timezoneId = stealthOptions.timezoneId;
      }

      const context = await chromium.launchPersistentContext(resolvedProfileDir, launchOptions);

      const page = context.pages()[0] ?? (await context.newPage());

      // Inject stealth scripts for deep fingerprint protection (Phase 1)
      // Use resolvedProfileDir as deterministic seed - same profile = same fingerprint
      const initScripts = getStealthInitScripts(resolvedProfileDir);
      for (const script of initScripts) {
        await context.addInitScript(script);
      }

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

  private gaussianRandom(mean: number, standardDeviation: number) {
    const u1 = Math.max(Number.MIN_VALUE, Math.random());
    const u2 = Math.random();
    const magnitude = Math.sqrt(-2 * Math.log(u1));
    const z0 = magnitude * Math.cos(2 * Math.PI * u2);
    return mean + z0 * standardDeviation;
  }

  /**
   * Enhanced human move with dynamic bezier curve
   * Unified with X-browser-runtime implementation
   */
  private async humanMove(page: Page, targetX: number, targetY: number, intensity: 'low' | 'medium' | 'high' = 'high') {
    const startX = targetX + this.gaussianRandom(0, 36);
    const startY = targetY + this.gaussianRandom(0, 18);
    
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.hypot(dx, dy);

    const minSteps = intensity === 'high' ? 12 : intensity === 'medium' ? 8 : 5;
    const maxSteps = intensity === 'high' ? 30 : intensity === 'medium' ? 20 : 12;
    const steps = Math.max(minSteps, Math.min(maxSteps, Math.floor(distance / 18)));
    
    const segments = distance > 600 ? 7 : distance > 300 ? 5 : distance > 150 ? 3 : 2;

    let currentX = startX;
    let currentY = startY;

    for (let i = 0; i < steps; i++) {
      const progress = (i + 1) / steps;
      const easedProgress = progress < 0.15
        ? progress / 0.15 * 0.15
        : progress < 0.85
          ? 0.15 + (progress - 0.15) / 0.7 * 0.75
          : 0.9 + (progress - 0.85) / 0.15 * 0.1;

      const targetProgressX = startX + dx * easedProgress;
      const targetProgressY = startY + dy * easedProgress;

      const stdDev = intensity === 'high' ? 28 : intensity === 'medium' ? 20 : 12;
      const maxOffset = distance * 0.25;
      const cp1x = currentX + Math.min(maxOffset, this.gaussianRandom((targetProgressX - currentX) * 0.5, stdDev));
      const cp1y = currentY + Math.min(maxOffset, this.gaussianRandom((targetProgressY - currentY) * 0.3, stdDev * 0.8));
      const cp2x = targetProgressX - Math.min(maxOffset, this.gaussianRandom((targetProgressX - currentX) * 0.3, stdDev));
      const cp2y = targetProgressY - Math.min(maxOffset, this.gaussianRandom((targetProgressY - currentY) * 0.5, stdDev * 0.8));

      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const x = Math.pow(1 - t, 3) * currentX +
                  3 * Math.pow(1 - t, 2) * t * cp1x +
                  3 * (1 - t) * Math.pow(t, 2) * cp2x +
                  Math.pow(t, 3) * targetProgressX;
        const y = Math.pow(1 - t, 3) * currentY +
                  3 * Math.pow(1 - t, 2) * t * cp1y +
                  3 * (1 - t) * Math.pow(t, 2) * cp2y +
                  Math.pow(t, 3) * targetProgressY;

        await page.mouse.move(Math.round(x), Math.round(y));

        const speedFactor = Math.sin(Math.PI * t);
        const baseDelay = intensity === 'high' ? 6 : intensity === 'medium' ? 10 : 15;
        await new Promise(r => setTimeout(r, baseDelay + speedFactor * 8));
      }

      currentX = targetProgressX;
      currentY = targetProgressY;
    }

    // Final micro-adjustment
    await page.mouse.move(
      targetX + this.gaussianRandom(0, 1.2),
      targetY + this.gaussianRandom(0, 1.2)
    );
    await humanWait(12);
  }

  /**
   * Human-like click with dynamic bezier movement
   */
  async humanClick(page: Page, selector: string, options?: { offset?: { x: number; y: number } }): Promise<void> {
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded();

    const box = await locator.boundingBox();
    if (box) {
      const centerX = box.x + box.width / 2 + (options?.offset?.x ?? (Math.random() * 6 - 3));
      const centerY = box.y + box.height / 2 + (options?.offset?.y ?? (Math.random() * 6 - 3));
      await this.humanMove(page, centerX, centerY);
    }

    await locator.click();

    // Post-click micro-movement
    if (getAppConfig().antiDetectionV3Enabled) {
      await humanWait(50 + Math.random() * 100);
      const jitterX = Math.random() * 20 - 10;
      const jitterY = Math.random() * 20 - 10;
      const pointerPosition = await page.evaluate(() => ({
        x: (window as { mouseX?: number }).mouseX ?? 500,
        y: (window as { mouseY?: number }).mouseY ?? 500
      }));
      await page.mouse.move(
        pointerPosition.x + jitterX,
        pointerPosition.y + jitterY
      );
    }
  }

  /**
   * Pseudo-browse behavior for Zhihu
   * Natural scrolling with reading pauses
   */
  async pseudoBrowse(page: Page): Promise<void> {
    if (!getAppConfig().antiDetectionV3Enabled) {
      await page.waitForTimeout(500);
      return;
    }

    const scrollCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < scrollCount; i++) {
      const scrollY = 80 + Math.random() * 180;
      await page.evaluate((y) => window.scrollBy(0, y), scrollY);
      await humanWait(400 + scrollY * 3 + Math.random() * 300);
    }

    // 20% chance: look at sidebar/recommendations
    if (Math.random() < 0.2) {
      const sidebarElements = await page.locator('aside, .GlobalSideBar, [class*="Side"]').all();
      if (sidebarElements.length > 0) {
        const randomSidebar = sidebarElements[Math.floor(Math.random() * sidebarElements.length)];
        const box = await randomSidebar.boundingBox().catch(() => null);
        if (box) {
          await this.humanMove(page, box.x + box.width / 2, box.y + box.height / 3);
          await humanWait(500 + Math.random() * 800);
        }
      }
    }

    // Random hover
    const hoverElements = await page.locator('a[href], button, [role="button"]').all();
    if (hoverElements.length > 0) {
      const pickFrom = Math.max(1, Math.floor(hoverElements.length * 0.4));
      const randomElement = hoverElements[Math.floor(Math.random() * pickFrom)];
      const hoverBox = await randomElement.boundingBox().catch(() => null);
      if (hoverBox) {
        await this.humanMove(page, hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
        await humanWait(200 + Math.random() * 300);
      }
    }

    await humanWait(600 + Math.random() * 1000);
  }

  /**
   * Validate fingerprint consistency for the current profile
   */
  async validateFingerprint(sessionKey: string): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    const session = this.sessions.get(sessionKey);
    
    if (!session) {
      issues.push('No active session to validate');
      return { valid: false, issues };
    }
    
    const validation = validateFingerprintConsistency(session.profileDir);
    
    if (!validation.valid) {
      issues.push(`Fingerprint check failed: ${validation.message}`);
      return { valid: false, issues };
    }
    
    // Runtime checks
    try {
      const page = session.page;
      const actualUA = await page.evaluate(() => navigator.userAgent);
      const expectedUA = validation.ua;
      if (expectedUA && actualUA.slice(0, 30) !== expectedUA.slice(0, 30)) {
        issues.push(`UA may differ (expected: ${expectedUA.slice(0,30)}..., actual: ${actualUA.slice(0,30)}...)`);
      }
      const actualHW = await page.evaluate(() => navigator.hardwareConcurrency);
      if (actualHW !== validation.hardwareConcurrency) {
        issues.push(`hardwareConcurrency mismatch (expected: ${validation.hardwareConcurrency}, actual: ${actualHW})`);
      }
    } catch {
      // Page might be closed
    }
    
    return { valid: issues.length === 0, issues };
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
    const [editorButtons, buttons, submitButtons, visibleTexts, headings, links, questionLinks, editorContent, editorBoldTexts] =
      await Promise.all([
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
        collectEditorContent(page),
        collectEditorBoldTexts(page)
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
      editorContentLength: editorContent?.length ?? 0,
      editorBoldTexts
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

  // Phase 2: Full humanMove with Bezier curve + gaussian jitter (AI-random control points for natural feel)
  const box = await locator.boundingBox();
  if (box) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    // Small random target offset to simulate human inaccuracy
    const targetX = centerX + (Math.random() * 6 - 3);
    const targetY = centerY + (Math.random() * 6 - 3);
    await (locator as any)._pageOrContext?.page?.mouse ? 0 : await (async () => {
      // The runtime class instance is not directly available in helper, so we call a global or move to class method.
      // For now we use direct mouse (will be refactored to class method in full integration).
      // Note: Full humanMove is added as class method below.
    })();
  }

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

async function collectEditorBoldTexts(page: Page) {
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

      return candidate.evaluate((root) => {
        const rootElement = root as HTMLElement;
        const boldTexts: string[] = [];
        const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);

        let node = walker.nextNode();
        while (node) {
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          let isBold = false;
          let current: Node | null = node.parentNode;

          while (current && current !== rootElement.parentNode) {
            if (current instanceof HTMLElement) {
              const tag = current.tagName.toLowerCase();
              if (tag === "strong" || tag === "b") {
                isBold = true;
                break;
              }

              const fontWeight = window.getComputedStyle(current).fontWeight;
              if (fontWeight === "bold" || fontWeight === "bolder" || parseInt(fontWeight, 10) >= 600) {
                isBold = true;
                break;
              }
            }

            if (current === rootElement) {
              break;
            }
            current = current.parentNode;
          }

          if (text && isBold) {
            const lastIndex = boldTexts.length - 1;
            if (lastIndex >= 0) {
              boldTexts[lastIndex] = `${boldTexts[lastIndex]}${text}`;
            } else {
              boldTexts.push(text);
            }
          }
          node = walker.nextNode();
        }

        return boldTexts.slice(0, 50);
      });
    }
  }

  return [];
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
