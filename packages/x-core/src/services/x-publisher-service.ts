import crypto from "node:crypto";
import type { Page, Response } from "playwright";
import { getXAppConfig, type XAppConfig } from "../config.js";
import type { XAccount, XPublishAction, XPublishMode, XPublishResult, XTask } from "../types.js";
import { XBrowserRuntime } from "./x-browser-runtime.js";
import { XTaskExecutionError } from "./x-task-error.js";

/**
 * Risk signal keywords used to detect account restrictions, challenges, or captchas
 */
const X_RISK_SIGNAL_KEYWORDS = [
  'suspicious', 'unusual activity', 'verify your account', 'security check',
  'we detected unusual activity', 'account access limited', 'temporarily locked',
  'confirm your identity', 'captcha', 'challenge', 'restricted',
  '验证', '验证码', '人机验证', '风控', '异常活动', '访问受限', '安全验证'
];

/**
 * URLs patterns that indicate login or challenge pages
 */
const X_RISK_URL_PATTERNS = [
  '/i/flow/login', '/login', '/challenge', '/captcha',
  '/account/access', '/suspended', '/account/unusual'
];

/**
 * Calculate exponential backoff with jitter for rate limit handling
 */
function calculateBackoff(attempt: number, baseMs: number = 30000, maxMs: number = 120000): number {
  const backoff = baseMs * Math.pow(2, attempt - 1);
  const jitter = backoff * 0.2 * Math.random();
  return Math.min(backoff + jitter, maxMs);
}

/**
 * Classify HTTP response status into risk categories
 */
function classifyHttpStatus(status: number): 'ok' | 'rate_limit' | 'forbidden' | 'server_error' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'rate_limit';
  if (status === 403) return 'forbidden';
  if (status >= 500) return 'server_error';
  return 'ok';
}

export class XPublisherService {
  constructor(
    private readonly config: XAppConfig = getXAppConfig(),
    private readonly browserRuntime = new XBrowserRuntime(config)
  ) {}

  /**
   * Check if the browser session is ready for publishing (anti-detection readiness)
   * Returns { ready: true } if all checks pass, otherwise lists issues
   */
  async checkPublishReadiness(page: Page): Promise<{ ready: boolean; issues: string[]; riskSignals: string[] }> {
    const issues: string[] = [];
    const riskSignals: string[] = [];
    
    // 1. Check domain
    const url = page.url();
    if (!url.includes('x.com') && !url.includes('twitter.com')) {
      issues.push('not_on_x_domain');
    }
    
    // 2. Check for login/challenge redirects
    for (const pattern of X_RISK_URL_PATTERNS) {
      if (url.includes(pattern)) {
        riskSignals.push(`risk_url_${pattern.replace(/\//g, '_')}`);
        issues.push(`redirected_to_${pattern}`);
      }
    }
    
    // 3. Check page text for risk signals
    try {
      const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      const lowerText = pageText.toLowerCase();
      for (const keyword of X_RISK_SIGNAL_KEYWORDS) {
        if (lowerText.includes(keyword.toLowerCase())) {
          riskSignals.push(`risk_text_${keyword}`);
        }
      }
    } catch {
      // Page may not be fully loaded
    }
    
    // 4. Check editor visibility (for standalone posts)
    if (url.includes('/compose/post')) {
      const editor = page.locator("[data-testid='tweetTextarea_0']").first();
      const editorVisible = await editor.isVisible().catch(() => false);
      if (!editorVisible) {
        issues.push('editor_not_visible');
      }
      
      const tweetButton = page.locator("[data-testid='tweetButtonInline']").first();
      const buttonEnabled = await tweetButton.isEnabled().catch(() => false);
      if (!buttonEnabled) {
        // Could be normal (empty editor), but log it
      }
    }
    
    return { ready: issues.length === 0, issues, riskSignals };
  }

