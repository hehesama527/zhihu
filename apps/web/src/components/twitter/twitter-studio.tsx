"use client";

import Link from "next/link";

export function TwitterStudio() {
  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>X 工作流说明</h2>
          <p className="muted">
            主链路页面当前不在这个入口里展开，避免和传统链路工作台混在一起。
          </p>
          <p className="helper-text">
            如需处理账户学习、任务执行和传统链路操作，请进入传统工作台。
          </p>
        </div>
      </section>

      <article className="card stack stack--tight">
        <h3>主链路入口已收起</h3>
        <p className="helper-text">
          这个占位页只用于保留旧入口，不再承担主链路实际操作。
        </p>
        <p className="helper-text">
          传统链路请前往 <Link href="/twitter/traditional">/twitter/traditional</Link>。
        </p>
      </article>
    </div>
  );
}
