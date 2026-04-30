import type { ReactNode } from "react";
import { ProductShell } from "../../components/product-shell";

export default function ImagesLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ProductShell
      tone="images"
      kicker="矩阵辅助"
      title="配图中心"
      description="统一管理已有配图资产，支撑知乎与 X 的选图、审核、候选召回和使用留痕。"
      navItems={[
        { href: "/images", label: "图片检索" },
        { href: "/images/library", label: "已入库" },
        { href: "/images/import", label: "图片导入" },
        { href: "/images/review", label: "待审核" },
        { href: "/images/usage", label: "使用记录" }
      ]}
      switchHref="/zhihu"
      switchLabel="切到知乎工作台"
    >
      {children}
    </ProductShell>
  );
}
