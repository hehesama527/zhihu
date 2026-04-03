import fs from "node:fs";
import path from "node:path";
import { getAppConfig } from "../config/env.js";
import { sanitizeSensitiveText, sanitizeUnknown } from "../utils/sensitive-data.js";

type OpsAgentErrorLogServiceOptions = {
  logFilePath?: string;
  stateFilePath?: string;
  timezone?: string;
};

type OpsAgentErrorLogState = {
  lastCleanupAt: string | null;
  lastCleanupMonth: string | null;
};

export type OpsAgentErrorLogEntryInput = {
  source: string;
  error: unknown;
  message?: string | null;
  context?: unknown;
  occurredAt?: Date;
};

export type OpsAgentErrorLogCleanupSummary = {
  cleanedAt: string;
  monthKey: string;
  filePath: string;
  previousSizeBytes: number;
};

export class OpsAgentErrorLogService {
  private readonly logFilePath: string;
  private readonly stateFilePath: string;
  private readonly timezone: string;
  private pendingOperation: Promise<void> = Promise.resolve();

  constructor(options: OpsAgentErrorLogServiceOptions = {}) {
    const config = getAppConfig();
    this.logFilePath = options.logFilePath ?? path.join(config.dataDir, "logs", "zhihu-ops-agent.error.log");
    this.stateFilePath =
      options.stateFilePath ?? path.join(config.dataDir, "logs", "zhihu-ops-agent.error-log-state.json");
    this.timezone = options.timezone ?? config.timezone;
  }

  async recordError(input: OpsAgentErrorLogEntryInput) {
    return this.enqueue(async () => {
      const occurredAt = input.occurredAt ?? new Date();
      await this.runMonthlyCleanupIfNeededInternal(occurredAt);
      await fs.promises.mkdir(path.dirname(this.logFilePath), { recursive: true });
      await fs.promises.appendFile(this.logFilePath, serializeEntry(input, occurredAt), "utf8");

      return {
        filePath: this.logFilePath,
        loggedAt: occurredAt.toISOString()
      };
    });
  }

  async runMonthlyCleanupIfNeeded(now = new Date()) {
    return this.enqueue(() => this.runMonthlyCleanupIfNeededInternal(now));
  }

  private async runMonthlyCleanupIfNeededInternal(now: Date) {
    const monthKey = formatMonthInTimezone(now, this.timezone);
    const state = await this.readState();
    if (state.lastCleanupMonth === monthKey) {
      return {
        ran: false as const,
        summary: null
      };
    }

    const logStat = await safeStat(this.logFilePath);
    const currentFileMonth = logStat?.isFile() ? formatMonthInTimezone(logStat.mtime, this.timezone) : null;
    const shouldClear = logStat?.isFile()
      ? state.lastCleanupMonth !== null || (currentFileMonth !== null && currentFileMonth !== monthKey)
      : false;

    if (shouldClear) {
      await fs.promises.mkdir(path.dirname(this.logFilePath), { recursive: true });
      await fs.promises.writeFile(this.logFilePath, "", "utf8");
    }

    await this.writeState({
      lastCleanupAt: now.toISOString(),
      lastCleanupMonth: monthKey
    });

    if (!shouldClear) {
      return {
        ran: false as const,
        summary: null
      };
    }

    return {
      ran: true as const,
      summary: {
        cleanedAt: now.toISOString(),
        monthKey,
        filePath: this.logFilePath,
        previousSizeBytes: logStat?.isFile() ? logStat.size : 0
      } satisfies OpsAgentErrorLogCleanupSummary
    };
  }

  private async readState(): Promise<OpsAgentErrorLogState> {
    try {
      const raw = await fs.promises.readFile(this.stateFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<OpsAgentErrorLogState>;
      return {
        lastCleanupAt: typeof parsed.lastCleanupAt === "string" ? parsed.lastCleanupAt : null,
        lastCleanupMonth: typeof parsed.lastCleanupMonth === "string" ? parsed.lastCleanupMonth : null
      };
    } catch {
      return {
        lastCleanupAt: null,
        lastCleanupMonth: null
      };
    }
  }

  private async writeState(state: OpsAgentErrorLogState) {
    await fs.promises.mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await fs.promises.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const run = this.pendingOperation.then(operation, operation);
    this.pendingOperation = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

function serializeEntry(input: OpsAgentErrorLogEntryInput, occurredAt: Date) {
  const normalizedError = normalizeError(input.error);
  const normalizedMessage = sanitizeSensitiveText(
    input.message ?? normalizedError.message ?? "Ops agent runtime error"
  );

  return `${JSON.stringify({
    occurredAt: occurredAt.toISOString(),
    source: input.source,
    message: normalizedMessage ?? "Ops agent runtime error",
    errorName: normalizedError.name,
    errorMessage: normalizedError.message,
    stack: normalizedError.stack,
    errorValue: normalizedError.value,
    context: sanitizeUnknown(input.context ?? null)
  })}\n`;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeSensitiveText(error.message),
      stack: sanitizeSensitiveText(error.stack ?? null),
      value: null
    };
  }

  if (typeof error === "string") {
    return {
      name: null,
      message: sanitizeSensitiveText(error),
      stack: null,
      value: null
    };
  }

  return {
    name: null,
    message: null,
    stack: null,
    value: sanitizeUnknown(error)
  };
}

function formatMonthInTimezone(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit"
  });

  return formatter.format(date);
}

async function safeStat(filePath: string) {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}
