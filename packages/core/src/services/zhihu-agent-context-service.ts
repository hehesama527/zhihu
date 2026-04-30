import fs from "node:fs/promises";
import path from "node:path";
import { getAppConfig } from "../config/env.js";

export type ZhihuAgentContextDocuments = {
  targetMarkdown: string | null;
  productMarkdown: string | null;
  targetPath: string;
  productPath: string;
};

export class ZhihuAgentContextService {
  async ensureDocuments(): Promise<ZhihuAgentContextDocuments> {
    const targetPath = this.getTargetPath();
    const productPath = this.getProductPath();

    await Promise.all([
      fs.mkdir(path.dirname(targetPath), { recursive: true }),
      fs.mkdir(path.dirname(productPath), { recursive: true })
    ]);

    const [targetMarkdown, productMarkdown] = await Promise.all([
      ensureMarkdownFile(targetPath, DEFAULT_TARGET_MARKDOWN),
      ensureMarkdownFile(productPath, DEFAULT_PRODUCT_MARKDOWN)
    ]);

    return {
      targetMarkdown,
      productMarkdown,
      targetPath,
      productPath
    };
  }

  private getTargetPath() {
    const override = normalizeOptionalPath(process.env.ZHIHU_TARGET_CONTEXT_PATH);
    if (override) {
      return override;
    }

    return path.join(this.getContextDirectory(), "target.md");
  }

  private getProductPath() {
    const override = normalizeOptionalPath(process.env.ZHIHU_PRODUCT_CONTEXT_PATH);
    if (override) {
      return override;
    }

    return path.join(this.getContextDirectory(), "product.md");
  }

  private getContextDirectory() {
    const override = normalizeOptionalPath(process.env.ZHIHU_AGENT_CONTEXT_DIR);
    if (override) {
      return override;
    }

    return path.join(getAppConfig().dataDir, "zhihu-agent-context");
  }
}

async function ensureMarkdownFile(filePath: string, defaultContent: string) {
  try {
    const existing = await fs.readFile(filePath, "utf8");
    return normalizeMarkdown(existing);
  } catch {
    await fs.writeFile(filePath, defaultContent, "utf8");
    return normalizeMarkdown(defaultContent);
  }
}

function normalizeMarkdown(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized || null;
}

