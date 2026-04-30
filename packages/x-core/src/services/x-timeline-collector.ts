import type { Page } from "playwright";
import type { XReferenceTweetSample } from "../types.js";

export type XCollectedTimeline = {
  link: string;
  handle: string;
  tweets: XReferenceTweetSample[];
};

export async function collectAccountTimeline(
  page: Page,
  linkOrHandle: string,
  maxTweets: number,
  xBaseUrl: string
): Promise<XCollectedTimeline> {
  const profileUrl = normalizeProfileUrl(linkOrHandle, xBaseUrl);
  const handle = extractHandleFromLink(linkOrHandle) || extractHandleFromLink(profileUrl) || "unknown";

  await page.goto(profileUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });
  await page.waitForTimeout(2_200);

  const tweetsByUrl = new Map<string, XReferenceTweetSample>();
  const maxScrolls = Math.max(12, Math.ceil(maxTweets / 6) + 8);
  let stagnantRounds = 0;
  let previousCount = 0;

  for (let index = 0; index < maxScrolls && tweetsByUrl.size < maxTweets; index += 1) {
    const visibleTweets = await extractVisibleTweets(page);
    for (const tweet of visibleTweets) {
      if (!tweetsByUrl.has(tweet.tweetUrl)) {
        tweetsByUrl.set(tweet.tweetUrl, tweet);
      }
    }

    if (tweetsByUrl.size === previousCount) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
      previousCount = tweetsByUrl.size;
    }

    if (stagnantRounds >= 4) {
      break;
    }

    await page.mouse.wheel(0, 7_500);
    await page.waitForTimeout(1_500);
  }

  return {
    link: profileUrl,
    handle,
    tweets: Array.from(tweetsByUrl.values()).slice(0, maxTweets)
  };
}

export async function extractVisibleTweets(page: Page): Promise<XReferenceTweetSample[]> {
  const tweets = await page.evaluate(() => {
    const results: Array<{
      tweetUrl: string;
      text: string;
      publishedAt: string | null;
      socialContext: string;
      hasReplyContext: boolean;
    }> = [];

    const articles = Array.from(document.querySelectorAll("article[data-testid='tweet']"));
    for (const article of articles) {
      const tweetTextParts = Array.from(article.querySelectorAll("[data-testid='tweetText']"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);
      const text = tweetTextParts.join("\n").trim();
      const socialContext = article.querySelector("[data-testid='socialContext']")?.textContent?.trim() ?? "";
      const hasReplyContext = Array.from(article.querySelectorAll("span")).some((node) =>
        /replying to/i.test(node.textContent ?? "")
      );
      const publishedAt = article.querySelector("time")?.getAttribute("datetime") ?? null;

      const tweetLink = Array.from(article.querySelectorAll("a[href*='/status/']"))
        .map((node) => (node as HTMLAnchorElement).href)
        .find((href) => /\/status\/\d+/i.test(href));

      if (!tweetLink || !text) {
        continue;
      }

      results.push({
        tweetUrl: tweetLink,
        text,
        publishedAt,
        socialContext,
        hasReplyContext
      });
    }

    return results;
  });

  return tweets
    .filter((tweet) => tweet.text.trim().length >= 8)
    .filter((tweet) => !/reposted|鏉烆剚甯箌repost/i.test(tweet.socialContext))
    .map((tweet) => ({
      tweetUrl: tweet.tweetUrl,
      text: tweet.text.trim(),
      publishedAt: tweet.publishedAt,
      isReply: tweet.hasReplyContext,
      socialContext: tweet.socialContext || null
    }));
}

export function normalizeProfileUrl(linkOrHandle: string, xBaseUrl: string) {
  const trimmed = linkOrHandle.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^https?:\/\/(twitter\.com|www\.twitter\.com)/i, xBaseUrl);
  }

  const handle = trimmed.replace(/^@+/, "").replace(/^x\.com\//i, "").replace(/^twitter\.com\//i, "");
  return `${xBaseUrl.replace(/\/$/, "")}/${handle}`;
}

export function extractHandleFromLink(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  const match = trimmed.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i);
  if (match?.[1]) {
    return match[1];
  }

  const plainHandle = trimmed.replace(/^@+/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(plainHandle) ? plainHandle : null;
}
