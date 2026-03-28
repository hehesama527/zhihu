import { createHash } from "node:crypto";
import { getAppConfig } from "../config/env.js";

export function normalizeZhihuQuestionUrl(rawUrl: string | null | undefined) {
  if (!rawUrl || !rawUrl.includes("/question/")) {
    return null;
  }

  try {
    const normalized = new URL(rawUrl, getAppConfig().zhihuBaseUrl);
    if (!normalized.hostname.includes("zhihu.com")) {
      return null;
    }

    const match = normalized.pathname.match(/\/question\/(\d+)/);
    if (!match) {
      return null;
    }

    return `${normalized.protocol}//${normalized.host}/question/${match[1]}`;
  } catch {
    return null;
  }
}

export function hashZhihuQuestionUrl(rawUrl: string | null | undefined) {
  const normalizedUrl = normalizeZhihuQuestionUrl(rawUrl);
  if (!normalizedUrl) {
    return null;
  }

  return createHash("sha256").update(normalizedUrl).digest("hex");
}
