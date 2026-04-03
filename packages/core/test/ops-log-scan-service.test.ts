import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildStableIncidentFingerprintText } from "../src/services/ops-diagnosis-service.ts";
import { OpsLogScanService } from "../src/services/ops-log-scan-service.ts";

function createTestSetup() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-log-scan-"));
  const logDir = path.join(rootDir, ".runlogs");
  const stateFilePath = path.join(rootDir, "data", "logs", "ops-log-scan-state.json");

  fs.mkdirSync(logDir, { recursive: true });

  return {
    rootDir,
    logDir,
    stateFilePath,
    service: new OpsLogScanService({
      logDir,
      stateFilePath
    })
  };
}

test("does not backfill existing err log content on first scan", async (t) => {
  const setup = createTestSetup();
  t.after(() => {
    fs.rmSync(setup.rootDir, { recursive: true, force: true });
  });

  const filePath = path.join(setup.logDir, "zhihu-api.err.log");
  fs.writeFileSync(
    filePath,
    [
      "2026-04-02T23:58:19: npm error Lifecycle script `start` failed with error:",
      "2026-04-02T23:58:29: npm error code 137"
    ].join("\n"),
    "utf8"
  );

  const incidents = await setup.service.scanRecentErrors();
  const state = JSON.parse(fs.readFileSync(setup.stateFilePath, "utf8")) as {
    files: Record<string, { offsetBytes: number }>;
  };

  assert.equal(incidents.length, 0);
  assert.equal(state.files[path.resolve(filePath)]?.offsetBytes, fs.statSync(filePath).size);
});

test("only reports newly appended actionable log lines and ignores later noise", async (t) => {
  const setup = createTestSetup();
  t.after(() => {
    fs.rmSync(setup.rootDir, { recursive: true, force: true });
  });

  const filePath = path.join(setup.logDir, "zhihu-worker.err.log");
  fs.writeFileSync(filePath, "", "utf8");

  await setup.service.scanRecentErrors();

  fs.appendFileSync(
    filePath,
    [
      "2026-04-03T00:00:00: npm error Lifecycle script `start` failed with error:",
      "2026-04-03T00:00:01: npm error code 137",
      "2026-04-03T00:00:01: npm error path /home/userroot/文档/claw/apps/worker",
      "2026-04-03T00:00:01: npm error workspace @zhihu-mvp/worker@0.1.2"
    ].join("\n") + "\n",
    "utf8"
  );

  const incidents = await setup.service.scanRecentErrors();
  assert.equal(incidents.length, 1);
  assert.match(incidents[0]?.rawErrorExcerpt ?? "", /lifecycle script/i);
  assert.match(incidents[0]?.rawErrorExcerpt ?? "", /code 137/i);
  assert.doesNotMatch(incidents[0]?.rawErrorExcerpt ?? "", /workspace/i);
  assert.doesNotMatch(incidents[0]?.rawErrorExcerpt ?? "", /npm error path/i);

  fs.appendFileSync(
    filePath,
    [
      "2026-04-03T00:00:02: (node:12345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.",
      "2026-04-03T00:00:02: (Use `node --trace-deprecation ...` to show where the warning was created)"
    ].join("\n") + "\n",
    "utf8"
  );

  const secondIncidents = await setup.service.scanRecentErrors();
  assert.equal(secondIncidents.length, 0);
});

test("after truncation, only new err log content is scanned", async (t) => {
  const setup = createTestSetup();
  t.after(() => {
    fs.rmSync(setup.rootDir, { recursive: true, force: true });
  });

  const filePath = path.join(setup.logDir, "zhihu-ops-agent.err.log");
  fs.writeFileSync(filePath, "", "utf8");

  await setup.service.scanRecentErrors();

  fs.appendFileSync(filePath, "2026-04-03T00:00:00: npm error code 137\n", "utf8");
  assert.equal((await setup.service.scanRecentErrors()).length, 1);

  fs.writeFileSync(filePath, "", "utf8");
  assert.equal((await setup.service.scanRecentErrors()).length, 0);

  fs.appendFileSync(filePath, "2026-04-03T00:05:00: unhandled exception: new failure\n", "utf8");
  const incidents = await setup.service.scanRecentErrors();

  assert.equal(incidents.length, 1);
  assert.match(incidents[0]?.rawErrorExcerpt ?? "", /new failure/i);
});

test("fingerprint text stays stable when only durations change", () => {
  const first = buildStableIncidentFingerprintText("zhihu-worker.out.log has not been updated for 2550 seconds.");
  const second = buildStableIncidentFingerprintText("zhihu-worker.out.log has not been updated for 2878 seconds.");

  assert.equal(first, second);
});
