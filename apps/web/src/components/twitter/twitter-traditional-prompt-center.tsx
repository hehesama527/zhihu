"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  getTwitterAccountPromptPanel,
  getTwitterAccounts,
  type TwitterAccount,
  type TwitterAccountPromptPanel
} from "../../lib/twitter/api";
import { getTwitterClientApiBaseUrl, getTwitterTraditionalClientApiBaseUrl } from "../../lib/twitter/http";
import {
  activateTwitterTraditionalPromptVersion,
  createTwitterTraditionalPrompt,
  getTwitterTraditionalPrompt,
  getTwitterTraditionalPrompts,
  testTwitterTraditionalPrompt,
  type TwitterTraditionalPrompt,
  type TwitterTraditionalPromptCategory,
  type TwitterTraditionalPromptDetail
} from "../../lib/twitter/traditional-api";

type FlashState = {
  tone: "success" | "error" | "info";
  message: string;
};

type MainAccountPromptCategory = "main" | "writing";

type PromptScopeRow = {
  module: "x-main" | "x-traditional" | "hotspots";
  agent: string;
  category: string;
  setName: string;
  scope: "global" | "account-scoped" | "global + account-scoped" | "global + manual";
  runtime: string;
  endpoints: string[];
  note: string;
};

const PROMPT_ORDER: TwitterTraditionalPromptCategory[] = ["main", "writing", "review", "publish", "note"];
const ACCOUNT_SCOPED_CATEGORIES: MainAccountPromptCategory[] = ["main", "writing"];

const PROMPT_TITLES: Record<TwitterTraditionalPromptCategory, string> = {
  main: "主控智能体",
  writing: "写作智能体",
  review: "审核智能体",
  publish: "发布智能体",
  note: "笔记智能体"
};

const MAIN_ACCOUNT_CATEGORY_TITLES: Record<MainAccountPromptCategory, string> = {
  main: "主控智能体",
  writing: "写作智能体"
};

const TEST_INPUT_TEMPLATES: Record<TwitterTraditionalPromptCategory, string> = {
  main: `{
  "accountSoulMarkdown": "# soul\\n关注市场结构与执行，不喊口号。",
  "goal": "围绕“市场反应为什么比标题本身更重要”选一个题。",
  "hotspotCandidates": [
    {
      "id": 101,
      "title": "宏观消息改变了市场对降息的预期",
      "summaryText": "声明发出后，风险资产开始重新定价。"
    }
  ],
  "recentPublishedSignals": [],
  "candidateTweetTargets": []
}`,
  writing: `{
  "accountSoulMarkdown": "# soul\\n交易员口吻，结构紧凑，少空话。",
  "taskTitle": "为什么大多数人等看到新闻时，交易窗口已经过去了",
  "taskBrief": "写一条单推，讲清预期与反应的区别。",
  "goal": "让读者别再只看标题做交易。",
  "preferredMode": "single",
  "selectedHotspots": [],
  "writerBrief": {
    "angle": "先解释预期，再解释市场反应",
    "goal": "像真实交易台笔记，不像模板文案",
    "mustInclude": ["预期差", "市场反应"],
    "mustAvoid": ["鸡汤口号"],
    "openingDirection": "从最常见的错误认知切入",
    "threadPlan": ""
  }
}`,
  review: `{
  "accountSoulMarkdown": "# soul\\n密度高、偏实操、不说教。",
  "taskTitle": "为什么 MACD 金叉经常失效",
  "draftPack": {
    "summary": "单条推文草稿",
    "posts": [
      "MACD 金叉本身不是买点，它只是价格走出来之后的滞后结果。真正有意义的是它出现时所处的结构位置。"
    ],
    "notes": []
  }
}`,
  publish: `{
  "taskTitle": "发布前检查",
  "reviewResult": {
    "decision": "approve",
    "reason": "内容已通过审核"
  },
  "publishPlan": {
    "shouldPublish": true,
    "mode": "single",
    "action": "post"
  }
}`,
  note: `{
  "ragReadmeMarkdown": "# README\\n需要补齐风格规则、数字表达规则、审核 rubric 和样本收集计划。",
  "accountConfig": {
    "soulMarkdown": "# soul\\n这个账户专注于热点事件对市场的影响。",
    "strategyYaml": "positioning: 热点驱动分析",
    "goalsYaml": "primary_goal: 建立稳定的市场解读框架"
  },
  "styleRulesMarkdown": "",
  "numberExpressionRulesMarkdown": "",
  "reviewRubricMarkdown": "",
  "sampleCollectionPlanMarkdown": ""
}`
};

