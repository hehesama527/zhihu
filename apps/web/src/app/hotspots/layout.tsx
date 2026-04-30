import type { ReactNode } from "react";
import { ProductShell } from "../../components/product-shell";

export default function HotspotsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ProductShell
      tone="hotspots"
      kicker="矩阵中控"
      title="热点中心"
      description="把 X 的热点扫描、研究、watchlist 和转任务入口提升到中控层，避免把情报层和执行层继续揉在一起。"
      navItems={[
        { href: "/hotspots", label: "热点池" },
        { href: "/hotspots/watchlists", label: "监控配置" }
      ]}
      switchHref="/twitter"
      switchLabel="切到 X 工作台"
    >
      {children}
    </ProductShell>
  );
}
