type DebugMeta = Record<string, unknown>;

export function isDebugTimingEnabled() {
  const value = process.env.WORKER_DEBUG_TIMING?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function logDebugTiming(scope: string, message: string, meta?: DebugMeta) {
  if (!isDebugTimingEnabled()) {
    return;
  }

  const payload = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[debug:${scope}] ${message}${payload}`);
}

export function getElapsedMs(startedAt: number) {
  return Date.now() - startedAt;
}
