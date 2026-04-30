const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

export function extractTwitterAccountHandle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const domainMatch = withoutProtocol.match(/^(?:www\.)?(?:x\.com|twitter\.com)\/([^/?#]+)/i);
  const candidate = (domainMatch?.[1] ?? withoutProtocol)
    .replace(/^@+/, "")
    .split(/[/?#]/)[0]
    ?.trim();

  return candidate && X_HANDLE_PATTERN.test(candidate) ? candidate : "";
}

export function normalizeTwitterAccountValue(value: string) {
  const handle = extractTwitterAccountHandle(value);
  return handle ? `https://x.com/${handle}` : "";
}

export function formatTwitterAccountHandle(value: string) {
  const handle = extractTwitterAccountHandle(value);
  return handle ? `@${handle}` : value.trim();
}

export function buildTwitterProfileUrl(value: string) {
  return normalizeTwitterAccountValue(value) || value.trim();
}

export function getDefaultTwitterAccountLabel(value: string) {
  return formatTwitterAccountHandle(value);
}
