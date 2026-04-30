import type { ReactNode } from "react";
import { TwitterPromptSubnav } from "../../../../components/twitter/twitter-prompt-subnav";

export default function TwitterPromptsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="stack">
      <section className="prompt-hub-hero">
        <div className="prompt-hub-hero__content">
          <div className="prompt-hub-hero__eyebrow">配置中心</div>
          <h2>把“改配置”、“看绑定”、“查作用域”拆开</h2>
          <p className="muted">
            `/twitter/prompts` 现在作为配置中心入口，负责把传统链路配置、主链路账户绑定和作用域说明拆开承载，减少单页信息密度，也降低误操作成本。
          </p>
          <div className="prompt-hub-hero__meta">
            <span className="mini-badge">传统链路配置</span>
            <span className="mini-badge">主链路账户绑定</span>
            <span className="mini-badge mini-badge--accent">支持返回传统工作台</span>
          </div>
        </div>

        <TwitterPromptSubnav />
      </section>

      {children}
    </div>
  );
}
