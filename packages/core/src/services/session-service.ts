import type { PromptSnapshotMap, ToolTraceStage } from "@zhihu-mvp/shared";
import { getAppConfig } from "../config/env.js";
import { launchManualBrowser } from "../utils/chrome-manual-login.js";
import { createManualLoginLock, removeManualLoginLock } from "../utils/manual-login-lock.js";
import { BrowserSkillService } from "./browser-skill-service.js";
import { LlmService } from "./llm-service.js";

type SessionSnapshotInput = {
  url: string;
  title: string;
  visibleTexts: string[];
  buttons?: string[];
  links?: Array<{ text: string; href: string }>;
};

type SessionDetectionResult = {
  session_state?: "active" | "login_required" | "session_expired" | "unknown";
  reason?: string;
  confidence?: "high" | "medium" | "low";
};

export class SessionStateError extends Error {
  constructor(
    public readonly sessionState: "login_required" | "session_expired",
    message: string,
    public readonly currentUrl: string | null,
    public readonly snapshot: {
      url: string;
      title: string;
      visibleTexts: string[];
      buttons?: string[];
    }
  ) {
    super(message);
  }
}

export class SessionService {
  constructor(
    private readonly browserSkillService: BrowserSkillService,
    private readonly llmService?: LlmService
  ) {}

  async startManualLoginFlow(accountId: number, profileDir: string, returnUrl?: string | null) {
    await createManualLoginLock(accountId);
    await this.browserSkillService.closeSession(`manual-login-${accountId}`);

    const targetUrl = returnUrl ?? `${getAppConfig().zhihuBaseUrl}/`;
    try {
      const launchResult = await launchManualBrowser(profileDir, targetUrl);

      return {
        accountId,
        browserMode: `${getAppConfig().browserChannel}-manual`,
        nextAction: "OPEN_LOGIN_PAGE",
        returnUrl: returnUrl ?? null,
        loginUrl: targetUrl,
        browserPid: launchResult.pid ?? null,
        chromePid: launchResult.pid ?? null,
        executablePath: launchResult.executablePath
      };
    } catch (error) {
      await removeManualLoginLock(accountId);
      throw error;
    }
  }

  async continueAfterManualLogin(accountId: number, publishJobId?: number) {
    await this.browserSkillService.closeSession(`manual-login-${accountId}`);
    await removeManualLoginLock(accountId);

    return {
      accountId,
      publishJobId: publishJobId ?? null,
      nextAction: "RECHECK_SESSION"
    };
  }

  async confirmRecoveredSession(input: {
    accountId: number;
    profileDir: string;
    returnUrl?: string | null;
    publishJobId?: number | null;
    promptSnapshot?: PromptSnapshotMap | null;
  }) {
    const sessionKey = `recovery-check-${input.accountId}`;
    const traceGroupId = `recovery-check-${input.accountId}-${Date.now()}`;

    try {
      return await this.ensureLoggedIn({
        sessionKey,
        profileDir: input.profileDir,
        traceGroupId,
        stage: "login_checking",
        url: input.returnUrl ?? `${getAppConfig().zhihuBaseUrl}/`,
        publishJobId: input.publishJobId ?? null,
        promptSnapshot: input.promptSnapshot
      });
    } finally {
      await this.browserSkillService.closeSession(sessionKey);
    }
  }

  async ensureLoggedIn(input: {
    sessionKey: string;
    profileDir: string;
    traceGroupId: string;
    stage?: ToolTraceStage;
    url?: string;
    publishJobId?: number | null;
    publishAttemptId?: number | null;
    promptSnapshot?: PromptSnapshotMap | null;
  }) {
    const traceContext = {
      sessionKey: input.sessionKey,
      profileDir: input.profileDir,
      traceGroupId: input.traceGroupId,
      publishJobId: input.publishJobId ?? null,
      publishAttemptId: input.publishAttemptId ?? null,
      stage: input.stage ?? "login_checking",
      agentName: "publish_agent"
    } as const;

    await this.browserSkillService.open(traceContext, {
      url: input.url ?? `${getAppConfig().zhihuBaseUrl}/`
    });
    await this.browserSkillService.wait(traceContext, { ms: 1_200 });

    const snapshot = await this.browserSkillService.snapshot(traceContext);
    const sessionState = normalizeSessionState(await this.detectSessionState(snapshot, input.promptSnapshot), snapshot);

    if (sessionState.session_state === "login_required" || sessionState.session_state === "session_expired") {
      throw new SessionStateError(sessionState.session_state, sessionState.reason, snapshot.url, snapshot);
    }

    return {
      snapshot,
      sessionState
    };
  }

