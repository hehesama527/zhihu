import crypto from "node:crypto";
import { request as httpRequest, type Agent as HttpAgent } from "node:http";
import { request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { getXAppConfig } from "../config.js";
import { XHotspotRepository } from "../repositories/x-hotspot-repository.js";
import { XWorkspaceRepository } from "../repositories/x-workspace-repository.js";
import type {
  XAccount,
  XHotspot,
  XHotspotDetail,
  XHotspotPriority,
  XHotspotResearchOutput,
  XHotspotScanSummary,
  XHotspotSourceType,
  XHotspotStatus,
  XHotspotTopicType,
  XHotspotWatchlist,
  XHotspotWatchlistItem,
  XTask,
  XReferenceTweetSample
} from "../types.js";
import { XBrowserRuntime } from "./x-browser-runtime.js";
import { XLlmService } from "./x-llm-service.js";
import { rankHotspotsForTask, sortPlanningHotspots } from "./x-planning-utils.js";
import { collectAccountTimeline } from "./x-timeline-collector.js";

const require = createRequire(import.meta.url);
const HOTSPOT_RETENTION_MS = 72 * 60 * 60 * 1000;
const SOURCE_INTERVALS_MS: Record<XHotspotSourceType, number> = {
  market: 5 * 60 * 1000,
  news: 10 * 60 * 1000,
  watchlist: 60 * 60 * 1000
};
const ALL_SOURCE_TYPES: XHotspotSourceType[] = ["market", "news", "watchlist"];
const NEWS_FEEDS = [
  {
    label: "BlockBeats RSS",
    url: "https://api.theblockbeats.news/v1/open-api/home-xml",
    limit: 12
  },
  {
    label: "Cointelegraph RSS",
    url: "https://cointelegraph.com/rss",
    limit: 10
  },
  {
    label: "Decrypt RSS",
    url: "https://decrypt.co/feed",
    limit: 10
  },
  {
    label: "Bitcoin Magazine RSS",
    url: "https://www.bitcoinmagazine.com/.rss/full/",
    limit: 8
  }
] as const;

type ScanOptions = {
  sourceTypes?: XHotspotSourceType[];
  force?: boolean;
  includeResearch?: boolean;
};

type SourceScanResult = {
  createdCount: number;
  updatedCount: number;
  ignoredCount: number;
  researchHotspotIds: number[];
  summaryText: string;
};

type ParsedRssItem = {
  sourceLabel: string;
  title: string;
  link: string | null;
  summary: string;
  publishedAt: string | null;
};

type BinanceTicker24h = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume?: string;
};

export class XHotspotScoutService {
  private readonly config = getXAppConfig();

  constructor(
    private readonly llmService: XLlmService,
    private readonly repository = new XHotspotRepository(),
    private readonly browserRuntime = new XBrowserRuntime(),
    private readonly workspaceRepository = new XWorkspaceRepository()
  ) {}

  async ensureReady() {
    await this.repository.ensureReady();
    await this.repository.ensureDefaultWatchlist();
    await this.workspaceRepository.ensureReady();
  }

  async listHotspots(filters?: Parameters<XHotspotRepository["listHotspots"]>[0]) {
    await this.ensureReady();
    return this.repository.listHotspots(filters);
  }

  async getHotspotDetail(hotspotId: number) {
    await this.ensureReady();
    return this.repository.getHotspotDetail(hotspotId);
  }

  async listPlanningHotspots(limit = 6) {
    await this.ensureReady();
    const hotspots = await this.repository.listHotspots({
      status: "active",
      includeExpired: false
    });

    return sortPlanningHotspots(hotspots.filter((hotspot) => hotspot.priority !== "DROP")).slice(0, limit);
  }

  async listRelevantPlanningHotspots(task: Pick<XTask, "title" | "brief" | "goal">, limit = 6) {
    await this.ensureReady();
    const hotspots = await this.repository.listHotspots({
      status: "active",
      includeExpired: false
    });

    return rankHotspotsForTask(
      task,
      hotspots.filter((hotspot) => hotspot.priority !== "DROP")
    )
      .slice(0, limit)
      .map((item) => item.hotspot);
  }

  async getHotspotDetailsByIds(hotspotIds: number[]) {
    await this.ensureReady();
    const details: XHotspotDetail[] = [];

    for (const hotspotId of hotspotIds) {
      const detail = await this.repository.getHotspotDetail(hotspotId);
      if (detail) {
        details.push(detail);
      }
    }

    return details;
  }

  async updateHotspotStatus(hotspotId: number, status: XHotspotStatus) {
    await this.ensureReady();
    return this.repository.updateHotspotStatus(hotspotId, status);
  }

  async listWatchlists() {
    await this.ensureReady();
    return this.repository.listWatchlists();
  }

  async createWatchlist(input: { name: string; description: string; enabled: boolean }) {
    await this.ensureReady();
    return this.repository.createWatchlist(input);
  }

  async updateWatchlist(watchlistId: number, input: { name?: string; description?: string; enabled?: boolean }) {
    await this.ensureReady();
    return this.repository.updateWatchlist(watchlistId, input);
  }

