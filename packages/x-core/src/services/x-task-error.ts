import type { XAccountAuthStatus, XTaskFailureStage, XTaskFailureType } from "../types.js";

type XTaskExecutionErrorInput = {
  stage: XTaskFailureStage;
  failureType: XTaskFailureType;
  message: string;
  currentStage?: string | null;
  accountAuthStatus?: XAccountAuthStatus | null;
  accountAuthReason?: string | null;
};

export class XTaskExecutionError extends Error {
  readonly stage: XTaskFailureStage;
  readonly failureType: XTaskFailureType;
  readonly currentStage: string;
  readonly accountAuthStatus: XAccountAuthStatus | null;
  readonly accountAuthReason: string | null;

  constructor(input: XTaskExecutionErrorInput) {
    super(input.message);
    this.name = "XTaskExecutionError";
    this.stage = input.stage;
    this.failureType = input.failureType;
    this.currentStage = input.currentStage ?? `${input.stage}_failed`;
    this.accountAuthStatus = input.accountAuthStatus ?? null;
    this.accountAuthReason = input.accountAuthReason ?? null;
  }
}

export function toXTaskExecutionError(
  stage: XTaskFailureStage,
  error: unknown,
  fallbackFailureType?: XTaskFailureType
) {
  if (error instanceof XTaskExecutionError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new XTaskExecutionError({
    stage,
    failureType: fallbackFailureType ?? defaultFailureTypeForStage(stage),
    message
  });
}

function defaultFailureTypeForStage(stage: XTaskFailureStage): XTaskFailureType {
  if (stage === "publish") {
    return "publish_error";
  }

  return "unknown_error";
}
