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

export class OpsDiagnosisService {
  async diagnose(input: OpsDiagnosisInput): Promise<OpsDiagnosisResult> {
    const sanitizedInput = {
      ...input,
      rawErrorExcerpt: sanitizeSensitiveText(input.rawErrorExcerpt),
      evidence: sanitizeUnknown(input.evidence)
    };

    try {
      const client = createOpenAiClient("ops");
      const runtime = readLlmRuntimeConfig("ops");
      const response = await createLlmTextResponse(
        client,
        runtime,
        [
          {
            role: "system",
            content: [
              "You are an internal incident diagnosis assistant.",
              "Return strict JSON with keys: summary, rootCause, keyEvidence, suggestedAction.",
              "Keep the answer factual and operational.",
              "Do not propose automatic code changes.",
              "keyEvidence must be an array of short strings."
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

function normalizeDiagnosisPayload(payload: OpsDiagnosisPayload): Omit<OpsDiagnosisResult, "provider"> {
  const keyEvidence = Array.isArray(payload.keyEvidence)
    ? payload.keyEvidence.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 5)
    : [];

  return {
    summary: normalizeText(payload.summary, "Incident detected. Review the attached evidence."),
    rootCause: normalizeText(payload.rootCause, "Root cause is not confirmed yet."),
    keyEvidence: keyEvidence.length ? keyEvidence : ["Structured incident evidence was captured."],
    suggestedAction: normalizeText(payload.suggestedAction, "Review the recent logs and the related job/account state.")
  };
}

function buildFallbackDiagnosis(input: OpsDiagnosisInput, error: unknown): OpsDiagnosisResult {
  const failureText = sanitizeSensitiveText(error instanceof Error ? error.message : String(error)) ?? "unknown error";
  const excerpt = input.rawErrorExcerpt?.trim() || "No raw error excerpt was captured.";
  const rootCause =
    inferRootCauseFromExcerpt(excerpt) ??
    `Ops diagnosis LLM was unavailable or returned an invalid response (${failureText}).`;

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
    return "The account session is not usable and still requires manual login recovery.";
  }

  if (normalized.includes("econnrefused") || normalized.includes("fetch failed")) {
    return "A dependent network endpoint was unreachable when the incident was captured.";
  }

  if (normalized.includes("running attempt")) {
    return "A publish attempt likely remained in running state without a terminal update.";
  }

  if (normalized.includes("tick failed")) {
    return "The worker loop raised an unhandled runtime error before the tick completed.";
  }

  return null;
}

function inferSuggestedAction(excerpt: string, failureType: string | null) {
  const normalized = `${failureType ?? ""}\n${excerpt}`.toLowerCase();

  if (normalized.includes("manual_login")) {
    return "Check the account status and complete manual login recovery before retrying the workflow.";
  }

  if (normalized.includes("econnrefused") || normalized.includes("health")) {
    return "Verify the local service process and confirm that the API port is reachable on the same machine.";
  }

  if (normalized.includes("running")) {
    return "Inspect the related publish attempt and close stale running records after confirming the real job state.";
  }

  return "Review the recent service logs, related incident evidence, and the affected job/account records.";
}

function normalizeText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}