  async deleteWatchlist(watchlistId: number) {
    await this.ensureReady();
    return this.repository.deleteWatchlist(watchlistId);
  }

  async createWatchlistItem(input: {
    watchlistId: number;
    type: XHotspotWatchlistItem["type"];
    value: string;
    label: string;
    enabled: boolean;
    priority: number;
    notes: string;
  }) {
    await this.ensureReady();
    return this.repository.createWatchlistItem(input);
  }

  async updateWatchlistItem(
    itemId: number,
    input: {
      label?: string;
      enabled?: boolean;
      priority?: number;
      notes?: string;
    }
  ) {
    await this.ensureReady();
    return this.repository.updateWatchlistItem(itemId, input);
  }

  async deleteWatchlistItem(itemId: number) {
    await this.ensureReady();
    return this.repository.deleteWatchlistItem(itemId);
  }

  async tick() {
    return this.runScanCycle({});
  }

  async scanNow(options: ScanOptions) {
    return this.runScanCycle(options);
  }

  async runResearchForHotspot(hotspotId: number) {
    await this.ensureReady();
    const detail = await this.repository.getHotspotDetail(hotspotId);
    if (!detail) {
      throw new Error("Hotspot does not exist.");
    }

    await this.repository.setHotspotResearchStatus(hotspotId, "running");

    const fallback: XHotspotResearchOutput = {
      summary: detail.summaryText || detail.title,
      whyNow: "",
      recommendedAction: "watch",
      suggestedTaskTitle: "",
      suggestedTaskBrief: "",
      angles: [],
      risks: [],
      operatorHints: []
    };

    try {
      const output = await this.llmService.runJson<XHotspotResearchOutput>(
        "x_hotspot_scout_agent",
        {
          hotspot: {
            id: detail.id,
            title: detail.title,
            summaryText: detail.summaryText,
            sourceType: detail.sourceType,
            topicType: detail.topicType,
            score: detail.score,
            priority: detail.priority,
            matchedWatchlistValues: detail.matchedWatchlistValues,
            symbols: detail.symbols,
            keywords: detail.keywords,
            firstSeenAt: detail.firstSeenAt,
            lastSeenAt: detail.lastSeenAt,
            expiresAt: detail.expiresAt
          },
          sources: detail.sources.slice(0, 8).map((source) => ({
            sourceType: source.sourceType,
            sourceLabel: source.sourceLabel,
            sourceUrl: source.sourceUrl,
            title: source.title,
            summaryText: source.summaryText,
            eventTime: source.eventTime,
            detectedAt: source.detectedAt,
            scoreDelta: source.scoreDelta
          })),
          watchlistContext: detail.matchedWatchlistValues
        },
        fallback
      );

      await this.repository.saveResearchRun(hotspotId, {
        status: "completed",
        summary: output.summary || fallback.summary,
        whyNow: output.whyNow || "",
        recommendedAction: output.recommendedAction || "watch",
        suggestedTaskTitle: output.suggestedTaskTitle || "",
        suggestedTaskBrief: output.suggestedTaskBrief || "",
        angles: ensureStringArray(output.angles),
        risks: ensureStringArray(output.risks),
        operatorHints: ensureStringArray(output.operatorHints),
        rawOutputJson: JSON.stringify(output)
      });
    } catch (error) {
      await this.repository.saveResearchRun(hotspotId, {
        status: "failed",
        summary: fallback.summary,
        whyNow: "",
        recommendedAction: "watch",
        suggestedTaskTitle: "",
        suggestedTaskBrief: "",
        angles: [],
        risks: [],
        operatorHints: [],
        errorText: error instanceof Error ? error.message : "Unknown hotspot research error."
      });
      throw error;
    }

    const updatedDetail = await this.repository.getHotspotDetail(hotspotId);
    if (!updatedDetail) {
      throw new Error("Hotspot disappeared after research.");
    }

    return updatedDetail;
  }

  buildTaskDraft(detail: XHotspotDetail) {
    const title = detail.suggestedTaskTitle?.trim() || `热点响应 | ${detail.title}`.slice(0, 120);
    const angleLine = detail.angles.length ? `建议角度：${detail.angles.join("；")}` : "建议角度：围绕热点本身做简明判断。";
    const riskLine = detail.risks.length ? `风险提醒：${detail.risks.join("；")}` : "风险提醒：避免夸大、避免把未证实信息写成定论。";
    const summaryLine = detail.researchSummaryText?.trim() || detail.summaryText.trim() || detail.title;
    const brief =
      detail.suggestedTaskBrief?.trim() ||
      [summaryLine, angleLine, riskLine, detail.canonicalUrl ? `参考链接：${detail.canonicalUrl}` : null]
        .filter(Boolean)
        .join("\n");

    return {
      title,
      brief,
      goal: "快速响应高优先级热点，输出适合 X 的观点内容。"
    };
  }

  async linkTaskToHotspot(input: {
    hotspotId: number | null;
    taskId: string;
    accountId: string;
    accountHandle: string;
    snapshotJson: string;
  }) {
    await this.ensureReady();
    return this.repository.createTaskLink(input);
  }

