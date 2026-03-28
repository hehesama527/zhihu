import type { FailureType, PromptSnapshotMap, PublishStepAction, PublishStepPlan } from "@zhihu-mvp/shared";
import { normalizeZhihuQuestionUrl } from "../utils/zhihu-url.js";
import { LlmService } from "./llm-service.js";
import { BrowserSkillService, type PageSnapshot } from "./browser-skill-service.js";
import { SessionService } from "./session-service.js";

const EDITOR_SELECTORS = [
  "[role='textbox']",
  ".public-DraftEditor-content",
  ".DraftEditor-root div[contenteditable='true']",
  "[contenteditable='true']"
];

type PublishResultReview = {
  decision: "SUCCESS" | "CONTENT_RISK" | "UNCERTAIN";
  confidence: "high" | "medium" | "low";
  matchedSignals: string[];
  reason: string;
};

type PublishContentSignals = {
  expectedExcerpt: string;
  expectedSignals: string[];
};

type ExistingDraftComparison = {
  decision: "MATCHED" | "SIMILAR" | "MISMATCH";
  expectedLength: number;
  actualLength: number;
  lengthDelta: number;
  lengthDeltaRatio: number;
  overlapScore: number;
  matchedSignalCount: number;
  reason: string;
};

export type PublishResumeAnchor = {
  stage: string;
  currentUrl?: string | null;
};

