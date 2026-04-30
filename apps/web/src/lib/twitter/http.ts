// 浏览器端只能使用 NEXT_PUBLIC_* 或代理路径，不能暴露内部地址
const FALLBACK_X_CLIENT_API_BASE_URL =
  process.env.NEXT_PUBLIC_X_API_BASE_URL ?? "/x-api";
const FALLBACK_X_TRADITIONAL_CLIENT_API_BASE_URL =
  process.env.NEXT_PUBLIC_X_TRADITIONAL_API_BASE_URL ?? "/x-traditional-api";
const DEV_X_TRADITIONAL_API_PORT = process.env.NEXT_PUBLIC_X_TRADITIONAL_API_PORT ?? "8791";

declare global {
  interface Window {
    __X_MVP_API_BASE_URL__?: string;
    __X_TRADITIONAL_MVP_API_BASE_URL__?: string;
  }
}

export function getTwitterClientApiBaseUrl() {
  if (typeof window !== "undefined" && window.__X_MVP_API_BASE_URL__) {
    return window.__X_MVP_API_BASE_URL__;
  }

  return FALLBACK_X_CLIENT_API_BASE_URL;
}

export function getTwitterTraditionalClientApiBaseUrl() {
  if (typeof window !== "undefined" && window.__X_TRADITIONAL_MVP_API_BASE_URL__) {
    return window.__X_TRADITIONAL_MVP_API_BASE_URL__;
  }

  return FALLBACK_X_TRADITIONAL_CLIENT_API_BASE_URL;
}

export async function fetchTwitterClientResponse(path: string, init?: RequestInit) {
  const apiBaseUrl = getTwitterClientApiBaseUrl();

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
    throw new Error(buildTwitterNetworkErrorMessage(path, error));
  }
}

export async function fetchTwitterTraditionalClientResponse(path: string, init?: RequestInit) {
  const apiBaseUrl = resolveTwitterTraditionalRequestBaseUrl();

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
    throw new Error(buildTwitterTraditionalNetworkErrorMessage(path, error));
  }
}

export function buildTwitterNetworkErrorMessage(path: string, error: unknown) {
  const apiBaseUrl = getTwitterClientApiBaseUrl();
  const rawMessage = error instanceof Error ? error.message : String(error);

  return [
    `Twitter / X 接口不可达：${apiBaseUrl}${path}`,
    `你可以先检查服务健康状态：${apiBaseUrl}/health`,
    `原始错误：${rawMessage}`
  ].join(" ");
}

export function buildTwitterTraditionalNetworkErrorMessage(path: string, error: unknown) {
  const apiBaseUrl = getTwitterTraditionalClientApiBaseUrl();
  const rawMessage = error instanceof Error ? error.message : String(error);

  return [
    `X 传统链路接口不可达：${apiBaseUrl}${path}`,
    `可以先检查服务健康状态：${apiBaseUrl}/health`,
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

function getDevDirectTwitterTraditionalApiBaseUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  if (process.env.NEXT_PUBLIC_X_TRADITIONAL_API_BASE_URL) {
    return null;
  }

  return `${window.location.protocol}//${window.location.hostname}:${DEV_X_TRADITIONAL_API_PORT}`;
}

function resolveTwitterTraditionalRequestBaseUrl() {
  const devDirectUrl = getDevDirectTwitterTraditionalApiBaseUrl();
  if (devDirectUrl) {
    return devDirectUrl;
  }

  return getTwitterTraditionalClientApiBaseUrl();
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