const MAIN_SCOPE_ROWS: PromptScopeRow[] = [
  {
    module: "x-main",
    agent: "主控智能体",
    category: "main",
    setName: "x_main_agent",
    scope: "global + account-scoped",
    runtime: "全局模板来自 /prompts，账户绑定版本来自 /accounts/:id/account-prompts/main",
    endpoints: ["/x-api/prompts", "/x-api/accounts/:id/account-prompts/main"],
    note: "后端已确认：main 同时存在全局模板版本与账户自有绑定版本。"
  },
  {
    module: "x-main",
    agent: "写作智能体",
    category: "writing",
    setName: "x_writer_agent",
    scope: "global + account-scoped",
    runtime: "全局模板来自 /prompts，账户绑定版本来自 /accounts/:id/account-prompts/writing",
    endpoints: ["/x-api/prompts", "/x-api/accounts/:id/account-prompts/writing"],
    note: "后端已确认：writing 同时支持全局模板版本与账户自有绑定版本。"
  },
  {
    module: "x-main",
    agent: "审核智能体",
    category: "review",
    setName: "x_review_agent",
    scope: "global",
    runtime: "仅全局模板",
    endpoints: ["/x-api/prompts"],
    note: "review 在 x-api 中保持全局，不存在 /account-prompts/review 路由。"
  },
  {
    module: "x-main",
    agent: "发布智能体",
    category: "publish",
    setName: "x_publish_agent",
    scope: "global",
    runtime: "仅全局模板",
    endpoints: ["/x-api/prompts"],
    note: "publish 在 x-api 中保持全局，不存在 /account-prompts/publish 路由。"
  }
];

const HOTSPOT_CONTROL_SCOPE_ROWS: PromptScopeRow[] = [
  {
    module: "hotspots",
    agent: "热点侦察智能体",
    category: "hotspot_scout",
    setName: "x_hotspot_scout_agent",
    scope: "global",
    runtime: "仅中控级全局提示词",
    endpoints: ["/hotspot-api/prompts"],
    note: "热点扫描与补研究已经提升到中控层，hotspot_scout 的提示词路由现在应由 hotspot-api 承接。"
  }
];

const TRADITIONAL_SCOPE_ROWS: PromptScopeRow[] = [
  {
    module: "x-traditional",
    agent: "主控智能体",
    category: "main",
    setName: "x_traditional_main_agent",
    scope: "global",
    runtime: "仅传统链路全局提示词",
    endpoints: ["/x-traditional-api/prompts"],
    note: "传统链路后端对这个智能体只暴露 /prompts，不暴露 /account-prompts。"
  },
  {
    module: "x-traditional",
    agent: "写作智能体",
    category: "writing",
    setName: "x_traditional_writer_agent",
    scope: "global",
    runtime: "仅传统链路全局提示词",
    endpoints: ["/x-traditional-api/prompts"],
    note: "传统 writer 运行时会用数据库里的提示词快照，但提示词集合本身仍然是全局的。"
  },
  {
    module: "x-traditional",
    agent: "审核智能体",
    category: "review",
    setName: "x_traditional_review_agent",
    scope: "global",
    runtime: "仅传统链路全局提示词",
    endpoints: ["/x-traditional-api/prompts"],
    note: "x-traditional-api 中不存在 review 的账户级提示词路由。"
  },
  {
    module: "x-traditional",
    agent: "发布智能体",
    category: "publish",
    setName: "x_traditional_publish_agent",
    scope: "global",
    runtime: "仅传统链路全局提示词",
    endpoints: ["/x-traditional-api/prompts"],
    note: "publish 提示词在传统链路里保持模块级全局。"
  },
  {
    module: "x-traditional",
    agent: "笔记智能体",
    category: "note",
    setName: "x_traditional_note_agent",
    scope: "global + manual",
    runtime: "全局提示词定义，按账户手动执行",
    endpoints: ["/x-traditional-api/prompts", "/x-traditional-api/accounts/:id/note-agent/generate"],
    note: "提示词定义是全局的，但执行通过 note-agent 路由按账户手动触发。"
  }
];

