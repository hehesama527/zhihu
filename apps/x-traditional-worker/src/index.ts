import {
  getXTraditionalAppConfig,
  XTraditionalLlmService,
  XTraditionalPromptService,
  XTraditionalWorkerRunner,
  XTraditionalWorkspaceRepository
} from "@zhihu-mvp/x-traditional-core";

const config = getXTraditionalAppConfig();
const repository = new XTraditionalWorkspaceRepository();
const llmService = new XTraditionalLlmService();
const promptService = new XTraditionalPromptService(llmService);
const runner = XTraditionalWorkerRunner.createDefault();

let timer: NodeJS.Timeout | null = null;
let stopped = false;

async function boot() {
  await repository.ensureReady();
  await promptService.bootstrapDefaults();

  const loop = async () => {
    if (stopped) {
      return;
    }

    try {
      const summary = await runner.tick();
      console.log("[x-traditional-worker] tick", JSON.stringify(summary));
    } catch (error) {
      console.error("[x-traditional-worker] tick failed", error);
    } finally {
      if (!stopped) {
        timer = setTimeout(loop, config.workerIntervalMs);
      }
    }
  };

  await loop();
}

async function shutdown() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
  }
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

await boot();
