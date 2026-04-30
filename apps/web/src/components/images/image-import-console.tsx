"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { ImageImportJobSummary } from "@zhihu-mvp/shared";
import { createImageImportJob, getImageImportJobs } from "../../lib/api";
import { StatusChip } from "../status-chip";

const DEFAULT_SOURCE_PATH = "C:\\Users\\Mayn\\Pictures\\EmojiPackage-master\\EmojiPackage-master";

export function ImageImportConsole() {
  const [sourcePath, setSourcePath] = useState(DEFAULT_SOURCE_PATH);
  const [jobs, setJobs] = useState<ImageImportJobSummary[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void hydrate();
    const timer = window.setInterval(() => {
      void hydrate();
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  function withAction(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        setMessage("");
        await action();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "导入任务执行失败。");
      }
    });
  }

  async function hydrate() {
    setJobs(await getImageImportJobs());
  }

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>图片导入</h2>
          <p className="muted">V1 先跑目录导入。当前默认测试源已经固定到 EmojiPackage 测试图库。</p>
        </div>

        <div className="button-row">
          <Link href="/images/library" className="button button--ghost">
            去已入库
          </Link>
          <Link href="/images/review" className="button button--ghost">
            去待审核
          </Link>
        </div>
      </section>

      <section className="grid grid--three">
        <article className="card">
          <p className="muted">默认测试源</p>
          <div className="metric-value">EmojiPackage</div>
        </article>
        <article className="card">
          <p className="muted">最近导入任务</p>
          <div className="metric-value">{jobs.length}</div>
        </article>
        <article className="card">
          <p className="muted">运行中任务</p>
          <div className="metric-value">{jobs.filter((job) => job.status === "running").length}</div>
        </article>
      </section>

      <section className="card">
        <label className="field">
          <span>导入根目录</span>
          <input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} />
        </label>

        <div className="button-row">
          <button
            className="button"
            disabled={pending}
            onClick={() =>
              withAction(async () => {
                const job = await createImageImportJob(sourcePath);
                await hydrate();
                setMessage(job ? `导入任务已创建：${job.id}` : "导入任务已提交。");
              })
            }
          >
            {pending ? "提交中..." : "开始导入"}
          </button>

          <button className="button button--ghost" disabled={pending} onClick={() => withAction(() => hydrate())}>
            刷新任务
          </button>
        </div>

        <p className="helper-text">
          当前导入规则：递归扫描子目录，只接收 `.jpg` / `.jpeg` / `.png` / `.webp` / `.gif` / `.bmp`，
          非图片文件记为 skipped，不阻塞任务完成。
        </p>
        {message ? <p className="helper-text">{message}</p> : null}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>导入任务</h3>
            <p className="muted">导入过程不会等待 OCR / Ollama 完成，图片入库后异步分析。</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>目录</th>
                <th>统计</th>
                <th>完成时间</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length ? (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>
                      <StatusChip status={job.status} />
                    </td>
                    <td>{job.sourcePath}</td>
                    <td>
                      总计 {job.totalCount} / 入库 {job.importedCount} / 重复 {job.duplicatedCount} / skipped {job.skippedCount} /
                      失败 {job.failedCount}
                    </td>
                    <td>{job.completedAt ? new Date(job.completedAt).toLocaleString("zh-CN") : "进行中"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>还没有导入任务。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
