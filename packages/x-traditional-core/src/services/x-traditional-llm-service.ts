import type { PromptSnapshotMap } from "@zhihu-mvp/shared";
import {
  PromptRepository,
  createOpenAiClient,
  extractResponseText,
  getMysqlPool,
  parseJsonOrThrow,
  readLlmRuntimeConfig,
  safeParseJson
} from "@zhihu-mvp/core";
import type { XJsonLlmService, XPromptRunOptions } from "@zhihu-mvp/x-core";
import {
  getDefaultXTraditionalPromptSeed,
  xTraditionalDefaultPromptSeeds
} from "../prompts/x-traditional-default-prompts.js";
import type { XTraditionalPromptSetName } from "../types.js";

export const X_TRADITIONAL_PROMPT_SET_NAMES: XTraditionalPromptSetName[] = [
  "x_traditional_main_agent",
  "x_traditional_writer_agent",
  "x_traditional_review_agent",
  "x_traditional_publish_agent",
  "x_traditional_note_agent"
];

export class XTraditionalLlmService implements XJsonLlmService {
  private readonly promptRepository = new PromptRepository(getMysqlPool());

  async getActivePromptSnapshot(names = X_TRADITIONAL_PROMPT_SET_NAMES): Promise<PromptSnapshotMap> {
    const activeSnapshots = await this.promptRepository.getActivePromptSnapshots(names);

    for (const name of names) {
      if (!activeSnapshots[name]) {
        const seed = getDefaultXTraditionalPromptSeed(name);
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

  async getPromptSnapshotForAccount() {
    return this.getActivePromptSnapshot();
  }

  async resolvePrompt(promptSetName: XTraditionalPromptSetName, options?: XPromptRunOptions) {
    const snapshotPrompt = options?.promptSnapshot?.[promptSetName];
    if (snapshotPrompt?.content) {
      return appendPromptSuffix(snapshotPrompt.content, options?.promptSuffix);
    }

    const basePrompt =
      (await this.promptRepository.getActivePromptContent(promptSetName)) ??
      getDefaultXTraditionalPromptSeed(promptSetName)?.content ??
      "";

    return appendPromptSuffix(basePrompt, options?.promptSuffix);
  }

  async runPrompt(systemPromptOrSetName: string, input: unknown, options?: XPromptRunOptions) {
    const runtimeTarget = "x";
    const client = createOpenAiClient(runtimeTarget);
    const runtime = readLlmRuntimeConfig(runtimeTarget);
    const requestTimeoutMs = Math.min(runtime.requestTimeoutMs, X_TRADITIONAL_LLM_MAX_REQUEST_TIMEOUT_MS);
    const payload = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    const systemPrompt = isXTraditionalPromptSetName(systemPromptOrSetName)
      ? await this.resolvePrompt(systemPromptOrSetName, options)
      : systemPromptOrSetName;

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
      throw new Error("X traditional LLM request returned empty response text.");
    }

    return text;
  }

  async runJson<T>(systemPromptOrSetName: string, input: unknown, fallback: T, options?: XPromptRunOptions) {
    const systemPrompt = await this.resolveJsonPrompt(systemPromptOrSetName, options);
    const retrySystemPrompt = appendPromptSuffix(systemPrompt, JSON_RETRY_RUNTIME_SUFFIX);
    let lastResponseText = "";

    for (const prompt of [systemPrompt, retrySystemPrompt]) {
      const responseText = await this.runPrompt(prompt, input, {
        runtimeTarget: "x"
      });
      lastResponseText = responseText;
      const directParsed = tryParseJsonResponse<T>(responseText);
      if (directParsed !== null) {
        return directParsed;
      }

      const repairedResponseText = await this.repairJsonResponse(prompt, responseText, fallback);
      const repairedParsed = repairedResponseText ? tryParseJsonResponse<T>(repairedResponseText) : null;
      if (repairedParsed !== null) {
        return repairedParsed;
      }
    }

    return safeParseJson(lastResponseText, fallback);
  }

  private async resolveJsonPrompt(systemPromptOrSetName: string, options?: XPromptRunOptions) {
    const basePrompt = isXTraditionalPromptSetName(systemPromptOrSetName)
      ? await this.resolvePrompt(systemPromptOrSetName, options)
      : appendPromptSuffix(systemPromptOrSetName, options?.promptSuffix);

    return appendPromptSuffix(basePrompt, JSON_OUTPUT_RUNTIME_SUFFIX);
  }

  private async repairJsonResponse<T>(systemPrompt: string, brokenResponseText: string, fallback: T) {
    const normalizedBrokenResponse = brokenResponseText.trim();
    if (!normalizedBrokenResponse) {
      return null;
    }

    const runtimeTarget = "x";
    const client = createOpenAiClient(runtimeTarget);
    const runtime = readLlmRuntimeConfig(runtimeTarget);
    const requestTimeoutMs = Math.min(runtime.requestTimeoutMs, X_TRADITIONAL_LLM_MAX_REQUEST_TIMEOUT_MS);
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

export function isXTraditionalPromptSetName(value: string): value is XTraditionalPromptSetName {
  return X_TRADITIONAL_PROMPT_SET_NAMES.includes(value as XTraditionalPromptSetName);
}

export function listXTraditionalPromptSeeds() {
  return xTraditionalDefaultPromptSeeds;
}

function appendPromptSuffix(basePrompt: string, promptSuffix?: string | null) {
  const suffix = promptSuffix?.trim();
  if (!suffix) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${suffix}`;
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

const X_TRADITIONAL_LLM_MAX_REQUEST_TIMEOUT_MS = 10 * 60_000;