  async publishTask(account: XAccount, task: XTask) {
    if (account.authStatus !== "ready") {
      throw new XTaskExecutionError({
        stage: "publish",
        failureType: "publish_error",
        message: account.authStatusReason || "Account authorization is not ready for publishing.",
        accountAuthStatus: account.authStatus ?? "login_required",
        accountAuthReason: account.authStatusReason || "Account authorization is not ready for publishing."
      });
    }

    const publishSelection = resolvePublishSelection(task);
    if (publishSelection.posts.length === 0) {
      throw new XTaskExecutionError({
        stage: "publish",
        failureType: "invalid_output",
        message: "Task has no draft posts to publish."
      });
    }

    if (this.config.publishMode === "dry_run") {
      return this.publishDryRun(account, publishSelection);
    }

    return this.publishInBrowser(account, publishSelection);
  }

  private async publishDryRun(
    account: XAccount,
    publishSelection: {
      posts: string[];
      mode: XPublishMode;
      action: XPublishAction;
      targetTweetUrl: string | null;
      selectionNote: string;
    }
  ): Promise<XPublishResult> {
    const publishedAt = new Date().toISOString();
    const tweetIds = publishSelection.posts.map(() => generateSyntheticTweetId());
    const urls = tweetIds.map((tweetId) => buildTweetUrl(account.handle, tweetId));

    return {
      transport: "dry_run",
      tweetIds,
      urls,
      publishedAt,
      note: [
        `Dry run only. No live browser publish was executed. Planned ${publishSelection.posts.length} post(s) in ${publishSelection.mode} mode via ${publishSelection.action}.`,
        publishSelection.targetTweetUrl ? `Target: ${publishSelection.targetTweetUrl}.` : "",
        publishSelection.selectionNote
      ]
        .filter(Boolean)
        .join(" ")
        .trim()
    };
  }

  private async publishInBrowser(
    account: XAccount,
    publishSelection: {
      posts: string[];
      mode: XPublishMode;
      action: XPublishAction;
      targetTweetUrl: string | null;
      selectionNote: string;
    }
  ): Promise<XPublishResult> {
    return this.browserRuntime.withSession(
      buildPublishSessionKey(account.id),
      account.profileDir,
      account.proxyUrl,
      async (page) => {
        const tweetIds: string[] = [];
        const urls: string[] = [];
        let previousTweetUrl: string | null = null;

        for (const [index, post] of publishSelection.posts.entries()) {
          if (!post.trim()) {
            throw new XTaskExecutionError({
              stage: "publish",
              failureType: "invalid_output",
              message: `Draft post #${index + 1} is empty.`
            });
          }

          const publishResult: {
            tweetId: string;
            url: string;
          } = previousTweetUrl
            ? await publishReply(page, previousTweetUrl, post, account.handle)
            : publishSelection.action === "reply"
              ? await publishReply(
                  page,
                  requireTargetTweetUrl(publishSelection.targetTweetUrl, "reply"),
                  post,
                  account.handle
                )
              : publishSelection.action === "quote"
                ? await publishQuotePost(
                    page,
                    this.config.xBaseUrl,
                    requireTargetTweetUrl(publishSelection.targetTweetUrl, "quote"),
                    post,
                    account.handle
                  )
                : await publishStandalonePost(page, this.config.xBaseUrl, post, account.handle);

          previousTweetUrl = publishResult.url;
          tweetIds.push(publishResult.tweetId);
          urls.push(previousTweetUrl);
        }

        return {
          transport: "browser",
          tweetIds,
          urls,
          publishedAt: new Date().toISOString(),
          note: [
            `Published ${tweetIds.length} post(s) via Playwright browser flow in ${publishSelection.mode} mode with ${publishSelection.action}.`,
            publishSelection.targetTweetUrl ? `Target: ${publishSelection.targetTweetUrl}.` : "",
            publishSelection.selectionNote
          ]
            .filter(Boolean)
            .join(" ")
            .trim()
        } satisfies XPublishResult;
      }
    );
  }
}

