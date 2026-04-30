import type { ReactNode } from "react";
import { ProductShell } from "../../components/product-shell";

export default function TwitterLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ProductShell
      tone="twitter"
      kicker="X 工作流"
      title="X Traditional 工作台"
      description="把任务执行、账户定位、风格学习和配置说明拆开管理，避免再回到单页堆叠式控制台。"
      navItems={[
        { href: "/twitter/traditional", label: "工作台总览" },
        { href: "/twitter/traditional/tasks", label: "任务" },
        { href: "/twitter/traditional/account", label: "账户定位" },
        { href: "/twitter/traditional/learning", label: "风格学习" },
        { href: "/twitter/prompts", label: "配置中心" }
      ]}
      homeHref="/twitter"
      homeLabel="返回 X 入口"
      switchHref="/zhihu"
      switchLabel="切到知乎工作台"
    >
      {children}
    </ProductShell>
  );
}
