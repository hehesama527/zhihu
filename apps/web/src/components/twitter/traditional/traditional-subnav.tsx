"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/twitter/traditional",
    label: "工作台总览",
    description: "看状态、看下一步"
  },
  {
    href: "/twitter/traditional/tasks",
    label: "任务",
    description: "创建、筛选、执行"
  },
  {
    href: "/twitter/traditional/account",
    label: "账户定位",
    description: "确认账号定位与表达"
  },
  {
    href: "/twitter/traditional/learning",
    label: "风格学习",
    description: "参考账号学习与写回"
  }
] as const;

export function TwitterTraditionalSubnav() {
  const pathname = usePathname();

  return (
    <section className="traditional-nav-card">
      <div className="traditional-nav-card__intro">
        <span className="mini-badge mini-badge--accent">Traditional 工作台</span>
        <h2>把“看状态”、“做任务”、“调账户”、“学风格”拆开</h2>
        <p className="muted">传统工作台只保留执行主线。配置和说明统一收口到配置中心，避免再回到单页堆叠式控制台。</p>
      </div>

      <nav className="traditional-nav-grid" aria-label="传统工作台导航">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`traditional-nav-item ${active ? "traditional-nav-item--active" : ""}`}
            >
              <span className="traditional-nav-item__label">{item.label}</span>
              <span className="traditional-nav-item__desc">{item.description}</span>
            </Link>
          );
        })}

        <Link href="/twitter/prompts" className="traditional-nav-item traditional-nav-item--secondary">
          <span className="traditional-nav-item__label">配置中心</span>
          <span className="traditional-nav-item__desc">编辑提示词、查绑定与作用域</span>
        </Link>
      </nav>
    </section>
  );
}