function resolvePublishSelection(task: XTask) {
  const draftPosts = task.draftPack?.posts ?? [];
  const mode: XPublishMode =
    task.publishPlan?.mode === "thread" || task.publishPlan?.mode === "single"
      ? task.publishPlan.mode
      : draftPosts.length > 1
        ? "thread"
        : "single";
  const action: XPublishAction =
    task.publishPlan?.action === "reply" || task.publishPlan?.action === "quote" ? task.publishPlan.action : "post";
  const targetTweetUrl = task.publishPlan?.targetTweetUrl?.trim() || null;

  if (mode === "single") {
    return {
      posts: draftPosts.slice(0, 1),
      mode,
      action,
      targetTweetUrl,
      selectionNote:
        draftPosts.length > 1
          ? "MainAgent selected single mode, so only the first draft post was published."
          : ""
    };
  }

  return {
    posts: draftPosts,
    mode,
    action,
    targetTweetUrl,
    selectionNote: ""
  };
}

async function publishQuotePost(page: Page, xBaseUrl: string, targetTweetUrl: string, content: string, handle: string) {
  const quoteContent = content.includes(targetTweetUrl) ? content : `${content}\n\n${targetTweetUrl}`;
  return publishStandalonePost(page, xBaseUrl, quoteContent, handle);
}

async function publishStandalonePost(page: Page, xBaseUrl: string, content: string, handle: string) {
  // Pre-publish readiness check
  const readiness = await checkPageReadiness(page, { checkRiskSignals: true });
  if (!readiness.ready && readiness.riskSignals.length > 0) {
    throw new XTaskExecutionError({
      stage: "publish",
      failureType: "risk_signal",
      message: `X publish blocked by risk signals: ${readiness.riskSignals.join(', ')}`
    });
  }

  const createTweetResponse = waitForCreateTweetResponse(page);
  await page.goto(`${xBaseUrl}/compose/post`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });

  // Post-navigation readiness check
  const postNavReadiness = await checkPageReadiness(page, { checkRiskSignals: true, checkEditor: true });
  if (!postNavReadiness.ready) {
    throw new XTaskExecutionError({
      stage: "publish",
      failureType: "browser_error",
      message: `X compose page not ready: ${postNavReadiness.issues.join(', ')}`
    });
  }

  const editor = await requireFirstVisibleLocator(page, [
    "[data-testid='tweetTextarea_0']",
    "[data-testid='tweetTextarea_0'] div[contenteditable='true']",
    "[role='textbox']"
  ]);

  await editor.click();
  await page.keyboard.insertText(content);

  const submitButton = await requireFirstVisibleLocator(page, ["[data-testid='tweetButton']", "[data-testid='tweetButtonInline']"]);
  await submitButton.click();

  const tweetId = await extractTweetIdFromResponse(await createTweetResponse);
  return {
    tweetId,
    url: buildTweetUrl(handle, tweetId)
  };
}

async function publishReply(page: Page, previousTweetUrl: string, content: string, handle: string) {
  const createTweetResponse = waitForCreateTweetResponse(page);
  await page.goto(previousTweetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });

  const replyButton = await requireFirstVisibleLocator(page, ["[data-testid='reply']", "[data-testid='replyButton']"]);
  await replyButton.click();
  await page.waitForTimeout(1_200);

  const editor = await requireFirstVisibleLocator(page, [
    "[data-testid='tweetTextarea_0']",
    "[data-testid='tweetTextarea_0'] div[contenteditable='true']",
    "[role='dialog'] [role='textbox']"
  ]);
  await editor.click();
  await page.keyboard.insertText(content);

  const submitButton = await requireFirstVisibleLocator(page, [
    "[data-testid='tweetButton']",
    "[role='dialog'] [data-testid='tweetButton']",
    "[role='dialog'] [data-testid='tweetButtonInline']"
  ]);
  await submitButton.click();

  const tweetId = await extractTweetIdFromResponse(await createTweetResponse);
  return {
    tweetId,
    url: buildTweetUrl(handle, tweetId)
  };
}

