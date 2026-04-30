import Link from "next/link";

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

const MAIN_SCOPE_ROWS: PromptScopeRow[] = [
  {
    module: "x-main",
    agent: "主链路 Main Agent",
    category: "main",
    setName: "x_main_agent",
    scope: "global + account-scoped",
    runtime: "全局 prompt 定义 + 账户级绑定版本共同决定",
    endpoints: ["/x-api/prompts", "/x-api/accounts/:id/account-prompts/main"],
    note: "主链路 main 同时存在全局 prompt 和账户级绑定版本。"
  },
  {
    module: "x-main",
    agent: "主链路 Writer Agent",
    category: "writing",
    setName: "x_writer_agent",
    scope: "global + account-scoped",
    runtime: "全局 prompt 定义 + 账户级绑定版本共同决定",
    endpoints: ["/x-api/prompts", "/x-api/accounts/:id/account-prompts/writing"],
    note: "主链路 writing 和 main 一样，后端存在账户级绑定入口。"
  },
  {
    module: "x-main",
    agent: "主链路 Review Agent",
    category: "review",
    setName: "x_review_agent",
    scope: "global",
    runtime: "只读全局 prompt",
    endpoints: ["/x-api/prompts"],
    note: "review 在主链路保持全局，不存在账户级 review prompt 路由。"
  },
  {
    module: "x-main",
    agent: "主链路 Publish Agent",
    category: "publish",
    setName: "x_publish_agent",
    scope: "global",
    runtime: "只读全局 prompt",
    endpoints: ["/x-api/prompts"],
    note: "publish 在主链路保持全局，不存在账户级 publish prompt 路由。"
  }
];

const TRADITIONAL_SCOPE_ROWS: PromptScopeRow[] = [
  {
    module: "x-traditional",
    agent: "传统链路 Main Agent",
    category: "main",
    setName: "x_traditional_main_agent",
    scope: "global",
    runtime: "只读传统链路全局 prompt",
    endpoints: ["/x-traditional-api/prompts"],
    note: "传统链路 main 现在没有账户级 prompt 绑定路由。"
  },
  {
    module: "x-traditional",
    agent: "传统链路 Writer Agent",
    category: "writing",
    setName: "x_traditional_writer_agent",
    scope: "global",
    runtime: "全局 writer prompt + 账户 Soul/RAG 共同作用",
    endpoints: ["/x-traditional-api/prompts"],
    note: "传统 writer 的系统 prompt 是全局的，账户差异主要来自 Soul 和账户级 RAG。"
  },
  {
    module: "x-traditional",
    agent: "传统链路 Review Agent",
    category: "review",
    setName: "x_traditional_review_agent",
    scope: "global",
    runtime: "全局 review prompt + 账户级审核规则共同作用",
    endpoints: ["/x-traditional-api/prompts"],
    note: "传统 review 也是全局 prompt，但审核标准会被账户级 RAG 收紧。"
  },
  {
    module: "x-traditional",
    agent: "传统链路 Publish Agent",
    category: "publish",
    setName: "x_traditional_publish_agent",
    scope: "global",
    runtime: "只读传统链路全局 prompt",
    endpoints: ["/x-traditional-api/prompts"],
    note: "传统 publish 保持模块级全局。"
  },
  {
    module: "x-traditional",
    agent: "传统链路 Note Agent",
    category: "note",
    setName: "x_traditional_note_agent",
    scope: "global + manual",
    runtime: "全局 prompt 定义，但按目标账户手动触发账户学习流程",
    endpoints: ["/x-traditional-api/prompts", "/x-traditional-api/accounts/:id/note-agent/generate"],
    note: "Note Agent 是全局 prompt 定义，但执行是手动的，输出落到账户级资产。"
  }
];

const HOTSPOT_SCOPE_ROWS: PromptScopeRow[] = [
  {
    module: "hotspots",
    agent: "Hotspot Scout Agent",
    category: "hotspot_scout",
    setName: "x_hotspot_scout_agent",
    scope: "global",
    runtime: "热点中控级全局 prompt",
    endpoints: ["/hotspot-api/prompts"],
    note: "热点扫描、补研究和 watchlist 已提升到中控层，由 hotspot-api 承接。"
  }
];

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

function ScopeSection({
  title,
  subtitle,
  rows,
  ctaHref,
  ctaLabel
}: {
  title: string;
  subtitle: string;
  rows: PromptScopeRow[];
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <article className="card stack stack--tight">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p className="muted">{subtitle}</p>
        </div>
        {ctaHref && ctaLabel ? (
          <Link href={ctaHref} className="button button--ghost">
            {ctaLabel}
          </Link>
        ) : null}
      </div>

      <div className="catalog-list">
        {rows.map((row) => (
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
  );
}

export function TwitterPromptScopeMap() {
  return (
    <div className="stack">
      <section className="grid grid--two">
        <article className="card stack stack--tight">
          <h3>这页的作用</h3>
          <p className="muted">这页只负责确认作用域和后端入口，不承担 prompt 编辑工作。把说明和编辑分开，是这次减负的核心。</p>
        </article>
        <article className="card stack stack--tight">
          <h3>你可以在这里回答的问题</h3>
          <p className="muted">某个 agent 到底是全局还是账户级？某个页面该看哪个后端路由？Note Agent 为什么是全局 prompt 定义但手动执行？这些都在这里看。</p>
        </article>
      </section>

      <ScopeSection
        title="主链路作用域"
        subtitle="主链路里只有 main / writing 存在账户级绑定查看入口。"
        rows={MAIN_SCOPE_ROWS}
        ctaHref="/twitter/prompts/main-account"
        ctaLabel="去看账户级绑定"
      />

      <ScopeSection
        title="传统链路作用域"
        subtitle="传统链路现在以全局 prompt 为主，账户差异更多来自 Soul、RAG 和手动流程。"
        rows={TRADITIONAL_SCOPE_ROWS}
        ctaHref="/twitter/prompts/traditional"
        ctaLabel="去看传统链路编辑器"
      />

      <ScopeSection
        title="热点中控作用域"
        subtitle="热点扫描和研究能力已经上收到中控层，不再挂在主链路编辑区里。"
        rows={HOTSPOT_SCOPE_ROWS}
        ctaHref="/twitter/hotspots"
        ctaLabel="打开热点中心"
      />
    </div>
  );
}
