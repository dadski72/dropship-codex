import { chromium } from "playwright";
import path from "node:path";
import {
  focusBrowserWindow,
  waitForManualFix,
  looksLikeCaptchaOrChallenge,
} from "./problem-ui.mjs";

const ROOT = "/Users/dadski/Projects/dropship-codex";
const PROFILE = path.join(ROOT, "profiles/tiktok");

function titleOf(product) {
  return (
    product?.title ||
    product?.productTitle ||
    product?.name ||
    product?.product ||
    ""
  );
}

function cleanQuery(value) {
  return String(value ?? "")
    .replace(/[^\w\s&'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productIdFromKalodataUrl(product) {
  const candidates = [
    product?.kalodataUrl,
    product?.productUrl,
    product?.url,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const id = url.searchParams.get("id");
      if (/^\d{10,}$/.test(id || "")) return id;
    } catch {
      const match = String(candidate).match(/[?&]id=(\d{10,})/);
      if (match) return match[1];
    }
  }

  return "";
}

function slugify(value) {
  return cleanQuery(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "product";
}

function distinctiveTitleTokens(product) {
  const stop = new Set([
    "with",
    "from",
    "this",
    "that",
    "for",
    "and",
    "the",
    "new",
    "arrival",
    "heavy",
    "duty",
    "portable",
    "wireless",
    "electric",
    "smart",
    "remote",
    "control",
    "home",
    "office",
    "kids",
    "baby",
    "toddler",
    "toddlers",
    "gift",
    "fathersdaygift",
  ]);

  return cleanQuery(titleOf(product))
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length >= 4)
    .filter((word) => !stop.has(word))
    .slice(0, 12);
}

function buildTikTokUrl(product) {
  const query = cleanQuery(titleOf(product));
  return `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`;
}

function buildTikTokShopPdpUrl(product) {
  const id = productIdFromKalodataUrl(product);
  if (!id) return "";

  return `https://www.tiktok.com/shop/pdp/${slugify(titleOf(product))}/${id}?source=ecommerce_store&region=US`;
}

async function launchTikTokContext({ visible = false, foreground = false } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: visible ? false : process.env.VISIBLE_BROWSER === "1" ? false : true,
    viewport: { width: 1440, height: 1000 },
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  if (foreground) {
    await focusBrowserWindow(page);
  }

  return { context, page };
}

async function openTikTokPage(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(4000);
}

async function scrollTikTokProductPage(page) {
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 900).catch(() => {});
    await page.waitForTimeout(700);
  }
}

async function openTikTokForegroundForManual(product, reason) {
  const url = buildTikTokUrl(product);

  const { context, page } = await launchTikTokContext({
    visible: true,
    foreground: true,
  });

  await openTikTokPage(page, url).catch(() => {});

  await waitForManualFix(
    page,
    `TikTok needs manual attention: ${reason}

Product:
${titleOf(product)}

Fix captcha/login/page in the foreground TikTok browser window.`
  );

  await page.waitForTimeout(2000);

  return { context, page };
}

