"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TwitterAccount, TwitterTask } from "../../../lib/twitter/api";
import {
  getTwitterTraditionalAccounts,
  getTwitterTraditionalHealth,
  type TwitterTraditionalHealth
} from "../../../lib/twitter/traditional-api";

export type TraditionalTaskFilter = "all" | "pending" | "in_progress" | "completed" | "failed";

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function buildErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function getTraditionalTaskFilter(task: TwitterTask): TraditionalTaskFilter {
  const status = task.status;

  if (
    [
      "failed",
      "failed_terminal",
      "publish_failed",
      "review_rejected",
      "rejected",
      "error",
      "publish_uncertain"
    ].includes(status)
  ) {
    return "failed";
  }

  if (["published", "completed", "approved_to_publish", "approved"].includes(status)) {
    return "completed";
  }

  if (
    [
      "in_progress",
      "running",
      "writing",
      "reviewing",
      "publishing",
      "under_review",
      "login_checking"
    ].includes(status)
  ) {
    return "in_progress";
  }

  return "pending";
}

export function filterTraditionalTasks(tasks: TwitterTask[], filter: TraditionalTaskFilter) {
  if (filter === "all") {
    return tasks;
  }

  return tasks.filter((task) => getTraditionalTaskFilter(task) === filter);
}

export function summarizeTraditionalTasks(tasks: TwitterTask[]) {
  return {
    all: tasks.length,
    pending: tasks.filter((task) => getTraditionalTaskFilter(task) === "pending").length,
    inProgress: tasks.filter((task) => getTraditionalTaskFilter(task) === "in_progress").length,
    completed: tasks.filter((task) => getTraditionalTaskFilter(task) === "completed").length,
    failed: tasks.filter((task) => getTraditionalTaskFilter(task) === "failed").length
  };
}

type UseTwitterTraditionalWorkspaceResult = {
  health: TwitterTraditionalHealth | null;
  accounts: TwitterAccount[];
  selectedAccountId: string | null;
  selectedAccount: TwitterAccount | null;
  loading: boolean;
  message: string;
  setMessage: (message: string) => void;
  refreshWorkspace: (preferredAccountId?: string | null) => Promise<void>;
  selectAccount: (accountId: string | null) => void;
};

export function useTwitterTraditionalWorkspace(): UseTwitterTraditionalWorkspaceResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedAccountId = searchParams.get("accountId");

  const [health, setHealth] = useState<TwitterTraditionalHealth | null>(null);
  const [accounts, setAccounts] = useState<TwitterAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshWorkspace(requestedAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedAccountId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  async function refreshWorkspace(preferredAccountId?: string | null) {
    setLoading(true);

    try {
      const [nextHealth, nextAccounts] = await Promise.all([
        getTwitterTraditionalHealth(),
        getTwitterTraditionalAccounts()
      ]);

      const nextSelectedAccountId =
        preferredAccountId && nextAccounts.some((account) => account.id === preferredAccountId)
          ? preferredAccountId
          : nextAccounts[0]?.id ?? null;

      setHealth(nextHealth);
      setAccounts(nextAccounts);
      setSelectedAccountId(nextSelectedAccountId);
      setMessage("");
    } catch (error) {
      setHealth(null);
      setAccounts([]);
      setSelectedAccountId(null);
      setMessage(buildErrorMessage(error, "加载传统工作台失败。"));
    } finally {
      setLoading(false);
    }
  }

  function selectAccount(accountId: string | null) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (accountId) {
      nextParams.set("accountId", accountId);
    } else {
      nextParams.delete("accountId");
    }

    const nextUrl = nextParams.size ? `${pathname}?${nextParams.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }

  return {
    health,
    accounts,
    selectedAccountId,
    selectedAccount,
    loading,
    message,
    setMessage,
    refreshWorkspace,
    selectAccount
  };
}
