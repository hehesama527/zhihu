import type { FailureType, PromptSnapshotMap, RecoveryAction } from "@zhihu-mvp/shared";
import { LlmService } from "./llm-service.js";

export type FailureResolution = {
  action: RecoveryAction;
  reason: string;
};

export class FailureResolutionService {
  constructor(private readonly llmService?: LlmService) {}

  async resolve(
    input: {
      failureType: FailureType;
      retryCount: number;
      context: unknown;
    },
    promptSnapshot?: PromptSnapshotMap | null
  ): Promise<FailureResolution> {
    void this.llmService;
    void input.context;
    void promptSnapshot;
    return mapFailureWithRules(input.failureType, input.retryCount);
  }
}

function mapFailureWithRules(failureType: FailureType, retryCount: number): FailureResolution {
  if (
    failureType === "auth_required" ||
    failureType === "login_required" ||
    failureType === "session_expired" ||
    failureType === "account_identity_mismatch" ||
    failureType === "challenge_required"
  ) {
    return {
      action: "MANUAL_LOGIN",
      reason:
        failureType === "account_identity_mismatch"
          ? "当前 Profile 登录的不是目标账号，需要重新登录或重建该账号的 Profile。"
          : "检测到登录失效、挑战页或风控状态，需要进入人工恢复。"
    };
  }

  if (failureType === "llm_connection_error") {
    return {
      action: retryCount >= 2 ? "TERMINAL_FAIL" : "RETRY_SAME_SESSION",
      reason: retryCount >= 2 ? "LLM 连接多次失败，终止本次任务。" : "LLM 连接失败，等下一轮自动重试。"
    };
  }

  if (failureType === "duplicate_block") {
    return {
      action: "RESELECT_TOPIC",
      reason: "重复性问题直接换题，不进入修订回路。"
    };
  }

  if (failureType === "editor_not_ready") {
    return {
      action: retryCount >= 1 ? "RESTART_BROWSER" : "RETRY_SAME_SESSION",
      reason: retryCount >= 1 ? "编辑器仍未就绪，升级为重启浏览器。" : "编辑器未就绪，先同会话重试一次。"
    };
  }

  if (failureType === "submit_not_ready") {
    return {
      action: retryCount >= 1 ? "RESTART_BROWSER" : "RETRY_SAME_SESSION",
      reason: retryCount >= 1 ? "提交按钮仍未就绪，升级为重启浏览器。" : "提交按钮未就绪，先同会话重试一次。"
    };
  }

  if (failureType === "network_or_page_error") {
    return {
      action: retryCount >= 1 ? "TERMINAL_FAIL" : "RESTART_BROWSER",
      reason: retryCount >= 1 ? "页面或网络异常再次发生，终止本次任务。" : "页面或网络异常，先重启浏览器再试一次。"
    };
  }

  if (failureType === "publish_uncertain") {
    return {
      action: "VERIFY_ONCE",
      reason: "发布结果不够明确，执行一次发布后核验。"
    };
  }

  if (failureType === "content_risk_block") {
    return {
      action: retryCount >= 1 ? "TERMINAL_FAIL" : "REWRITE_ONCE",
      reason: retryCount >= 1 ? "内容风险再次命中，终止本次任务。" : "命中内容风险，允许回 Writer 重写一次。"
    };
  }

  return {
    action: "TERMINAL_FAIL",
    reason: "未命中可恢复策略，按终止处理。"
  };
}
