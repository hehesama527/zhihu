export function safeParseJson<T>(value: string, fallback: T): T {
  const normalized = unwrapJsonFence(value);
  try {
    return JSON.parse(normalized) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonOrThrow<T>(value: string): T {
  return JSON.parse(unwrapJsonFence(value)) as T;
}

export function extractResponseText(response: unknown): string {
  const fromResponse = extractResponseValue(response);
  return normalizeResponseText(fromResponse);
}

function unwrapJsonFence(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const lines = trimmed.split("\n");
  const firstLine = lines[0] ?? "";
  const lastLine = lines[lines.length - 1] ?? "";
  if (firstLine.startsWith("```") && lastLine.startsWith("```")) {
    const middle = lines.slice(1, -1);
    if (middle[0]?.trim().toLowerCase() === "json") {
      return middle.slice(1).join("\n");
    }
    return middle.join("\n");
  }

  return trimmed;
}

function extractResponseValue(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }

  if (!response || typeof response !== "object") {
    return "";
  }

  const outputText = readProperty(response, "output_text");
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText;
  }

  const output = readProperty(response, "output");
  const fromOutput = extractTextFromUnknown(output);
  if (fromOutput) {
    return fromOutput;
  }

  const choices = readProperty(response, "choices");
  const fromChoices = extractTextFromUnknown(choices);
  if (fromChoices) {
    return fromChoices;
  }

  const content = readProperty(response, "content");
  const fromContent = extractTextFromUnknown(content);
  if (fromContent) {
    return fromContent;
  }

  return "";
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const texts = value
      .map((item) => extractTextFromUnknown(item))
      .filter((item) => Boolean(item && item.trim()));
    return texts.join("");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const text = readProperty(value, "text");
  if (typeof text === "string" && text.trim()) {
    return text;
  }

  const delta = readProperty(value, "delta");
  if (typeof delta === "string" && delta.trim()) {
    return delta;
  }

  const outputText = readProperty(value, "output_text");
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText;
  }

  const part = readProperty(value, "part");
  const fromPart = extractTextFromUnknown(part);
  if (fromPart) {
    return fromPart;
  }

  const item = readProperty(value, "item");
  const fromItem = extractTextFromUnknown(item);
  if (fromItem) {
    return fromItem;
  }

  const content = readProperty(value, "content");
  const fromContent = extractTextFromUnknown(content);
  if (fromContent) {
    return fromContent;
  }

  const message = readProperty(value, "message");
  const fromMessage = extractTextFromUnknown(message);
  if (fromMessage) {
    return fromMessage;
  }

  const output = readProperty(value, "output");
  const fromOutput = extractTextFromUnknown(output);
  if (fromOutput) {
    return fromOutput;
  }

  const response = readProperty(value, "response");
  const fromResponse = extractTextFromUnknown(response);
  if (fromResponse) {
    return fromResponse;
  }

  return "";
}

function normalizeResponseText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (!trimmed.includes("event:") || !trimmed.includes("data:")) {
    return trimmed;
  }

  const parsed = parseSseOutputText(trimmed);
  return parsed || trimmed;
}

function parseSseOutputText(value: string) {
  const lines = value.split(/\r?\n/);
  const events: Array<{ event: string | null; data: string[] }> = [];
  let currentEvent: string | null = null;
  let currentData: string[] = [];

  const flush = () => {
    if (!currentEvent && currentData.length === 0) {
      return;
    }

    events.push({
      event: currentEvent,
      data: [...currentData]
    });
    currentEvent = null;
    currentData = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }

    if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      currentData.push(line.slice("data:".length).trimStart());
    }
  }
  flush();

  let deltaText = "";
  let latestMessageText = "";

  for (const event of events) {
    const payloadText = event.data.join("\n").trim();
    if (!payloadText || payloadText === "[DONE]") {
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      continue;
    }

    const eventType =
      payload && typeof payload === "object" && "type" in payload && typeof payload.type === "string"
        ? payload.type
        : event.event;

    if (eventType === "response.output_text.delta") {
      const delta =
        payload && typeof payload === "object" && "delta" in payload && typeof payload.delta === "string"
          ? payload.delta
          : extractTextFromUnknown(payload);
      deltaText += delta;
      continue;
    }

    const messageText = extractTextFromUnknown(payload);
    if (messageText) {
      latestMessageText = messageText;
    }
  }

  return deltaText.trim() || latestMessageText.trim();
}

function readProperty(value: object, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor) {
    if ("value" in descriptor) {
      return descriptor.value;
    }

    if (typeof descriptor.get === "function") {
      try {
        return descriptor.get.call(value);
      } catch {
        return undefined;
      }
    }
  }

  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}
