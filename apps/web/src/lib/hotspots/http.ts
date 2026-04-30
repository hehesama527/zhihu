import { buildNetworkErrorMessage } from "../http";

const FALLBACK_HOTSPOT_CLIENT_API_BASE_URL =
  process.env.NEXT_PUBLIC_HOTSPOT_API_BASE_URL ?? "/hotspot-api";

declare global {
  interface Window {
    __ZHIHU_MVP_HOTSPOT_API_BASE_URL__?: string;
  }
}

export function getHotspotClientApiBaseUrl() {
  if (typeof window !== "undefined" && window.__ZHIHU_MVP_HOTSPOT_API_BASE_URL__) {
    return window.__ZHIHU_MVP_HOTSPOT_API_BASE_URL__;
  }

  return FALLBACK_HOTSPOT_CLIENT_API_BASE_URL;
}

export async function fetchHotspotClientResponse(path: string, init?: RequestInit) {
  const apiBaseUrl = getHotspotClientApiBaseUrl();

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, normalizeJsonRequest(init));
    const text = await response.text();
    const payload = safeParseRecord(text);

    return {
      response,
      text,
      payload
    };
  } catch (error) {
    throw new Error(buildNetworkErrorMessage(path, error, apiBaseUrl));
  }
}

function normalizeJsonRequest(init?: RequestInit) {
  if (!init) {
    return init;
  }

  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const contentType = headers.get("content-type") ?? "";
  const shouldProvideEmptyJsonBody =
    init.body === undefined &&
    (method === "POST" || method === "PATCH" || method === "PUT") &&
    contentType.includes("application/json");

  if (!shouldProvideEmptyJsonBody) {
    return {
      ...init,
      headers
    };
  }

  return {
    ...init,
    headers,
    body: "{}"
  };
}

function safeParseRecord(text: string) {
  if (!text) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}
