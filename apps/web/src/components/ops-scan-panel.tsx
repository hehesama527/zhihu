"use client";

import { useState, useTransition } from "react";
import { fetchClientResponse, getClientApiBaseUrl } from "../lib/http";

export function OpsScanPanel() {
  const [result, setResult] = useState("");
  const [pending, startTransition] = useTransition();

  async function runScan() {
    const { response, text, payload } = await fetchClientResponse("/ops/scan", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    });

    if (!response.ok) {
      const message =
        typeof payload.error === "object" && payload.error && "message" in payload.error
          ? String((payload.error as { message?: unknown }).message ?? "")
          : text;
      throw new Error(message || "Failed to run ops scan.");
    }

    return payload;
  }

  return (
    <article className="card">
      <div className="card-header">
        <div>
          <h3>Manual Scan</h3>
          <p className="muted">Trigger one immediate ops scan in the test environment and inspect the returned summary.</p>
        </div>

        <button
          className="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                const payload = await runScan();
                setResult(JSON.stringify(payload, null, 2));
              } catch (error) {
                setResult(error instanceof Error ? error.message : "Failed to run ops scan.");
              }
            })
          }
        >
          {pending ? "Scanning..." : "Run Scan"}
        </button>
      </div>

      <p className="helper-text">Client API: {getClientApiBaseUrl()}</p>
      <pre>{result || "The latest scan summary will be shown here."}</pre>
    </article>
  );
}
