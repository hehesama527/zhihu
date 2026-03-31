import test from "node:test";
import assert from "node:assert/strict";
import { SessionService } from "../src/services/session-service.ts";

function createSessionService() {
  return new SessionService({} as never);
}

test("treats Zhihu account settings pages as active even when they mention login-related text", async () => {
  const service = createSessionService();

  const result = await service.detectSessionState({
    url: "https://www.zhihu.com/settings/account",
    title: "账号设置 - 知乎",
    visibleTexts: ["账号设置", "登录方式", "绑定手机", "绑定邮箱"],
    buttons: ["修改", "绑定"],
    links: [{ text: "账号设置", href: "https://www.zhihu.com/settings/account" }]
  });

  assert.equal(result.session_state, "active");
});

test("detects real sign-in pages as login_required", async () => {
  const service = createSessionService();

  const result = await service.detectSessionState({
    url: "https://www.zhihu.com/signin",
    title: "登录知乎",
    visibleTexts: ["登录/注册", "手机号登录", "密码登录"],
    buttons: ["获取短信验证码", "立即登录"],
    links: []
  });

  assert.equal(result.session_state, "login_required");
});

test("detects challenge pages as session_expired", async () => {
  const service = createSessionService();

  const result = await service.detectSessionState({
    url: "https://www.zhihu.com/account/unhuman",
    title: "安全验证 - 知乎",
    visibleTexts: ["安全验证", "请完成验证", "拖动滑块完成验证"],
    buttons: ["开始验证"],
    links: []
  });

  assert.equal(result.session_state, "session_expired");
});

test("does not misclassify ordinary page text mentioning login as a login prompt", async () => {
  const service = createSessionService();

  const result = await service.detectSessionState({
    url: "https://www.zhihu.com/question/123456789",
    title: "为什么有些网站要求重复登录？",
    visibleTexts: ["有人讨论重复登录的体验问题", "这里不是登录页"],
    buttons: ["赞同", "评论"],
    links: []
  });

  assert.equal(result.session_state, "unknown");
});