  async detectSessionState(
    input: SessionSnapshotInput,
    promptSnapshot?: PromptSnapshotMap | null
  ): Promise<Required<SessionDetectionResult>> {
    const fallback: Required<SessionDetectionResult> = {
      session_state: "unknown",
      reason: "没有可用的登录态判断结果，改用页面兜底规则。",
      confidence: "low"
    };

    if (!this.llmService) {
      return fallback;
    }

    const publishPrompt = await this.llmService.resolvePrompt("publish_agent", {
      promptSnapshot
    });

    const result = await withTimeout(
      this.llmService.runJsonWithSystemPrompt<SessionDetectionResult>(
        `${publishPrompt}

补充说明：
你现在执行的是 Publish Agent 的“登录态判断任务”。

任务目标：
根据当前知乎页面快照，判断这个账号是否处于可继续执行的已登录状态。

判断规则：
1. 如果页面明显要求登录、注册、手机号验证码登录、密码登录，输出 login_required。
2. 如果页面出现安全验证、异常验证、滑块、身份校验、挑战页、风控提示，输出 session_expired。
3. 如果页面已经能正常看到知乎内容，或者能看到“写回答”“查看我的回答”“编辑回答”等回答相关入口，通常可判为 active。
4. 如果证据不足，输出 unknown，不要硬判。
5. 只输出 JSON，不要解释，不要 Markdown。

输出格式：
{
  "session_state": "active | login_required | session_expired | unknown",
  "reason": "一句话说明原因",
  "confidence": "high | medium | low"
}`,
        input,
        fallback
      ),
      6_000,
      {
        session_state: "unknown",
        reason: "登录态判断超时，改用页面兜底规则。",
        confidence: "low"
      }
    );

    return {
      session_state:
        result.session_state === "active" || result.session_state === "login_required" || result.session_state === "session_expired"
          ? result.session_state
          : "unknown",
      reason: typeof result.reason === "string" && result.reason.trim() ? result.reason : fallback.reason,
      confidence: result.confidence === "high" || result.confidence === "medium" ? result.confidence : "low"
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function normalizeSessionState(
  detected: SessionDetectionResult,
  snapshot: {
    url: string;
    title: string;
    visibleTexts: string[];
    buttons?: string[];
  }
) {
  const combinedText = [snapshot.url, snapshot.title, ...snapshot.visibleTexts, ...(snapshot.buttons ?? [])].join(" ");
  const hasLoginHint =
    /signin|login/i.test(snapshot.url) ||
    ["登录", "注册", "验证码登录", "手机号登录", "密码登录", "立即登录"].some((text) => combinedText.includes(text));
  const hasChallengeHint = ["安全验证", "异常验证", "验证身份", "滑块", "验证码", "短信验证", "挑战", "风控"].some((text) =>
    combinedText.includes(text)
  );

  if (detected.session_state === "login_required" || detected.session_state === "session_expired") {
    return {
      session_state: detected.session_state,
      reason: detected.reason || "没有检测到可复用的知乎登录状态。",
      confidence: detected.confidence ?? "medium"
    } as const;
  }

  if (hasChallengeHint) {
    return {
      session_state: "session_expired",
      reason: detected.reason || "页面进入验证或风控状态，请先人工恢复登录。",
      confidence: "high"
    } as const;
  }

  if (hasLoginHint) {
    return {
      session_state: "login_required",
      reason: detected.reason || "当前账号尚未登录知乎，请先登录后继续。",
      confidence: "high"
    } as const;
  }

  return {
    session_state: "active",
    reason: detected.reason || "已检测到可继续执行的知乎页面。",
    confidence: detected.confidence ?? "medium"
  } as const;
}
