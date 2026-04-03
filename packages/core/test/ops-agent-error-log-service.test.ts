import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpsAgentErrorLogService } from "../src/services/ops-agent-error-log-service.ts";

function createTestFiles() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-agent-error-log-"));
  const logFilePath = path.join(rootDir, "zhihu-ops-agent.error.log");
  const stateFilePath = path.join(rootDir, "zhihu-ops-agent.error-log-state.json");

  return {
    rootDir,
    logFilePath,
    stateFilePath,
    service: new OpsAgentErrorLogService({
      logFilePath,
      stateFilePath,
      timezone: "UTC"
    })
  };
}

test("does not clear an existing current-month log on first initialization", async (t) => {
  const setup = createTestFiles();
  t.after(() => {
    fs.rmSync(setup.rootDir, { recursive: true, force: true });
  });

  fs.writeFileSync(setup.logFilePath, "existing-april-entry\n", "utf8");
  fs.utimesSync(setup.logFilePath, new Date("2026-04-02T12:00:00.000Z"), new Date("2026-04-02T12:00:00.000Z"));

  const result = await setup.service.runMonthlyCleanupIfNeeded(new Date("2026-04-03T00:00:00.000Z"));
  const content = fs.readFileSync(setup.logFilePath, "utf8");
  const state = JSON.parse(fs.readFileSync(setup.stateFilePath, "utf8")) as {
    lastCleanupMonth: string;
  };

  assert.equal(result.ran, false);
  assert.equal(content, "existing-april-entry\n");
  assert.equal(state.lastCleanupMonth, "2026-04");
});

test("clears the old month log before appending a new error entry", async (t) => {
  const setup = createTestFiles();
  t.after(() => {
    fs.rmSync(setup.rootDir, { recursive: true, force: true });
  });

  fs.writeFileSync(setup.logFilePath, "stale-march-entry\n", "utf8");
  fs.writeFileSync(
    setup.stateFilePath,
    JSON.stringify(
      {
        lastCleanupAt: "2026-03-03T00:00:00.000Z",
        lastCleanupMonth: "2026-03"
      },
      null,
      2
    ),
    "utf8"
  );

  await setup.service.recordError({
    source: "scan",
    error: new Error("April failure"),
    context: {
      action: "scan"
    },
    occurredAt: new Date("2026-04-03T00:00:00.000Z")
  });

  const lines = fs
    .readFileSync(setup.logFilePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const state = JSON.parse(fs.readFileSync(setup.stateFilePath, "utf8")) as {
    lastCleanupMonth: string;
  };
  const entry = JSON.parse(lines[0] ?? "{}") as {
    source?: string;
    errorMessage?: string | null;
    context?: { action?: string };
  };

  assert.equal(lines.length, 1);
  assert.equal(entry.source, "scan");
  assert.equal(entry.errorMessage, "April failure");
  assert.equal(entry.context?.action, "scan");
  assert.equal(state.lastCleanupMonth, "2026-04");
});