function sortPrompts(prompts: TwitterTraditionalPrompt[]) {
  const order = new Map(PROMPT_ORDER.map((category, index) => [category, index]));
  return [...prompts].sort((left, right) => {
    const leftRank = order.get(left.category) ?? 999;
    const rightRank = order.get(right.category) ?? 999;
    return leftRank - rightRank;
  });
}

function resolvePromptId(prompts: TwitterTraditionalPrompt[], rawValue: string | null) {
  if (!rawValue) {
    return prompts[0]?.id ?? null;
  }

  const match = prompts.find(
    (prompt) =>
      prompt.id === rawValue || prompt.category === rawValue || prompt.name === rawValue || prompt.setName === rawValue
  );
  return match?.id ?? prompts[0]?.id ?? null;
}

function pickVersion(detail: TwitterTraditionalPromptDetail, preferredVersionId?: number | null) {
  if (preferredVersionId) {
    const preferred = detail.versions.find((version) => version.id === preferredVersionId);
    if (preferred) {
      return preferred;
    }
  }

  if (detail.activeVersionId) {
    const active = detail.versions.find((version) => version.id === detail.activeVersionId);
    if (active) {
      return active;
    }
  }

  return detail.versions[0] ?? null;
}

function latestVersionId(detail: TwitterTraditionalPromptDetail) {
  return detail.versions.reduce<number | null>((latest, version) => {
    if (latest === null || version.version > (detail.versions.find((item) => item.id === latest)?.version ?? -1)) {
      return version.id;
    }

    return latest;
  }, null);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatPromptCategory(category: TwitterTraditionalPromptCategory) {
  return PROMPT_TITLES[category];
}

function formatPromptDescription(category: TwitterTraditionalPromptCategory, description: string) {
  if (description.trim()) {
    return description;
  }

  if (category === "note") {
    return "笔记智能体负责手动补齐账户级 RAG 资料，但提示词定义本身仍然保持全局。";
  }

  return "传统链路固定的全局提示词定义。";
}

function formatVersionStatus(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    active: "生效中",
    archived: "已归档"
  };

  return labels[status] ?? status;
}

function isManualTraditionalPrompt(category: TwitterTraditionalPromptCategory) {
  return category === "note";
}

function formatScopeTone(scope: PromptScopeRow["scope"]) {
  if (scope === "global") {
    return "全局";
  }

  if (scope === "account-scoped") {
    return "账户级";
  }

  if (scope === "global + manual") {
    return "全局 + 手动执行";
  }

  return "全局 + 账户级";
}

function buildTraditionalPromptScope(category: TwitterTraditionalPromptCategory) {
  return TRADITIONAL_SCOPE_ROWS.find((row) => row.category === category) ?? null;
}

type TwitterTraditionalPromptCenterProps = {
  initialPromptId?: string | null;
};

