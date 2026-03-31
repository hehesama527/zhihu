"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { retryJob, runWorkerTick } from "../lib/api";

type RetryJobButtonProps = {
  jobId: number;
  className?: string;
  label?: string;
};

export function RetryJobButton({
  jobId,
  className = "button button--ghost",
  label = "失败重试"
}: RetryJobButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  return (
    <div className="action-button-wrap">
      <button
        className={className}
        disabled={pending}
        onClick={() => {
          setMessage("");
          startTransition(async () => {
            try {
              await retryJob(jobId);
              const summary = await runWorkerTick();
              setMessage(summary.message ?? `任务 #${jobId} 已加入重试队列，系统会继续推进。`);
              router.refresh();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "重试任务失败。");
            }
          });
        }}
      >
        {pending ? "处理中..." : label}
      </button>
      {message ? <p className="helper-text">{message}</p> : null}
    </div>
  );
}
