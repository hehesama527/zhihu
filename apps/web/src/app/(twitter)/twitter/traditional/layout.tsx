import type { ReactNode } from "react";
import { TwitterTraditionalSubnav } from "../../../../components/twitter/traditional/traditional-subnav";

export default function TwitterTraditionalLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="stack">
      <TwitterTraditionalSubnav />
      {children}
    </div>
  );
}