export function TwitterTraditionalPromptCenter({
  initialPromptId = null
}: TwitterTraditionalPromptCenterProps) {
  const [mainAccounts, setMainAccounts] = useState<TwitterAccount[]>([]);
  const [selectedMainAccountId, setSelectedMainAccountId] = useState<string | null>(null);
  const [selectedMainCategory, setSelectedMainCategory] = useState<MainAccountPromptCategory>("writing");
  const [mainPanel, setMainPanel] = useState<TwitterAccountPromptPanel | null>(null);
  const [mainAccountsError, setMainAccountsError] = useState("");
  const [mainPanelError, setMainPanelError] = useState("");
  const [loadingMainAccounts, setLoadingMainAccounts] = useState(true);
  const [loadingMainPanel, setLoadingMainPanel] = useState(false);

  const [prompts, setPrompts] = useState<TwitterTraditionalPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<TwitterTraditionalPromptDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [testInput, setTestInput] = useState(TEST_INPUT_TEMPLATES.main);
  const [testResult, setTestResult] = useState("");
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void refreshMainAccounts();
  }, []);

  useEffect(() => {
    if (!selectedMainAccountId) {
      setMainPanel(null);
      return;
    }

    void refreshMainAccountPanel(selectedMainAccountId, selectedMainCategory);
  }, [selectedMainAccountId, selectedMainCategory]);

  useEffect(() => {
    void refreshPromptList(initialPromptId);
  }, [initialPromptId]);

  useEffect(() => {
    if (!selectedPromptId) {
      setSelectedPrompt(null);
      setSelectedVersionId(null);
      return;
    }

    void refreshPromptDetail(selectedPromptId);
  }, [selectedPromptId]);

  async function refreshMainAccounts() {
    setLoadingMainAccounts(true);

    try {
      const nextAccounts = await getTwitterAccounts();
      setMainAccounts(nextAccounts);
      setSelectedMainAccountId((current) => {
        if (current && nextAccounts.some((account) => account.id === current)) {
          return current;
        }

        return nextAccounts[0]?.id ?? null;
      });
      setMainAccountsError("");
    } catch (error) {
      setMainAccounts([]);
      setSelectedMainAccountId(null);
      setMainAccountsError(error instanceof Error ? error.message : "加载 X 主链路账户失败。");
    } finally {
      setLoadingMainAccounts(false);
    }
  }

  async function refreshMainAccountPanel(accountId: string, category: MainAccountPromptCategory) {
    setLoadingMainPanel(true);

    try {
      const data = await getTwitterAccountPromptPanel(accountId, category);
      setMainPanel(data.panel);
      setMainPanelError("");
    } catch (error) {
      setMainPanel(null);
      setMainPanelError(error instanceof Error ? error.message : "加载账户级提示词面板失败。");
    } finally {
      setLoadingMainPanel(false);
    }
  }

  async function refreshPromptList(preferredPromptId?: string | null) {
    setLoadingList(true);

    try {
      const nextPrompts = sortPrompts(await getTwitterTraditionalPrompts());
      setPrompts(nextPrompts);
      setSelectedPromptId((current) => {
        if (current && nextPrompts.some((prompt) => prompt.id === current) && !preferredPromptId) {
          return current;
        }

        return resolvePromptId(nextPrompts, preferredPromptId ?? null) ?? null;
      });
    } catch (error) {
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : "加载传统链路提示词列表失败。"
      });
    } finally {
      setLoadingList(false);
    }
  }

  function hydrateEditor(nextPrompt: TwitterTraditionalPromptDetail, preferredVersionId?: number | null) {
    const version = pickVersion(nextPrompt, preferredVersionId);
    setSelectedPrompt(nextPrompt);
    setSelectedVersionId(version?.id ?? null);
    setDraftLabel(version?.label ?? nextPrompt.activeLabel ?? nextPrompt.name ?? "");
    setDraftNotes(version?.notes ?? nextPrompt.description ?? "");
    setDraftContent(version?.content ?? nextPrompt.template ?? "");
    setTestInput(TEST_INPUT_TEMPLATES[nextPrompt.category]);
    setTestResult("");
  }

  async function refreshPromptDetail(promptId: string, preferredVersionId?: number | null) {
    setLoadingDetail(true);

    try {
      const nextPrompt = await getTwitterTraditionalPrompt(promptId);
      hydrateEditor(nextPrompt, preferredVersionId);
    } catch (error) {
      setSelectedPrompt(null);
      setSelectedVersionId(null);
      setFlash({
        tone: "error",
        message: error instanceof Error ? error.message : "加载传统链路提示词详情失败。"
      });
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleVersionSelect(versionId: number) {
    if (!selectedPrompt) {
      return;
    }

    const version = selectedPrompt.versions.find((item) => item.id === versionId);
    if (!version) {
      return;
    }

    setSelectedVersionId(version.id);
    setDraftLabel(version.label);
    setDraftNotes(version.notes);
    setDraftContent(version.content);
  }

  function createVersion(activate: boolean) {
    if (!selectedPrompt) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const nextPrompt = await createTwitterTraditionalPrompt({
            name: draftLabel.trim(),
            description: draftNotes.trim(),
            category: selectedPrompt.category,
            template: draftContent,
            isActive: activate
          });

          const nextVersionId = activate ? nextPrompt.activeVersionId : latestVersionId(nextPrompt);
          hydrateEditor(nextPrompt, nextVersionId);
          await refreshPromptList(nextPrompt.id);
          setFlash({
            tone: "success",
            message: activate ? "已保存新的生效版本。" : "已保存新的草稿版本。"
          });
        } catch (error) {
          setFlash({
            tone: "error",
            message: error instanceof Error ? error.message : "保存传统链路提示词版本失败。"
          });
        }
      })();
    });
  }

  function activateSelectedVersion() {
    if (!selectedPrompt || !selectedVersionId) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const nextPrompt = await activateTwitterTraditionalPromptVersion(selectedVersionId);
          hydrateEditor(nextPrompt, nextPrompt.activeVersionId);
          await refreshPromptList(nextPrompt.id);
          setFlash({
            tone: "success",
            message: `已启用所选的${formatPromptCategory(nextPrompt.category)}版本。`
          });
        } catch (error) {
          setFlash({
            tone: "error",
            message: error instanceof Error ? error.message : "启用传统链路提示词版本失败。"
          });
        }
      })();
    });
  }

  function runPromptTest() {
    if (!selectedPrompt) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const parsedInput = JSON.parse(testInput) as Record<string, unknown>;
          const result = await testTwitterTraditionalPrompt(selectedPrompt.id, parsedInput);
          setTestResult(result);
          setFlash({
            tone: "success",
            message: "测试已完成。测试接口始终运行当前已生效的传统链路版本。"
          });
          await refreshPromptDetail(selectedPrompt.id, selectedPrompt.activeVersionId);
        } catch (error) {
          setFlash({
            tone: "error",
            message: error instanceof Error ? error.message : "传统链路提示词测试失败。"
          });
        }
      })();
    });
  }

  const selectedMainAccount = mainAccounts.find((account) => account.id === selectedMainAccountId) ?? null;
  const selectedVersion = selectedPrompt
    ? selectedPrompt.versions.find((version) => version.id === selectedVersionId) ??
      pickVersion(selectedPrompt, selectedVersionId)
    : null;
  const selectedTraditionalScope = selectedPrompt ? buildTraditionalPromptScope(selectedPrompt.category) : null;

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>X 提示词中心</h2>
          <p className="muted">
            这个页面先按后端真实能力区分提示词作用域，再在下方提供传统链路的全局提示词编辑区。
          </p>
          <p className="helper-text">
            X 主链路 API: {getTwitterClientApiBaseUrl()} / 传统链路 API: {getTwitterTraditionalClientApiBaseUrl()}
          </p>
        </div>

        <div className="button-row">
          <Link href="/twitter/traditional" className="button button--ghost">
            打开传统链路工作台
          </Link>
          <button
            className="button button--ghost"
            disabled={pending || loadingList || loadingMainAccounts}
            onClick={() => {
              void refreshMainAccounts();
              void refreshPromptList(selectedPromptId);
            }}
          >
            刷新
          </button>
        </div>
      </section>

      {flash ? (
        <div className="card">
          <p className="helper-text">{flash.message}</p>
        </div>
      ) : null}

      <section className="grid grid--two">
        <article className="card stack stack--tight">
          <div className="card-header">
            <div>
              <h3>X 主链路作用域地图</h3>
              <p className="muted">
                根据 x-api 路由确认：全局提示词模板来自 <code>/prompts</code>，只有 <code>main</code> 和{" "}
                <code>writing</code> 支持账户级提示词路由。
              </p>
            </div>
            <span className="mini-badge mini-badge--accent">后端已确认</span>
          </div>

          <div className="catalog-list">
            {MAIN_SCOPE_ROWS.map((row) => (
              <div key={`${row.module}-${row.category}`} className="catalog-list__item">
                <div className="catalog-list__item-top">
                  <div>
                    <div className="catalog-list__item-subtitle">{row.agent}</div>
                    <div className="catalog-list__item-caption">{row.setName}</div>
                  </div>
                  <span className={`mini-badge ${row.scope === "global" ? "" : "mini-badge--accent"}`}>
                    {formatScopeTone(row.scope)}
                  </span>
                </div>
                <div className="catalog-list__item-caption">运行方式：{row.runtime}</div>
                <div className="catalog-list__item-caption">路由：{row.endpoints.join(" | ")}</div>
                <div className="catalog-list__item-caption">{row.note}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="card stack stack--tight">
          <div className="card-header">
            <div>
              <h3>X 传统链路作用域地图</h3>
              <p className="muted">
                根据 x-traditional-api 路由确认：传统模块只暴露 <code>/prompts</code>，不暴露{" "}
                <code>/accounts/:id/account-prompts/*</code>。笔记智能体以人工手动方式执行。
              </p>
            </div>
            <span className="mini-badge mini-badge--accent">后端已确认</span>
          </div>

          <div className="catalog-list">
            {TRADITIONAL_SCOPE_ROWS.map((row) => (
              <div key={`${row.module}-${row.category}`} className="catalog-list__item">
                <div className="catalog-list__item-top">
                  <div>
                    <div className="catalog-list__item-subtitle">{row.agent}</div>
                    <div className="catalog-list__item-caption">{row.setName}</div>
                  </div>
                  <span className={`mini-badge ${row.scope === "global" ? "" : "mini-badge--accent"}`}>
                    {formatScopeTone(row.scope)}
                  </span>
                </div>
                <div className="catalog-list__item-caption">运行方式：{row.runtime}</div>
                <div className="catalog-list__item-caption">路由：{row.endpoints.join(" | ")}</div>
                <div className="catalog-list__item-caption">{row.note}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="card stack stack--tight">
          <div className="card-header">
            <div>
              <h3>热点中控作用域地图</h3>
              <p className="muted">
                热点池、补研究、watchlist 和转任务入口已经提升到中控层。对应的热点侦察提示词应由{" "}
                <code>/hotspot-api/prompts</code> 承接，而不是继续挂在 X 主链路下面。
              </p>
            </div>
            <Link href="/hotspots" className="button button--ghost">
              打开热点中心
            </Link>
          </div>

          <div className="catalog-list">
            {HOTSPOT_CONTROL_SCOPE_ROWS.map((row) => (
              <div key={`${row.module}-${row.category}`} className="catalog-list__item">
                <div className="catalog-list__item-top">
                  <div>
                    <div className="catalog-list__item-subtitle">{row.agent}</div>
                    <div className="catalog-list__item-caption">{row.setName}</div>
                  </div>
                  <span className={`mini-badge ${row.scope === "global" ? "" : "mini-badge--accent"}`}>
                    {formatScopeTone(row.scope)}
                  </span>
                </div>
                <div className="catalog-list__item-caption">运行方式：{row.runtime}</div>
                <div className="catalog-list__item-caption">路由：{row.endpoints.join(" | ")}</div>
                <div className="catalog-list__item-caption">{row.note}</div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <article className="card stack stack--tight">
        <div className="card-header">
          <div>
            <h3>X 主链路账户级提示词视图</h3>
            <p className="muted">
              这里直接读取 x-api 的账户提示词面板。以后端实际返回为准，账户级类别只有 <code>main</code> 和{" "}
              <code>writing</code>。
            </p>
          </div>
          <Link href="/twitter/account" className="button button--ghost">
            打开账户页
          </Link>
        </div>

        {mainAccountsError ? (
          <div className="card" style={{ padding: "1rem" }}>
            <p className="helper-text">{mainAccountsError}</p>
          </div>
        ) : null}

        <div className="grid grid--two">
          <label className="field">
            <span>主链路账户</span>
            <select
              value={selectedMainAccountId ?? ""}
              disabled={loadingMainAccounts || pending || !mainAccounts.length}
              onChange={(event) => setSelectedMainAccountId(event.target.value || null)}
            >
              {mainAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.handle}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>账户级类别</span>
            <select
              value={selectedMainCategory}
              disabled={pending || !selectedMainAccountId}
              onChange={(event) => setSelectedMainCategory(event.target.value as MainAccountPromptCategory)}
            >
              {ACCOUNT_SCOPED_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {MAIN_ACCOUNT_CATEGORY_TITLES[category]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loadingMainPanel ? (
          <p className="helper-text">正在加载账户提示词面板...</p>
        ) : null}

        {mainPanelError ? (
          <div className="card" style={{ padding: "1rem" }}>
            <p className="helper-text">{mainPanelError}</p>
          </div>
        ) : null}

        {selectedMainAccount && mainPanel ? (
          <div className="grid grid--two">
            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>
                  @{selectedMainAccount.handle} / {MAIN_ACCOUNT_CATEGORY_TITLES[selectedMainCategory]}
                </strong>
                <span className="helper-text">全局集合：{mainPanel.prompt.setName}</span>
                <span className="helper-text">
                  当前绑定版本：{mainPanel.boundVersion ? `#${mainPanel.boundVersion.id}` : "跟随全局生效版本"}
                </span>
                <span className="helper-text">账户自有版本数：{mainPanel.accountVersions.length}</span>
                <span className="helper-text">
                  当前作用域：
                  {mainPanel.boundVersion || mainPanel.accountVersions.length ? " 可用账户级版本" : " 当前使用全局回退"}
                </span>
              </div>
            </div>

            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>后端读取说明</strong>
                <span className="helper-text">
                  该面板来自 <code>/x-api/accounts/:id/account-prompts/{selectedMainCategory}</code>。
                </span>
                <span className="helper-text">
                  后端会分别返回全局提示词集合、当前绑定版本以及账户自有版本。
                </span>
              </div>
            </div>

            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>当前生效内容</strong>
                <pre>{mainPanel.boundVersion?.content ?? mainPanel.prompt.template}</pre>
              </div>
            </div>

            <div className="card" style={{ padding: "1rem" }}>
              <div className="stack stack--tight">
                <strong>账户自有版本列表</strong>
                {mainPanel.accountVersions.length ? (
                  <div className="log-list">
                    {mainPanel.accountVersions.map((version) => (
                      <div key={version.id} className="catalog-list__item">
                        <div className="catalog-list__item-top">
                          <div>
                            <div className="catalog-list__item-subtitle">{version.label}</div>
                            <div className="catalog-list__item-caption">
                              #{version.id} / v{version.version} / {formatVersionStatus(version.status)}
                            </div>
                          </div>
                          {version.id === mainPanel.boundVersionId ? (
                            <span className="mini-badge mini-badge--accent">已绑定</span>
                          ) : null}
                        </div>
                        <div className="catalog-list__item-caption">{version.notes || "无备注"}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="helper-text">
                    这个账户与类别组合没有返回账户自有版本，当前沿用全局模板。
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </article>

      <article className="card stack stack--tight">
        <div className="card-header">
          <div>
            <h3>传统链路全局提示词编辑器</h3>
            <p className="muted">
              下方编辑器只针对传统链路的全局提示词集合。按照当前后端能力，这些提示词定义都不是账户级。
            </p>
          </div>
          <span className="mini-badge">/x-traditional-api/prompts</span>
        </div>

        <div className="prompt-studio">
          <aside className="prompt-sidebar">
            {prompts.map((prompt) => {
              const isActive = prompt.id === selectedPromptId;
              const isManual = prompt.category === "note";

              return (
                <button
                  key={prompt.id}
                  className={`prompt-tab ${isActive ? "prompt-tab--active" : ""}`}
                  disabled={pending || loadingList}
                  onClick={() => setSelectedPromptId(prompt.id)}
                >
                  <span>{formatPromptCategory(prompt.category)}</span>
                  <small>{prompt.setName}</small>
                  <small>作用域：全局</small>
                  <small>{isManual ? "执行方式：按账户手动触发" : "执行方式：链路正常运行"}</small>
                </button>
              );
            })}
          </aside>

          <section className="prompt-main stack">
            {loadingList || loadingDetail ? (
              <div className="card">
                <p className="helper-text">正在加载传统链路提示词数据...</p>
              </div>
            ) : null}

            {selectedPrompt ? (
              <>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h3>{formatPromptCategory(selectedPrompt.category)}</h3>
                      <p className="muted">{formatPromptDescription(selectedPrompt.category, selectedPrompt.description)}</p>
                    </div>
                    <div className="button-row">
                      <span className="mini-badge">传统链路</span>
                      <span className="mini-badge">全局</span>
                      {isManualTraditionalPrompt(selectedPrompt.category) ? (
                        <span className="mini-badge mini-badge--accent">手动执行</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid--two">
                    <div className="card" style={{ padding: "1rem" }}>
                      <div className="stack stack--tight">
                        <strong>当前状态</strong>
                        <span className="helper-text">生效版本：{selectedPrompt.activeVersion ? `v${selectedPrompt.activeVersion}` : "-"}</span>
                        <span className="helper-text">版本数量：{selectedPrompt.versionCount}</span>
                        <span className="helper-text">最近测试：{formatDateTime(selectedPrompt.lastTestedAt)}</span>
                      </div>
                    </div>

                    <div className="card" style={{ padding: "1rem" }}>
                      <div className="stack stack--tight">
                        <strong>后端作用域</strong>
                        <span className="helper-text">路由族：/x-traditional-api/prompts</span>
                        <span className="helper-text">
                          是否存在账户级提示词路由：{selectedTraditionalScope?.scope.includes("account") ? "是" : "否"}
                        </span>
                        <span className="helper-text">{selectedTraditionalScope?.note ?? "传统链路全局提示词。"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="stack stack--tight">
                    <h3>版本列表</h3>
                    <p className="muted">每次保存都会创建新版本，点击启用才会切换当前线上传统链路版本。</p>
                  </div>

                  <div className="prompt-version-list" style={{ marginTop: "1rem" }}>
                    {selectedPrompt.versions.map((version) => (
                      <button
                        key={version.id}
                        className={`version-pill ${version.id === selectedVersionId ? "version-pill--active" : ""}`}
                        disabled={pending}
                        onClick={() => handleVersionSelect(version.id)}
                      >
                        <strong>
                          v{version.version} / #{version.id}
                          {version.id === selectedPrompt.activeVersionId ? " / 生效中" : ""}
                        </strong>
                        <small>
                          {version.label} / {formatVersionStatus(version.status)} / {formatDateTime(version.updatedAt)}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="stack stack--tight">
                    <h3>编辑区</h3>
                    <p className="muted">
                      当前载入版本：{selectedVersion ? `v${selectedVersion.version} / ${selectedVersion.label}` : "未选择"}
                    </p>
                  </div>

                  <label className="field">
                    <span>版本标签</span>
                    <input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} />
                  </label>

                  <label className="field">
                    <span>备注</span>
                    <textarea rows={3} value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
                  </label>

                  <label className="field">
                    <span>提示词内容</span>
                    <textarea
                      className="twitter-editor"
                      rows={20}
                      value={draftContent}
                      onChange={(event) => setDraftContent(event.target.value)}
                    />
                  </label>

                  <div className="button-row">
                    <button
                      className="button"
                      disabled={pending || !selectedPrompt || !draftLabel.trim() || !draftContent.trim()}
                      onClick={() => createVersion(false)}
                    >
                      保存为新草稿
                    </button>
                    <button
                      className="button button--ghost"
                      disabled={pending || !selectedPrompt || !draftLabel.trim() || !draftContent.trim()}
                      onClick={() => createVersion(true)}
                    >
                      保存并启用
                    </button>
                    <button
                      className="button button--ghost"
                      disabled={pending || !selectedPrompt || !selectedVersionId || selectedVersionId === selectedPrompt.activeVersionId}
                      onClick={activateSelectedVersion}
                    >
                      启用所选版本
                    </button>
                  </div>
                </div>

                <div className="grid grid--two">
                  <article className="card">
                    <div className="stack stack--tight">
                      <h3>测试输入</h3>
                      <p className="muted">测试始终使用当前已生效的传统链路版本，不读取尚未保存的编辑内容。</p>
                    </div>

                    <label className="field">
                      <span>输入 JSON</span>
                      <textarea
                        rows={14}
                        className="twitter-editor"
                        value={testInput}
                        onChange={(event) => setTestInput(event.target.value)}
                      />
                    </label>

                    <div className="button-row">
                      <button className="button" disabled={pending || !selectedPrompt} onClick={runPromptTest}>
                        测试生效版本
                      </button>
                      <button
                        className="button button--ghost"
                        disabled={pending || !selectedPrompt}
                        onClick={() => setTestInput(TEST_INPUT_TEMPLATES[selectedPrompt.category])}
                      >
                        载入示例
                      </button>
                    </div>
                  </article>

                  <article className="card">
                    <div className="stack stack--tight">
                      <h3>测试结果</h3>
                      <p className="muted">这里展示传统链路提示词测试接口返回的最新原始输出。</p>
                    </div>

                    {testResult ? (
                      <pre>{testResult}</pre>
                    ) : (
                      <div className="empty-state empty-state--compact">
                        <p>暂时还没有测试结果。</p>
                      </div>
                    )}
                  </article>
                </div>

                <div className="card">
                  <div className="stack stack--tight">
                    <h3>最近测试记录</h3>
                    <p className="muted">这里展示传统链路提示词详情接口返回的测试记录。</p>
                  </div>

                  <div className="log-list" style={{ marginTop: "1rem" }}>
                    {selectedPrompt.testRuns.length ? (
                      selectedPrompt.testRuns.map((run) => (
                        <article key={run.id} className="log-item">
                          <p>
                            #{run.id} / 版本 {run.promptVersionId} / {formatDateTime(run.createdAt)}
                          </p>
                          <pre>{run.outputJson ?? run.errorText ?? "无输出"}</pre>
                        </article>
                      ))
                    ) : (
                      <p className="muted">暂时还没有测试记录。</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="card">
                <p className="helper-text">当前还没有可用的传统链路提示词。</p>
              </div>
            )}
          </section>
        </div>
      </article>
    </div>
  );
}
