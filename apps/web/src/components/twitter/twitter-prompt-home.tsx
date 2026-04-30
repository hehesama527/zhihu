import Link from "next/link";

const HUB_SECTIONS = [
  {
    href: "/twitter/prompts/traditional",
    title: "传统链路配置",
    eyebrow: "配置版本",
    description: "只处理传统链路的全局提示词配置版本、测试和启用，不再和其他说明区混在一起。",
    bullets: ["全局提示词配置列表", "版本切换和测试", "给笔记智能体单独保留位置"]
  },
  {
    href: "/twitter/prompts/main-account",
    title: "主链路账户绑定",
    eyebrow: "账户绑定",
    description: "把主链路 `main / writing` 的账户级绑定单独拿出来看，避免和传统链路配置页挤在同一页。",
    bullets: ["账户选择", "类别切换", "当前绑定版本与账户自有版本"]
  },
  {
    href: "/twitter/prompts/scopes",
    title: "配置作用域与路由确认",
    eyebrow: "作用域说明",
    description: "专门查看中控级、账户级、手动执行这些边界说明，减少配置页里的解释性噪音。",
    bullets: ["后端路由入口", "模块作用域", "哪些是全局、哪些是账户级"]
  }
] as const;

export function TwitterPromptHome() {
  return (
    <div className="stack">
      <section className="prompt-home-grid">
        {HUB_SECTIONS.map((section) => (
          <article key={section.href} className="prompt-home-card">
            <div className="prompt-home-card__meta">{section.eyebrow}</div>
            <h3>{section.title}</h3>
            <p className="muted">{section.description}</p>
            <ul className="prompt-home-card__list">
              {section.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="button-row">
              <Link href={section.href} className="button">
                打开
              </Link>
            </div>
          </article>
        ))}
      </section>

      <section className="grid grid--two">
        <article className="card stack stack--tight">
          <h3>配置中心怎么用</h3>
          <p className="muted">
            如果你是要改传统链路的提示词配置，直接进“传统链路配置”。如果你是要确认主链路账户到底绑定了哪个版本，进“主链路账户绑定”。如果你是在核对边界和路由，进“配置作用域与路由确认”。
          </p>
        </article>

        <article className="card stack stack--tight">
          <h3>返回传统工作台</h3>
          <p className="muted">
            配置中心只负责收口和分流，不替代传统工作台总览。如果你要看链路总览、任务入口或回到原工作台上下文，直接返回 `/twitter/traditional`。
          </p>
          <div className="button-row">
            <Link href="/twitter/traditional" className="button button--ghost">
              返回传统工作台总览
            </Link>
          </div>
        </article>
      </section>
    </div>
  );
}