  async buildHotspotSnapshot(hotspotId: number) {
    const detail = await this.getHotspotDetail(hotspotId);
    if (!detail) {
      throw new Error("Hotspot does not exist.");
    }

    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        hotspot: detail
      },
      null,
      2
    );
  }

  private async runScanCycle(options: ScanOptions): Promise<XHotspotScanSummary> {
    await this.ensureReady();

    const requestedSources = normalizeSourceTypes(options.sourceTypes);
    const watchlistItems = await this.repository.listEnabledWatchlistItems();
    const triggeredSources: XHotspotSourceType[] = [];
    const skippedSources: XHotspotSourceType[] = [];
    const runs: XHotspotScanSummary["runs"] = [];
    const researchCandidates = new Set<number>();
    let createdCount = 0;
    let updatedCount = 0;
    let ignoredCount = 0;
    let researchCount = 0;

    for (const sourceType of requestedSources) {
      const due = options.force ? true : await this.isSourceDue(sourceType);
      if (!due) {
        skippedSources.push(sourceType);
        continue;
      }

      triggeredSources.push(sourceType);
      const scanRun = await this.repository.createScanRun(sourceType, new Date().toISOString());
      try {
        const result =
          sourceType === "news"
            ? await this.scanNews(watchlistItems)
            : sourceType === "market"
              ? await this.scanMarket(watchlistItems)
              : await this.scanWatchlistSignals(watchlistItems);

        createdCount += result.createdCount;
        updatedCount += result.updatedCount;
        ignoredCount += result.ignoredCount;
        for (const hotspotId of result.researchHotspotIds) {
          researchCandidates.add(hotspotId);
        }

        const completedRun = await this.repository.completeScanRun(scanRun.id, {
          status: "success",
          finishedAt: new Date().toISOString(),
          summaryText: result.summaryText,
          createdCount: result.createdCount,
          updatedCount: result.updatedCount,
          researchCount: 0
        });

        if (completedRun) {
          runs.push(completedRun);
        }
      } catch (error) {
        const completedRun = await this.repository.completeScanRun(scanRun.id, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          summaryText: error instanceof Error ? error.message : "Hotspot scan failed.",
          createdCount: 0,
          updatedCount: 0,
          researchCount: 0,
          errorText: error instanceof Error ? error.message : "Hotspot scan failed."
        });

        if (completedRun) {
          runs.push(completedRun);
        }
      }
    }

    if (options.includeResearch !== false && researchCandidates.size > 0) {
      researchCount = await this.runResearchForPendingHotspots([...researchCandidates]);
    }

    await this.repository.cleanupExpiredHotspots();

    return {
      triggeredSources,
      skippedSources,
      createdCount,
      updatedCount,
      researchCount,
      ignoredCount,
      runs
    };
  }

  private async isSourceDue(sourceType: XHotspotSourceType) {
    const lastRun = await this.repository.getLatestScanRun(sourceType);
    if (!lastRun?.finishedAt) {
      return true;
    }

    return Date.now() - new Date(lastRun.finishedAt).getTime() >= SOURCE_INTERVALS_MS[sourceType];
  }

  private async runResearchForPendingHotspots(hotspotIds: number[]) {
    let completedCount = 0;
    const hotspots = await this.repository.listHotspotsNeedingResearch(3, hotspotIds);
    for (const hotspot of hotspots) {
      try {
        await this.runResearchForHotspot(hotspot.id);
        completedCount += 1;
      } catch {
        // Keep moving. The failed run is already recorded.
      }
    }

    return completedCount;
  }

  private async scanNews(watchlistItems: XHotspotWatchlistItem[]): Promise<SourceScanResult> {
    const feedResults = await Promise.allSettled(
      NEWS_FEEDS.map(async (feed) => {
        const rssText = await fetchText(feed.url, this.config.browserProxyUrl);
        return parseRssItems(rssText, feed.label).slice(0, feed.limit);
      })
    );
    const items = feedResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    const failedFeeds = feedResults
      .map((result, index) =>
        result.status === "rejected" ? `${NEWS_FEEDS[index].label}: ${result.reason instanceof Error ? result.reason.message : "unknown error"}` : null
      )
      .filter((value): value is string => value != null);

    let createdCount = 0;
    let updatedCount = 0;
    let ignoredCount = 0;
    const researchHotspotIds: number[] = [];

    for (const item of items) {
      const text = `${item.title}\n${item.summary}`;
      const matchedWatchlistValues = matchWatchlistValues(
        text,
        item.sourceLabel,
        extractSymbols(text, watchlistItems),
        watchlistItems
      );
      const analysis = scoreNewsSignal(item, matchedWatchlistValues);
      const eventTime = item.publishedAt ?? new Date().toISOString();
      const hotspotKey = buildHotspotKey("news", item.title, analysis.symbols, eventTime);
      const normalizedLink = normalizeSourceUrl(item.link);
      const sourceHash = sha256(normalizedLink ?? `${item.sourceLabel}|${item.title}|${eventTime}`);

      const result = await this.repository.upsertHotspot({
        hotspotKey,
        title: item.title,
        summaryText: item.summary || item.title,
        sourceType: "news",
        topicType: analysis.topicType,
        symbols: analysis.symbols,
        keywords: analysis.keywords,
        matchedWatchlistValues,
        canonicalUrl: normalizedLink,
        score: analysis.score,
        priority: analysis.priority,
        firstSeenAt: eventTime,
        lastSeenAt: new Date().toISOString(),
        eventTime,
        expiresAt: new Date(Date.now() + HOTSPOT_RETENTION_MS).toISOString(),
        source: {
          sourceHash,
          sourceType: "news",
          sourceLabel: item.sourceLabel,
          sourceUrl: normalizedLink,
          title: item.title,
          summaryText: item.summary || item.title,
          rawPayloadJson: JSON.stringify(item),
          eventTime,
          detectedAt: new Date().toISOString(),
          scoreDelta: analysis.score
        }
      });

      if (result.duplicateSource) {
        ignoredCount += 1;
      } else if (result.created) {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }

      if (!result.duplicateSource && (result.hotspot.priority === "P0" || result.hotspot.priority === "P1")) {
        researchHotspotIds.push(result.hotspot.id);
      }
    }

    return {
      createdCount,
      updatedCount,
      ignoredCount,
      researchHotspotIds,
      summaryText:
        `新闻扫描完成：处理 ${items.length} 条 RSS 项，新增 ${createdCount}，更新 ${updatedCount}，重复 ${ignoredCount}` +
        (failedFeeds.length ? `，失败源 ${failedFeeds.length} 个：${failedFeeds.join(" | ")}` : "。")
    };
  }

  private async scanMarket(watchlistItems: XHotspotWatchlistItem[]): Promise<SourceScanResult> {
    const symbols = resolveMarketSymbols(watchlistItems);
    let createdCount = 0;
    let updatedCount = 0;
    let ignoredCount = 0;
    const researchHotspotIds: number[] = [];

    for (const config of symbols) {
      let ticker: BinanceTicker24h;
      try {
        ticker = await fetchJson<BinanceTicker24h>(
          `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(config.pair)}`,
          this.config.browserProxyUrl
        );
      } catch {
        ignoredCount += 1;
        continue;
      }
      const changePercent = Number(ticker.priceChangePercent);
      if (!Number.isFinite(changePercent) || Math.abs(changePercent) < config.threshold) {
        continue;
      }

      const matchedWatchlistValues = matchWatchlistValues(
        `${config.symbol} ${changePercent}`,
        "Binance API",
        [config.symbol],
        watchlistItems
      );
      const analysis = scoreMarketSignal({
        symbol: config.symbol,
        threshold: config.threshold,
        changePercent,
        quoteVolume: Number(ticker.quoteVolume ?? "0"),
        matchedWatchlistValues
      });
      const now = new Date().toISOString();
      const bucketStart = startOfHour(now);
      const hotspotKey = buildHotspotKey("market", `${config.symbol}-${changePercent >= 0 ? "up" : "down"}`, [config.symbol], bucketStart);
      const sourceHash = sha256(`${config.pair}:${changePercent >= 0 ? "up" : "down"}:${bucketStart}`);
      const title = `${config.symbol} 24h 涨跌幅 ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%，触发价格异动阈值`;
      const summaryText = [
        `当前价格：${Number(ticker.lastPrice).toFixed(4)}`,
        `24h 高点：${Number(ticker.highPrice).toFixed(4)}`,
        `24h 低点：${Number(ticker.lowPrice).toFixed(4)}`,
        `24h 成交量：${Number(ticker.volume).toFixed(2)}`
      ].join(" | ");

      const result = await this.repository.upsertHotspot({
        hotspotKey,
        title,
        summaryText,
        sourceType: "market",
        topicType: "price_move",
        symbols: [config.symbol],
        keywords: [config.symbol, "价格异动", changePercent >= 0 ? "上涨" : "下跌"],
        matchedWatchlistValues,
        canonicalUrl: null,
        score: analysis.score,
        priority: analysis.priority,
        firstSeenAt: bucketStart,
        lastSeenAt: now,
        eventTime: now,
        expiresAt: new Date(Date.now() + HOTSPOT_RETENTION_MS).toISOString(),
        source: {
          sourceHash,
          sourceType: "market",
          sourceLabel: "Binance API",
          sourceUrl: null,
          title,
          summaryText,
          rawPayloadJson: JSON.stringify(ticker),
          eventTime: now,
          detectedAt: now,
          scoreDelta: analysis.score
        }
      });

      if (result.duplicateSource) {
        ignoredCount += 1;
      } else if (result.created) {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }

      if (!result.duplicateSource && (result.hotspot.priority === "P0" || result.hotspot.priority === "P1")) {
        researchHotspotIds.push(result.hotspot.id);
      }
    }

    return {
      createdCount,
      updatedCount,
      ignoredCount,
      researchHotspotIds,
      summaryText: `行情扫描完成：监控 ${symbols.length} 个交易对，新增 ${createdCount}，更新 ${updatedCount}，重复 ${ignoredCount}。`
    };
  }

  private async scanWatchlistSignals(watchlistItems: XHotspotWatchlistItem[]): Promise<SourceScanResult> {
    const xAccountItems = watchlistItems.filter((item) => item.type === "x_account");
    if (xAccountItems.length === 0) {
      return {
        createdCount: 0,
        updatedCount: 0,
        ignoredCount: 0,
        researchHotspotIds: [],
        summaryText: `Watchlist scan skipped: ${watchlistItems.length} enabled items, 0 x_account entries.`
      };
    }

    const scoutAccount = await this.selectScoutAccount();
    if (!scoutAccount) {
      return {
        createdCount: 0,
        updatedCount: 0,
        ignoredCount: 0,
        researchHotspotIds: [],
        summaryText: `Watchlist scan skipped: ${xAccountItems.length} x_account entries, no active account with authStatus=ready.`
      };
    }

    const researchHotspotIds: number[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let ignoredCount = 0;
    let scannedAccounts = 0;
    let collectedTweets = 0;
    let failures = 0;
    const sessionKey = `x-hotspot-watchlist-${scoutAccount.id}`;

    try {
      await this.browserRuntime.withSession(
        sessionKey,
        scoutAccount.profileDir,
        scoutAccount.proxyUrl,
        async (page) => {
          for (const item of xAccountItems) {
            try {
              const collected = await collectAccountTimeline(page, item.value, 24, this.config.xBaseUrl);
              const recentTweets = collected.tweets.filter((tweet) => isRecentWatchlistTweet(tweet.publishedAt));

              scannedAccounts += 1;
              collectedTweets += recentTweets.length;

              for (const tweet of recentTweets) {
                const detectedAt = new Date().toISOString();
                const sourceLabel = `@${collected.handle}`;
                const analysis = scoreWatchlistTweet(tweet, collected.handle, item, watchlistItems);
                const matchedWatchlistValues = uniqueStrings([
                  item.label.trim() || item.value.trim(),
                  ...analysis.matchedWatchlistValues
                ]);
                const eventTime = tweet.publishedAt ?? detectedAt;
                const title = buildWatchlistHotspotTitle(collected.handle, tweet.text);
                const result = await this.repository.upsertHotspot({
                  hotspotKey: buildHotspotKey(
                    "watchlist",
                    `${collected.handle}:${tweet.tweetUrl}`,
                    analysis.symbols,
                    eventTime
                  ),
                  title,
                  summaryText: tweet.text.trim(),
                  sourceType: "watchlist",
                  topicType: analysis.topicType,
                  symbols: analysis.symbols,
                  keywords: analysis.keywords,
                  matchedWatchlistValues,
                  canonicalUrl: tweet.tweetUrl,
                  score: analysis.score,
                  priority: analysis.priority,
                  firstSeenAt: eventTime,
                  lastSeenAt: detectedAt,
                  eventTime,
                  expiresAt: new Date(Date.now() + HOTSPOT_RETENTION_MS).toISOString(),
                  source: {
                    sourceHash: sha256(tweet.tweetUrl),
                    sourceType: "watchlist",
                    sourceLabel,
                    sourceUrl: tweet.tweetUrl,
                    title,
                    summaryText: tweet.text.trim(),
                    rawPayloadJson: JSON.stringify({
                      watchlistItemId: item.id,
                      watchlistItemValue: item.value,
                      watchlistLabel: item.label,
                      collectorAccountId: scoutAccount.id,
                      handle: collected.handle,
                      tweet
                    }),
                    eventTime,
                    detectedAt,
                    scoreDelta: analysis.score
                  }
                });

                if (result.duplicateSource) {
                  ignoredCount += 1;
                } else if (result.created) {
                  createdCount += 1;
                } else {
                  updatedCount += 1;
                }

                if (!result.duplicateSource && (result.hotspot.priority === "P0" || result.hotspot.priority === "P1")) {
                  researchHotspotIds.push(result.hotspot.id);
                }
              }
            } catch {
              failures += 1;
            }
          }
        },
        {
          headless: this.config.browserHeadless
        }
      );
    } catch (error) {
      return {
        createdCount,
        updatedCount,
        ignoredCount,
        researchHotspotIds,
        summaryText: `Watchlist scan skipped: ${error instanceof Error ? error.message : "browser session failed"}.`
      };
    } finally {
      await this.browserRuntime.closeSession(sessionKey).catch(() => undefined);
    }

    return {
      createdCount,
      updatedCount,
      ignoredCount,
      researchHotspotIds,
      summaryText:
        `Watchlist scan completed: ${scannedAccounts}/${xAccountItems.length} accounts, ` +
        `${collectedTweets} recent tweets, created ${createdCount}, updated ${updatedCount}, ` +
        `ignored ${ignoredCount}, failures ${failures}.`
    };
  }

  private async selectScoutAccount(): Promise<XAccount | null> {
    const accounts = await this.workspaceRepository.listAccounts();
    return accounts.find((account) => account.status === "active" && account.authStatus === "ready") ?? null;
  }
}

