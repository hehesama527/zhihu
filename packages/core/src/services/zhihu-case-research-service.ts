import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { LlmService } from "./llm-service.js";

const CASE_RESEARCH_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RAW_MATERIALS = 36;

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

const CASE_RESEARCH_TOPIC_PATTERNS = [
  /\u5e01\u5708/u,
  /\u7092\u5e01/u,
  /\u5c71\u5be8\u5e01/u,
  /\u52a0\u5bc6\u8d27\u5e01/u,
  /\u4ea4\u6613/u,
  /\u91cf\u5316/u,
  /\u7b56\u7565/u,
  /\u56de\u6d4b/u,
  /\u5408\u7ea6/u,
  /\u6760\u6746/u,
  /\u4ed3\u4f4d/u,
  /\u6b62\u635f/u,
  /\u505a\u591a|\u505a\u7a7a/u,
  /\u5fc3\u6001/u,
  /\u7a33\u5b9a\u76c8\u5229/u,
  /crypto|bitcoin|btc|eth|altcoin|memecoin|token|trading|backtest|strategy|leverage/i
];

type RawCaseMaterial = {
  source_type: "rss" | "market" | "source_context";
  source_label: string;
  source_url: string | null;
  title: string;
  summary: string;
  published_at: string | null;
  symbols: string[];
  metrics: Record<string, string | number | null>;
};

export type ZhihuCaseMaterial = {
  case_label: string;
  source_type: "rss" | "market" | "source_context" | "composite_hint";
  source_label: string;
  source_url: string;
  time_or_period: string;
  price_or_market_path: string;
  retail_entry_trigger: string;
  risk_mechanism: string;
  outcome_pressure: string;
  usable_angle: string;
  confidence: "high" | "medium" | "low";
  caution: string;
};

export type ZhihuCaseResearchOutput = {
  should_use_case_research: boolean;
  research_summary: string;
  case_materials: ZhihuCaseMaterial[];
  writer_guidance: string;
  must_not_claim: string[];
  collected_at: string;
  raw_material_count: number;
  failed_sources: string[];
};