async function extractTikTokStatus(page, product = {}) {
  await scrollTikTokProductPage(page);

  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 8000 })
    .catch(() => "");

  const text = bodyText.toLowerCase();

  const resultCount = await page.evaluate(() => {
    const selectors = [
      'a[href*="/video/"]',
      'div[data-e2e*="search"]',
      'div[data-e2e*="recommend"]',
      'div[class*="DivItemContainer"]',
      'div[class*="video"]'
    ];

    let max = 0;

    for (const selector of selectors) {
      max = Math.max(max, document.querySelectorAll(selector).length);
    }

    return max;
  }).catch(() => 0);

  const officialShopEvidence = await page.evaluate((tokens) => {
    const terms = [
      "official shop",
      "officialshop",
      "official store",
      "verified shop",
      "verified store",
      "verified seller",
      "authorized store",
      "authorized seller",
    ];

    const normalize = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    const hasOfficialTerm = (value) => terms.some((term) => value.includes(term));
    const hasProductToken = (value) => tokens.some((token) => token.length >= 4 && value.includes(token));
    const elements = [...document.querySelectorAll("body *")]
      .filter((el) => {
        if (el === document.body || el === document.documentElement) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const text = normalize(el.textContent);
        return text.length > 0 && text.length <= 500 && hasOfficialTerm(text);
      })
      .slice(0, 80);

    const snippets = [];

    for (const el of elements) {
      const candidates = [normalize(el.textContent)];
      let node = el.parentElement;

      for (let depth = 0; node && depth < 3; depth += 1) {
        if (node === document.body || node === document.documentElement) break;
        const candidate = normalize(node.textContent);
        if (candidate.length <= 500) {
          candidates.push(candidate);
        }
        node = node.parentElement;
      }

      const best = candidates
        .filter((candidate) => hasOfficialTerm(candidate))
        .sort((a, b) => {
          const aToken = hasProductToken(a) ? 0 : 1;
          const bToken = hasProductToken(b) ? 0 : 1;
          return aToken - bToken || a.length - b.length;
        })[0];

      if (!best || snippets.includes(best)) continue;
      snippets.push(best);
    }

    const tokenHit = snippets.find((snippet) => hasProductToken(snippet));

    return {
      officialTextSeen: snippets.length > 0,
      matchedSnippet: tokenHit || "",
      snippets: snippets.slice(0, 5),
    };
  }, distinctiveTitleTokens(product)).catch(() => ({
    officialTextSeen: false,
    matchedSnippet: "",
    snippets: [],
  }));

  const officialShop = Boolean(officialShopEvidence.matchedSnippet);

  const noResults =
    text.includes("no results found") ||
    text.includes("couldn't find") ||
    text.includes("no videos found");

  if (officialShop) {
    return {
      tiktokStatus: "branded / official shop risk",
      tiktokOfficialShop: true,
      tiktokResultCount: resultCount,
      tiktokNotes: `TikTok official-shop badge matched current product/shop context: ${officialShopEvidence.matchedSnippet}`,
      tiktokOfficialShopEvidence: officialShopEvidence,
      tiktokUrl: page.url(),
    };
  }

  if (noResults) {
    return {
      tiktokStatus: "no clear TikTok result",
      tiktokOfficialShop: false,
      tiktokResultCount: resultCount,
      tiktokNotes: "TikTok search loaded but no obvious result was found.",
      tiktokUrl: page.url(),
    };
  }

  return {
    tiktokStatus: "success",
    tiktokOfficialShop: false,
    tiktokResultCount: resultCount,
    tiktokNotes: officialShopEvidence.officialTextSeen
      ? `TikTok page loaded. OFFICIAL SHOP text appeared elsewhere on the page, but it did not match the current product/shop context.`
      : `TikTok page loaded. Visible result signal count: ${resultCount}. No official shop indicator detected in relevant text.`,
    tiktokOfficialShopEvidence: officialShopEvidence,
    tiktokUrl: page.url(),
  };
}

export async function checkTikTokProduct(product) {
  const directPdpUrl = buildTikTokShopPdpUrl(product);
  const searchUrl = buildTikTokUrl(product);

  let context;

  try {
    const opened = await launchTikTokContext({
      visible: process.env.VISIBLE_BROWSER === "1",
      foreground: false,
    });

    context = opened.context;
    const page = opened.page;

    try {
      if (directPdpUrl) {
        console.log(`[tiktok] Opening TikTok Shop PDP from Kalodata id: ${directPdpUrl}`);
        await openTikTokPage(page, directPdpUrl);

        const directStatus = await extractTikTokStatus(page, product);
        if (
          directStatus.tiktokOfficialShop ||
          directStatus.tiktokStatus !== "no clear TikTok result"
        ) {
          return directStatus;
        }
      }

      await openTikTokPage(page, searchUrl);
    } catch (err) {
      await context.close().catch(() => {});
      context = null;

      const manual = await openTikTokForegroundForManual(
        product,
        `page failed to load/spawn: ${err.message}`
      );

      context = manual.context;
      return await extractTikTokStatus(manual.page, product);
    }

    if (await looksLikeCaptchaOrChallenge(page)) {
      await context.close().catch(() => {});
      context = null;

      const manual = await openTikTokForegroundForManual(
        product,
        "captcha / security verification detected"
      );

      context = manual.context;

      if (await looksLikeCaptchaOrChallenge(manual.page)) {
        return {
          tiktokStatus: "manual verification needed",
          tiktokOfficialShop: false,
          tiktokNotes: "TikTok captcha/security check still detected after manual step.",
        };
      }

      return await extractTikTokStatus(manual.page, product);
    }

    return await extractTikTokStatus(page, product);
  } catch (err) {
    if (context) {
      await context.close().catch(() => {});
      context = null;
    }

    const manual = await openTikTokForegroundForManual(
      product,
      `unexpected TikTok error: ${err.message}`
    );

    context = manual.context;
    return await extractTikTokStatus(manual.page, product);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

export async function researchTikTok(input) {
  if (Array.isArray(input)) {
    const results = [];

    for (const product of input) {
      console.log(`[tiktok] Checking: ${titleOf(product)}`);

      const tiktok = await checkTikTokProduct(product);

      console.log(`[tiktok] Success: ${tiktok.tiktokStatus}; visible result signal count=${tiktok.tiktokResultCount ?? 0}`);

      results.push({
        ...product,
        ...tiktok,
      });
    }

    return results;
  }

  return await checkTikTokProduct(input);
}

export async function loginTikTok() {
  console.log("[tiktok] Login/captcha is handled on demand in foreground only when needed.");
  return {
    ok: true,
    loginRequired: false,
  };
}

// Compatibility aliases for different runner names.
export const checkTikTok = checkTikTokProduct;
export const checkTikTokShop = checkTikTokProduct;
export const researchTikTokShop = researchTikTok;
export const verifyTikTok = checkTikTokProduct;

export default researchTikTok;
