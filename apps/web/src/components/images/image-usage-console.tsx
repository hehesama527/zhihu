"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { ImageAssetUsageRecord } from "@zhihu-mvp/shared";
import { getImageUsageRecords } from "../../lib/api";
import { StatusChip } from "../status-chip";

export function ImageUsageConsole() {
  const [records, setRecords] = useState<ImageAssetUsageRecord[]>([]);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  useEffect(() => {
    void hydrate();
  }, []);

  function withAction(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        setMessage("");
        await action();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "使用记录加载失败。");
      }
    });
  }

  async function hydrate() {
    setRecords(await getImageUsageRecords({ limit: 200 }));
  }

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>使用记录</h2>
          <p className="muted">查看图片被哪些平台、账号和任务选中过，便于回查复用和避免过度重复。</p>
        </div>

        <div className="button-row">
          <button className="button button--ghost" disabled={pending} onClick={() => withAction(() => hydrate())}>
            刷新
          </button>
        </div>
      </section>

      {message ? (
        <article className="card">
          <p className="helper-text">{message}</p>
        </article>
      ) : null}

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>图片</th>
                <th>平台</th>
                <th>任务</th>
                <th>账号</th>
                <th>用途</th>
                <th>选图方式</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {records.length ? (
                records.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <div className="image-usage-cell">
                        {record.asset?.thumbnailUrl ? (
                          <Link href={`/images/${record.asset.id}`}>
                            <img src={record.asset.thumbnailUrl} alt={record.asset.fileName} />
                          </Link>
                        ) : null}
                        <div className="stack stack--tight">
                          <strong>
                            <Link href={`/images/${record.asset?.id ?? record.assetId}`}>{record.asset?.fileName ?? record.assetId}</Link>
                          </strong>
                          <span className="helper-text">{record.asset?.manualCaption ?? record.asset?.autoCaption ?? "暂无描述"}</span>
                          {record.asset ? <StatusChip status={record.asset.status} /> : null}
                        </div>
                      </div>
                    </td>
                    <td>{record.platform}</td>
                    <td>{record.taskId ?? "-"}</td>
                    <td>{record.accountId ?? "-"}</td>
                    <td>{record.usageType}</td>
                    <td>{record.selectedBy}</td>
                    <td>{new Date(record.createdAt).toLocaleString("zh-CN")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>还没有图片使用记录。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
