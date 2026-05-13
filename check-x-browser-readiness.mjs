import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getXAppConfig } from "./packages/x-core/dist/x-core/src/config.js";
import { XBrowserRuntime } from "./packages/x-core/dist/x-core/src/services/x-browser-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = getXAppConfig();
const browserRuntime = new XBrowserRuntime();

async function main() {
  const targetArg = process.argv.find((arg) => arg.startsWith("--account="));
  const targetValue = targetArg ? targetArg.slice("--account=".length).trim() : null;

  console.log("X browser readiness check");
  console.log("========================");
  console.log(`Publish mode: ${config.publishMode}`);
  console.log(`Browser channel: ${config.browserChannel}`);
  console.log(`Headless: ${config.browserHeadless ? "true" : "false"}`);
  console.log(`Proxy: ${config.browserProxyUrl ?? "none"}`);
  console.log(`Feishu webhook: ${config.xFeishuBotWebhookUrl ? "configured" : "missing"}`);
  console.log("");

  const accounts = await loadAccounts();
  if (accounts.length === 0) {
    throw new Error(`No X accounts found in ${path.join(config.dataDir, "accounts.json")}`);
  }

  const account =
    accounts.find((item) => matchesAccount(item, targetValue)) ??
    accounts.find((item) => item.status === "active") ??
    accounts[0];

  console.log(`Using account: ${account.name} (@${account.handle})`);
  console.log(`Profile dir: ${account.profileDir}`);
  console.log(`Auth status: ${account.authStatus ?? "null"}`);

  if (account.authStatus !== "ready") {
    throw new Error(`Account authStatus is ${account.authStatus ?? "null"}, not ready.`);
  }

  const loginCheck = await browserRuntime.verifyLogin(account);
  console.log(`Login verify: ${loginCheck.success ? "ok" : "failed"}`);
  if (!loginCheck.success) {
    throw new Error(loginCheck.errorMessage ?? "Login verification failed.");
  }

  const composeSessionKey = `readiness-${account.id}`;
  try {
    const composeResult = await browserRuntime.withSession(
      composeSessionKey,
      account.profileDir,
      account.proxyUrl,
      async (page) => {
        await page.goto(`${config.xBaseUrl}/compose/post`, {
          waitUntil: "domcontentloaded",
          timeout: 45_000
        });
        await page.waitForTimeout(2_500);

        const editorSelector = await findFirstVisibleSelector(page, [
          "[data-testid='tweetTextarea_0']",
          "[data-testid='tweetTextarea_0'] div[contenteditable='true']",
          "[role='textbox']"
        ]);
        const submitSelector = await findFirstVisibleSelector(page, [
          "[data-testid='tweetButton']",
          "[data-testid='tweetButtonInline']"
        ]);
        const loginSelector = await findFirstVisibleSelector(page, [
          "a[href='/i/flow/login']",
          "[data-testid='loginButton']",
          "input[autocomplete='username']"
        ]);

        return {
          currentUrl: page.url(),
          title: await page.title(),
          editorSelector,
          submitSelector,
          loginSelector
        };
      }
    );

    console.log(`Compose URL: ${composeResult.currentUrl}`);
    console.log(`Page title: ${composeResult.title}`);
    console.log(`Editor found: ${composeResult.editorSelector ?? "no"}`);
    console.log(`Submit button found: ${composeResult.submitSelector ?? "no"}`);
    console.log(`Login prompt found: ${composeResult.loginSelector ?? "no"}`);
    console.log("");

    const isReady =
      Boolean(composeResult.editorSelector) &&
      Boolean(composeResult.submitSelector) &&
      !composeResult.loginSelector;

    if (!isReady) {
      throw new Error("Compose page is reachable, but the publish editor is not fully ready.");
    }

    console.log("Readiness result: READY");
    console.log("The account can open the compose page and locate the publish editor without posting.");
  } finally {
    await browserRuntime.closeSession(composeSessionKey);
  }
}

async function loadAccounts() {
  const filePath = path.join(config.dataDir, "accounts.json");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function matchesAccount(account, targetValue) {
  if (!targetValue) {
    return false;
  }

  return account.id === targetValue || account.handle === targetValue || account.name === targetValue;
}

async function findFirstVisibleSelector(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        return selector;
      }
    } catch {
      continue;
    }
  }

  return null;
}

main().catch(async (error) => {
  console.error("");
  console.error(`Readiness result: FAILED`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