const NEWS_KEYWORD_GROUPS = [
  { score: 20, terms: ["回测"] },
  { score: 18, terms: ["量化", "策略"] },
  { score: 15, terms: ["算法交易", "交易机器人", "自动交易", "历史数据"] },
  { score: 20, terms: ["亏损", "爆仓", "割肉"] },
  { score: 18, terms: ["浮亏", "被套"] },
  { score: 12, terms: ["暴跌", "黑客", "攻击", "漏洞", "风险"] },
  { score: 12, terms: ["ETF", "巨鲸", "爆仓量"] },
  { score: 10, terms: ["净流入", "净流出", "持仓量", "建仓", "平仓", "杠杆", "监管", "法案", "SEC", "美联储"] },
  { score: 8, terms: ["交易量", "多空", "新手", "入门", "学习", "经验", "心得", "复盘", "CPI", "降息", "区块链", "比特币", "以太坊", "BTC", "ETH", "SOL"] },
  { score: 10, terms: ["实测", "对比", "测评", "AI", "工具", "平台", "API", "TradingView", "Binance", "币安", "交易所"] },
  { score: 15, terms: ["突发"] },
  { score: 12, terms: ["重磅", "刚刚"] }
] as const;

function isRecentWatchlistTweet(publishedAt: string | null) {
  if (!publishedAt) {
    return true;
  }

  const publishedTime = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedTime)) {
    return true;
  }

  return Date.now() - publishedTime <= HOTSPOT_RETENTION_MS;
}