export class PublishFlowError extends Error {
  constructor(
    public readonly failureType: FailureType,
    message: string,
    public readonly currentUrl: string | null = null,
    public readonly meta: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export class PublishService {
  constructor(
    private readonly llmService: LlmService,
    private readonly browserSkillService: BrowserSkillService,
    private readonly sessionService: SessionService
  ) {}

  async runPublishAttempt(input: {
    sessionKey: string;
    traceGroupId: string;
    profileDir: string;
    questionUrl: string;
    content: string;
    publishJobId: number;
    publishAttemptId: number | null;
    promptSnapshot?: PromptSnapshotMap | null;
    resumeAnchor?: PublishResumeAnchor | null;
    expectedZhihuUserName?: string | null;
    accountName?: string | null;
  }) {
    const traceBase = {
      sessionKey: input.sessionKey,
      profileDir: input.profileDir,
      publishJobId: input.publishJobId,
      publishAttemptId: input.publishAttemptId,
      traceGroupId: input.traceGroupId,
      agentName: "publish_agent"
    } as const;

    await this.sessionService.ensureLoggedIn({
      sessionKey: input.sessionKey,
      profileDir: input.profileDir,
      traceGroupId: `${input.traceGroupId}-preflight`,
      stage: "login_checking",
      publishJobId: input.publishJobId,
      publishAttemptId: input.publishAttemptId,
      promptSnapshot: input.promptSnapshot,
      expectedZhihuUserName: input.expectedZhihuUserName ?? null,
      accountName: input.accountName ?? null
    });

    const targetUrl = input.resumeAnchor?.currentUrl ?? normalizeZhihuQuestionUrl(input.questionUrl) ?? input.questionUrl;

    await this.browserSkillService.open(
      {
        ...traceBase,
        stage: "publishing"
      },
      {
        url: targetUrl
      }
    );

    const openSnapshot = await this.browserSkillService.snapshot({
      ...traceBase,
      stage: "login_checking"
    });

    const sessionState = await this.sessionService.detectSessionState(openSnapshot, input.promptSnapshot);
    if (sessionState.session_state === "login_required" || sessionState.session_state === "session_expired") {
      throw new PublishFlowError(sessionState.session_state as FailureType, sessionState.reason, openSnapshot.url, {
        sessionState,
        resumeAnchor: {
          stage: "login_checking",
          currentUrl: openSnapshot.url
        }
      });
    }

    const openPlanState = await this.resolvePlanForStage({
      traceBase,
      stage: "publishing",
      snapshot: openSnapshot,
      promptSnapshot: input.promptSnapshot,
      expectedActions: ["CLICK_WRITE_ANSWER", "FOCUS_EDITOR", "PASTE_CONTENT", "VERIFY_RESULT"]
    });
    const openPlan = openPlanState.plan;

    if (openPlan.nextAction === "REQUEST_MANUAL_LOGIN") {
      throw new PublishFlowError("session_expired", openPlan.reason, openPlanState.snapshot.url, {
        snapshot: openPlanState.snapshot,
        publishPlan: openPlan,
        resumeAnchor: {
          stage: "login_checking",
          currentUrl: openPlanState.snapshot.url
        }
      });
    }

    const existingAnswerSignal = getExistingAnswerSignal(openPlan);
    let rawEditorSnapshot = openPlanState.snapshot;
    let editorAlreadyPrepared = false;

    if (existingAnswerSignal === "edit" || existingAnswerSignal === "view") {
      const existingAnswerResult = await this.handleExistingAnswerEntry({
        traceBase,
        snapshot: openPlanState.snapshot,
        plan: openPlan,
        content: input.content,
        promptSnapshot: input.promptSnapshot,
        signal: existingAnswerSignal
      });

      if (existingAnswerResult.kind === "completed") {
        return {
          finalUrl: existingAnswerResult.finalUrl,
          screenshotPath: existingAnswerResult.screenshotPath,
          pageSnapshot: existingAnswerResult.pageSnapshot
        };
      }

      if (existingAnswerResult.kind === "uncertain") {
        throw new PublishFlowError("publish_uncertain", existingAnswerResult.reason, existingAnswerResult.currentUrl, {
          screenshotPath: existingAnswerResult.screenshotPath,
          verifySnapshot: existingAnswerResult.pageSnapshot,
          contentComparison: existingAnswerResult.comparison,
          resumeAnchor: {
            stage: "publish_verify",
            currentUrl: existingAnswerResult.currentUrl
          }
        });
      }

      rawEditorSnapshot = existingAnswerResult.editorSnapshot;
      editorAlreadyPrepared = true;
    } else if (openPlan.nextAction === "VERIFY_RESULT") {
      const existingPageResult = await this.captureAndReviewPageResult({
        traceBase,
        stage: "publish_verify",
        currentUrl: openPlanState.snapshot.url,
        snapshot: openPlanState.snapshot,
        content: input.content,
        promptSnapshot: input.promptSnapshot,
        screenshotLabel: `publish-open-${input.publishJobId}`
      });

      if (existingPageResult.reviewedResult.decision === "SUCCESS") {
        return {
          finalUrl: existingPageResult.currentUrl,
          screenshotPath: existingPageResult.screenshotPath,
          pageSnapshot: existingPageResult.snapshot
        };
      }

      throw new PublishFlowError("publish_uncertain", existingPageResult.reviewedResult.reason, existingPageResult.currentUrl, {
        screenshotPath: existingPageResult.screenshotPath,
        verifySnapshot: existingPageResult.snapshot,
        reviewedResult: existingPageResult.reviewedResult,
        resumeAnchor: {
          stage: "publish_verify",
          currentUrl: existingPageResult.currentUrl
        }
      });
    } else if (openPlan.nextAction === "CLICK_WRITE_ANSWER") {
      await this.clickPlanOrThrow({
        traceBase,
        snapshot: openPlanState.snapshot,
        plan: openPlan,
        failureType: "editor_not_ready",
        errorMessage: "没有找到“写回答”入口。"
      });

      await this.browserSkillService.wait(
        {
          ...traceBase,
          stage: "publishing"
        },
        {
          ms: 2500
        }
      );

      rawEditorSnapshot = await this.browserSkillService.snapshot({
        ...traceBase,
        stage: "publishing"
      });
    } else if (openPlan.nextAction !== "FOCUS_EDITOR" && openPlan.nextAction !== "PASTE_CONTENT") {
      throw new PublishFlowError("editor_not_ready", openPlan.reason || "当前页面还没有进入可编辑状态。", openPlanState.snapshot.url, {
        snapshot: openPlanState.snapshot,
        publishPlan: openPlan,
        resumeAnchor: {
          stage: "publishing",
          currentUrl: openPlanState.snapshot.url
        }
      });
    }

    let editorSnapshot = rawEditorSnapshot;
    let editorPlan: PublishStepPlan;

    if (editorAlreadyPrepared) {
      editorPlan = {
        nextAction: "PASTE_CONTENT",
        targetTexts: [],
        targetRoles: [],
        targetSelectors: EDITOR_SELECTORS,
        confidence: "high",
        reason: "已在编辑态完成旧内容清空，直接重新粘贴全文。"
      };
    } else {
      const editorPlanState = await this.resolvePlanForStage({
        traceBase,
        stage: "publishing",
        snapshot: rawEditorSnapshot,
        promptSnapshot: input.promptSnapshot,
        expectedActions: ["FOCUS_EDITOR", "PASTE_CONTENT"]
      });
      editorSnapshot = editorPlanState.snapshot;
      editorPlan = editorPlanState.plan;

      if (editorPlan.nextAction === "REQUEST_MANUAL_LOGIN") {
        throw new PublishFlowError("session_expired", editorPlan.reason, editorPlanState.snapshot.url, {
          snapshot: editorPlanState.snapshot,
          publishPlan: editorPlan,
          resumeAnchor: {
            stage: "login_checking",
            currentUrl: editorPlanState.snapshot.url
          }
        });
      }

      if (editorPlan.nextAction !== "FOCUS_EDITOR" && editorPlan.nextAction !== "PASTE_CONTENT") {
        throw new PublishFlowError("editor_not_ready", editorPlan.reason || "没有进入可编辑的回答区域。", editorPlanState.snapshot.url, {
          snapshot: editorPlanState.snapshot,
          publishPlan: editorPlan,
          resumeAnchor: {
            stage: "publishing",
            currentUrl: editorPlanState.snapshot.url
          }
        });
      }
    }

    await this.focusEditorOrThrow(traceBase, editorSnapshot, editorPlan);

    await this.browserSkillService.pasteText(
      {
        ...traceBase,
        stage: "publishing"
      },
      {
        text: input.content
      }
    );

    await this.browserSkillService.wait(
      {
        ...traceBase,
        stage: "publishing"
      },
      {
        ms: 1000
      }
    );

    const rawSubmitSnapshot = await this.browserSkillService.snapshot({
      ...traceBase,
      stage: "publishing"
    });
    const submitPlanState = await this.resolvePlanForStage({
      traceBase,
      stage: "publishing",
      snapshot: rawSubmitSnapshot,
      promptSnapshot: input.promptSnapshot,
      expectedActions: ["CLICK_SUBMIT"]
    });
    const submitPlan = submitPlanState.plan;

    if (submitPlan.nextAction !== "CLICK_SUBMIT") {
      throw new PublishFlowError("submit_not_ready", submitPlan.reason || "当前页面还没有出现可提交的发布按钮。", submitPlanState.snapshot.url, {
        snapshot: submitPlanState.snapshot,
        publishPlan: submitPlan,
        resumeAnchor: {
          stage: "publishing",
          currentUrl: submitPlanState.snapshot.url
        }
      });
    }

    await this.clickPlanOrThrow({
      traceBase,
      snapshot: submitPlanState.snapshot,
      plan: submitPlan,
      failureType: "submit_not_ready",
      errorMessage: "没有找到“发布回答”按钮。"
    });

    await this.browserSkillService.wait(
      {
        ...traceBase,
        stage: "publish_verify"
      },
      {
        ms: 3500
      }
    );

    const finalUrlResult = await this.browserSkillService.getUrl({
      ...traceBase,
      stage: "publish_verify"
    });
    const verifySnapshot = await this.browserSkillService.snapshot({
      ...traceBase,
      stage: "publish_verify"
    });
    const screenshot = await this.browserSkillService.screenshot(
      {
        ...traceBase,
        stage: "publish_verify"
      },
      {
        label: `publish-job-${input.publishJobId}`
      }
    );

    const reviewedResult = await this.reviewPublishResult(
      verifySnapshot,
      finalUrlResult.url,
      input.content,
      input.promptSnapshot
    );

    if (reviewedResult.decision === "CONTENT_RISK") {
      throw new PublishFlowError("content_risk_block", reviewedResult.reason, finalUrlResult.url, {
        screenshotPath: screenshot.screenshotPath,
        verifySnapshot,
        reviewedResult,
        resumeAnchor: {
          stage: "publish_verify",
          currentUrl: finalUrlResult.url
        }
      });
    }

    if (reviewedResult.decision !== "SUCCESS") {
      throw new PublishFlowError("publish_uncertain", reviewedResult.reason, finalUrlResult.url, {
        screenshotPath: screenshot.screenshotPath,
        verifySnapshot,
        reviewedResult,
        resumeAnchor: {
          stage: "publish_verify",
          currentUrl: finalUrlResult.url
        }
      });
    }

    return {
      finalUrl: finalUrlResult.url,
      screenshotPath: screenshot.screenshotPath,
      pageSnapshot: verifySnapshot
    };
  }

  async closeSession(sessionKey: string) {
    await this.browserSkillService.closeSession(sessionKey);
  }

  async restartSession(input: { sessionKey: string; profileDir: string; traceGroupId?: string }) {
    await this.browserSkillService.restartSession({
      sessionKey: input.sessionKey,
      profileDir: input.profileDir,
      traceGroupId: input.traceGroupId
    });
  }

  async verifyExistingResult(input: {
    sessionKey: string;
    traceGroupId: string;
    profileDir: string;
    publishJobId: number;
    publishAttemptId: number | null;
    currentUrl: string;
    content: string;
    promptSnapshot?: PromptSnapshotMap | null;
    expectedZhihuUserName?: string | null;
    accountName?: string | null;
  }) {
    const traceBase = {
      sessionKey: input.sessionKey,
      profileDir: input.profileDir,
      publishJobId: input.publishJobId,
      publishAttemptId: input.publishAttemptId,
      traceGroupId: input.traceGroupId,
      agentName: "publish_agent"
    } as const;

    await this.sessionService.ensureLoggedIn({
      sessionKey: input.sessionKey,
      profileDir: input.profileDir,
      traceGroupId: `${input.traceGroupId}-preflight`,
      stage: "login_checking",
      publishJobId: input.publishJobId,
      publishAttemptId: input.publishAttemptId,
      promptSnapshot: input.promptSnapshot,
      expectedZhihuUserName: input.expectedZhihuUserName ?? null,
      accountName: input.accountName ?? null
    });

    await this.browserSkillService.open(
      {
        ...traceBase,
        stage: "publish_verify"
      },
      {
        url: input.currentUrl
      }
    );

    await this.browserSkillService.wait(
      {
        ...traceBase,
        stage: "publish_verify"
      },
      {
        ms: 1800
      }
    );

    const reviewedPage = await this.captureAndReviewPageResult({
      traceBase,
      stage: "publish_verify",
      content: input.content,
      promptSnapshot: input.promptSnapshot,
      screenshotLabel: `publish-verify-${input.publishJobId}`
    });

    return {
      ok: reviewedPage.reviewedResult.decision === "SUCCESS",
      reason: reviewedPage.reviewedResult.reason,
      finalUrl: reviewedPage.currentUrl,
      screenshotPath: reviewedPage.screenshotPath
    };
  }

  private async captureAndReviewPageResult(input: {
    traceBase: {
      sessionKey: string;
      profileDir: string;
      publishJobId: number;
      publishAttemptId: number | null;
      traceGroupId: string;
      agentName: "publish_agent";
    };
    stage: "publishing" | "publish_verify";
    currentUrl?: string;
    snapshot?: PageSnapshot;
    content: string;
    promptSnapshot?: PromptSnapshotMap | null;
    screenshotLabel: string;
  }) {
    const currentUrl =
      input.currentUrl ??
      (
        await this.browserSkillService.getUrl({
          ...input.traceBase,
          stage: input.stage
        })
      ).url;

    const snapshot =
      input.snapshot ??
      (await this.browserSkillService.snapshot({
        ...input.traceBase,
        stage: input.stage
      }));

    const screenshot = await this.browserSkillService.screenshot(
      {
        ...input.traceBase,
        stage: input.stage
      },
      {
        label: input.screenshotLabel
      }
    );

    const reviewedResult = await this.reviewPublishResult(snapshot, currentUrl, input.content, input.promptSnapshot);

    return {
      currentUrl,
      snapshot,
      screenshotPath: screenshot.screenshotPath,
      reviewedResult
    };
  }

  private async resolvePlanForStage(input: {
    traceBase: {
      sessionKey: string;
      profileDir: string;
      publishJobId: number;
      publishAttemptId: number | null;
      traceGroupId: string;
      agentName: "publish_agent";
    };
    stage: "publishing" | "publish_verify";
    snapshot: PageSnapshot;
    promptSnapshot?: PromptSnapshotMap | null;
    expectedActions: PublishStepAction[];
  }) {
    let snapshot = input.snapshot;
    let plan = await this.understandPublishPage(snapshot, input.promptSnapshot);

    if (plan.nextAction === "REQUEST_MANUAL_LOGIN" || input.expectedActions.includes(plan.nextAction)) {
      return { snapshot, plan };
    }

    const firstFallbackPlan = buildFallbackPublishPlan(snapshot, input.expectedActions);
    if (firstFallbackPlan) {
      return {
        snapshot,
        plan: firstFallbackPlan
      };
    }

    if (plan.nextAction === "WAIT" || (plan.nextAction === "FOCUS_EDITOR" && input.expectedActions.includes("CLICK_SUBMIT"))) {
      await this.browserSkillService.wait(
        {
          ...input.traceBase,
          stage: input.stage
        },
        { ms: 1200 }
      );

      snapshot = await this.browserSkillService.snapshot({
        ...input.traceBase,
        stage: input.stage
      });
      plan = await this.understandPublishPage(snapshot, input.promptSnapshot);

      if (plan.nextAction === "REQUEST_MANUAL_LOGIN" || input.expectedActions.includes(plan.nextAction)) {
        return { snapshot, plan };
      }

      const secondFallbackPlan = buildFallbackPublishPlan(snapshot, input.expectedActions);
      if (secondFallbackPlan) {
        return {
          snapshot,
          plan: secondFallbackPlan
        };
      }
    }

    return { snapshot, plan };
  }

  private async understandPublishPage(snapshot: PageSnapshot, promptSnapshot?: PromptSnapshotMap | null): Promise<PublishStepPlan> {
    const publishPrompt = await this.llmService.resolvePrompt("publish_agent", {
      promptSnapshot
    });

    const result = await this.llmService.runJsonWithSystemPrompt<PublishStepPlan>(
      `${publishPrompt}

补充说明：
你现在执行的是 Publish Agent 的“发布页理解任务”。
任务目标：
根据当前知乎页面快照，判断发布流程下一步最合理的动作。

可选 nextAction 只有：
1. CLICK_WRITE_ANSWER
2. FOCUS_EDITOR
3. PASTE_CONTENT
4. CLICK_SUBMIT
5. WAIT
6. VERIFY_RESULT
7. REQUEST_MANUAL_LOGIN

判断规则：
1. 如果页面出现登录、挑战、风控、安全验证，输出 REQUEST_MANUAL_LOGIN。
2. 如果页面是问题页，而且存在“写回答”这类入口，输出 CLICK_WRITE_ANSWER。
3. 如果已经进入编辑态，且能识别到回答编辑器，输出 FOCUS_EDITOR 或 PASTE_CONTENT。
4. 如果能识别到“发布回答”或等价提交入口，输出 CLICK_SUBMIT。
5. 如果页面出现“查看我的回答”“编辑回答”“我的回答”等明确表示当前账号已有回答的语义，优先输出 VERIFY_RESULT，不要误判成新回答入口。
6. targetTexts 里放最值得点击的按钮或链接文案，targetRoles 只允许 button 或 link，targetSelectors 只有在页面语义非常明确时才填写。
7. 证据不足时才输出 WAIT。
8. 只输出 JSON，不要解释，不要 Markdown。

输出格式：
{
  "nextAction": "CLICK_WRITE_ANSWER | FOCUS_EDITOR | PASTE_CONTENT | CLICK_SUBMIT | WAIT | VERIFY_RESULT | REQUEST_MANUAL_LOGIN",
  "targetTexts": ["写回答"],
  "targetRoles": ["button"],
  "targetSelectors": [],
  "confidence": "high | medium | low",
  "reason": "一句话说明原因"
}`,
      snapshot,
      {
        nextAction: "WAIT",
        targetTexts: [],
        targetRoles: [],
        targetSelectors: [],
        confidence: "low",
        reason: ""
      }
    );

    return {
      nextAction: result.nextAction ?? "WAIT",
      targetTexts: Array.isArray(result.targetTexts) ? result.targetTexts.map((item: unknown) => String(item)) : [],
      targetRoles: Array.isArray(result.targetRoles)
        ? result.targetRoles.filter((item: unknown): item is "button" | "link" => item === "button" || item === "link")
        : [],
      targetSelectors: Array.isArray(result.targetSelectors)
        ? result.targetSelectors.map((item: unknown) => String(item))
        : [],
      confidence: result.confidence === "high" || result.confidence === "medium" ? result.confidence : "low",
      reason: typeof result.reason === "string" ? result.reason : ""
    };
  }

  private async reviewPublishResult(
    snapshot: PageSnapshot,
    currentUrl: string,
    content: string,
    promptSnapshot?: PromptSnapshotMap | null
  ) {
    const contentSignals = buildPublishContentSignals(content);
    const publishPrompt = await this.llmService.resolvePrompt("publish_agent", {
      promptSnapshot
    });

    const result = await this.llmService.runJsonWithSystemPrompt<PublishResultReview>(
      `${publishPrompt}

补充说明：
你现在执行的是 Publish Agent 的“发布结果判断任务”。
任务目标：
结合页面快照、当前 URL，以及本次待发内容的关键片段，判断发布是否成功。

判断规则：
1. 如果页面明确显示内容风险、发布失败、违规拦截、审核拦截，输出 CONTENT_RISK。
2. 如果页面能看到本次内容片段，或者页面出现“查看我的回答”“编辑回答”“我的回答”等语义，可倾向输出 SUCCESS。
3. 不能只凭 URL 判断成功，必须结合页面语义和内容痕迹。
4. 证据不足时输出 UNCERTAIN。
5. matchedSignals 尽量返回你命中的成功信号、风险信号或内容片段提示。
6. 只输出 JSON，不要解释，不要 Markdown。

输出格式：
{
  "decision": "SUCCESS | CONTENT_RISK | UNCERTAIN",
  "confidence": "high | medium | low",
  "matchedSignals": ["查看我的回答"],
  "reason": "一句话说明原因"
}`,
      {
        snapshot,
        currentUrl,
        expectedContentExcerpt: contentSignals.expectedExcerpt,
        expectedContentSignals: contentSignals.expectedSignals
      },
      {
        decision: "UNCERTAIN",
        confidence: "low",
        matchedSignals: [],
        reason: ""
      }
    );

    const matchedSignals = mergeMatchedSignals(
      Array.isArray(result.matchedSignals) ? result.matchedSignals.map((item: unknown) => String(item)) : [],
      findMatchedExpectedSignals(snapshot, contentSignals.expectedSignals)
    );
    const hasPublishedSemantic = hasPublishedAnswerSemantic(snapshot);
    const editorStillVisible = hasEditorSemantic(snapshot);
    const answerDetailUrl = isAnswerDetailUrl(currentUrl);

    const decision =
      result.decision === "SUCCESS" || result.decision === "CONTENT_RISK" || result.decision === "UNCERTAIN"
        ? result.decision
        : "UNCERTAIN";

    if (decision === "SUCCESS" && editorStillVisible && !answerDetailUrl) {
      return {
        decision: "UNCERTAIN" as const,
        confidence: "low" as const,
        matchedSignals,
        reason: "页面仍停留在编辑态，且当前 URL 不是回答详情页，暂时不能判定为发布成功。"
      };
    }

    if (decision === "SUCCESS" && matchedSignals.length === 0 && !hasPublishedSemantic) {
      return {
        decision: "UNCERTAIN" as const,
        confidence: "low" as const,
        matchedSignals,
        reason:
          typeof result.reason === "string" && result.reason
            ? `${result.reason}；但页面里还没有命中本次待发内容的关键片段。`
            : "页面尚未命中本次待发内容的关键片段，暂时不能判定为发布成功。"
      };
    }

    return {
      decision,
      confidence: result.confidence === "high" || result.confidence === "medium" ? result.confidence : "low",
      matchedSignals,
      reason: typeof result.reason === "string" && result.reason ? result.reason : "发布结果暂时无法确认。"
    };
  }

  private async handleExistingAnswerEntry(input: {
    traceBase: {
      sessionKey: string;
      profileDir: string;
      publishJobId: number;
      publishAttemptId: number | null;
      traceGroupId: string;
      agentName: "publish_agent";
    };
    snapshot: PageSnapshot;
    plan: PublishStepPlan;
    content: string;
    promptSnapshot?: PromptSnapshotMap | null;
    signal: "view" | "edit";
  }): Promise<
    | {
        kind: "completed";
        finalUrl: string;
        screenshotPath: string;
        pageSnapshot: PageSnapshot;
      }
    | {
        kind: "uncertain";
        reason: string;
        currentUrl: string;
        screenshotPath: string | null;
        pageSnapshot: PageSnapshot;
        comparison: ExistingDraftComparison;
      }
    | {
        kind: "continue_editing";
        editorSnapshot: PageSnapshot;
      }
  > {
    await this.clickPlanOrThrow({
      traceBase: input.traceBase,
      snapshot: input.snapshot,
      plan: input.plan,
      failureType: "editor_not_ready",
      errorMessage: "没有找到“查看我的回答”或“编辑回答”的入口。"
    });

    await this.browserSkillService.wait(
      {
        ...input.traceBase,
        stage: "publishing"
      },
      {
        ms: input.signal === "edit" ? 2000 : 2500
      }
    );

    const existingSnapshot = await this.browserSkillService.snapshot({
      ...input.traceBase,
      stage: "publishing"
    });
    const comparison = compareExistingDraftToExpected(existingSnapshot, input.content);

    if (comparison.decision === "MATCHED") {
      const verifiedPage = await this.captureAndReviewPageResult({
        traceBase: input.traceBase,
        stage: "publish_verify",
        currentUrl: existingSnapshot.url,
        snapshot: existingSnapshot,
        content: input.content,
        promptSnapshot: input.promptSnapshot,
        screenshotLabel: `publish-existing-match-${input.traceBase.publishJobId}`
      });

      return {
        kind: "completed",
        finalUrl: verifiedPage.currentUrl,
        screenshotPath: verifiedPage.screenshotPath,
        pageSnapshot: verifiedPage.snapshot
      };
    }

    if (comparison.decision === "SIMILAR") {
      return {
        kind: "uncertain",
        reason: `页面里已存在接近的回答内容，需要人工核对后再决定是否覆盖重发。${comparison.reason}`,
        currentUrl: existingSnapshot.url,
        screenshotPath: null,
        pageSnapshot: existingSnapshot,
        comparison
      };
    }

    const editorSnapshot = await this.prepareEditorForRepaste({
      traceBase: input.traceBase,
      snapshot: existingSnapshot,
      promptSnapshot: input.promptSnapshot
    });

    return {
      kind: "continue_editing",
      editorSnapshot
    };
  }

  private async prepareEditorForRepaste(input: {
    traceBase: {
      sessionKey: string;
      profileDir: string;
      publishJobId: number;
      publishAttemptId: number | null;
      traceGroupId: string;
      agentName: "publish_agent";
    };
    snapshot: PageSnapshot;
    promptSnapshot?: PromptSnapshotMap | null;
  }) {
    const editorPlan = await this.understandPublishPage(input.snapshot, input.promptSnapshot);
    await this.focusEditorOrThrow(input.traceBase, input.snapshot, editorPlan);

    await this.browserSkillService.press(
      {
        ...input.traceBase,
        stage: "publishing"
      },
      {
        key: "Control+A"
      }
    );

    await this.browserSkillService.press(
      {
        ...input.traceBase,
        stage: "publishing"
      },
      {
        key: "Backspace"
      }
    );

    await this.browserSkillService.wait(
      {
        ...input.traceBase,
        stage: "publishing"
      },
      {
        ms: 500
      }
    );

    return this.browserSkillService.snapshot({
      ...input.traceBase,
      stage: "publishing"
    });
  }

  private async focusEditorOrThrow(
    traceBase: {
      sessionKey: string;
      profileDir: string;
      publishJobId: number;
      publishAttemptId: number | null;
      traceGroupId: string;
      agentName: "publish_agent";
    },
    snapshot: PageSnapshot,
    plan: PublishStepPlan
  ) {
    try {
      await this.browserSkillService.focus(
        {
          ...traceBase,
          stage: "publishing"
        },
        {
          selectors: mergeSelectors(plan.targetSelectors, EDITOR_SELECTORS)
        }
      );
    } catch {
      throw new PublishFlowError("editor_not_ready", "没有找到可编辑的输入区域。", snapshot.url, {
        snapshot,
        publishPlan: plan,
        resumeAnchor: {
          stage: "publishing",
          currentUrl: snapshot.url
        }
      });
    }
  }

  private async clickPlanOrThrow(input: {
    traceBase: {
      sessionKey: string;
      profileDir: string;
      publishJobId: number;
      publishAttemptId: number | null;
      traceGroupId: string;
      agentName: "publish_agent";
    };
    snapshot: PageSnapshot;
    plan: PublishStepPlan;
    failureType: FailureType;
    errorMessage: string;
  }) {
    try {
      await this.browserSkillService.click(
        {
          ...input.traceBase,
          stage: "publishing"
        },
        {
          names: input.plan.targetTexts,
          roles: input.plan.targetRoles.length ? input.plan.targetRoles : ["button", "link"],
          selectors: input.plan.targetSelectors
        }
      );
    } catch {
      throw new PublishFlowError(input.failureType, input.errorMessage, input.snapshot.url, {
        snapshot: input.snapshot,
        publishPlan: input.plan,
        resumeAnchor: {
          stage: "publishing",
          currentUrl: input.snapshot.url
        }
      });
    }
  }
}

function mergeSelectors(primary: string[], fallback: string[]) {
  return Array.from(new Set([...primary, ...fallback].filter(Boolean)));
}

function buildFallbackPublishPlan(snapshot: PageSnapshot, expectedActions: PublishStepAction[]): PublishStepPlan | null {
  const combinedTexts = [
    snapshot.title,
    ...snapshot.visibleTexts,
    ...snapshot.buttons,
    ...snapshot.links.map((item) => item.text)
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  if (expectedActions.includes("VERIFY_RESULT")) {
    const existingAnswerText = findFirstMatchingText(combinedTexts, ["查看我的回答", "编辑回答", "我的回答"]);
    if (existingAnswerText) {
      return {
        nextAction: "VERIFY_RESULT",
        targetTexts: [existingAnswerText],
        targetRoles: ["button", "link"],
        targetSelectors: [],
        confidence: "high",
        reason: "页面已经出现当前账号的回答语义，先按已回答状态核验结果。"
      };
    }
  }

  if (expectedActions.includes("CLICK_WRITE_ANSWER")) {
    const writeAnswerText = findFirstMatchingText(combinedTexts, ["写回答"]);
    if (writeAnswerText && !hasEditorSemantic(snapshot) && !hasSubmitSemantic(snapshot)) {
      return {
        nextAction: "CLICK_WRITE_ANSWER",
        targetTexts: [writeAnswerText],
        targetRoles: ["button", "link"],
        targetSelectors: [],
        confidence: "medium",
        reason: "页面仍是问题详情态，存在明确的“写回答”入口。"
      };
    }
  }

  if (hasEditorSemantic(snapshot) && (expectedActions.includes("FOCUS_EDITOR") || expectedActions.includes("PASTE_CONTENT"))) {
    return {
      nextAction: "FOCUS_EDITOR",
      targetTexts: [],
      targetRoles: [],
      targetSelectors: EDITOR_SELECTORS,
      confidence: "high",
      reason: "页面已进入回答编辑态，可直接聚焦编辑器并准备粘贴全文。"
    };
  }

  if (expectedActions.includes("CLICK_SUBMIT")) {
    const submitText = findFirstMatchingText(combinedTexts, ["发布回答", "提交回答", "发布"]);
    if (submitText && hasEditorSemantic(snapshot)) {
      return {
        nextAction: "CLICK_SUBMIT",
        targetTexts: [submitText],
        targetRoles: ["button", "link"],
        targetSelectors: [],
        confidence: "medium",
        reason: "页面已进入编辑态，并且出现了明确的发布入口。"
      };
    }
  }

  return null;
}

function getExistingAnswerSignal(plan: PublishStepPlan): "view" | "edit" | null {
  const combined = [...plan.targetTexts, ...plan.targetSelectors].join(" ");
  if (combined.includes("查看我的回答") || combined.includes("我的回答")) {
    return "view";
  }

  if (combined.includes("编辑回答")) {
    return "edit";
  }

  return null;
}

function buildPublishContentSignals(content: string): PublishContentSignals {
  const trimmed = content.trim();
  const paragraphs = trimmed
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const sentences = trimmed
    .split(/[。！？!?；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const rawCandidates = [...paragraphs.slice(0, 3), ...sentences.slice(0, 6)];
  const expectedSignals = Array.from(
    new Set(
      rawCandidates
        .map((item) => normalizeComparableText(item))
        .filter((item) => item.length >= 18)
        .map((item) => item.slice(0, Math.min(item.length, 36)))
    )
  ).slice(0, 5);

  return {
    expectedExcerpt: trimmed.slice(0, 120),
    expectedSignals
  };
}

function findMatchedExpectedSignals(snapshot: PageSnapshot, expectedSignals: string[]) {
  const snapshotTexts = [
    snapshot.title,
    ...snapshot.visibleTexts,
    ...snapshot.buttons,
    ...snapshot.links.map((item) => item.text)
  ]
    .map((item) => normalizeComparableText(item))
    .filter(Boolean);

  return expectedSignals.filter((signal) => snapshotTexts.some((text) => text.includes(signal)));
}

function mergeMatchedSignals(primary: string[], secondary: string[]) {
  return Array.from(new Set([...primary, ...secondary].filter(Boolean)));
}

function hasPublishedAnswerSemantic(snapshot: PageSnapshot) {
  const combined = [snapshot.title, ...snapshot.visibleTexts, ...snapshot.buttons, ...snapshot.links.map((item) => item.text)].join(" ");
  return ["查看我的回答", "我的回答", "编辑回答", "回答已提交", "已发布"].some((text) => combined.includes(text));
}

function hasEditorSemantic(snapshot: PageSnapshot) {
  if (snapshot.editorContent !== null) {
    return true;
  }

  const combined = [snapshot.title, ...snapshot.visibleTexts, ...snapshot.buttons, ...snapshot.links.map((item) => item.text)].join(" ");
  return ["撤销", "重做", "清除格式", "标题", "加粗", "创作助手", "无声明", "允许规范转载", "任何人都可以评论"].some(
    (text) => combined.includes(text)
  );
}

function hasSubmitSemantic(snapshot: PageSnapshot) {
  const combined = [snapshot.title, ...snapshot.visibleTexts, ...snapshot.buttons, ...snapshot.links.map((item) => item.text)].join(" ");
  return ["发布回答", "提交回答"].some((text) => combined.includes(text));
}

function isAnswerDetailUrl(url: string) {
  return /\/answer\/\d+/i.test(url);
}

function findFirstMatchingText(values: string[], candidates: string[]) {
  for (const candidate of candidates) {
    const matched = values.find((value) => value.includes(candidate));
    if (matched) {
      return matched;
    }
  }

  return null;
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, "").replace(/[.,，。！？!?；;:'\"“”‘’()（）[\]【】《》<>-]/g, "").trim();
}

function compareExistingDraftToExpected(snapshot: PageSnapshot, expectedContent: string): ExistingDraftComparison {
  const expectedNormalized = normalizeComparableText(expectedContent);
  const expectedLength = expectedNormalized.length;
  const expectedSignals = buildPublishContentSignals(expectedContent).expectedSignals;
  const editorCandidate = snapshot.editorContent === null ? null : normalizeComparableText(snapshot.editorContent);

  const candidateTexts =
    editorCandidate !== null
      ? [editorCandidate]
      : Array.from(
          new Set(
            [
              ...snapshot.visibleTexts,
              snapshot.visibleTexts.join(" "),
              snapshot.title,
              ...snapshot.links.map((item) => item.text)
            ]
              .map((item) => normalizeComparableText(item))
              .filter((item) => item.length >= 12)
          )
        );

  let bestText = "";
  let bestOverlapScore = 0;

  for (const candidate of candidateTexts) {
    const overlapScore = computeOverlapScore(expectedNormalized, candidate);
    if (overlapScore > bestOverlapScore) {
      bestOverlapScore = overlapScore;
      bestText = candidate;
    }
  }

  const actualLength = bestText.length;
  const lengthDelta = Math.abs(expectedLength - actualLength);
  const lengthDeltaRatio = expectedLength > 0 ? lengthDelta / expectedLength : 1;
  const matchedSignalCount = expectedSignals.filter((signal) => bestText.includes(signal)).length;

  if (
    bestText &&
    (bestText === expectedNormalized ||
      (bestOverlapScore >= 0.96 && lengthDeltaRatio <= 0.03) ||
      (bestOverlapScore >= 0.92 && lengthDelta <= 20))
  ) {
    return {
      decision: "MATCHED",
      expectedLength,
      actualLength,
      lengthDelta,
      lengthDeltaRatio,
      overlapScore: bestOverlapScore,
      matchedSignalCount,
      reason: `编辑器内容与待发布正文基本一致，长度差 ${lengthDelta} 字，重合度 ${(bestOverlapScore * 100).toFixed(1)}%。`
    };
  }

  if (
    bestText &&
    ((bestOverlapScore >= 0.78 && lengthDeltaRatio <= 0.2) ||
      (bestOverlapScore >= 0.7 && matchedSignalCount >= Math.min(2, Math.max(1, expectedSignals.length))))
  ) {
    return {
      decision: "SIMILAR",
      expectedLength,
      actualLength,
      lengthDelta,
      lengthDeltaRatio,
      overlapScore: bestOverlapScore,
      matchedSignalCount,
      reason: `编辑器内容与待发布正文接近，但还不能确认是同一版，长度差 ${lengthDelta} 字，重合度 ${(bestOverlapScore * 100).toFixed(1)}%。`
    };
  }

  return {
    decision: "MISMATCH",
    expectedLength,
    actualLength,
    lengthDelta,
    lengthDeltaRatio,
    overlapScore: bestOverlapScore,
    matchedSignalCount,
    reason: `编辑器内容与待发布正文差异较大，长度差 ${lengthDelta} 字，重合度 ${(bestOverlapScore * 100).toFixed(1)}%。`
  };
}

function computeOverlapScore(expected: string, actual: string) {
  if (!expected || !actual) {
    return 0;
  }

  const minGram = 12;
  if (expected.length < minGram || actual.length < minGram) {
    return expected === actual ? 1 : 0;
  }

  const grams = new Set<string>();
  for (let index = 0; index <= expected.length - minGram; index += 1) {
    grams.add(expected.slice(index, index + minGram));
  }

  if (grams.size === 0) {
    return 0;
  }

  let matched = 0;
  for (const gram of grams) {
    if (actual.includes(gram)) {
      matched += 1;
    }
  }

  return matched / grams.size;
}
