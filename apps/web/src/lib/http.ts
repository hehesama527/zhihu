// 浏览器端只能使用 NEXT_PUBLIC_* 或代理路径，不能暴露内部地址
const FALLBACK_CLIENT_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

declare global {
  interface Window {
    __ZHIHU_MVP_API_BASE_URL__?: string;
  }
}

export function getClientApiBaseUrl() {
  if (typeof window !== "undefined" && window.__ZHIHU_MVP_API_BASE_URL__) {
    return window.__ZHIHU_MVP_API_BASE_URL__;
  }

  return FALLBACK_CLIENT_API_BASE_URL;
}

export async function fetchClientResponse(path: string, init?: RequestInit) {
  const apiBaseUrl = getClientApiBaseUrl();

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

export function buildNetworkErrorMessage(path: string, error: unknown, apiBaseUrl = getClientApiBaseUrl()) {
  const rawMessage = error instanceof Error ? error.message : String(error);

  return [
    `浏览器没有连上接口：${apiBaseUrl}${path}`,
    "这通常表示 API 服务没启动、端口不对，或者你打开的是旧前端页面。",
    `你可以先在浏览器里检查：${apiBaseUrl}/health`,
    `原始错误：${rawMessage}`
  ].join(" ");
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
