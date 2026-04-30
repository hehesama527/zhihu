import type {
  CreateTwitterTaskFromHotspotInput,
  TwitterAccount,
  TwitterHotspot,
  TwitterHotspotDetail,
  TwitterHotspotPriority,
  TwitterHotspotScanSummary,
  TwitterHotspotSourceType,
  TwitterHotspotStatus,
  TwitterHotspotWatchlist,
  TwitterHotspotWatchlistItem
} from "../twitter/api";
import { fetchHotspotClientResponse } from "./http";

export type HotspotAccount = Pick<TwitterAccount, "id" | "name" | "handle">;
export type Hotspot = TwitterHotspot;
export type HotspotDetail = TwitterHotspotDetail;
export type HotspotPriority = TwitterHotspotPriority;
export type HotspotStatus = TwitterHotspotStatus;
export type HotspotSourceType = TwitterHotspotSourceType;
export type HotspotWatchlist = TwitterHotspotWatchlist;
export type HotspotWatchlistItem = TwitterHotspotWatchlistItem;
export type HotspotWatchlistItemType = TwitterHotspotWatchlistItem["type"];
export type CreateHotspotTaskInput = CreateTwitterTaskFromHotspotInput;

async function hotspotApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { response, text, payload } = await fetchHotspotClientResponse(path, init);

  if (!response.ok) {
    const errorMessage =
      typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message ?? "")
        : text || `热点中心接口请求失败：${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

export async function getHotspotAccounts() {
  const data = await hotspotApiFetch<{ accounts: HotspotAccount[] }>("/accounts");
  return data.accounts;
}

export async function getHotspots(filters?: {
  priority?: HotspotPriority | null;
  status?: HotspotStatus | null;
  sourceType?: HotspotSourceType | null;
  includeExpired?: boolean;
}) {
  const params = new URLSearchParams();
  if (filters?.priority) {
    params.set("priority", filters.priority);
  }
  if (filters?.status) {
    params.set("status", filters.status);
  }
  if (filters?.sourceType) {
    params.set("sourceType", filters.sourceType);
  }
  if (filters?.includeExpired) {
    params.set("includeExpired", "true");
  }

  const path = params.toString() ? `/hotspots?${params.toString()}` : "/hotspots";
  const data = await hotspotApiFetch<{ hotspots: Hotspot[] }>(path);
  return data.hotspots;
}

export async function getHotspot(hotspotId: number) {
  const data = await hotspotApiFetch<{ hotspot: HotspotDetail }>(`/hotspots/${hotspotId}`);
  return data.hotspot;
}

export async function scanHotspots(input?: {
  sourceTypes?: HotspotSourceType[];
  force?: boolean;
  includeResearch?: boolean;
}) {
  const data = await hotspotApiFetch<{ ok: boolean; summary: TwitterHotspotScanSummary }>("/hotspots/scan", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sourceTypes: input?.sourceTypes ?? [],
      force: input?.force ?? false,
      includeResearch: input?.includeResearch ?? true
    })
  });

  return data.summary;
}

export async function runHotspotResearch(hotspotId: number) {
  const data = await hotspotApiFetch<{ ok: boolean; hotspot: HotspotDetail }>(`/hotspots/${hotspotId}/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    }
  });

  return data.hotspot;
}

export async function updateHotspot(hotspotId: number, patch: { status: HotspotStatus }) {
  const data = await hotspotApiFetch<{ ok: boolean; hotspot: Hotspot }>(`/hotspots/${hotspotId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  return data.hotspot;
}

export async function createTaskFromHotspot(hotspotId: number, input: CreateHotspotTaskInput) {
  const data = await hotspotApiFetch<{ ok: boolean; task: { title: string }; hotspot: HotspotDetail }>(
    `/hotspots/${hotspotId}/create-task`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    }
  );

  return data;
}

export async function getHotspotWatchlists() {
  const data = await hotspotApiFetch<{ watchlists: HotspotWatchlist[] }>("/watchlists");
  return data.watchlists;
}

export async function createHotspotWatchlist(input: { name: string; description: string; enabled: boolean }) {
  const data = await hotspotApiFetch<{ ok: boolean; watchlist: HotspotWatchlist }>("/watchlists", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data.watchlist;
}

export async function updateHotspotWatchlist(
  watchlistId: number,
  patch: Partial<Pick<HotspotWatchlist, "name" | "description" | "enabled">>
) {
  const data = await hotspotApiFetch<{ ok: boolean; watchlist: HotspotWatchlist }>(`/watchlists/${watchlistId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  return data.watchlist;
}

export async function deleteHotspotWatchlist(watchlistId: number) {
  await hotspotApiFetch<{ ok: boolean }>(`/watchlists/${watchlistId}`, {
    method: "DELETE"
  });
}

export async function createHotspotWatchlistItem(
  watchlistId: number,
  input: {
    type: HotspotWatchlistItemType;
    value: string;
    label?: string;
    enabled: boolean;
    priority: number;
    notes: string;
  }
) {
  const data = await hotspotApiFetch<{ ok: boolean; watchlist: HotspotWatchlist }>(`/watchlists/${watchlistId}/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return data.watchlist;
}

export async function updateHotspotWatchlistItem(
  watchlistId: number,
  itemId: number,
  patch: Partial<Pick<HotspotWatchlistItem, "label" | "enabled" | "priority" | "notes">>
) {
  const data = await hotspotApiFetch<{ ok: boolean; item: HotspotWatchlistItem }>(
    `/watchlists/${watchlistId}/items/${itemId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(patch)
    }
  );

  return data.item;
}

export async function deleteHotspotWatchlistItem(watchlistId: number, itemId: number) {
  await hotspotApiFetch<{ ok: boolean }>(`/watchlists/${watchlistId}/items/${itemId}`, {
    method: "DELETE"
  });
}