type CaseResearchInput = {
  questionTitle: string;
  questionUrl?: string | null;
  topicCard?: Record<string, unknown> | null;
  sourceContext?: Record<string, unknown> | null;
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

type CoinGeckoMarket = {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  high_24h: number | null;
  low_24h: number | null;
  total_volume: number | null;
  price_change_percentage_24h: number | null;
  market_cap_rank: number | null;
};

export class ZhihuCaseResearchService {
  constructor(private readonly llmService: LlmService) {}

  async research(input: CaseResearchInput): Promise<ZhihuCaseResearchOutput> {
    const startedAt = Date.now();
    const shouldResearch = shouldRunCaseResearch(input.questionTitle, input.topicCard);
    const fallback = buildFallbackResearch(input.questionTitle, shouldResearch);

    if (!shouldResearch) {
      return fallback;
    }

    logDebugTiming("zhihuCaseResearch.research", "start", {
      questionTitle: input.questionTitle
    });

    try {
      const { materials, failedSources } = await this.collectRawMaterials(input);
      const selectedMaterials = selectRelevantMaterials(input.questionTitle, materials);

      if (selectedMaterials.length === 0) {
        return {
          ...fallback,
          should_use_case_research: true,
          research_summary: "No reliable backend source material was collected; Writer should use a clearly typical/composite case.",
          failed_sources: failedSources
        };
      }

      const structured = await this.llmService.runJsonWithSystemPrompt<ZhihuCaseResearchOutput>(
        buildCaseResearchPrompt(),
        {
          questionTitle: input.questionTitle,
          questionUrl: input.questionUrl ?? null,
          topicCard: pickTopicCardResearchFields(input.topicCard),
          raw_materials: selectedMaterials.slice(0, MAX_RAW_MATERIALS)
        },
        {
          ...fallback,
          raw_material_count: selectedMaterials.length,
          failed_sources: failedSources
        },
        CASE_RESEARCH_TIMEOUT_MS
      );

      const normalized = normalizeCaseResearchOutput(structured, {
        ...fallback,
        raw_material_count: selectedMaterials.length,
        failed_sources: failedSources
      });

      logDebugTiming("zhihuCaseResearch.research", "done", {
        questionTitle: input.questionTitle,
        rawMaterialCount: selectedMaterials.length,
        caseMaterialCount: normalized.case_materials.length,
        elapsedMs: getElapsedMs(startedAt)
      });

      return normalized;
    } catch (error) {
      logDebugTiming("zhihuCaseResearch.research", "failed", {
        questionTitle: input.questionTitle,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: getElapsedMs(startedAt)
      });

      return {
        ...fallback,
        should_use_case_research: true,
        research_summary:
          "Backend case research failed; Writer should use a cautious typical/composite case and avoid claiming verified facts.",
        failed_sources: ["case_research_runtime"]
      };
    }
  }

  private async collectRawMaterials(input: CaseResearchInput) {
    const [newsResult, marketResult] = await Promise.allSettled([
      collectNewsMaterials(),
      collectMarketMaterials()
    ]);

    const materials: RawCaseMaterial[] = [
      ...collectSourceContextMaterials(input.sourceContext),
      ...(newsResult.status === "fulfilled" ? newsResult.value.materials : []),
      ...(marketResult.status === "fulfilled" ? marketResult.value.materials : [])
    ];

    const failedSources = [
      ...(newsResult.status === "fulfilled" ? newsResult.value.failedSources : ["news_research"]),
      ...(marketResult.status === "fulfilled" ? marketResult.value.failedSources : ["market_research"])
    ];

    return { materials, failedSources };
  }
}

function shouldRunCaseResearch(questionTitle: string, topicCard?: Record<string, unknown> | null) {
  const plan = topicCard && typeof topicCard.writing_plan === "object" ? (topicCard.writing_plan as Record<string, unknown>) : null;
  if (plan?.should_use_cases === true) {
    return true;
  }

  const text = [
    questionTitle,
    typeof topicCard?.title === "string" ? topicCard.title : "",
    typeof topicCard?.summary === "string" ? topicCard.summary : "",
    typeof topicCard?.question_type === "string" ? topicCard.question_type : "",
    typeof topicCard?.recommended_angle === "string" ? topicCard.recommended_angle : ""
  ].join("\n");

  return CASE_RESEARCH_TOPIC_PATTERNS.some((pattern) => pattern.test(text));
}

async function collectNewsMaterials() {
  const settled = await Promise.allSettled(
    NEWS_FEEDS.map(async (feed) => {
      const rssText = await fetchText(feed.url);
      return parseRssItems(rssText, feed.label).slice(0, feed.limit);
    })
  );

  const failedSources: string[] = [];
  const items = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    failedSources.push(`${NEWS_FEEDS[index].label}: ${toErrorMessage(result.reason)}`);
    return [];
  });

  return {
    failedSources,
    materials: items.map<RawCaseMaterial>((item) => ({
      source_type: "rss",
      source_label: item.sourceLabel,
      source_url: item.link,
      title: item.title,
      summary: item.summary,
      published_at: item.publishedAt,
      symbols: extractCryptoSymbols(`${item.title}\n${item.summary}`),
      metrics: {}
    }))
  };
}

async function collectMarketMaterials() {
  const failedSources: string[] = [];

  try {
    const materials = await collectBinanceMarketMaterials();
    if (materials.length > 0) {
      return {
        failedSources,
        materials
      };
    }
  } catch (error) {
    failedSources.push(`Binance 24h ticker: ${toErrorMessage(error)}`);
  }

  try {
    const materials = await collectCoinGeckoMarketMaterials();
    return {
      failedSources,
      materials
    };
  } catch (error) {
    failedSources.push(`CoinGecko markets: ${toErrorMessage(error)}`);
    return {
      failedSources,
      materials: []
    };
  }
}

