import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "知乎自动化 MVP",
  description: "单账号知乎自动化发布系统 MVP 控制台"
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
              <h1>单账号自动化控制台</h1>
              <p>选题、写作、审核、发布、恢复和 Prompt 管理都放在这里。</p>
            </div>

            <nav className="nav">
              <Link href="/">总览</Link>
              <Link href="/schedule">排期</Link>
              <Link href="/topics">Topics / Drafts</Link>
              <Link href="/publish-jobs">Publish Jobs</Link>
              <Link href="/prompts">Prompt Studio</Link>
              <Link href="/account">账号恢复</Link>
            </nav>
          </aside>

          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
