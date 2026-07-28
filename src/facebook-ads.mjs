import { chromium } from "playwright";
import path from "node:path";
import {
  focusBrowserWindow,
  waitForManualFix,
  looksLikeCaptchaOrChallenge,
  looksLikeLoginPage,
} from "./problem-ui.mjs";

const ROOT = "/Users/dadski/Projects/dropship-codex";
const FACEBOOK_PROFILE = path.join(ROOT, "profiles/facebook");

const ADS_LIBRARY_URL =
  "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&is_targeted_country=false&media_type=all";

function cleanSearchText(text = "") {
  return String(text)
    .replace(/[^\w\s&'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(product) {
  return (
    product?.title ||
    product?.productTitle ||
    product?.name ||
    product?.product ||
    ""
  );
}

function meaningfulWords(text = "") {
  const stop = new Set([
    "with",
    "and",
    "for",
    "the",
    "this",
    "that",
    "from",
    "plus",
    "new",
    "hot",
    "best",
    "sale",
    "free",
    "shipping",
    "adjustable",
    "portable",
    "electric",
    "official",
    "store",
  ]);

  return cleanSearchText(text)
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length >= 3)
    .filter((w) => !stop.has(w.toLowerCase()));
}

function buildFacebookQueries(product) {
  const queries = [];

  const brandish =
    product?.brand ||
    product?.brandName ||
    product?.shop ||
    product?.shopName ||
    product?.seller ||
    product?.storeName;

  if (brandish) queries.push(cleanSearchText(brandish));

  const title = titleOf(product);
  const words = meaningfulWords(title);

  if (words.length >= 3) queries.push(words.slice(0, 5).join(" "));
  if (words.length >= 2) queries.push(words.slice(0, 3).join(" "));
  if (title) queries.push(cleanSearchText(title));

  return [...new Set(queries.filter(Boolean))].slice(0, 4);
}

async function launchFacebookContext({ visible = false, foreground = false } = {}) {
  const context = await chromium.launchPersistentContext(FACEBOOK_PROFILE, {
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

async function openFacebookForeground(product, query, reason) {
  const url = `${ADS_LIBRARY_URL}&q=${encodeURIComponent(query || titleOf(product))}`;

  const { context, page } = await launchFacebookContext({
    visible: true,
    foreground: true,
  });

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  }).catch(() => {});

  await waitForManualFix(
    page,
    `Facebook Ads Library needs manual attention: ${reason}

Product:
${titleOf(product)}

Query:
${query || ""}

Fix captcha/login/page in the foreground Facebook browser window.`
  );

  await page.waitForTimeout(2000);

  return { context, page };
}

async function getSearchBox(page) {
  const selectors = [
    'input[placeholder*="Search" i]',
    'input[type="search"]',
    'input[role="combobox"]',
  ];

  for (const selector of selectors) {
    const box = page.locator(selector).first();
    const count = await box.count().catch(() => 0);
    if (count === 0) continue;

    const visible = await box.isVisible().catch(() => false);
    if (!visible) continue;

    return box;
  }

  return null;
}

async function getSearchBoxValue(page) {
  const box = await getSearchBox(page);
  if (!box) return "";

  return await box
    .inputValue()
    .catch(async () => {
      return await box.evaluate((el) => el.value || el.textContent || "").catch(() => "");
    });
}

async function fillSearchBox(page, query) {
  const box = await getSearchBox(page);
  if (!box) return false;

  try {
    await box.click({ timeout: 5000 });

    await box.fill("").catch(async () => {
      await page.keyboard.press("Meta+A").catch(() => {});
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
    });

    await box.evaluate((el) => {
      el.value = "";
      el.textContent = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }).catch(() => {});

    await page.waitForTimeout(300);

    await box.fill(query).catch(async () => {
      await page.keyboard.type(query, { delay: 20 });
    });

    await page.keyboard.press("Enter");
    return true;
  } catch {
    return false;
  }
}

async function pageHasNoAds(page) {
  const noAdsCount = await page
    .locator(
      'text=/No ads match your search criteria|No results found|No ads found|We didn.t find any ads/i'
    )
    .count()
    .catch(() => 0);

  return noAdsCount > 0;
}

async function countPossibleAdCards(page) {
  const selectors = [
    'text=/Library ID/i',
    'text=/Active/i',
    'div:has-text("Library ID")',
  ];

  let maxCount = 0;

  for (const selector of selectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > maxCount) maxCount = count;
  }

  return maxCount;
}

async function extractFacebookAdvertisers(page) {
  return await page.evaluate(() => {
    function clean(value) {
      return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function text(el) {
      return String(el?.innerText || el?.textContent || "")
        .replace(/\r/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
    }

    function normalizeName(value) {
      return clean(value)
        .toLowerCase()
        .replace(/[^a-z0-9&'. -]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function plausibleAdvertiser(line) {
      const value = clean(line);
      const lower = value.toLowerCase();
      if (!value || value.length < 2 || value.length > 90) return false;
      if (/^\d+$/.test(value)) return false;
      if (/^\$/.test(value)) return false;
      if (/\blibrary id\b/i.test(value)) return false;
      if (/\b(active|inactive|sponsored|started running|platforms|facebook|instagram|messenger|audience network)\b/i.test(value)) return false;
      if (/\b(about this ad|ad details|see ad details|learn more|shop now|send message|get offer|this ad|multiple versions)\b/i.test(value)) return false;
      if (/^\d+\s+(ads?|results?)$/i.test(value)) return false;
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value)) return false;
      return lower !== "meta";
    }

    function advertiserFromCard(rawText) {
      const lines = rawText
        .split("\n")
        .map((line) => clean(line))
        .filter(Boolean);

      const sponsoredIndex = lines.findIndex((line) => /^sponsored$/i.test(line));
      if (sponsoredIndex > 0) {
        for (let i = sponsoredIndex - 1; i >= 0; i -= 1) {
          if (plausibleAdvertiser(lines[i])) return lines[i];
        }
      }

      const libraryIndex = lines.findIndex((line) => /\blibrary id\b/i.test(line));
      if (libraryIndex > 0) {
        for (let i = libraryIndex - 1; i >= 0; i -= 1) {
          if (plausibleAdvertiser(lines[i])) return lines[i];
        }
      }

      for (const line of lines.slice(0, 12)) {
        if (plausibleAdvertiser(line)) return line;
      }

      return "";
    }

    const selected = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;

    while ((node = walker.nextNode())) {
      if (!/\blibrary id\b/i.test(node.nodeValue || "")) continue;

      let el = node.parentElement;
      let card = null;

      for (let depth = 0; el && depth < 10; depth += 1, el = el.parentElement) {
        const raw = text(el);
        if (!/\blibrary id\b/i.test(raw)) continue;
        if (raw.length >= 80 && raw.length <= 5000) {
          card = el;
          break;
        }
      }

      if (!card) continue;
      if (selected.some((existing) => existing === card || existing.contains(card) || card.contains(existing))) continue;
      selected.push(card);
    }

    const names = [];
    const seen = new Set();

    for (const card of selected) {
      const name = advertiserFromCard(text(card));
      const key = normalizeName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }

    return {
      advertiserNames: names,
      uniqueAdvertiserCount: names.length,
      sampledCardCount: selected.length,
    };
  }).catch(() => ({
    advertiserNames: [],
    uniqueAdvertiserCount: 0,
    sampledCardCount: 0,
  }));
}


async function extractFacebookVisibleResultCount(page) {
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");

  const match = bodyText.match(/~?\s*([\d,]+)\s+results/i);
  if (!match) return 0;

  return Number(match[1].replace(/,/g, "")) || 0;
}

function logFacebookResult(result) {
  const countText = result.uniqueAdvertiserCount
    ? `${result.uniqueAdvertiserCount} unique advertiser(s), ${result.visibleResultCount || result.adCount || 0} raw ad/result signal(s)`
    : result.visibleResultCount
      ? `${result.visibleResultCount} visible result(s)`
    : result.adCount
      ? `${result.adCount} ad card signal(s)`
      : "0 visible result(s)";

  if (result.status === "active ads found") {
    console.log(`[facebook] Success: ${countText} for query "${result.query}"`);
  } else if (result.status === "no active ads found") {
    console.log(`[facebook] Success: searched query "${result.query}", no active ads found.`);
  } else {
    console.log(`[facebook] Check complete: ${result.status} for query "${result.query}"`);
  }
}

async function runSingleSearch(page, query) {
  const url = `${ADS_LIBRARY_URL}&q=${encodeURIComponent(query)}`;

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  if (await looksLikeLoginPage(page)) {
    return {
      query,
      status: "manual foreground required",
      reason: "login/checkpoint detected",
    };
  }

  // If normal FB results are visible, do not treat random page text as captcha.
  const visibleResultCount = await extractFacebookVisibleResultCount(page);
  const earlyAdCount = await countPossibleAdCards(page);
  const earlyAdvertisers = await extractFacebookAdvertisers(page);

  if (visibleResultCount > 0 || earlyAdCount > 0 || earlyAdvertisers.uniqueAdvertiserCount > 0) {
    return {
      query,
      status: "active ads found",
      adCount: earlyAdCount,
      visibleResultCount,
      uniqueAdvertiserCount: earlyAdvertisers.uniqueAdvertiserCount,
      advertiserNames: earlyAdvertisers.advertiserNames,
      sampledCardCount: earlyAdvertisers.sampledCardCount,
      notes: `Possible active ads found for query: ${query}`,
    };
  }

  if (await pageHasNoAds(page)) {
    return {
      query,
      status: "no active ads found",
      adCount: 0,
      notes: "Meta Ads Library returned no matching active ads.",
    };
  }

  if (await looksLikeCaptchaOrChallenge(page)) {
    return {
      query,
      status: "manual foreground required",
      reason: "captcha/security check detected",
    };
  }

  const currentValue = (await getSearchBoxValue(page)).trim();

  if (currentValue.toLowerCase() !== query.toLowerCase()) {
    await fillSearchBox(page, query).catch(() => false);
    await page.waitForTimeout(5000);
  }

  if (await pageHasNoAds(page)) {
    return {
      query,
      status: "no active ads found",
      adCount: 0,
      notes: "Meta Ads Library returned no matching active ads.",
    };
  }

  const finalVisibleResultCount = await extractFacebookVisibleResultCount(page);
  const adCount = await countPossibleAdCards(page);
  const advertisers = await extractFacebookAdvertisers(page);

  if (finalVisibleResultCount > 0 || adCount > 0 || advertisers.uniqueAdvertiserCount > 0) {
    return {
      query,
      status: "active ads found",
      adCount,
      visibleResultCount: finalVisibleResultCount,
      uniqueAdvertiserCount: advertisers.uniqueAdvertiserCount,
      advertiserNames: advertisers.advertiserNames,
      sampledCardCount: advertisers.sampledCardCount,
      notes: `Possible active ads found for query: ${query}`,
    };
  }

  return {
    query,
    status: "manual verification needed",
    adCount: 0,
    notes: "Ads Library loaded, but result state was unclear.",
  };
}

export async function checkFacebookAds(product) {
  const queries = buildFacebookQueries(product);

  console.log(`[facebook] Checking ads for: ${titleOf(product)}`);

  if (queries.length === 0) {
    return {
      facebookAdsStatus: "manual verification needed",
      facebookAdCount: 0,
      facebookQueries: [],
      facebookWinningQuery: "",
      facebookSearchTextWithResults: "",
      facebookNotes: "No usable Facebook search query could be generated.",
    };
  }

  let context;

  try {
    const opened = await launchFacebookContext({
      visible: process.env.VISIBLE_BROWSER === "1",
      foreground: false,
    });

    context = opened.context;
    const page = opened.page;

    const results = [];

    for (const query of queries) {
      console.log(`[facebook] Search query: ${query}`);

      let result;

      try {
        result = await runSingleSearch(page, query);
      } catch (err) {
        result = {
          query,
          status: "manual foreground required",
          reason: `page failed to load/spawn: ${err.message}`,
        };
      }

      if (result.status === "manual foreground required") {
        await context.close().catch(() => {});
        context = null;

        const manual = await openFacebookForeground(product, query, result.reason);
        context = manual.context;

        result = await runSingleSearch(manual.page, query).catch((err) => ({
          query,
          status: "manual verification needed",
          adCount: 0,
          notes: `Facebook still unclear after manual step: ${err.message}`,
        }));
      }

      results.push(result);
      logFacebookResult(result);

      if (result.status === "active ads found") break;
    }

    const active = results.find((r) => r.status === "active ads found");
    const noAds = results.some((r) => r.status === "no active ads found");

    if (active) {
      const advertiserCount = active.uniqueAdvertiserCount || 0;
      return {
        facebookAdsStatus: "active ads found",
        facebookAdCount: advertiserCount || active.visibleResultCount || active.adCount,
        facebookRawAdCount: active.visibleResultCount || active.adCount || 0,
        facebookAdCardCount: active.adCount || 0,
        facebookVisibleResultCount: active.visibleResultCount || 0,
        facebookUniqueAdvertiserCount: advertiserCount,
        facebookAdvertiserCount: advertiserCount,
        facebookAdvertiserNames: active.advertiserNames || [],
        facebookAdvertiserCountBasis: advertiserCount ? "unique advertisers/pages" : "raw ad/result signals",
        facebookQueries: results.map((r) => r.query),
        facebookWinningQuery: active.query,
        facebookSearchTextWithResults: active.query,
        facebookNotes: active.notes,
      };
    }

    if (noAds) {
      return {
        facebookAdsStatus: "no active ads found",
        facebookAdCount: 0,
        facebookQueries: results.map((r) => r.query),
        facebookWinningQuery: "",
        facebookSearchTextWithResults: "",
        facebookNotes: "No active ads found using shortened Facebook Ads Library queries.",
      };
    }

    return {
      facebookAdsStatus: "manual verification needed",
      facebookAdCount: 0,
      facebookQueries: results.map((r) => r.query),
      facebookWinningQuery: "",
      facebookSearchTextWithResults: "",
      facebookNotes: results.map((r) => r.notes || r.reason || "").filter(Boolean).join(" | "),
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export async function researchFacebookAds(input) {
  if (Array.isArray(input)) {
    const results = [];

    for (const product of input) {
      const fb = await checkFacebookAds(product);
      results.push({
        ...product,
        ...fb,
      });
    }

    return results;
  }

  return await checkFacebookAds(input);
}

export async function loginFacebook() {
  console.log("[facebook] Public Ads Library mode. Foreground manual fix only when captcha/login/problem appears.");
  return {
    ok: true,
    loginRequired: false,
  };
}

export const checkFacebookAdsForProduct = checkFacebookAds;
export const searchFacebookAds = checkFacebookAds;

export default checkFacebookAds;
