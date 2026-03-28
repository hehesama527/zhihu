import type { PromptSetName, PromptSnapshotMap } from "@zhihu-mvp/shared";
import { createOpenAiClient, readLlmRuntimeConfig } from "../config/llm-provider.js";
import { getDefaultPromptSeed } from "../prompts/default-prompts.js";
import { PromptRepository } from "../repositories/prompt-repository.js";
import { getElapsedMs, logDebugTiming } from "../utils/debug-timing.js";
import { extractResponseText, safeParseJson } from "../utils/json.js";
import { createLlmTextResponse } from "../utils/llm-text.js";

const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 120_000;
const WRITER_LLM_REQUEST_TIMEOUT_MS = 600_000;

export const ALL_PROMPT_SET_NAMES: PromptSetName[] = [
  "topic_agent",
  "writer_agent",
  "review_agent",
  "publish_agent"
];

type PromptRunOptions = {
  promptSnapshot?: PromptSnapshotMap | null;
  promptSuffix?: string | null;
};

type PromptSnapshotBindingOptions = {
  names?: PromptSetName[];
  writerPromptVersionId?: number | null;
};

export class LlmService {
  constructor(private readonly promptRepository: PromptRepository) {}

  async getActivePromptSnapshot(names = ALL_PROMPT_SET_NAMES) {
    const activeSnapshots = await this.promptRepository.getActivePromptSnapshots(names);

    for (const name of names) {
      if (!activeSnapshots[name]) {
        const seed = getDefaultPromptSeed(name);
        if (!seed) {
          continue;
        }
        activeSnapshots[name] = {
          promptSetName: name,
          promptVersionId: null,
          version: null,
          label: seed.label,
          content: seed.content
        };
      }
    }

    return activeSnapshots;
  }

  async getPromptSnapshotForAccount(options?: PromptSnapshotBindingOptions) {
    const names = options?.names ?? ALL_PROMPT_SET_NAMES;
    const activeSnapshots = await this.getActivePromptSnapshot(names);
    const writerPromptVersionId = options?.writerPromptVersionId ?? null;

    if (!writerPromptVersionId || !names.includes("writer_agent")) {
      return activeSnapshots;
    }

    const writerSnapshot = await this.promptRepository.getPromptVersionSnapshotById(writerPromptVersionId);
    if (writerSnapshot?.promptSetName === "writer_agent") {
      activeSnapshots.writer_agent = writerSnapshot;
    }

    return activeSnapshots;
  }

  async resolvePrompt(promptSetName: PromptSetName, options?: PromptRunOptions) {
    const snapshotPrompt = options?.promptSnapshot?.[promptSetName];
    const basePrompt =
      snapshotPrompt?.content ??
      (await this.promptRepository.getActivePromptContent(promptSetName)) ??
      getDefaultPromptSeed(promptSetName)?.content ??
      "";

    const promptSuffix = options?.promptSuffix?.trim();
    if (promptSuffix) {
      return `${basePrompt}\n\n${promptSuffix}`;
    }

    return basePrompt;
  }

  async runPrompt(promptSetName: PromptSetName, input: unknown, options?: PromptRunOptions) {
    const startedAt = Date.now();
    const prompt = await this.resolvePrompt(promptSetName, options);
    const timeoutMs = getPromptTimeoutMs(promptSetName);
    logDebugTiming("llm.runPrompt", "start", {
      promptSetName,
      timeoutMs
    });

    try {
      const responseText = await this.runSystemPrompt(
        prompt,
        input,
        timeoutMs,
        `${promptSetName} returned empty response text.`
      );
      logDebugTiming("llm.runPrompt", "done", {
        promptSetName,
        timeoutMs,
        elapsedMs: getElapsedMs(startedAt),
        outputLength: responseText.length
      });
      return responseText;
    } catch (error) {
      logDebugTiming("llm.runPrompt", "failed", {
        promptSetName,
        timeoutMs,
        elapsedMs: getElapsedMs(startedAt),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async runJson<T>(promptSetName: PromptSetName, input: unknown, fallback: T, options?: PromptRunOptions) {
    const responseText = await this.runPrompt(promptSetName, input, options);
    return safeParseJson(responseText, fallback);
  }

  async runSystemPrompt(systemPrompt: string, input: unknown, timeoutMs = DEFAULT_LLM_REQUEST_TIMEOUT_MS, emptyMessage?: string) {
    const client = createOpenAiClient();
    const runtime = readLlmRuntimeConfig();

    const response = await createLlmTextResponse(
      client,
      runtime,
      [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: typeof input === "string" ? input : JSON.stringify(input, null, 2)
        }
      ],
      {
        initialResponseTimeoutMs: timeoutMs
      }
    );

    const outputText = extractResponseText(response);
    if (!outputText.trim()) {
      throw new Error(emptyMessage ?? "custom system prompt returned empty response text.");
    }

    return outputText.trim();
  }

  async runJsonWithSystemPrompt<T>(
    systemPrompt: string,
    input: unknown,
    fallback: T,
    timeoutMs = DEFAULT_LLM_REQUEST_TIMEOUT_MS
  ) {
    const startedAt = Date.now();
    logDebugTiming("llm.runJsonWithSystemPrompt", "start", {
      timeoutMs
    });

    try {
      const responseText = await this.runSystemPrompt(
        systemPrompt,
        input,
        timeoutMs,
        "custom system prompt returned empty response text."
      );
      logDebugTiming("llm.runJsonWithSystemPrompt", "done", {
        timeoutMs,
        elapsedMs: getElapsedMs(startedAt),
        outputLength: responseText.length
      });
      return safeParseJson(responseText, fallback);
    } catch (error) {
      logDebugTiming("llm.runJsonWithSystemPrompt", "failed", {
        timeoutMs,
        elapsedMs: getElapsedMs(startedAt),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

function getPromptTimeoutMs(promptSetName: PromptSetName) {
  if (promptSetName === "writer_agent") {
    return WRITER_LLM_REQUEST_TIMEOUT_MS;
  }

  return DEFAULT_LLM_REQUEST_TIMEOUT_MS;
}
