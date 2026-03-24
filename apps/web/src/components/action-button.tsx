"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { fetchClientResponse } from "../lib/http";

type ActionButtonProps = {
  path: string;
  body?: unknown;
  method?: "POST" | "PATCH";
  children: ReactNode;
  className?: string;
  onSuccessMessage?: string;
};

export function ActionButton({
  path,
  body,
  method = "POST",
  children,
  className,
  onSuccessMessage
}: ActionButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  return (
    <div className="action-button-wrap">
      <button
        className={className ?? "button"}
        disabled={pending}
        onClick={() => {
          setMessage("");
          startTransition(async () => {
            try {
              const { response, text, payload } = await fetchClientResponse(path, {
                method,
                headers: {
                  "content-type": "application/json"
                },
                body: body !== undefined ? JSON.stringify(body) : undefined
              });

              if (!response.ok) {
                const errorMessage =
                  typeof payload.error === "object" && payload.error && "message" in payload.error
                    ? String((payload.error as { message?: unknown }).message ?? "")
                    : text;
                setMessage(errorMessage || "操作失败。");
                return;
              }

              setMessage(onSuccessMessage ?? "操作已执行。");
              router.refresh();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "操作失败。");
            }
          });
        }}
      >
        {pending ? "处理中..." : children}
      </button>
      {message ? <p className="helper-text">{message}</p> : null}
    </div>
  );
}
