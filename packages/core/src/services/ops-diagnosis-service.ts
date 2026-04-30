import { createHash } from "node:crypto";
import { createOpenAiClient, readLlmRuntimeConfig } from "../config/llm-provider.js";
import { extractResponseText, safeParseJson } from "../utils/json.js";
import { createLlmTextResponse } from "../utils/llm-text.js";
import { sanitizeSensitiveText, sanitizeUnknown } from "../utils/sensitive-data.js";

export type OpsDiagnosisInput = {
  serviceName: string;
  source: string;
  severity: string;
  failureType: string | null;
  title: string;
  rawErrorExcerpt: string | null;
  evidence: unknown;
};

export type OpsDiagnosisResult = {
  summary: string;
  rootCause: string;
  keyEvidence: string[];
  suggestedAction: string;
  provider: "ops_llm" | "fallback";
};

type OpsDiagnosisPayload = {
  summary?: unknown;
  rootCause?: unknown;
  keyEvidence?: unknown;
  suggestedAction?: unknown;
};

const INCIDENT_FINGERPRINT_NOISE_LINE_PATTERNS = [
  /^\(use `node --trace-deprecation/i,
  /^\(node:<pid>\) \[dep<num>\] deprecationwarning:/i
];

export class OpsDiagnosisService {
  async diagnose(input: OpsDiagnosisInput): Promise<OpsDiagnosisResult> {
    const sanitizedInput = {
      ...input,
      rawErrorExcerpt: sanitizeSensitiveText(input.rawErrorExcerpt),
      evidence: sanitizeUnknown(input.evidence)
    };

    try {
      const client = createOpenAiClient("ops_agent");
      const runtime = readLlmRuntimeConfig("ops_agent");
      const response = await createLlmTextResponse(
        client,
        runtime,
        [
          {
            role: "system",
            content: [
              "你是内部故障诊断助手 (v3.0 anti-detection aware)。",
              "请严格输出 JSON，键必须是：summary, rootCause, keyEvidence, suggestedAction。",
              "全部使用简体中文自然语言，便于非研发同学快速理解。",
              "结论要具体、可执行，不要空话，不要输出代码。",
              "keyEvidence 必须是短句数组，最多 5 条。",
              "特别注意反检测相关错误：如果evidence或title包含 'stealth', 'fingerprint', 'canvas', 'webdriver', 'challenge', '风控', '行为模拟', 'trace' 等关键词，rootCause应优先考虑浏览器指纹/行为检测问题，并给出针对Phase1-3优化 (stealth-inject, human delay, prompt约束) 的具体建议。"
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify(sanitizedInput, null, 2)
          }
        ],
        {
          initialResponseTimeoutMs: 45_000
        }
      );
      const payload = safeParseJson<OpsDiagnosisPayload>(extractResponseText(response), {});
      const parsed = normalizeDiagnosisPayload(payload);

      return {
        ...parsed,
        provider: "ops_llm"
      };
    } catch (error) {
      return buildFallbackDiagnosis(sanitizedInput, error);
    }
  }
}

export function buildIncidentFingerprint(parts: Array<string | number | null | undefined>) {
  const normalized = parts
    .map((part) => (part == null ? "" : String(part).trim().toLowerCase()))
    .filter(Boolean)
    .join("|");

  return createHash("sha256").update(normalized || "empty").digest("hex");
}

export function buildStableIncidentFingerprintText(value: string | null | undefined) {
  const normalizedLines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeIncidentFingerprintLine(line))
    .filter(Boolean);

  const meaningfulLines = normalizedLines.filter((line) => !isIncidentFingerprintNoiseLine(line));
  return (meaningfulLines.length ? meaningfulLines : normalizedLines).slice(-8).join("\n");
}

export function normalizeIncidentFingerprintLine(value: string | null | undefined) {
  const line = String(value ?? "").trim();
  if (!line) {
    return "";
  }

  return line
    .replace(/^\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?z?:\s*/i, "")
    .replace(/\bnode:\d+\b/gi, "node:<pid>")
    .replace(/\[dep\d+\]/gi, "[dep<num>]")
    .replace(/(?:^|[\s(])\/(?:[^/\s]+\/)*[^/\s)]+/g, (match) => match.replace(/\/(?:[^/\s]+\/)*[^/\s)]+/, "<path>"))
    .replace(/\b\d+\s+seconds\b/gi, "<duration_seconds>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isIncidentFingerprintNoiseLine(line: string) {
  return INCIDENT_FINGERPRINT_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

function normalizeDiagnosisPayload(payload: OpsDiagnosisPayload): Omit<OpsDiagnosisResult, "provider"> {
  const keyEvidence = Array.isArray(payload.keyEvidence)
    ? payload.keyEvidence.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 5)
    : [];

  return {
    summary: normalizeText(payload.summary, "检测到异常，请结合证据继续排查。"),
    rootCause: normalizeText(payload.rootCause, "暂未确认根因，请优先检查最近错误日志。"),
    keyEvidence: keyEvidence.length ? keyEvidence : ["系统已采集到结构化故障证据。"],
    suggestedAction: normalizeText(payload.suggestedAction, "请先核对近期日志、任务状态和账号状态，再执行重试。")
  };
}

function buildFallbackDiagnosis(input: OpsDiagnosisInput, error: unknown): OpsDiagnosisResult {
  const failureText = sanitizeSensitiveText(error instanceof Error ? error.message : String(error)) ?? "unknown error";
  const excerpt = input.rawErrorExcerpt?.trim() || "No raw error excerpt was captured.";
  const rootCause =
    inferRootCauseFromExcerpt(excerpt) ??
    `诊断模型暂不可用或返回格式异常（${failureText}）。`;

  return {
    summary: `${input.title} (${input.serviceName})`,
    rootCause,
    keyEvidence: [excerpt.slice(0, 240)],
    suggestedAction: inferSuggestedAction(excerpt, input.failureType),
    provider: "fallback"
  };
}

function inferRootCauseFromExcerpt(excerpt: string) {
  const normalized = excerpt.toLowerCase();

  if (normalized.includes("manual_login_required") || normalized.includes("session_expired")) {
    return "账号会话不可用，仍需人工登录恢复后才能继续任务。";
  }

  if (normalized.includes("econnrefused") || normalized.includes("fetch failed")) {
    return "采集故障时依赖的网络端点不可达。";
  }

  if (normalized.includes("running attempt")) {
    return "发布尝试长时间停留在 running 状态，可能未正常收口。";
  }

  if (normalized.includes("tick failed")) {
    return "Worker 循环在 tick 完成前触发了未处理运行时错误。";
  }

  return null;
}

function inferSuggestedAction(excerpt: string, failureType: string | null) {
  const normalized = `${failureType ?? ""}\n${excerpt}`.toLowerCase();

  if (normalized.includes("manual_login")) {
    return "先确认账号状态并完成人工登录恢复，再重新触发流程。";
  }

  if (normalized.includes("econnrefused") || normalized.includes("health")) {
    return "先检查本机服务进程和端口连通性，确认 API 在本机可访问。";
  }

  if (normalized.includes("running")) {
    return "核对对应发布尝试的真实状态，确认后清理陈旧 running 记录。";
  }

  return "优先查看近期服务日志与故障证据，并核对受影响任务/账号状态。";
}

function normalizeText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}
