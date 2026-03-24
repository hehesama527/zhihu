import type { PromptSetName, PromptSnapshotMap } from "@zhihu-mvp/shared";
import { createOpenAiClient, readLlmRuntimeConfig } from "../config/llm-provider.js";
import { getDefaultPromptSeed } from "../prompts/default-prompts.js";
import { PromptRepository } from "../repositories/prompt-repository.js";
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

  async resolvePrompt(promptSetName: PromptSetName, options?: PromptRunOptions) {
    const snapshotPrompt = options?.promptSnapshot?.[promptSetName];
    if (snapshotPrompt?.content) {
      return snapshotPrompt.content;
    }

    const activePrompt = await this.promptRepository.getActivePromptContent(promptSetName);
    return activePrompt ?? getDefaultPromptSeed(promptSetName)?.content ?? "";
  }

  async runPrompt(promptSetName: PromptSetName, input: unknown, options?: PromptRunOptions) {
    const prompt = await this.resolvePrompt(promptSetName, options);
    const timeoutMs = getPromptTimeoutMs(promptSetName);
    return this.runSystemPrompt(prompt, input, timeoutMs, `${promptSetName} returned empty response text.`);
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
    const responseText = await this.runSystemPrompt(
      systemPrompt,
      input,
      timeoutMs,
      "custom system prompt returned empty response text."
    );
    return safeParseJson(responseText, fallback);
  }
}

function getPromptTimeoutMs(promptSetName: PromptSetName) {
  if (promptSetName === "writer_agent") {
    return WRITER_LLM_REQUEST_TIMEOUT_MS;
  }

  return DEFAULT_LLM_REQUEST_TIMEOUT_MS;
}
