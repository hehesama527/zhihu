import { modelCenterAgentNames, type ModelCenterAgentName, type PromptSnapshotMap } from "@zhihu-mvp/shared";
import {
  PromptRepository,
  createOpenAiClient,
  extractResponseText,
  getMysqlPool,
  parseJsonOrThrow,
  readLlmRuntimeConfig,
  safeParseJson,
  type LlmConfigTarget
} from "@zhihu-mvp/core";
import type { XAccount, XPromptSetName } from "../types.js";
import { getDefaultXPromptSeed } from "../prompts/x-default-prompts.js";
import { isAccountScopedPromptOwnedByAccount } from "../prompts/x-account-scoped-prompt-utils.js";
import { isAccountScopedXPromptSetName } from "../prompts/x-account-scoped-prompts.js";

export const X_PROMPT_SET_NAMES: XPromptSetName[] = [
  "x_main_agent",
  "x_hotspot_scout_agent",
  "x_writer_agent",
  "x_review_agent",
  "x_publish_agent"
];

export type XPromptRunOptions = {
  promptSnapshot?: PromptSnapshotMap | null;
  promptSuffix?: string | null;
  runtimeTarget?: XPromptSetName | "x" | (string & {});
};

export interface XJsonLlmService {
  getPromptSnapshotForAccount?(account?: Partial<XAccount> | null): Promise<PromptSnapshotMap>;
  runPrompt(systemPromptOrSetName: string, input: unknown, options?: XPromptRunOptions): Promise<string>;
  runJson<T>(systemPromptOrSetName: string, input: unknown, fallback: T, options?: XPromptRunOptions): Promise<T>;
}

export class XLlmService {
  private readonly promptRepository = new PromptRepository(getMysqlPool());