async function collectBinanceMarketMaterials() {
  const tickers = await fetchJson<BinanceTicker24h[]>("https://api.binance.com/api/v3/ticker/24hr");
  return tickers
    .filter((ticker) => isUsdtSpotSymbol(ticker.symbol))
    .map((ticker) => ({
      ticker,
      changePercent: Number(ticker.priceChangePercent),
      quoteVolume: Number(ticker.quoteVolume ?? "0")
    }))
    .filter((item) => Number.isFinite(item.changePercent) && Number.isFinite(item.quoteVolume))
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 18)
    .map<RawCaseMaterial>(({ ticker, changePercent, quoteVolume }) => ({
      source_type: "market",
      source_label: "Binance 24h ticker",
      source_url: "",
      title: `${ticker.symbol} 24h move ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
      summary: [
        `last=${ticker.lastPrice}`,
        `high=${ticker.highPrice}`,
        `low=${ticker.lowPrice}`,
        `volume=${ticker.volume}`,
        `quoteVolume=${Number.isFinite(quoteVolume) ? quoteVolume.toFixed(0) : "unknown"}`
      ].join(" | "),
      published_at: new Date().toISOString(),
      symbols: [ticker.symbol.replace(/USDT$/i, "")],
      metrics: {
        symbol: ticker.symbol,
        lastPrice: ticker.lastPrice,
        highPrice: ticker.highPrice,
        lowPrice: ticker.lowPrice,
        priceChangePercent: changePercent,
        volume: ticker.volume,
        quoteVolume: ticker.quoteVolume ?? null
      }
    }));
}

async function collectCoinGeckoMarketMaterials() {
  const url = [
    "https://api.coingecko.com/api/v3/coins/markets",
    "?vs_currency=usd",
    "&order=market_cap_desc",
    "&per_page=80",
    "&page=1",
    "&sparkline=false",
    "&price_change_percentage=24h"
  ].join("");
  const tickers = await fetchJson<CoinGeckoMarket[]>(url);

  return tickers
    .map((ticker) => ({
      ticker,
      changePercent: Number(ticker.price_change_percentage_24h ?? 0),
      volume: Number(ticker.total_volume ?? 0)
    }))
    .filter((item) => Number.isFinite(item.changePercent) && Number.isFinite(item.volume))
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 18)
    .map<RawCaseMaterial>(({ ticker, changePercent, volume }) => ({
      source_type: "market",
      source_label: "CoinGecko markets",
      source_url: `https://www.coingecko.com/en/coins/${ticker.id}`,
      title: `${ticker.name} (${ticker.symbol.toUpperCase()}) 24h move ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
      summary: [
        `current=${formatMetric(ticker.current_price)}`,
        `high_24h=${formatMetric(ticker.high_24h)}`,
        `low_24h=${formatMetric(ticker.low_24h)}`,
        `volume=${Number.isFinite(volume) ? volume.toFixed(0) : "unknown"}`,
        `market_cap_rank=${ticker.market_cap_rank ?? "unknown"}`
      ].join(" | "),
      published_at: new Date().toISOString(),
      symbols: [ticker.symbol.toUpperCase()],
      metrics: {
        id: ticker.id,
        symbol: ticker.symbol.toUpperCase(),
        currentPrice: ticker.current_price,
        high24h: ticker.high_24h,
        low24h: ticker.low_24h,
        priceChangePercent24h: changePercent,
        volume,
        marketCapRank: ticker.market_cap_rank
      }
    }));
}

function collectSourceContextMaterials(sourceContext?: Record<string, unknown> | null): RawCaseMaterial[] {
  const events = Array.isArray(sourceContext?.sourceEvents) ? sourceContext.sourceEvents : [];
  const materials: RawCaseMaterial[] = [];

  for (const [index, event] of events.entries()) {
    if (!event || typeof event !== "object") {
      continue;
    }

    const record = event as Record<string, unknown>;
    const metadata = record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : {};
    const title = pickString(metadata.title, metadata.questionTitle, metadata.text, record.title, record.sourceType);
    const summary = pickString(metadata.summary, metadata.description, metadata.content, metadata.extraContext, record.metadata);

    if (!title && !summary) {
      continue;
    }

    materials.push({
      source_type: "source_context",
      source_label: pickString(record.sourceType, "source_context") || `source_context_${index + 1}`,
      source_url: pickString(metadata.url, metadata.link, metadata.questionUrl) || null,
      title: title || `source_context_${index + 1}`,
      summary,
      published_at: pickString(record.discoveredAt, metadata.publishedAt, metadata.createdAt) || null,
      symbols: extractCryptoSymbols(`${title}\n${summary}`),
      metrics: {}
    });
  }

  return materials.slice(-10);
}

function selectRelevantMaterials(questionTitle: string, materials: RawCaseMaterial[]) {
  return materials
    .map((material) => ({
      material,
      score: scoreMaterial(questionTitle, material)
    }))
    .filter((item) => item.score > 0 || item.material.source_type === "market")
    .sort((a, b) => b.score - a.score)
    .map((item) => item.material)
    .slice(0, MAX_RAW_MATERIALS);
}

function scoreMaterial(questionTitle: string, material: RawCaseMaterial) {
  const question = questionTitle.toLowerCase();
  const text = `${material.title}\n${material.summary}\n${material.symbols.join(" ")}`.toLowerCase();
  let score = 0;

  const genericTerms = [
    "crypto",
    "bitcoin",
    "btc",
    "eth",
    "altcoin",
    "memecoin",
    "meme coin",
    "token",
    "trading",
    "leverage",
    "liquidation",
    "volatility",
    "pump",
    "dump",
    "rug",
    "binance",
    "\u5e01",
    "\u5c71\u5be8",
    "\u5408\u7ea6",
    "\u7206\u4ed3",
    "\u62c9\u76d8",
    "\u4e0b\u8dcc"
  ];

  for (const term of genericTerms) {
    if (text.includes(term)) {
      score += 2;
    }
  }

  const topicTerms = question
    .split(/[\s,，。?？!！:：;；/\\|()[\]{}"']+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  for (const term of topicTerms) {
    if (text.includes(term)) {
      score += 4;
    }
  }

  if (question.includes("\u5c71\u5be8") || question.includes("altcoin")) {
    for (const term of ["altcoin", "memecoin", "token", "pump", "dump", "liquidity", "low cap", "\u5c71\u5be8"]) {
      if (text.includes(term)) {
        score += 5;
      }
    }
  }

  if (material.source_type === "market") {
    const change = Number(material.metrics.priceChangePercent ?? 0);
    score += Math.min(8, Math.abs(change) / 4);
  }

  return score;
}

function buildCaseResearchPrompt() {
  return [
    "You are Zhihu Case Research Agent in the backend workflow.",
    "Your job is not to write the article. Your job is to turn backend-collected source material into case materials that Writer Agent can use.",
    "Use only facts present in raw_materials for source-backed cases. Do not invent exact facts for rss/market/source_context materials.",
    "If source material is weak, create one clearly typical/composite case as source_type=composite_hint with low confidence.",
    "Never copy article wording from RSS descriptions. Paraphrase only.",
    "Prefer concrete case action chains: time/price path or market setup, why a retail trader enters, position/budget range, long/short temptation, action deformation, outcome pressure, and review takeaway.",
    "Use cautious wording. Do not claim price prediction, guaranteed profit, insider knowledge, or verified personal trading records.",
    "Use Simplified Chinese for narrative fields.",
    "Return JSON only with this shape:",
    "{",
    '  "should_use_case_research": true,',
    '  "research_summary": "",',
    '  "case_materials": [',
    "    {",
    '      "case_label": "",',
    '      "source_type": "rss | market | source_context | composite_hint",',
    '      "source_label": "",',
    '      "source_url": "",',
    '      "time_or_period": "",',
    '      "price_or_market_path": "",',
    '      "retail_entry_trigger": "",',
    '      "risk_mechanism": "",',
    '      "outcome_pressure": "",',
    '      "usable_angle": "",',
    '      "confidence": "high | medium | low",',
    '      "caution": ""',
    "    }",
    "  ],",
    '  "writer_guidance": "",',
    '  "must_not_claim": [],',
    '  "collected_at": "",',
    '  "raw_material_count": 0,',
    '  "failed_sources": []',
    "}"
  ].join("\n");
}

function pickTopicCardResearchFields(topicCard?: Record<string, unknown> | null) {
  if (!topicCard) {
    return null;
  }

  return {
    title: topicCard.title,
    summary: topicCard.summary,
    question_type: topicCard.question_type,
    recommended_angle: topicCard.recommended_angle,
    writing_plan: topicCard.writing_plan,
    soft_promo_directive: topicCard.soft_promo_directive,
    risk_notes: topicCard.risk_notes
  };
}

function normalizeCaseResearchOutput(output: unknown, fallback: ZhihuCaseResearchOutput): ZhihuCaseResearchOutput {
  const record = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const materials = Array.isArray(record.case_materials)
    ? record.case_materials.map(normalizeCaseMaterial).filter((item): item is ZhihuCaseMaterial => item !== null)
    : [];

  return {
    should_use_case_research:
      typeof record.should_use_case_research === "boolean" ? record.should_use_case_research : fallback.should_use_case_research,
    research_summary: pickString(record.research_summary, fallback.research_summary),
    case_materials: materials.slice(0, 4),
    writer_guidance: pickString(record.writer_guidance, fallback.writer_guidance),
    must_not_claim: normalizeStringArray(record.must_not_claim, fallback.must_not_claim),
    collected_at: pickString(record.collected_at, fallback.collected_at) || new Date().toISOString(),
    raw_material_count: normalizeNumber(record.raw_material_count, fallback.raw_material_count),
    failed_sources: normalizeStringArray(record.failed_sources, fallback.failed_sources)
  };
}

function normalizeCaseMaterial(value: unknown): ZhihuCaseMaterial | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sourceType = normalizeSourceType(record.source_type);
  const confidence = normalizeConfidence(record.confidence);
  const caseLabel = pickString(record.case_label, record.source_label, "case_material");
  const usableAngle = pickString(record.usable_angle, record.risk_mechanism, record.price_or_market_path);

  if (!caseLabel && !usableAngle) {
    return null;
  }

  return {
    case_label: caseLabel || "case_material",
    source_type: sourceType,
    source_label: pickString(record.source_label, sourceType),
    source_url: pickString(record.source_url),
    time_or_period: pickString(record.time_or_period),
    price_or_market_path: pickString(record.price_or_market_path),
    retail_entry_trigger: pickString(record.retail_entry_trigger),
    risk_mechanism: pickString(record.risk_mechanism),
    outcome_pressure: pickString(record.outcome_pressure),
    usable_angle: usableAngle,
    confidence,
    caution: pickString(record.caution)
  };
}

function normalizeSourceType(value: unknown): ZhihuCaseMaterial["source_type"] {
  return value === "rss" || value === "market" || value === "source_context" || value === "composite_hint"
    ? value
    : "composite_hint";
}

function normalizeConfidence(value: unknown): ZhihuCaseMaterial["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function buildFallbackResearch(questionTitle: string, shouldResearch: boolean): ZhihuCaseResearchOutput {
  return {
    should_use_case_research: shouldResearch,
    research_summary: shouldResearch
      ? "Writer should use concrete case material. If no backend material is available, use a cautious typical/composite case."
      : "This topic does not require backend case research.",
    case_materials: shouldResearch
      ? [
          {
            case_label: "typical composite trading case",
            source_type: "composite_hint",
            source_label: "backend fallback",
            source_url: "",
            time_or_period: "typical short-cycle market move",
            price_or_market_path:
              "Use a self-consistent path such as a fast pump, a short consolidation, then a sharp retracement; do not present it as a verified token event.",
            retail_entry_trigger: "retail trader enters after seeing a fast move, social proof, or fear of missing out",
            risk_mechanism: "thin liquidity, late entry, leverage temptation, stop-loss failure, and emotional averaging down",
            outcome_pressure: "small mistake becomes a large drawdown because exit liquidity disappears",
            usable_angle: "Use this only as a common-pattern example when no reliable backend source material exists.",
            confidence: "low",
            caution: "Do not claim this is a real verified case."
          }
        ]
      : [],
    writer_guidance: shouldResearch
      ? "Use case material to carry the argument. Keep facts cautious and avoid repeating user-provided reference copy."
      : "",
    must_not_claim: [
      "Do not claim insider knowledge.",
      "Do not claim a source-backed case is independently verified unless the backend material proves it.",
      "Do not present composite_hint as a real friend, real trade record, or screenshot-backed fact."
    ],
    collected_at: new Date().toISOString(),
    raw_material_count: 0,
    failed_sources: []
  };
}

async function fetchText(url: string) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchJson<T>(url: string) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchWithTimeout(url: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS + attempt * 8_000);

    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/rss+xml, application/xml, application/json, text/xml, */*",
          "user-agent": "Mozilla/5.0 zhihu-agent-case-research/1.0"
        }
      });
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await sleep(500);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseRssItems(xml: string, sourceLabel: string): ParsedRssItem[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return items.map((block) => {
    const title = stripHtml(decodeHtmlEntities(extractXmlTag(block, "title")));
    const link = decodeHtmlEntities(extractXmlTag(block, "link")) || null;
    const summary = stripHtml(decodeHtmlEntities(extractXmlTag(block, "description") || extractXmlTag(block, "summary")));
    const published = extractXmlTag(block, "pubDate") || extractXmlTag(block, "published");

    return {
      sourceLabel,
      title,
      link,
      summary,
      publishedAt: normalizeDate(published)
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

function normalizeDate(value: string) {
  if (!value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractCryptoSymbols(text: string) {
  const upper = text.toUpperCase();
  const matches = upper.match(/\b[A-Z0-9]{2,12}\b/g) ?? [];
  const blocked = new Set(["THE", "AND", "FOR", "WITH", "THIS", "THAT", "FROM", "WILL", "HAVE", "HAS", "ARE"]);

  return [...new Set(matches.filter((item) => !blocked.has(item)).slice(0, 8))];
}

function isUsdtSpotSymbol(symbol: string) {
  if (!symbol.endsWith("USDT")) {
    return false;
  }

  return !/(UP|DOWN|BULL|BEAR|[0-9][SL])USDT$/i.test(symbol);
}

function formatMetric(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "unknown";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function normalizeStringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
