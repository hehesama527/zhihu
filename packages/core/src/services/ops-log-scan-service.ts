import fs from "node:fs";
import path from "node:path";
import { getAppConfig } from "../config/env.js";
import {
  buildStableIncidentFingerprintText,
  isIncidentFingerprintNoiseLine,
  normalizeIncidentFingerprintLine
} from "./ops-diagnosis-service.js";

type OpsLogScanServiceOptions = {
  logDir?: string;
  stateFilePath?: string;
};

type OpsLogScanState = {
  files: Record<string, OpsLogScanCursorState>;
};

type OpsLogScanCursorState = {
  offsetBytes: number;
  fileSizeBytes: number;
  lastModifiedAt: string | null;
  initializedAt: string | null;
};

export type OpsLogScanIncidentCandidate = {
  source: "log_scan";
  severity: "high";
  serviceName: string;
  failureType: "recent_log_error";
  title: string;
  rawErrorExcerpt: string;
  fingerprintKey: string;
  evidence: {
    filePath: string;
    lastModifiedAt: string;
    matchedLines: number;
    startOffsetBytes: number;
    endOffsetBytes: number;
  };
};

const LOG_SCAN_ERROR_PATTERN = /(error|failed|exception|unhandled|\bkilled\b)/i;
const LOG_SCAN_NOISE_LINE_PATTERNS = [
  /^\(use `node --trace-deprecation/i,
  /^\(node:<pid>\) \[dep<num>\] deprecationwarning:/i,
  /^npm error (path|workspace|location)\b/i,
  /^npm error command failed$/i,
  /^npm error command sh -c\b/i
];

export class OpsLogScanService {
  private readonly logDir: string;
  private readonly stateFilePath: string;

  constructor(options: OpsLogScanServiceOptions = {}) {
    if (options.logDir && options.stateFilePath) {
      this.logDir = options.logDir;
      this.stateFilePath = options.stateFilePath;
      return;
    }

    const config = getAppConfig();
    this.logDir = options.logDir ?? path.join(config.workspaceRoot, ".runlogs");
    this.stateFilePath = options.stateFilePath ?? path.join(config.dataDir, "logs", "ops-log-scan-state.json");
  }

  async scanRecentErrors(): Promise<OpsLogScanIncidentCandidate[]> {
    const files = await this.listManagedErrLogs();
    const state = await this.readState();
    let stateChanged = false;

    const activeFiles = new Set(files.map((filePath) => path.resolve(filePath)));
    for (const filePath of Object.keys(state.files)) {
      if (activeFiles.has(filePath)) {
        continue;
      }

      delete state.files[filePath];
      stateChanged = true;
    }

    const incidents: OpsLogScanIncidentCandidate[] = [];

    for (const filePath of files) {
      const resolvedPath = path.resolve(filePath);
      const stats = await safeStat(filePath);
      if (!stats?.isFile()) {
        continue;
      }

      const previous = state.files[resolvedPath];
      if (!previous) {
        state.files[resolvedPath] = buildCursorState(stats, stats.size);
        stateChanged = true;
        continue;
      }

      const startOffsetBytes = stats.size < previous.offsetBytes ? 0 : previous.offsetBytes;
      state.files[resolvedPath] = buildCursorState(stats, stats.size);
      stateChanged = true;

      if (stats.size <= startOffsetBytes) {
        continue;
      }

      const content = await readUtf8Slice(filePath, startOffsetBytes, stats.size - startOffsetBytes);
      const matchedLines = collectActionableLogLines(content);
      if (!matchedLines.length) {
        continue;
      }

      incidents.push({
        source: "log_scan",
        severity: "high",
        serviceName: path.basename(filePath).replace(/\.err\.log$/i, ""),
        failureType: "recent_log_error",
        title: `Recent error lines detected in ${path.basename(filePath)}`,
        rawErrorExcerpt: matchedLines.join("\n"),
        fingerprintKey: buildStableIncidentFingerprintText(matchedLines.join("\n")),
        evidence: {
          filePath,
          lastModifiedAt: stats.mtime.toISOString(),
          matchedLines: matchedLines.length,
          startOffsetBytes,
          endOffsetBytes: stats.size
        }
      });
    }

    if (stateChanged) {
      await this.writeState(state);
    }

    return incidents;
  }

  private async listManagedErrLogs() {
    try {
      const entries = await fs.promises.readdir(this.logDir, {
        withFileTypes: true
      });

      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".err.log"))
        .map((entry) => path.join(this.logDir, entry.name))
        .sort();
    } catch {
      return [];
    }
  }

  private async readState(): Promise<OpsLogScanState> {
    try {
      const raw = await fs.promises.readFile(this.stateFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<OpsLogScanState>;
      const files = parsed.files && typeof parsed.files === "object" ? parsed.files : {};

      return {
        files: Object.fromEntries(
          Object.entries(files).map(([filePath, state]) => [
            filePath,
            normalizeCursorState(state as Partial<OpsLogScanCursorState>)
          ])
        )
      };
    } catch {
      return {
        files: {}
      };
    }
  }

  private async writeState(state: OpsLogScanState) {
    await fs.promises.mkdir(path.dirname(this.stateFilePath), {
      recursive: true
    });
    await fs.promises.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
  }
}

export function collectActionableLogLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => isActionableLogLine(line))
    .slice(-8);
}

export function isActionableLogLine(line: string) {
  const normalizedLine = normalizeIncidentFingerprintLine(line);
  if (!normalizedLine) {
    return false;
  }

  if (isIncidentFingerprintNoiseLine(normalizedLine)) {
    return false;
  }

  if (LOG_SCAN_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(normalizedLine))) {
    return false;
  }

  return LOG_SCAN_ERROR_PATTERN.test(normalizedLine);
}

function buildCursorState(stats: fs.Stats, offsetBytes: number): OpsLogScanCursorState {
  return {
    offsetBytes,
    fileSizeBytes: stats.size,
    lastModifiedAt: stats.mtime.toISOString(),
    initializedAt: new Date().toISOString()
  };
}

function normalizeCursorState(state: Partial<OpsLogScanCursorState>): OpsLogScanCursorState {
  return {
    offsetBytes: Number.isFinite(state.offsetBytes) ? Math.max(0, Number(state.offsetBytes)) : 0,
    fileSizeBytes: Number.isFinite(state.fileSizeBytes) ? Math.max(0, Number(state.fileSizeBytes)) : 0,
    lastModifiedAt: typeof state.lastModifiedAt === "string" ? state.lastModifiedAt : null,
    initializedAt: typeof state.initializedAt === "string" ? state.initializedAt : null
  };
}

async function readUtf8Slice(filePath: string, start: number, length: number) {
  if (length <= 0) {
    return "";
  }

  const handle = await fs.promises.open(filePath, "r");
  const buffer = Buffer.alloc(length);

  try {
    let totalBytesRead = 0;

    while (totalBytesRead < length) {
      const { bytesRead } = await handle.read(buffer, totalBytesRead, length - totalBytesRead, start + totalBytesRead);
      if (bytesRead <= 0) {
        break;
      }

      totalBytesRead += bytesRead;
    }

    return buffer.subarray(0, totalBytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function safeStat(filePath: string) {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}