  async getActivePromptSnapshot(names = X_PROMPT_SET_NAMES) {
    const activeSnapshots = await this.promptRepository.getActivePromptSnapshots(names);

    for (const name of names) {
      if (!activeSnapshots[name]) {
        const seed = getDefaultXPromptSeed(name);
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

  async getPromptSnapshotForAccount(
    account?: Pick<
      XAccount,
      | "id"
      | "mainPromptVersionId"
      | "writerPromptVersionId"
      | "reviewPromptVersionId"
      | "publishPromptVersionId"
    > | null
  ) {
    const nonAccountScopedNames = X_PROMPT_SET_NAMES.filter((name) => !isAccountScopedXPromptSetName(name));
    const snapshots = await this.getActivePromptSnapshot(nonAccountScopedNames);
    const bindings: Array<{ name: XPromptSetName; versionId: number | null | undefined }> = [
      { name: "x_main_agent", versionId: account?.mainPromptVersionId },
      { name: "x_hotspot_scout_agent", versionId: null },
      { name: "x_writer_agent", versionId: account?.writerPromptVersionId },
      { name: "x_review_agent", versionId: account?.reviewPromptVersionId },
      { name: "x_publish_agent", versionId: account?.publishPromptVersionId }
    ];

    for (const binding of bindings) {
      if (!binding.versionId) {
        if (isAccountScopedXPromptSetName(binding.name)) {
          throw new Error(`Account-scoped prompt binding missing for ${binding.name}.`);
        }
        continue;
      }

      const version = await this.promptRepository.getPromptVersionById(binding.versionId);
      if (!version || version.set_name !== binding.name) {
        if (isAccountScopedXPromptSetName(binding.name)) {
          throw new Error(`Account-scoped prompt binding is invalid for ${binding.name}.`);
        }
        continue;
      }

      if (isAccountScopedXPromptSetName(binding.name)) {
        const category = binding.name === "x_main_agent" ? "main" : "writing";
        if (!account?.id || !isAccountScopedPromptOwnedByAccount(version.notes, category, account.id)) {
          throw new Error(`Account-scoped prompt binding is not owned by this account for ${binding.name}.`);
        }
      }

      snapshots[binding.name] = {
        promptSetName: binding.name,
        promptVersionId: version.id,
        version: version.version,
        label: version.label,
        content: version.content
      };
    }

    return snapshots;
  }

  async resolvePrompt(promptSetName: XPromptSetName, options?: XPromptRunOptions) {
    const snapshotPrompt = options?.promptSnapshot?.[promptSetName];
    if (snapshotPrompt?.content) {
      return appendPromptSuffix(snapshotPrompt.content, options?.promptSuffix);
    }

    if (isAccountScopedXPromptSetName(promptSetName)) {
      throw new Error(`Prompt ${promptSetName} must be resolved from an account-scoped prompt snapshot.`);
    }

    const basePrompt =
      (await this.promptRepository.getActivePromptContent(promptSetName)) ??
      getDefaultXPromptSeed(promptSetName)?.content ??
      "";

    return appendPromptSuffix(basePrompt, options?.promptSuffix);
  }

  async runPrompt(systemPromptOrSetName: string, input: unknown, options?: XPromptRunOptions) {
    const runtimeTarget =
      options?.runtimeTarget ?? (isXPromptSetName(systemPromptOrSetName) ? systemPromptOrSetName : "x");
    const runtimeConfigTarget = resolveXRuntimeConfigTarget(runtimeTarget);
    const client = createOpenAiClient(runtimeConfigTarget);
    const runtime = readLlmRuntimeConfig(runtimeConfigTarget);
    const requestTimeoutMs = Math.min(runtime.requestTimeoutMs, X_LLM_MAX_REQUEST_TIMEOUT_MS);
    const payload = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    const systemPrompt = isXPromptSetName(systemPromptOrSetName)
      ? await this.resolvePrompt(systemPromptOrSetName, options)
      : systemPromptOrSetName;

    // 429 重试机制：最多重试 5 次，指数退避
    const maxRetries = 5;
    const baseDelayMs = 5000; // 5 秒基础延迟
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response =
          runtime.wireApi === "chat_completions"
            ? await client.chat.completions.create(
                {
                  model: runtime.model,
                  messages: [
                    {
                      role: "system",
                      content: systemPrompt
                    },
                    {
                      role: "user",
                      content: payload
                    }
                  ]
                },
                {
                  timeout: requestTimeoutMs
                }
              )
            : await client.responses.create(
                {
                  model: runtime.model,
                  reasoning: {
                    effort: runtime.reasoningEffort
                  },
                  input: [
                    {
                      role: "system",
                      content: systemPrompt
                    },
                    {
                      role: "user",
                      content: payload
                    }
                  ]
                },
                {
                  timeout: requestTimeoutMs
                }
              );

        const text = extractResponseText(response).trim();
        if (!text) {
          throw new Error("X LLM request returned empty response text.");
        }

        return text;
      } catch (error: any) {
        const isRateLimitError = error?.status === 429 || error?.error?.code === 429;
        
        if (isRateLimitError && attempt < maxRetries) {
          // 指数退避：3s, 6s, 12s
          const delayMs = baseDelayMs * Math.pow(2, attempt);
          console.log(`[x-llm] 429 rate limit hit, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
          await this.sleep(delayMs);
          continue;
        }
        
        // 不是 429 错误，或者已经是最后一次重试
        throw error;
      }
    }

    throw new Error("X LLM request failed after all retries.");
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async runJson<T>(systemPromptOrSetName: string, input: unknown, fallback: T, options?: XPromptRunOptions) {
    const runtimeTarget =
      options?.runtimeTarget ?? (isXPromptSetName(systemPromptOrSetName) ? systemPromptOrSetName : "x");
    const systemPrompt = await this.resolveJsonPrompt(systemPromptOrSetName, options);
    const retrySystemPrompt = appendPromptSuffix(systemPrompt, JSON_RETRY_RUNTIME_SUFFIX);
    let lastResponseText = "";

    for (const prompt of [systemPrompt, retrySystemPrompt]) {
      const responseText = await this.runPrompt(prompt, input, {
        runtimeTarget
      });
      lastResponseText = responseText;
      const directParsed = tryParseJsonResponse<T>(responseText);
      if (directParsed !== null) {
        return directParsed;
      }

      const repairedResponseText = await this.repairJsonResponse(prompt, responseText, fallback, runtimeTarget);
      const repairedParsed = repairedResponseText ? tryParseJsonResponse<T>(repairedResponseText) : null;
      if (repairedParsed !== null) {
        return repairedParsed;
      }
    }

    return safeParseJson(lastResponseText, fallback);
  }

  private async resolveJsonPrompt(systemPromptOrSetName: string, options?: XPromptRunOptions) {
    const basePrompt = isXPromptSetName(systemPromptOrSetName)
      ? await this.resolvePrompt(systemPromptOrSetName, options)
      : appendPromptSuffix(systemPromptOrSetName, options?.promptSuffix);

    return appendPromptSuffix(basePrompt, JSON_OUTPUT_RUNTIME_SUFFIX);
  }

  private async repairJsonResponse<T>(
    systemPrompt: string,
    brokenResponseText: string,
    fallback: T,
    runtimeTarget: XPromptRunOptions["runtimeTarget"]
  ) {
    const normalizedBrokenResponse = brokenResponseText.trim();
    if (!normalizedBrokenResponse) {
      return null;
    }

    const runtimeConfigTarget = resolveXRuntimeConfigTarget(runtimeTarget);
    const client = createOpenAiClient(runtimeConfigTarget);
    const runtime = readLlmRuntimeConfig(runtimeConfigTarget);
    const requestTimeoutMs = Math.min(runtime.requestTimeoutMs, X_LLM_MAX_REQUEST_TIMEOUT_MS);
    const response =
      runtime.wireApi === "chat_completions"
        ? await client.chat.completions.create(
            {
              model: runtime.model,
              messages: [
                {
                  role: "system",
                  content: JSON_REPAIR_SYSTEM_PROMPT
                },
                {
                  role: "user",
                  content: JSON.stringify(
                    {
                      originalSystemPrompt: systemPrompt,
                      malformedResponse: normalizedBrokenResponse,
                      schemaExample: fallback
                    },
                    null,
                    2
                  )
                }
              ]
            },
            {
              timeout: requestTimeoutMs
            }
          )
        : await client.responses.create(
            {
              model: runtime.model,
              reasoning: {
                effort: "low"
              },
              input: [
                {
                  role: "system",
                  content: JSON_REPAIR_SYSTEM_PROMPT
                },
                {
                  role: "user",
                  content: JSON.stringify(
                    {
                      originalSystemPrompt: systemPrompt,
                      malformedResponse: normalizedBrokenResponse,
                      schemaExample: fallback
                    },
                    null,
                    2
                  )
                }
              ]
            },
            {
              timeout: requestTimeoutMs
            }
          );

    return extractResponseText(response).trim() || null;
  }
}

function appendPromptSuffix(basePrompt: string, promptSuffix?: string | null) {
  const suffix = promptSuffix?.trim();
  if (!suffix) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${suffix}`;
}

function isXPromptSetName(value: string): value is XPromptSetName {
  return X_PROMPT_SET_NAMES.includes(value as XPromptSetName);
}

function resolveXRuntimeConfigTarget(value: XPromptRunOptions["runtimeTarget"]): LlmConfigTarget {
  if (value === "x") {
    return "x";
  }
  if (typeof value === "string" && isModelCenterAgentName(value)) {
    return value;
  }
  return "x";
}

function isModelCenterAgentName(value: string): value is ModelCenterAgentName {
  return modelCenterAgentNames.includes(value as ModelCenterAgentName);
}

function tryParseJsonResponse<T>(value: string): T | null {
  for (const candidate of buildJsonCandidates(value)) {
    try {
      return parseJsonOrThrow<T>(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function buildJsonCandidates(value: string) {
  const trimmed = value.trim();
  const candidates = [trimmed];
  const objectCandidate = sliceJsonEnvelope(trimmed, "{", "}");
  const arrayCandidate = sliceJsonEnvelope(trimmed, "[", "]");

  if (objectCandidate) {
    candidates.push(objectCandidate);
  }
  if (arrayCandidate) {
    candidates.push(arrayCandidate);
  }

  return Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean)));
}

function sliceJsonEnvelope(value: string, openChar: "{" | "[", closeChar: "}" | "]") {
  const start = value.indexOf(openChar);
  const end = value.lastIndexOf(closeChar);
  if (start < 0 || end <= start) {
    return null;
  }

  return value.slice(start, end + 1);
}

const JSON_OUTPUT_RUNTIME_SUFFIX = [
  "JSON output hard requirement:",
  "1. Return exactly one valid JSON object or JSON array.",
  "2. Do not add any explanation before or after the JSON.",
  "3. Do not wrap the JSON in markdown fences.",
  "4. Ensure all strings are properly escaped and all arrays/objects are syntactically closed."
].join("\n");

const JSON_RETRY_RUNTIME_SUFFIX = [
  "Retry correction:",
  "1. The previous attempt failed JSON validation.",
  "2. This retry must return valid JSON on the first pass.",
  "3. Do not omit required fields, and do not leave arrays or objects empty unless the task truly has no content.",
  "4. Return JSON only, with no prose before or after it."
].join("\n");

const X_LLM_MAX_REQUEST_TIMEOUT_MS = 10 * 60_000;

const JSON_REPAIR_SYSTEM_PROMPT = [
  "You repair malformed JSON produced by an internal content agent.",
  "Your task:",
  "1. Return valid JSON only.",
  "2. Preserve the original meaning as much as possible.",
  "3. Do not add new facts, new claims, or new fields unless the schema example already contains them.",
  "4. Match the schema example's field names and value shapes.",
  "5. If a field cannot be recovered safely, use the schema example's empty/default shape for that field.",
  "6. Do not wrap the JSON in markdown fences."
].join("\n");
