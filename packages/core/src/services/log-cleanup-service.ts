import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAppConfig } from "../config/env.js";

const RETAIN_BYTES_PER_FILE = 2 * 1024 * 1024;
const EMERGENCY_TOTAL_BYTES = 128 * 1024 * 1024;

type ManagedLogFile = {
  filePath: string;
  size: number;
};

type LogCleanupState = {
  lastCleanupAt: string | null;
  lastCleanupDay: string | null;
};

export type LogCleanupSummary = {
  cleanedAt: string;
  reason: "daily" | "emergency" | "manual";
  totalBytesBefore: number;
  totalBytesAfter: number;
  freedBytes: number;
  truncatedFiles: Array<{
    filePath: string;
    beforeBytes: number;
    afterBytes: number;
  }>;
};

export class LogCleanupService {
  private readonly workspaceRoot = getAppConfig().workspaceRoot;
  private readonly timezone = getAppConfig().timezone;
  private readonly stateFilePath = path.join(this.workspaceRoot, ".runlogs", "log-cleanup-state.json");

  async runIfNeeded() {
    const now = new Date();
    const managedFiles = await this.listManagedLogFiles();
    const totalBytes = managedFiles.reduce((sum, item) => sum + item.size, 0);
    const todayKey = formatDateInTimezone(now, this.timezone);
    const state = await this.readState();

    const shouldRunDaily = state.lastCleanupDay !== todayKey;
    const shouldRunEmergency = totalBytes >= EMERGENCY_TOTAL_BYTES;

    if (!shouldRunDaily && !shouldRunEmergency) {
      return {
        ran: false as const,
        summary: null
      };
    }

    const summary = await this.cleanupNow({
      reason: shouldRunEmergency ? "emergency" : "daily",
      managedFiles,
      cleanedAt: now
    });

    await this.writeState({
      lastCleanupAt: summary.cleanedAt,
      lastCleanupDay: todayKey
    });

    return {
      ran: true as const,
      summary
    };
  }

  async cleanupNow(input?: {
    reason?: LogCleanupSummary["reason"];
    managedFiles?: ManagedLogFile[];
    cleanedAt?: Date;
  }): Promise<LogCleanupSummary> {
    const cleanedAt = input?.cleanedAt ?? new Date();
    const managedFiles = input?.managedFiles ?? (await this.listManagedLogFiles());
    const truncatedFiles: LogCleanupSummary["truncatedFiles"] = [];

    let totalBytesAfter = 0;

    for (const file of managedFiles) {
      if (file.size <= RETAIN_BYTES_PER_FILE) {
        totalBytesAfter += file.size;
        continue;
      }

      const retainedBytes = await truncateFileToTail(file.filePath, RETAIN_BYTES_PER_FILE);
      totalBytesAfter += retainedBytes;
      truncatedFiles.push({
        filePath: file.filePath,
        beforeBytes: file.size,
        afterBytes: retainedBytes
      });
    }

    const totalBytesBefore = managedFiles.reduce((sum, item) => sum + item.size, 0);
    const untouchedBytes = managedFiles
      .filter((file) => file.size <= RETAIN_BYTES_PER_FILE)
      .reduce((sum, item) => sum + item.size, 0);

    if (!truncatedFiles.length) {
      totalBytesAfter = untouchedBytes;
    }

    return {
      cleanedAt: cleanedAt.toISOString(),
      reason: input?.reason ?? "manual",
      totalBytesBefore,
      totalBytesAfter,
      freedBytes: Math.max(0, totalBytesBefore - totalBytesAfter),
      truncatedFiles
    };
  }

  private async listManagedLogFiles(): Promise<ManagedLogFile[]> {
    const files = new Map<string, ManagedLogFile>();
    const managedDirs = [
      path.join(this.workspaceRoot, ".runlogs"),
      path.join(this.workspaceRoot, ".codex-runtime")
    ];

    for (const dirPath of managedDirs) {
      const entries = await safeReadDir(dirPath);
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        if (!isManagedLogFile(entry.name)) {
          continue;
        }

        const filePath = path.join(dirPath, entry.name);
        const stat = await safeStat(filePath);
        if (!stat?.isFile()) {
          continue;
        }

        files.set(filePath, {
          filePath,
          size: stat.size
        });
      }
    }

    const pm2LogPath = path.join(os.homedir(), ".pm2", "pm2.log");
    const pm2Stat = await safeStat(pm2LogPath);
    if (pm2Stat?.isFile()) {
      files.set(pm2LogPath, {
        filePath: pm2LogPath,
        size: pm2Stat.size
      });
    }

    return Array.from(files.values()).sort((a, b) => b.size - a.size);
  }

  private async readState(): Promise<LogCleanupState> {
    try {
      const content = await fs.promises.readFile(this.stateFilePath, "utf8");
      const parsed = JSON.parse(content) as Partial<LogCleanupState>;
      return {
        lastCleanupAt: typeof parsed.lastCleanupAt === "string" ? parsed.lastCleanupAt : null,
        lastCleanupDay: typeof parsed.lastCleanupDay === "string" ? parsed.lastCleanupDay : null
      };
    } catch {
      return {
        lastCleanupAt: null,
        lastCleanupDay: null
      };
    }
  }

  private async writeState(state: LogCleanupState) {
    await fs.promises.mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await fs.promises.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
  }
}

async function truncateFileToTail(filePath: string, targetBytes: number) {
  const handle = await fs.promises.open(filePath, "r");

  try {
    const stat = await handle.stat();
    const retainedBytes = Math.min(stat.size, targetBytes);
    const buffer = Buffer.alloc(retainedBytes);

    if (retainedBytes > 0) {
      await handle.read(buffer, 0, retainedBytes, stat.size - retainedBytes);
    }

    await fs.promises.writeFile(filePath, buffer);
    return retainedBytes;
  } finally {
    await handle.close();
  }
}

async function safeReadDir(dirPath: string) {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(filePath: string) {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}

function isManagedLogFile(fileName: string) {
  return fileName.endsWith(".log") || fileName.endsWith(".out") || fileName.endsWith(".err");
}

function formatDateInTimezone(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}
