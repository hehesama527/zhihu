import type { OpenAI } from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import type { LlmRuntimeConfig } from "../config/llm-provider.js";

export type LlmTextMessage = {
  role: "system" | "user";
  content: string;
};

export type LlmTextRequestOptions = {
  initialResponseTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
};

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 180_000;
const STREAM_FALLBACK_HINT = /(stream|sse|event-stream|unsupported|not support|invalid parameter|unknown parameter)/i;

export async function createLlmTextResponse(
  client: OpenAI,
  runtime: LlmRuntimeConfig,
  messages: LlmTextMessage[],
  options?: LlmTextRequestOptions
): Promise<unknown> {
  const initialResponseTimeoutMs = normalizeTimeout(options?.initialResponseTimeoutMs, 120_000);
  const streamIdleTimeoutMs = normalizeTimeout(options?.streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS);

  if (runtime.wireApi === "chat_completions") {
    try {
      return await createStreamingChatCompletionText(client, runtime, messages, {
        initialResponseTimeoutMs,
        streamIdleTimeoutMs
      });
    } catch (error) {
      if (!shouldFallbackToNonStreaming(error)) {
        throw error;
      }

      return client.chat.completions.create(
        {
          model: runtime.model,
          messages
        },
        {
          timeout: runtime.requestTimeoutMs
        }
      );
    }
  }

  try {
    return await createStreamingResponsesText(client, runtime, messages, {
      initialResponseTimeoutMs,
      streamIdleTimeoutMs
    });
  } catch (error) {
    if (!shouldFallbackToNonStreaming(error)) {
      throw error;
    }

    return client.responses.create(
      {
        model: runtime.model,
        reasoning: { effort: runtime.reasoningEffort },
        input: messages
      },
      {
        timeout: runtime.requestTimeoutMs
      }
    );
  }
}

async function createStreamingChatCompletionText(
  client: OpenAI,
  runtime: LlmRuntimeConfig,
  messages: LlmTextMessage[],
  options: Required<LlmTextRequestOptions>
) {
  const controller = new AbortController();
  const stream = await client.chat.completions.create(
    {
      model: runtime.model,
      messages,
      stream: true
    },
    {
      signal: controller.signal,
      timeout: runtime.requestTimeoutMs
    }
  );

  const iterator = stream[Symbol.asyncIterator]();
  let sawChunk = false;
  let text = "";

  while (true) {
    const chunk = await readNextStreamValue(iterator, controller, {
      timeoutMs: sawChunk ? options.streamIdleTimeoutMs : options.initialResponseTimeoutMs,
      message: sawChunk
        ? `LLM stream idle for ${sawChunk ? options.streamIdleTimeoutMs : options.initialResponseTimeoutMs}ms`
        : `LLM did not return the first stream chunk within ${options.initialResponseTimeoutMs}ms`
    });

    if (chunk.done) {
      break;
    }

    sawChunk = true;
    text += extractChatCompletionChunkText(chunk.value);
  }

  if (!sawChunk) {
    throw new Error("LLM returned an empty stream.");
  }

  return text;
}

async function createStreamingResponsesText(
  client: OpenAI,
  runtime: LlmRuntimeConfig,
  messages: LlmTextMessage[],
  options: Required<LlmTextRequestOptions>
) {
  const controller = new AbortController();
  const stream = await client.responses.create(
    {
      model: runtime.model,
      reasoning: { effort: runtime.reasoningEffort },
      input: messages,
      stream: true
    },
    {
      signal: controller.signal,
      timeout: runtime.requestTimeoutMs
    }
  );

  const iterator = stream[Symbol.asyncIterator]();
  let sawChunk = false;
  let sawTextDelta = false;
  let text = "";

  while (true) {
    const event = await readNextStreamValue(iterator, controller, {
      timeoutMs: sawChunk ? options.streamIdleTimeoutMs : options.initialResponseTimeoutMs,
      message: sawChunk
        ? `LLM stream idle for ${sawChunk ? options.streamIdleTimeoutMs : options.initialResponseTimeoutMs}ms`
        : `LLM did not return the first stream chunk within ${options.initialResponseTimeoutMs}ms`
    });

    if (event.done) {
      break;
    }

    sawChunk = true;
    const extracted = extractResponsesStreamEventText(event.value, sawTextDelta);
    if (extracted.kind === "delta") {
      sawTextDelta = true;
      text += extracted.text;
    } else if (extracted.kind === "final" && !sawTextDelta) {
      text = extracted.text;
    }
  }

  if (!sawChunk) {
    throw new Error("LLM returned an empty stream.");
  }

  return text;
}

async function readNextStreamValue<T>(
  iterator: AsyncIterator<T>,
  controller: AbortController,
  input: { timeoutMs: number; message: string }
): Promise<IteratorResult<T>> {
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(input.message);
          reject(new Error(input.message));
        }, input.timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function extractChatCompletionChunkText(chunk: ChatCompletionChunk) {
  return chunk.choices
    .map((choice) => choice.delta?.content ?? choice.delta?.refusal ?? "")
    .filter(Boolean)
    .join("");
}

function extractResponsesStreamEventText(event: ResponseStreamEvent, hasDeltaText: boolean) {
  if (event.type === "response.output_text.delta") {
    return {
      kind: "delta" as const,
      text: event.delta
    };
  }

  if (event.type === "response.refusal.delta") {
    return {
      kind: "delta" as const,
      text: event.delta
    };
  }

  if (event.type === "response.output_text.done" && !hasDeltaText) {
    return {
      kind: "final" as const,
      text: event.text
    };
  }

  if (event.type === "response.refusal.done" && !hasDeltaText) {
    return {
      kind: "final" as const,
      text: event.refusal
    };
  }

  return {
    kind: "none" as const,
    text: ""
  };
}

function shouldFallbackToNonStreaming(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = typeof (error as { status?: unknown }).status === "number" ? Number((error as { status?: unknown }).status) : null;
  const message = error.message ?? "";

  return (status === 400 || status === 404 || status === 405 || status === 422 || status === 501) && STREAM_FALLBACK_HINT.test(message);
}

function normalizeTimeout(value: number | undefined, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  return fallback;
}
