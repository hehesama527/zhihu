import Link from "next/link";

export function TwitterHubPage() {
  return (
    <div className="stack">
      <section className="traditional-hub-hero">
        <div className="traditional-hub-hero__copy">
          <span className="brand-kicker">X 工作流入口</span>
          <h2>先选工作区，再进入具体操作</h2>
          <p className="muted">X 工作流入口只负责分流。传统工作台承担执行主线，配置中心承担提示词、绑定和作用域说明。</p>
        </div>
      </section>

      <section className="traditional-action-grid traditional-action-grid--hub">
        <Link href="/twitter/traditional" className="traditional-action-card traditional-action-card--primary">
          <span className="mini-badge mini-badge--accent">主入口</span>
          <h3>传统链路工作台</h3>
          <p>进入总览、任务、账户定位和风格学习，按执行主线推进传统链路。</p>
          <strong>进入传统工作台</strong>
        </Link>

        <Link href="/twitter/prompts" className="traditional-action-card">
          <span className="mini-badge">配置与说明</span>
          <h3>配置中心</h3>
          <p>查看和编辑提示词、确认主链路绑定、核对作用域与路由，不再和执行页混在一起。</p>
          <strong>打开配置中心</strong>
        </Link>
      </section>

      <section className="traditional-grid traditional-grid--overview">
        <article className="traditional-panel">
          <div className="traditional-panel__header">
            <div>
              <h3>核心工作区</h3>
              <p className="muted">围绕传统链路执行主线拆开的四个子页面。</p>
            </div>
          </div>

          <div className="traditional-compact-list">
            <div className="traditional-compact-list__item">
              <div>
                <div className="traditional-compact-list__title">工作台总览</div>
                <div className="traditional-compact-list__meta">先看状态、看推荐下一步</div>
              </div>
            </div>
            <div className="traditional-compact-list__item">
              <div>
                <div className="traditional-compact-list__title">任务</div>
                <div className="traditional-compact-list__meta">创建任务、筛选任务、触发执行</div>
              </div>
            </div>
            <div className="traditional-compact-list__item">
              <div>
                <div className="traditional-compact-list__title">账户定位</div>
                <div className="traditional-compact-list__meta">确认账号是谁、写给谁、哪些表达可以长期复用</div>
              </div>
            </div>
            <div className="traditional-compact-list__item">
              <div>
                <div className="traditional-compact-list__title">风格学习</div>
                <div className="traditional-compact-list__meta">从参考账号学习表达方式，再按需写回到账户资产</div>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
