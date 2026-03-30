import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zhihu Matrix Control Center",
  description: "Manage scheduling, topics, publishing, account recovery, prompts, and ops incidents."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const apiBaseUrl =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787";

  return (
    <html lang="zh-CN">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__ZHIHU_MVP_API_BASE_URL__ = ${JSON.stringify(apiBaseUrl)};`
          }}
        />

        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-kicker">Zhihu MVP</span>
              <h1>Zhihu Matrix Console</h1>
              <p>Control content flow, publishing, account recovery, prompts, and ops diagnostics in one place.</p>
            </div>

            <nav className="nav">
              <Link href="/">Dashboard</Link>
              <Link href="/schedule">Schedule</Link>
              <Link href="/topics">Topics / Drafts</Link>
              <Link href="/publish-jobs">Publish Jobs</Link>
              <Link href="/prompts">Prompt Studio</Link>
              <Link href="/account">Accounts</Link>
              <Link href="/ops">Ops</Link>
            </nav>
          </aside>

          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
