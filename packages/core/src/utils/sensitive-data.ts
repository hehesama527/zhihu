const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-***"],
  [/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1***"],
  [/(authorization\s*[:=]\s*)([^\s]+)/gi, "$1***"],
  [/(cookie\s*[:=]\s*)([^\r\n]+)/gi, "$1***"],
  [/(open-apis\/bot\/v2\/hook\/)[A-Za-z0-9-]+/gi, "$1***"],
  [/\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD))\s*[:=]\s*([^\s'"]+)/gi, "$1=***"]
];

export function sanitizeSensitiveText(value: string | null | undefined) {
  if (typeof value !== "string" || !value) {
    return value ?? null;
  }

  return SECRET_PATTERNS.reduce((output, [pattern, replacement]) => output.replace(pattern, replacement), value);
}

export function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeUnknown(nested)]));
}
