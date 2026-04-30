import crypto from "node:crypto";
import { getXAppConfig } from "../config.js";
import type { XAccount, XTask } from "../types.js";

type NotificationResult = {
  ok: boolean;
  delivery: "sent" | "disabled" | "failed";
  message: string;
};

export class XNotificationService {
  private readonly config = getXAppConfig();

  async sendResearchUpdated(account: XAccount, reason: string): Promise<NotificationResult> {
    return this.sendTextMessage(
      [
        "[X Research Updated]",
        `Account: ${account.name}`,
        `Handle: @${account.handle}`,
        `Reason: ${reason}`,
        `At: ${new Date().toISOString()}`
      ].join("\n")
    );
  }

  async sendPublishSuccess(account: XAccount, task: XTask): Promise<NotificationResult> {
    return this.sendTextMessage(
      [
        "[X Publish Success]",
        `Account: ${account.name}`,
        `Handle: @${account.handle}`,
        `Task: ${task.title}`,
        `Task ID: ${task.id}`,
        `Published At: ${task.publishResult?.publishedAt ?? new Date().toISOString()}`,
        `URLs: ${(task.publishResult?.urls ?? []).join(", ") || "N/A"}`
      ].join("\n")
    );
  }

  async sendPublishFailure(account: XAccount, task: XTask, reason: string): Promise<NotificationResult> {
    return this.sendTaskFailure(account, task, "publish", reason);
  }

  async sendTaskFailure(
    account: XAccount,
    task: XTask,
    stage: string,
    reason: string
  ): Promise<NotificationResult> {
    return this.sendTextMessage(
      [
        "[X Task Failure]",
        `Account: ${account.name}`,
        `Handle: @${account.handle}`,
        `Task: ${task.title}`,
        `Task ID: ${task.id}`,
        `Stage: ${stage}`,
        `Reason: ${reason}`,
        `At: ${new Date().toISOString()}`
      ].join("\n")
    );
  }

  private async sendTextMessage(text: string): Promise<NotificationResult> {
    const { xFeishuBotWebhookUrl, xFeishuBotSecret } = this.config;
    if (!xFeishuBotWebhookUrl) {
      return {
        ok: true,
        delivery: "disabled",
        message: "X_FEISHU_BOT_WEBHOOK_URL is not configured."
      };
    }

    const body: Record<string, unknown> = {
      msg_type: "text",
      content: {
        text
      }
    };

    if (xFeishuBotSecret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      body.timestamp = timestamp;
      body.sign = createFeishuSignature(timestamp, xFeishuBotSecret);
    }

    try {
      const response = await fetch(xFeishuBotWebhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const responseText = await response.text();
      const parsedBody = safeParseJsonRecord(responseText);

      if (!response.ok) {
        return {
          ok: false,
          delivery: "failed",
          message: `Feishu request failed with HTTP ${response.status}.${formatFeishuErrorSuffix(parsedBody, responseText)}`
        };
      }

      const apiError = extractFeishuApiError(parsedBody);
      if (apiError) {
        return {
          ok: false,
          delivery: "failed",
          message: `Feishu webhook rejected the message: ${apiError}`
        };
      }

      return {
        ok: true,
        delivery: "sent",
        message: "Notification sent."
      };
    } catch (error) {
      return {
        ok: false,
        delivery: "failed",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

function createFeishuSignature(timestamp: string, secret: string) {
  return crypto.createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

function safeParseJsonRecord(text: string) {
  if (!text.trim()) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function extractFeishuApiError(body: Record<string, unknown>) {
  const numericCode = readNumericField(body, ["code", "StatusCode"]);
  if (numericCode === null || numericCode === 0) {
    return null;
  }

  const message =
    readStringField(body, ["msg", "message", "StatusMessage"]) ?? `code=${numericCode}`;

  return `${message} (code=${numericCode})`;
}

function readNumericField(body: Record<string, unknown>, fieldNames: string[]) {
  for (const fieldName of fieldNames) {
    const value = body[fieldName];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return null;
}

function readStringField(body: Record<string, unknown>, fieldNames: string[]) {
  for (const fieldName of fieldNames) {
    const value = body[fieldName];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function formatFeishuErrorSuffix(body: Record<string, unknown>, rawText: string) {
  const message = readStringField(body, ["msg", "message", "StatusMessage"]);
  if (message) {
    return ` ${message}`;
  }

  const trimmedText = rawText.trim();
  return trimmedText ? ` ${trimmedText}` : "";
}