function buildWatchlistHotspotTitle(handle: string, text: string) {
  const normalizedText = normalizeTweetText(text);
  const preview = normalizedText.length > 96 ? `${normalizedText.slice(0, 93).trim()}...` : normalizedText;
  return `@${handle} ${preview}`;
}

function scoreWatchlistTweet(
  tweet: XReferenceTweetSample,
  handle: string,
  watchlistItem: XHotspotWatchlistItem,
  watchlistItems: XHotspotWatchlistItem[]
) {
  const normalizedText = normalizeTweetText(tweet.text);
  const lower = normalizedText.toLowerCase();
  const symbols = extractSymbols(normalizedText, watchlistItems);
  const matchedWatchlistValues = matchWatchlistValues(normalizedText, `@${handle}`, symbols, watchlistItems);
  const keywordHits = watchlistItems
    .filter((item) => item.type === "keyword" && lower.includes(item.value.toLowerCase()))
    .map((item) => item.label.trim() || item.value.trim());
  const signalKeywords = new Set<string>(keywordHits);
  let score = 35;

  score += Math.min(Math.round(watchlistItem.priority / 20), 5);
  score += 8;
  score += Math.min(symbols.length * 8, 16);
  score += Math.min(keywordHits.length * 6, 18);

  if (/\d/.test(normalizedText)) {
    score += 4;
  }
  if (normalizedText.length >= 60 && normalizedText.length <= 320) {
    score += 4;
  } else if (normalizedText.length < 24) {
    score -= 8;
  }
  if (/[?？]/.test(normalizedText)) {
    score += 2;
  }
  if (/(\bthread\b|(^|\s)\d+\/\d+|^\d+[.)])/i.test(normalizedText)) {
    score += 2;
  }
  if (containsAny(lower, ["etf", "sec", "fed", "cpi", "regulation", "lawsuit", "approval", "policy"])) {
    score += 12;
    signalKeywords.add("policy");
  }
  if (
    containsAny(lower, [
      "listing",
      "delist",
      "launch",
      "partnership",
      "acquisition",
      "mainnet",
      "testnet",
      "unlock",
      "hack",
      "exploit"
    ])
  ) {
    score += 10;
    signalKeywords.add("event");
  }
  if (
    containsAny(lower, [
      "long",
      "short",
      "buy",
      "sell",
      "entry",
      "exit",
      "breakout",
      "breakdown",
      "squeeze",
      "liquidation",
      "funding",
      "open interest",
      "volume"
    ])
  ) {
    score += 8;
    signalKeywords.add("market");
  }
  if (containsAny(lower, ["api", "tool", "bot", "wallet", "dashboard", "terminal"])) {
    score += 6;
    signalKeywords.add("tooling");
  }
  if (containsAny(lower, ["giveaway", "promo", "referral", "join now", "register", "follow + rt"])) {
    score -= 18;
    signalKeywords.add("promo");
  }

  const publishedTime = tweet.publishedAt ? new Date(tweet.publishedAt).getTime() : Number.NaN;
  if (Number.isFinite(publishedTime)) {
    const ageMs = Date.now() - publishedTime;
    if (ageMs <= 6 * 60 * 60 * 1000) {
      score += 6;
    } else if (ageMs <= 24 * 60 * 60 * 1000) {
      score += 4;
    } else if (ageMs <= HOTSPOT_RETENTION_MS) {
      score += 2;
    }
  }

  score = Math.max(0, score);

  return {
    score,
    priority: scoreToPriority(score),
    topicType: inferWatchlistTopicType(normalizedText, symbols),
    symbols,
    keywords: uniqueStrings([...signalKeywords]).slice(0, 8),
    matchedWatchlistValues
  };
}