function normalizeOptionalPath(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

const DEFAULT_TARGET_MARKDOWN = `# Target

## Business Goal
我们写知乎回答，是为了让目标读者理解：币圈、交易和量化判断不能只靠感觉，应该先做验证、回测、复盘和风险控制。CryptoPathX 只在能自然帮助这些步骤时出现。

## Target Reader
- 对币圈、交易策略、市场判断、量化验证有兴趣的中文知乎读者。
- 已经有交易或研究需求，但容易凭感觉、单一指标或短期情绪做决策的人。
- 不一定会写代码，但愿意用工具把想法变成可复盘流程的人。

## Content Goal
- 先把知乎问题回答完整，再考虑是否自然提及产品。
- 给出可操作的判断路径、验证方法、风险边界和复盘思路。
- 让产品成为方法链路里的一个工具选择，而不是文章目的本身。

## Soft-Promo Principle
- 不为每篇文章强行植入 CryptoPathX。
- 只有当题目自然涉及验证、回测、策略构建、多周期观察、多币种交叉、历史相似走势、复盘或风控时，才考虑提及 CryptoPathX。
- 产品提及必须短、具体、克制，放在自然的工作流节点里。
- 账号内容需要有留白，不要每一条都带软广。整体节奏可以按约 10 条里 7 条自然带产品、3 条纯分享/纯经验/纯观点来控制。
- Topic Agent 即使发现某个题目可以勉强承接产品，也要判断这篇是否更适合作为“无产品提及”的信任内容；泛交易心态、踩坑复盘、币圈常识、观点判断类题可以承担留白内容。
- 内容重心优先放在币圈交易者身上：炒币、合约、杠杆、行情结构、K 线形态、交易心态、风控、复盘和踩坑经验，比纯量化工作流更重要。
- 形态识别/技术形态教学类题可以回复，也可以自然加入软广。重点不是写成指标百科，而是讲如何识别形态、为什么容易误判、如何用历史数据或形态分析工具做验证。
- AI 和交易联动类题可以回复，也可以自然加入软广。重点是 AI 辅助解释指标、生成策略条件、解读回测结果、发现风险点，而不是宣称 AI 能预测行情或替用户交易。
- 纯量化工作流题不再作为主要选题方向。量化策略上线、深度优化、参数调优、研究 pipeline、团队研发效率这类题，如果没有明确币圈交易痛点，应跳过或降到很低优先级。
- 泛交易心态题可以作为纯经验分享存在，例如外汇交易者亏损、如何避免成为韭菜、人性和纪律问题；这类题不需要强行加入 CryptoPathX，除非题目本身明确问工具、回测、监控、策略验证或复盘系统。

## Success Criteria
- 读者先觉得答案解决了问题，其次才注意到工具。
- 产品能力和题目痛点之间有明确承接点。
- 没有收益承诺、喊单暗示、交易所推荐或过度营销。
- 即使删掉产品名，文章主体仍然成立、有用、像知乎真人回答。

## Agent Rules
- Topic Agent 判断这个选题是否适合自然软广，并给出具体承接点。
- Topic Agent 必须优先考虑币圈和交易经验类选题，不要再把纯量化工作流作为主要候选。
- Topic Agent 对泛交易心态题可以判定有效，但默认应让 Writer 作为纯分享回答，不强制软广。
- Topic Agent 需要维护内容节奏：不要连续把所有有效题都判定为 should_include_soft_promo=true；没有明确工具/验证/监控/回测承接必要时，优先留白。
- Topic Agent 对形态识别教学、K 线形态、量价结构、AI 辅助交易判断、AI 解读回测这类题，应视为产品可自然承接的重点方向，可以要求 Writer 轻量提及 CryptoPathX。
- Writer Agent 只在 Topic Agent 要求时自然提及产品，且必须先回答问题。
- Review Agent 检查产品提及是否真实、克制、相关，并拦截夸大或硬广。
- Note Agent 不使用本文档学习账号语气，避免污染 Soul。
- Publish Agent 不需要本文档。`;

const DEFAULT_PRODUCT_MARKDOWN = `# CryptoPathX Product Context

## One-Line Positioning
CryptoPathX 是一个面向加密货币交易者的策略回测与 AI 辅助决策平台。

一句话卖点：先验证，再交易。不要用真金白银直接试错。

## Target Users
- 有一定技术分析基础的加密货币交易者，不是纯小白用户。
- 希望用历史数据验证交易想法、降低主观决策风险的人。
- 会看 K 线和常见指标，但不一定会写代码或搭建专业回测框架的人。
- 需要把交易思路、指标条件、止盈止损和仓位规则整理成可复盘流程的人。

## Target User Segments

### Experienced Traders
- 有自己的交易思路、盘感或形态判断，但缺少方便的验证工具。
- 常见问题是“这个想法到底行不行”“这次回撤是正常波动还是策略失效”。
- 内容承接：策略验证、回测复盘、最大回撤、盈亏比、样本外失效。

### AI-Curious Traders
- 想用自然语言描述策略，不想从代码或复杂公式开始。
- 常见问题是“AI 能不能帮我把想法变成策略条件”“AI 能不能帮我看懂回测结果”。
- 内容承接：AI 自然语言生成策略、AI 解读回测、AI 对话助手。

### Indicator Learners
- 想学 RSI、MACD、均线、量价结构、K 线形态，但需要低门槛解释和验证。
- 常见问题是“这个指标到底有没有用”“这个形态为什么一追就错”。
- 内容承接：80+ 技术指标、形态识别、K 线可视化、历史验证。

### Busy Traders
- 有交易需求，但没有时间持续盯盘。
- 常见问题是“我不想一直盯着图表，条件到了能不能提醒我”。
- 内容承接：信号自动监控、条件触发、飞书推送。

## Current Stage
- Beta 已上线。
- 核心回测引擎和 AI Agent 一、二期已完成。
- 生产环境域名：cryptopathx.com。

## Core Value
CryptoPathX 帮助用户把“我感觉这个策略可行”变成“这个策略在历史数据、不同周期和明确风控参数下是否经得起验证”。

它不是替用户预测行情，也不是替用户下单，而是降低策略验证、回测分析和复盘优化的门槛。

## Core Features

### Strategy Backtesting
- 用户可以自定义买入、卖出条件。
- 支持技术指标、表达式和自定义指标组合。
- 支持选择币种和时间周期后运行历史回测。
- 输出交易记录、收益曲线、胜率、最大回撤等结果。
- 支持专业级回测：80+ 指标、多周期、自定义买卖条件。
- 典型流程：创建策略 -> 配置条件 -> 选择币种和周期 -> 运行回测 -> 查看收益报告。

### Technical Analysis And K-Line Visualization
- 提供专业 K 线图表和技术指标叠加，当前定位是专业可视化能力。
- 支持双引擎 K 线图表。
- 支持 80+ TA-Lib 技术指标。
- 支持多个常用周期，例如 1min、5min、15min、1h、4h、1d。
- 适合用来观察指标、价格结构、趋势变化和策略触发点。

### AI Strategy Assistant
- 用自然语言解释 RSI、MACD 等指标和策略逻辑。
- 根据用户当前页面和操作上下文给出引导。
- 支持自然语言生成策略条件，例如“帮我做一个 RSI 超卖买入的策略”。
- 自动解读回测结果，解释收益、胜率、最大回撤等关键指标。
- 基于回测结果给出优化建议，支持多轮对话和回滚。
- 这是当前最重要的差异化传播点之一：AI + 回测 + 可视化结合，而不是单纯聊天或单纯图表。

### Signal Monitoring
- 用户可以为特定币种和策略设置监控条件。
- 系统通过定时任务扫描行情，条件满足时触发通知。
- 当前支持飞书机器人推送。
- 这是定时轮询，不是 WebSocket 实时行情推送。
- 适合忙碌型交易者：不用长期盯盘，但关键条件触发时可以收到提醒。

### Pattern Analysis
- 检测经典量价形态，例如放量突破、缩量回调等。
- 提供形态教育解读，降低技术分析门槛。
- 适合 K 线形态教学内容：形态识别、假突破、量价背离、回踩确认、形态失效边界。

### Strategy Leaderboard
- 展示公开策略的表现。
- 用户可参考优秀策略的配置逻辑。
- 当前排行榜和评论是轻量社交，不是社区跟单系统。
- 策略排行榜和评论可以形成内容飞轮：用户参考别人如何构建策略，但不能写成一键跟单或保证收益。

### Growth And Membership System
- VIP + 能量系统：包含四级会员体系，支持 Binance Pay。
- 兑换码系统：可用于活动赠品、社群福利、KOL 合作或拉新活动。
- 邀请奖励：已接入，可用于裂变增长。
- 三语支持：中、英、西，说明产品面向全球加密交易者。
- 这些属于运营和营销玩法，知乎回答里通常不主动提，除非题目本身讨论产品、会员、活动、增长或工具商业模式。

## Strong Selling Points
- 先验证，再交易：用历史数据验证交易想法，而不是用真金白银直接试错。
- 专业级回测：80+ 指标、多周期、自定义买卖条件，适合把交易想法变成可验证规则。
- AI 辅助决策：自然语言生成策略、自动解读回测结果、AI 对话助手，这是核心差异化卖点。
- 信号自动监控：设置条件，系统定时盯盘，触发后飞书推送。
- 专业可视化：双引擎 K 线图表，支持指标叠加和量价形态分析。
- 社区策略参考：排行榜 + 评论形成内容飞轮，帮助用户学习策略结构，但不能写成一键跟单。
- 明确不碰用户资金：不连接交易所自动下单，不代客操盘，不托管资金，这一点能建立信任。

## Competitive Differentiation

### Compared With TradingView
- TradingView 强在图表和社区脚本。
- CryptoPathX 的差异点是 AI + 回测 + 可视化结合，尤其是自然语言生成策略和回测结果自动解读。
- 内容表达：可以说“TradingView 更偏看图和脚本生态，CryptoPathX 更适合把交易想法放进回测和 AI 解读流程里验证。”

### Compared With Cryptohopper
- Cryptohopper 更偏自动化交易和机器人。
- CryptoPathX 专注验证策略、回测分析和辅助决策，不碰资金、不自动交易。
- 内容表达：可以强调“先验证策略，不直接替你执行交易。”

### Compared With QuantConnect
- QuantConnect 更偏专业量化研究和代码工作流。
- CryptoPathX 更强调可视化、低代码/无需编程、AI 自然语言辅助。
- 内容表达：可以说“如果你不是程序化量化团队，只是想验证自己的币圈交易思路，可视化和 AI 辅助门槛更低。”

### Core Differentiation
- AI + 回测 + 可视化三合一。
- 明确不碰用户资金，只做策略验证和辅助决策。
- 面向加密货币交易者，而不是泛金融量化工程师。

## Best-Fit Content Angles
这些角度适合在知乎回答中自然提及 CryptoPathX：

- 如何验证一个交易策略是否靠谱。
- 如何避免凭感觉交易。
- 如何判断策略是正常回撤还是逻辑失效。
- 如何用回测、最大回撤、胜率、盈亏比评估策略。
- 如何把主观交易经验转成明确规则。
- 如何降低不会写代码时的回测门槛。
- 如何用 AI 帮助理解回测结果，而不是让 AI 预测行情。
- 如何用自然语言把交易想法变成策略条件。
- 如何用信号监控减少盯盘压力。
- 如何看待技术指标、K 线形态和量价结构。
- 如何识别放量突破、缩量回调、假突破、形态失效。
- AI 到底能不能辅助交易，以及 AI 在交易里适合做什么、不适合做什么。
- 忙碌交易者如何设置条件提醒，而不是全天盯盘。
- 新手如何学习指标和形态，但不把指标当成买卖指令。
- 如何参考策略排行榜学习策略结构，但不把排行榜当成跟单入口。

## User Stories For Content Marketing

### I Have An Idea But Do Not Know If It Works
- 用户痛点：有交易想法，但不知道是否经得起历史行情检验。
- 内容承接：先把入场、出场、止损、仓位写成条件，再跑回测验证。
- 产品锚点：策略回测、收益曲线、胜率、最大回撤、交易记录。

### I Do Not Understand Indicators But Want More Scientific Trading
- 用户痛点：知道 RSI、MACD、均线、K 线形态，但不会组合成规则。
- 内容承接：AI 用自然语言解释指标，并帮助生成策略条件。
- 产品锚点：AI 自然语言生成策略、80+ 指标、K 线可视化。

### I Do Not Have Time To Watch The Market
- 用户痛点：有条件判断，但没法一直盯盘。
- 内容承接：把关键条件设置成监控提醒。
- 产品锚点：信号自动监控、飞书推送。

### I Cannot Understand Backtest Results
- 用户痛点：看到胜率、最大回撤、收益曲线，但不知道该怎么判断策略质量。
- 内容承接：AI 自动解读回测结果，指出风险集中点和可能的优化方向。
- 产品锚点：AI 回测解读、风险收益比、最大回撤分析。

### I Want To See How Other People Build Strategies
- 用户痛点：不知道成熟策略通常怎么组织条件和风控。
- 内容承接：看策略排行榜学习结构，但不能直接照抄或跟单。
- 产品锚点：策略排行榜、评论、公开策略参考。

## Safe Mention Pattern
当 Topic Agent 判断可以自然软性提及时，Writer 应该把 CryptoPathX 放在“验证流程”里，而不是写成广告。

推荐表达方向：
- “这类想法最好先放进回测里验证。”
- “如果不想自己写代码，可以用 CryptoPathX 这类可视化回测工具，把入场条件、止盈止损和仓位规则放在一起跑。”
- “AI 的价值不是预测涨跌，而是帮你把想法整理成策略条件、解读回测结果、发现策略风险点。”
- “信号提醒适合减少盯盘，但不能替代风控和人工判断。”
- “形态识别适合做辅助观察，真正要下判断还得看位置、量能、回测表现和失效条件。”
- “排行榜适合学习别人怎么组织策略，不适合当成跟单入口。”

## Forbidden Claims
- 不说 CryptoPathX 是交易所、券商或下单执行平台。
- 不说它能自动交易、自动跟单、代客操盘或社区一键跟单。
- 不说它会托管、接触或管理用户资金。
- 不承诺收益、胜率、稳赚、保本或避免亏损。
- 不做价格预测，不暗示 AI 能预测未来行情。
- 不说 AI 能喊单、自动判断买卖点或替用户做最终决策。
- 不把系统信号写成投资建议、买卖指令或喊单。
- 不夸大为实时行情系统；当前信号监控是定时轮询。
- 不说支持多资产组合管理、对冲策略或组合级风控。
- 不把排行榜写成“跟着别人策略赚钱”。
- 不把 VIP、能量、兑换码、邀请奖励写成投资收益或交易优势。

## Product Limitations
- 当前主要做单币种策略回测，不做多资产组合或对冲管理。
- 当前不连接交易所自动下单。
- 当前不碰用户资金，不托管资金，不做交易执行。
- 信号监控依赖定时任务轮询，不是实时 WebSocket 推送。
- AI 依赖第三方 OpenAI API，存在成本、速率和稳定性限制。
- AI 的策略优化建议是辅助性质，最终决策权在用户。
- 数据依赖定时脚本拉取交易所历史行情，不是实时同步。
- VIP、能量、兑换码、邀请奖励属于产品运营系统，不等同于交易收益能力。

## Tone Boundaries For Content
- 可以说“降低验证门槛”“提高复盘效率”“减少拍脑袋决策”。
- 可以说“帮助用户更清楚地看到策略历史表现和风险边界”。
- 可以说“AI 帮你整理策略条件、解释指标和解读回测”，但不能说“AI 帮你判断涨跌”。
- 可以说“形态识别帮助观察量价结构和教学理解”，但不能说“识别到形态就该买/卖”。
- 可以说“明确不碰用户资金”，用于建立信任。
- 不要说“提高收益”“稳定盈利”“不错过机会就能赚钱”。
- 不要写成产品功能清单，除非题目本身就是工具推荐或产品分析。
- 如果题目和策略验证、回测、技术分析、信号提醒无关，宁可不提 CryptoPathX。`;