async function waitForCreateTweetResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /CreateTweet|TweetCreate|graphql/i.test(response.url()),
    {
      timeout: 45_000
    }
  );
}

async function extractTweetIdFromResponse(response: Response) {
  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const tweetId = findTweetId(payload);
  if (!tweetId) {
    throw new XTaskExecutionError({
      stage: "publish",
      failureType: "publish_error",
      message: "X browser publish returned success flow, but no tweet id could be extracted."
    });
  }

  return tweetId;
}

function findTweetId(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTweetId(item);
      if (found) {
        return found;
      }
    }

    return null;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if ((key === "rest_id" || key === "tweet_id" || key === "id_str" || key === "id") && looksLikeTweetId(child)) {
        return String(child);
      }
    }

    for (const child of Object.values(value)) {
      const found = findTweetId(child);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function looksLikeTweetId(value: unknown) {
  return typeof value === "string" && /^\d{8,}$/.test(value);
}

function buildPublishSessionKey(accountId: string) {
  return `x-publish-${accountId}`;
}

function generateSyntheticTweetId() {
  return BigInt(`1${crypto.randomInt(100_000_000, 999_999_999)}`).toString();
}

function buildTweetUrl(handle: string, tweetId: string) {
  const normalizedHandle = handle.trim().replace(/^@+/, "");
  return normalizedHandle ? `https://x.com/${normalizedHandle}/status/${tweetId}` : `https://x.com/i/web/status/${tweetId}`;
}

function requireTargetTweetUrl(value: string | null, action: "reply" | "quote") {
  if (value?.trim()) {
    return value.trim();
  }

  throw new XTaskExecutionError({
    stage: "publish",
    failureType: "invalid_output",
    message: `Publish action ${action} requires a targetTweetUrl.`
  });
}

async function requireFirstVisibleLocator(page: Page, selectors: string[]) {
  const locator = await findFirstVisibleLocator(page, selectors);
  if (!locator) {
    throw new XTaskExecutionError({
      stage: "publish",
      failureType: "browser_error",
      message: `X browser publish could not find a required UI target. Tried selectors: ${selectors.join(", ")}`
    });
  }

  return locator;
}

async function findFirstVisibleLocator(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        return locator;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Page readiness check for anti-detection (used before publishing)
 */
async function checkPageReadiness(page: Page, options?: {
  checkRiskSignals?: boolean;
  checkEditor?: boolean;
}): Promise<{ ready: boolean; issues: string[]; riskSignals: string[] }> {
  const issues: string[] = [];
  const riskSignals: string[] = [];

  // 1. Check domain
  const url = page.url();
  if (!url.includes('x.com') && !url.includes('twitter.com')) {
    issues.push('not_on_x_domain');
  }

  // 2. Check for login/challenge redirects
  if (options?.checkRiskSignals) {
    for (const pattern of X_RISK_URL_PATTERNS) {
      if (url.includes(pattern)) {
        riskSignals.push(`risk_url_${pattern.replace(/\//g, '_')}`);
        issues.push(`redirected_to_${pattern}`);
      }
    }
  }

  // 3. Check page text for risk signals
  if (options?.checkRiskSignals) {
    try {
      const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      const lowerText = pageText.toLowerCase();
      for (const keyword of X_RISK_SIGNAL_KEYWORDS) {
        if (lowerText.includes(keyword.toLowerCase())) {
          riskSignals.push(`risk_text_${keyword}`);
        }
      }
    } catch {
      // Page may not be fully loaded
    }
  }

  // 4. Check editor visibility
  if (options?.checkEditor) {
    const editor = page.locator("[data-testid='tweetTextarea_0']").first();
    const editorVisible = await editor.isVisible().catch(() => false);
    if (!editorVisible) {
      issues.push('editor_not_visible');
    }
  }

  return { ready: issues.length === 0, issues, riskSignals };
}