function inferWatchlistTopicType(text: string, symbols: string[]): XHotspotTopicType {
  const lower = text.toLowerCase();
  if (containsAny(lower, ["etf", "sec", "fed", "cpi", "regulation", "lawsuit", "approval", "policy"])) {
    return "policy";
  }
  if (containsAny(lower, ["api", "tool", "bot", "wallet", "dashboard", "terminal", "product"])) {
    return "tooling";
  }
  if (
    symbols.length > 0 &&
    containsAny(lower, ["long", "short", "buy", "sell", "entry", "exit", "breakout", "breakdown", "liquidation"])
  ) {
    return "market_event";
  }
  return "kol_signal";
}

function normalizeTweetText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSourceTypes(sourceTypes?: XHotspotSourceType[]) {
  if (!sourceTypes || sourceTypes.length === 0) {
    return [...ALL_SOURCE_TYPES];
  }

  return ALL_SOURCE_TYPES.filter((type) => sourceTypes.includes(type));
}

async function fetchText(url: string, proxyUrl?: string | null) {
  return requestText(url, {
    proxyUrl,
    headers: {
      "user-agent": "claw-x-hotspot-scout/1.0"
    }
  });
}

async function fetchJson<T>(url: string, proxyUrl?: string | null) {
  const text = await requestText(url, {
    proxyUrl,
    headers: {
      "user-agent": "claw-x-hotspot-scout/1.0"
    }
  });

  return JSON.parse(text) as T;
}

