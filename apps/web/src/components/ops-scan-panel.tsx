"use client";

import { useState, useTransition } from "react";
import { fetchClientResponse, getClientApiBaseUrl } from "../lib/http";

export function OpsScanPanel() {
  const [result, setResult] = useState("");
  const [pending, startTransition] = useTransition();

  async function runScan() {
    const { response, text, payload } = await fetchClientResponse("/ops/scan", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    });

    if (!response.ok) {
      const message =
        typeof payload.error === "object" && payload.error && "message" in payload.error
          ? String((payload.error as { message?: unknown }).message ?? "")
          : text;
      throw new Error(message || "执行运维扫描失败。");
    }

    return payload;
  }

  return (
    <article className="card">
      <div className="card-header">
        <div>
          <h3>手动扫描</h3>
          <p className="muted">在测试环境手动触发一轮运维扫描，并查看返回摘要。</p>
        </div>

        <button
          className="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                const payload = await runScan();
                setResult(JSON.stringify(payload, null, 2));
              } catch (error) {
                setResult(error instanceof Error ? error.message : "执行运维扫描失败。");
              }
            })
          }
        >
          {pending ? "扫描中..." : "执行扫描"}
        </button>
      </div>

      <p className="helper-text">当前客户端接口：{getClientApiBaseUrl()}</p>
      <pre>{result || "最近一次扫描摘要会显示在这里。"}</pre>
    </article>
  );
}
