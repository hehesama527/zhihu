"use client";

import { useState, useTransition } from "react";
import { fetchClientResponse, getClientApiBaseUrl } from "../lib/http";

type WorkerPanelProps = {
  accountId: number | null;
};

export function WorkerPanel({ accountId }: WorkerPanelProps) {
  const [result, setResult] = useState("");
  const [pending, startTransition] = useTransition();

  async function call(path: string, body?: unknown) {
    const { response, text, payload } = await fetchClientResponse(path, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const message =
        typeof payload.error === "object" && payload.error && "message" in payload.error
          ? String((payload.error as { message?: unknown }).message ?? "")
          : text;
      throw new Error(message || "请求失败。");
    }

    return payload;
  }

  return (
    <div className="card">
      <div className="inline-row">
        <div>
          <h3>执行器调度</h3>
          <p className="muted">需要立刻推进排期、选题、审核或发布时，可以手动跑一轮。</p>
          <p className="helper-text">
            {accountId === null ? "当前还没有选中账号。" : `当前“新建任务”会直接落到账号 #${accountId}。`}
          </p>
        </div>

        <div className="button-row">
          <button
            className="button button--ghost"
            disabled={pending || accountId === null}
            onClick={() =>
              startTransition(async () => {
                try {
                  if (accountId === null) {
                    throw new Error("当前没有可用账号，暂时不能创建任务。");
                  }

                  const payload = await call("/jobs", {
                    accountId
                  });
                  setResult(JSON.stringify(payload, null, 2));
                } catch (error) {
                  setResult(error instanceof Error ? error.message : "创建任务失败。");
                }
              })
            }
          >
            新建任务
          </button>

          <button
            className="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const payload = await call("/worker/tick");
                  setResult(JSON.stringify(payload, null, 2));
                } catch (error) {
                  setResult(error instanceof Error ? error.message : "执行器运行失败。");
                }
              })
            }
          >
            {pending ? "处理中..." : "立刻跑一轮"}
          </button>
        </div>
      </div>

      <p className="helper-text">当前前端请求的接口：{getClientApiBaseUrl()}</p>
      <pre>{result || "这里会显示最近一次手动触发的执行结果。"}</pre>
    </div>
  );
}
