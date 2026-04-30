"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PROMPT_NAV_ITEMS = [
  {
    href: "/twitter/prompts",
    label: "配置总览",
    description: "看清入口、职责和返回路径"
  },
  {
    href: "/twitter/prompts/traditional",
    label: "传统链路配置",
    description: "编辑传统链路全局提示词配置"
  },
  {
    href: "/twitter/prompts/main-account",
    label: "主链路账户绑定",
    description: "查看主链路账户级配置绑定"
  },
  {
    href: "/twitter/prompts/scopes",
    label: "作用域地图",
    description: "确认后端路由和配置边界"
  }
] as const;

export function TwitterPromptSubnav() {
  const pathname = usePathname();

  return (
    <div className="stack stack--tight">
      <nav className="prompt-hub-nav" aria-label="配置中心导航">
        {PROMPT_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`prompt-hub-nav__item ${isActive ? "prompt-hub-nav__item--active" : ""}`}
            >
              <span className="prompt-hub-nav__label">{item.label}</span>
              <span className="prompt-hub-nav__desc">{item.description}</span>
            </Link>
          );
        })}
      </nav>

      <div className="button-row">
        <Link href="/twitter/traditional" className="button button--ghost">
          返回传统工作台总览
        </Link>
      </div>
    </div>
  );
}
