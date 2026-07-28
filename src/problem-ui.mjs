import { execFile } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function waitForEnter(message) {
  const rl = readline.createInterface({ input, output });
  await rl.question(`\n${message}\nPress Enter here when done... `);
  rl.close();
}

export async function focusBrowserWindow(page) {
  await page?.bringToFront?.().catch(() => {});

  const apps = [
    "Google Chrome",
    "Google Chrome for Testing",
    "Chromium",
  ];

  for (const app of apps) {
    await new Promise((resolve) => {
      execFile(
        "osascript",
        ["-e", `tell application "${app}" to activate`],
        () => resolve()
      );
    });
  }
}

export async function waitForManualFix(page, message) {
  await focusBrowserWindow(page);
  await waitForEnter(message);
}

export async function looksLikeCaptchaOrChallenge(page) {
  const url = page.url().toLowerCase();

  // Strong URL-based signals only.
  if (
    url.includes("checkpoint") ||
    url.includes("captcha") ||
    url.includes("challenge") ||
    url.includes("arkoselabs") ||
    url.includes("recaptcha")
  ) {
    return true;
  }

  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");

  const text = bodyText.toLowerCase();

  // Strong phrase matches only. Do NOT match generic words like "verification".
  const strongPhrases = [
    "verify you are human",
    "confirm you're not a robot",
    "confirm you are not a robot",
    "security check required",
    "complete the security check",
    "complete this security check",
    "captcha verification",
    "enter the characters you see",
    "drag the slider",
    "solve this puzzle",
    "temporarily blocked",
    "unusual traffic from your computer network",
    "we need to check that you are not a robot",
    "please complete the captcha",
  ];

  if (strongPhrases.some((phrase) => text.includes(phrase))) {
    return true;
  }

  // iframe/widget signals.
  const iframeCount = await page
    .locator(
      'iframe[src*="captcha"], iframe[src*="challenge"], iframe[src*="recaptcha"], iframe[src*="arkoselabs"], iframe[title*="captcha" i], iframe[title*="challenge" i]'
    )
    .count()
    .catch(() => 0);

  if (iframeCount > 0) return true;

  // Visible captcha input/widget signals.
  const captchaInputCount = await page
    .locator(
      'input[name*="captcha" i], input[id*="captcha" i], [class*="captcha" i], [id*="captcha" i]'
    )
    .count()
    .catch(() => 0);

  return captchaInputCount > 0;
}

export async function looksLikeLoginPage(page) {
  const url = page.url().toLowerCase();

  if (
    url.includes("/login") ||
    url.includes("signin") ||
    url.includes("sign-in") ||
    url.includes("checkpoint")
  ) {
    return true;
  }

  const passwordInputs = await page
    .locator('input[type="password"]:visible')
    .count()
    .catch(() => 0);

  return passwordInputs > 0;
}