async function requestText(
  url: string,
  options?: {
    proxyUrl?: string | null;
    headers?: Record<string, string>;
    timeoutMs?: number;
    redirectsRemaining?: number;
  }
) {
  const parsedUrl = new URL(url);
  const requestImpl = parsedUrl.protocol === "http:" ? httpRequest : httpsRequest;
  const agent = createProxyAgent(options?.proxyUrl ?? null);

  return new Promise<string>((resolve, reject) => {
    const request = requestImpl(
      parsedUrl,
      {
        method: "GET",
        headers: options?.headers,
        agent,
        timeout: options?.timeoutMs ?? 20_000
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          const location = response.headers.location;
          if (
            location &&
            [301, 302, 303, 307, 308].includes(statusCode) &&
            (options?.redirectsRemaining ?? 3) > 0
          ) {
            resolve(
              requestText(new URL(location, parsedUrl).toString(), {
                ...options,
                redirectsRemaining: (options?.redirectsRemaining ?? 3) - 1
              })
            );
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Failed to fetch ${url}: ${statusCode}`));
            return;
          }

          resolve(body);
        });
      }
    );

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error(`Request timeout for ${url}`));
    });
    request.end();
  });
}

function parseRssItems(xml: string, sourceLabel: string): ParsedRssItem[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return items.map((block) => {
    const title = stripHtml(decodeHtmlEntities(extractXmlTag(block, "title")));
    const link = decodeHtmlEntities(extractXmlTag(block, "link")) || null;
    const summary = stripHtml(decodeHtmlEntities(extractXmlTag(block, "description") || extractXmlTag(block, "summary")));
    const published = extractXmlTag(block, "pubDate") || extractXmlTag(block, "published");
    const publishedAt = published ? new Date(published).toISOString() : null;

    return {
      sourceLabel,
      title,
      link,
      summary,
      publishedAt
    };
  });
}

function extractXmlTag(block: string, tagName: string) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match) {
    return "";
  }

  return match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCharCode(Number(digits)));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractSymbols(text: string, watchlistItems: XHotspotWatchlistItem[]) {
  const upper = text.toUpperCase();
  const baseSymbols = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"];
  const watchlistSymbols = watchlistItems
    .filter((item) => item.type === "symbol")
    .map((item) => normalizeSymbol(item.value));
  const symbols = [...baseSymbols, ...watchlistSymbols].filter((symbol, index, array) => array.indexOf(symbol) === index);
  return symbols.filter((symbol) => upper.includes(symbol));
}

function matchWatchlistValues(
  text: string,
  sourceLabel: string,
  symbols: string[],
  watchlistItems: XHotspotWatchlistItem[]
) {
  const lowerText = text.toLowerCase();
  const lowerSourceLabel = sourceLabel.toLowerCase();
  const symbolSet = new Set(symbols.map((symbol) => normalizeSymbol(symbol)));
  const matched = new Set<string>();

  for (const item of watchlistItems) {
    if (item.type === "keyword" && lowerText.includes(item.value.toLowerCase())) {
      matched.add(item.label || item.value);
    }
    if (item.type === "source" && (lowerSourceLabel.includes(item.value.toLowerCase()) || lowerText.includes(item.value.toLowerCase()))) {
      matched.add(item.label || item.value);
    }
    if (item.type === "symbol" && symbolSet.has(normalizeSymbol(item.value))) {
      matched.add(item.label || normalizeSymbol(item.value));
    }
  }

  return [...matched];
}

function scoreNewsSignal(item: ParsedRssItem, matchedWatchlistValues: string[]) {
  const title = item.title || "";
  const summary = item.summary || "";
  const titleLower = title.toLowerCase();
  const summaryLower = summary.toLowerCase();
  let score = 0;
  const matchedKeywords = new Set<string>();

  for (const group of NEWS_KEYWORD_GROUPS) {
    for (const term of group.terms) {
      const termLower = term.toLowerCase();
      const inTitle = titleLower.includes(termLower);
      const inSummary = summaryLower.includes(termLower);
      if (!inTitle && !inSummary) {
        continue;
      }

      score += Math.round(group.score * (inTitle ? 1.5 : 1));
      matchedKeywords.add(term);
    }
  }

  if (/\d/.test(`${title} ${summary}`)) {
    score += 5;
  }
  if (containsAny(titleLower + summaryLower, ["亏损", "爆仓", "割肉", "浮亏", "被套", "失败"])) {
    score += 8;
  }
  if (containsAny(titleLower + summaryLower, ["突发", "刚刚", "重磅"])) {
    score += 5;
  }
  if (containsAny(titleLower + summaryLower, ["回测", "量化", "策略", "tradingview", "api"])) {
    score += 10;
  }
  if (containsAny(titleLower + summaryLower, ["实测", "对比", "测评", "复盘", "经验", "心得"])) {
    score += 8;
  }
  if (containsAny(titleLower + summaryLower, ["广告", "推广", "赞助", "注册链接", "空投"])) {
    score -= 20;
  }

  score += Math.min(matchedWatchlistValues.length * 4, 12);
  score = Math.max(0, score);

  const symbols = extractSymbols(`${title}\n${summary}`, []);
  return {
    score,
    priority: scoreToPriority(score),
    topicType: inferNewsTopicType(`${title}\n${summary}`),
    symbols,
    keywords: [...matchedKeywords]
  };
}

function scoreMarketSignal(input: {
  symbol: string;
  threshold: number;
  changePercent: number;
  quoteVolume: number;
  matchedWatchlistValues: string[];
}) {
  let score = input.symbol === "BTC" ? 60 : input.symbol === "ETH" ? 65 : 55;
  const absChange = Math.abs(input.changePercent);
  if (absChange >= input.threshold + 5) {
    score += 10;
  } else if (absChange >= input.threshold + 2) {
    score += 5;
  }
  if (input.changePercent < 0) {
    score += 5;
  }
  if (input.quoteVolume >= 1_000_000_000) {
    score += 5;
  }
  score += Math.min(input.matchedWatchlistValues.length * 6, 12);

  return {
    score,
    priority: scoreToPriority(score)
  };
}

function inferNewsTopicType(text: string): XHotspotTopicType {
  const lower = text.toLowerCase();
  if (containsAny(lower, ["监管", "法案", "sec", "美联储", "cpi", "降息"])) {
    return "policy";
  }
  if (containsAny(lower, ["工具", "平台", "api", "tradingview", "软件"])) {
    return "tooling";
  }
  if (containsAny(lower, ["巨鲸", "etf", "爆仓", "突破", "跌破", "涨", "跌"])) {
    return "market_event";
  }
  return "news_flash";
}

function resolveMarketSymbols(watchlistItems: XHotspotWatchlistItem[]) {
  const symbolItems = watchlistItems
    .filter((item) => item.type === "symbol")
    .map((item) => normalizeSymbol(item.value));
  const symbols = symbolItems.length > 0 ? symbolItems : ["BTC", "ETH", "BNB"];

  return symbols.map((symbol) => ({
    symbol,
    pair: `${symbol}USDT`,
    threshold: symbol === "BTC" ? 5 : symbol === "ETH" ? 8 : 10
  }));
}

function buildHotspotKey(sourceType: XHotspotSourceType, title: string, symbols: string[], eventTime: string) {
  const normalizedTitle = normalizeHotspotIdentity(sourceType, title);
  const bucket = sourceType === "market" ? startOfHour(eventTime) : startOfHour(eventTime);
  return `${sourceType}:${sha256(`${normalizedTitle}|${symbols.join(",")}|${bucket}`)}`;
}

function startOfHour(value: string) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function scoreToPriority(score: number): XHotspotPriority {
  if (score >= 80) {
    return "P0";
  }
  if (score >= 60) {
    return "P1";
  }
  if (score >= 40) {
    return "P2";
  }
  return "DROP";
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function ensureStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function containsAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

function normalizeSymbol(value: string) {
  return value.trim().replace(/\/?USDT$/i, "").replace(/^@+/, "").toUpperCase();
}

function normalizeSourceUrl(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || key === "output" || key === "rss") {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function normalizeHotspotIdentity(sourceType: XHotspotSourceType, value: string) {
  const base = value.toLowerCase();
  if (sourceType !== "news") {
    return base.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  return base
    .replace(/^(breaking|update|just in|快讯|要闻|突发|简讯)\s*[:：\-|]\s*/i, "")
    .replace(/^[\[(【].{1,24}?[\])】]\s*/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function createProxyAgent(proxyUrl: string | null): HttpAgent | undefined {
  if (!proxyUrl) {
    return undefined;
  }

  const proxyModule = require("next/dist/compiled/https-proxy-agent");
  const HttpsProxyAgent = proxyModule.HttpsProxyAgent ?? proxyModule.default?.HttpsProxyAgent;
  if (!HttpsProxyAgent) {
    throw new Error("Missing HttpsProxyAgent runtime.");
  }

  return new HttpsProxyAgent(proxyUrl) as HttpAgent;
}
