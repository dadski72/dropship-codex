import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const PROJECT_ROOT = '/Users/dadski/Projects/dropship-codex';
export const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
export const DEBUG_DIR = path.join(OUTPUT_DIR, 'debug');

export const PROFILES = {
  kalodata: path.join(PROJECT_ROOT, 'profiles', 'kalodata'),
  facebook: path.join(PROJECT_ROOT, 'profiles', 'facebook'),
  aliexpress: path.join(PROJECT_ROOT, 'profiles', 'aliexpress'),
  tiktok: path.join(PROJECT_ROOT, 'profiles', 'tiktok'),
};

const LOGIN_TEXT = [
  'log in',
  'login',
  'sign in',
  'signin',
  'continue with facebook',
  'continue with google',
  'email or phone',
  'phone number or email',
  'password',
];

export async function ensureOutputDirs() {
  await mkdir(DEBUG_DIR, { recursive: true });
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openSiteContext(site, startUrl = 'about:blank') {
  await ensureOutputDirs();
  await mkdir(PROFILES[site], { recursive: true });

  console.log(`[${site}] Opening Chromium with persistent profile.`);
  const context = await chromium.launchPersistentContext(PROFILES[site], {
    headless: false,
    viewport: { width: 1440, height: 950 },
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();
  for (const extraPage of pages.slice(1)) {
    await extraPage.close().catch(() => {});
  }

  page.setDefaultTimeout(12_000);
  page.setDefaultNavigationTimeout(45_000);

  if (startUrl !== 'about:blank') {
    await goto(page, startUrl);
  }

  return { context, page };
}

export async function goto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}

export async function pauseForEnter(message) {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

export async function isLoginScreen(page) {
  const url = page.url().toLowerCase();
  if (/(login|signin|auth|account\/login|passport)/i.test(url)) return true;

  return page.evaluate((loginText) => {
    const visibleText = (document.body?.innerText || '').toLowerCase().slice(0, 30_000);
    const hasPasswordInput = Boolean(document.querySelector('input[type="password"]'));
    const hasLoginText = loginText.some((text) => visibleText.includes(text));
    const hasProductData = /product|price|sales|revenue|orders|rating|reviews|ads library/.test(visibleText);
    return hasPasswordInput || (hasLoginText && !hasProductData);
  }, LOGIN_TEXT).catch(() => false);
}

export async function pauseForLoginIfNeeded(page) {
  if (!(await isLoginScreen(page))) return false;

  await pauseForEnter('Login required. Log in manually in the opened browser, then press Enter to continue.');
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  return true;
}

export async function safeClick(pageOrLocator, selector, options = {}) {
  try {
    const locator = typeof selector === 'string' ? pageOrLocator.locator(selector).first() : selector.first();
    await locator.waitFor({ state: 'visible', timeout: options.timeout ?? 3_000 });
    await locator.click({ timeout: options.timeout ?? 3_000 });
    return true;
  } catch {
    return false;
  }
}

export async function safeText(locator, fallback = '') {
  try {
    const text = await locator.first().innerText({ timeout: 2_000 });
    return normalizeText(text);
  } catch {
    return fallback;
  }
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export async function screenshotOnError(page, site, label, error) {
  await ensureOutputDirs();
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const fileName = `${site}-${safeLabel}-${Date.now()}.png`;
  const filePath = path.join(DEBUG_DIR, fileName);
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    console.error(`[${site}] ${label} failed: ${error?.message ?? error}. Screenshot: output/debug/${fileName}`);
  } catch (screenshotError) {
    console.error(`[${site}] ${label} failed: ${error?.message ?? error}. Screenshot failed: ${screenshotError?.message ?? screenshotError}`);
  }
}

export async function runWithScreenshot(page, site, label, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    await screenshotOnError(page, site, label, error);
    return fallback;
  }
}

export async function writeJson(fileName, data) {
  await ensureOutputDirs();
  const { writeFile } = await import('node:fs/promises');
  const filePath = path.join(OUTPUT_DIR, fileName);
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return filePath;
}

export function parseMoney(value) {
  const text = normalizeText(value);
  const match = text.match(/(?:US\s*)?\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

export function estimateSellPrice(product) {
  const price = parseMoney(product.price);
  if (price && price >= 80 && price <= 200) return price;
  if (price && price < 80) return Math.min(200, Math.max(80, Math.round(price * 2.8)));
  return null;
}

