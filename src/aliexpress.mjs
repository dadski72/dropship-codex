import { chromium } from "playwright";
import path from "node:path";
import {
  focusBrowserWindow,
  waitForManualFix,
  looksLikeCaptchaOrChallenge,
  looksLikeLoginPage,
} from "./problem-ui.mjs";

const ROOT = "/Users/dadski/Projects/dropship-codex";
const PROFILE = path.join(ROOT, "profiles/aliexpress");

function titleOf(product) {
  return (
    product?.sourcingSearchTitle ||
    product?.alternativeSearchTitle ||
    product?.genericProductTitle ||
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

function buildAliExpressUrl(product) {
  const query = cleanQuery(titleOf(product));
  return `https://www.aliexpress.us/w/wholesale-${encodeURIComponent(query)}.html`;
}

function buildAlibabaUrl(product) {
  return `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(cleanQuery(titleOf(product)))}`;
}

function buildZendropUrl(product) {
  return `https://www.zendrop.com/products?search=${encodeURIComponent(cleanQuery(titleOf(product)))}`;
}

function buildWiioUrl(product) {
  return `https://www.wiio.io/search?keyword=${encodeURIComponent(cleanQuery(titleOf(product)))}`;
}

function moneyToNumber(value) {
  const m = String(value ?? "").replace(/,/g, "").match(/([\d.]+)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function parseShippingCost(rawText) {
  const text = String(rawText || "");
  if (/free\s+shipping/i.test(text)) return "$0.00";

  const m = text.match(/\$[\d,.]+\s*(?:shipping|delivery)/i);
  return m ? m[0].match(/\$[\d,.]+/)?.[0] || "" : "";
}

function parseShippingDays(rawText) {
  const text = String(rawText || "");
  const range = text.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*days?/i);
  if (range) return Number(range[2]);

  const single = text.match(/(?:delivery|shipping|arrives|ships)[^\d]{0,30}(\d{1,2})\s*days?/i);
  return single ? Number(single[1]) : null;
}

function parseWarehouse(rawText) {
  const text = String(rawText || "");
  if (/ships?\s+from\s+(?:the\s+)?(?:united states|usa|us)\b/i.test(text)) return "United States";
  if (/\bUS\s+warehouse\b/i.test(text)) return "United States";
  if (/ships?\s+from\s+china\b/i.test(text)) return "China";
  return "";
}

function sourceAppearsBranded(listing) {
  const text = `${listing?.title || ""} ${listing?.rawText || ""}`.toLowerCase();
  return /\b(official|logo|branded|brand store|authorized)\b/.test(text);
}

async function launchAliContext({ visible = false, foreground = false } = {}) {
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

async function openAliForeground(product, reason) {
  const url = buildAliExpressUrl(product);

  const { context, page } = await launchAliContext({
    visible: true,
    foreground: true,
  });

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  }).catch(() => {});

  await waitForManualFix(
    page,
    `AliExpress needs manual attention: ${reason}

Product:
${titleOf(product)}

Fix captcha/login/page in the foreground AliExpress browser window.`
  );

  await page.waitForTimeout(2000);

  return { context, page };
}

async function openAliSearch(page, product) {
  const url = buildAliExpressUrl(product);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(5000);
}

async function extractAliListings(page) {
  return await page.evaluate(() => {
    function text(el) {
      return String(el?.innerText || el?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function abs(href) {
      if (!href) return "";
      try {
        return new URL(href, location.origin).toString();
      } catch {
        return "";
      }
    }

    function firstMoney(raw) {
      const m = String(raw || "").match(/\$[\d,.]+/);
      return m ? m[0] : "";
    }

    const selectors = [
      "[data-pl]",
      ".search-item-card-wrapper-gallery",
      ".list-item",
      "a[href*='/item/']",
      "a[href*='item/']",
    ];

    const seen = new Set();
    const listings = [];

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const rawText = text(el);
        if (!rawText || rawText.length < 20) continue;

        const linkEl =
          el.matches?.("a[href]") ? el : el.querySelector?.("a[href]");

        const href = linkEl?.getAttribute("href") || "";
        const url = abs(href);

        if (!url || !url.includes("item")) continue;
        if (seen.has(url)) continue;
        seen.add(url);

        const price = firstMoney(rawText);
        const title =
          linkEl?.getAttribute("title") ||
          rawText.split("$")[0].trim().slice(0, 220);

        listings.push({
          title,
          url,
          price,
          shippingCost: firstMoney(rawText.match(/\$[\d,.]+\s*(?:shipping|delivery)/i)?.[0] || ""),
          parsedShippingCost: "",
          shippingDays: null,
          warehouseLocation: "",
          rawText,
        });
      }
    }

    return listings.slice(0, 10);
  });
}

function enrichListing(listing) {
  if (!listing) return listing;

  const shippingCost = listing.shippingCost || parseShippingCost(listing.rawText);
  const shippingDays = listing.shippingDays || parseShippingDays(listing.rawText);
  const warehouseLocation = listing.warehouseLocation || parseWarehouse(listing.rawText);

  return {
    ...listing,
    shippingCost,
    shippingDays,
    warehouseLocation,
    sourceAppearsBranded: sourceAppearsBranded(listing),
  };
}

function chooseBestListing(listings) {
  if (!Array.isArray(listings) || listings.length === 0) return null;

  const badTerms = [
    "brand",
    "logo",
    "official",
    "used",
    "refurbished",
  ];

  const scored = listings.map((listing) => {
    const enriched = enrichListing(listing);
    const text = `${listing.title} ${listing.rawText}`.toLowerCase();
    const price = moneyToNumber(listing.price);

    let score = 0;

    if (price > 0) score += 5;
    if (price >= 10 && price <= 80) score += 8;
    if (price > 80) score -= 5;
    if (enriched.warehouseLocation === "United States") score += 4;
    if (enriched.shippingDays && enriched.shippingDays <= 10) score += 3;
    if (badTerms.some((term) => text.includes(term))) score -= 8;

    return {
      ...enriched,
      sourceScore: score,
    };
  });

  scored.sort((a, b) => b.sourceScore - a.sourceScore);
  return scored[0];
}

export async function checkAliExpressProduct(product) {
  console.log(`[aliexpress] Checking source for: ${titleOf(product)}`);
  const aliExpressSearchUrl = buildAliExpressUrl(product);
  const alibabaSourcingUrl = buildAlibabaUrl(product);
  const zendropSourcingUrl = buildZendropUrl(product);
  const wiioSourcingUrl = buildWiioUrl(product);

  let context;

  try {
    const opened = await launchAliContext({
      visible: process.env.VISIBLE_BROWSER === "1",
      foreground: false,
    });

    context = opened.context;
    let page = opened.page;

    try {
      await openAliSearch(page, product);
    } catch (err) {
      await context.close().catch(() => {});
      context = null;

      const manual = await openAliForeground(
        product,
        `page failed to load/spawn: ${err.message}`
      );

      context = manual.context;
      page = manual.page;
    }

    if ((await looksLikeCaptchaOrChallenge(page)) || (await looksLikeLoginPage(page))) {
      await context.close().catch(() => {});
      context = null;

      const manual = await openAliForeground(
        product,
        "captcha/login/security verification detected"
      );

      context = manual.context;
      page = manual.page;
    }

    const listings = (await extractAliListings(page)).map(enrichListing);
    console.log(`[aliexpress] Success: page loaded, extracted ${listings.length} listing(s).`);

    const best = chooseBestListing(listings);

    if (!best) {
      return {
        aliExpressStatus: "manual verification needed",
        aliExpressSearchUrl,
        alibabaSourcingUrl,
        zendropSourcingUrl,
        wiioSourcingUrl,
        sourcingConfidence: "low; no exact AliExpress source extracted",
        aliExpressSourcePrice: "",
        aliExpressSourceUrl: "",
        aliExpressSourceTitle: "",
        aliExpressListings: listings,
        aliExpressResultCount: listings.length,
        aliExpressNotes: "AliExpress loaded but no usable source listing was extracted.",
      };
    }

    console.log(`[aliexpress] Success: selected source ${best.price || "unknown price"} - ${best.title}`);

    return {
      aliExpressStatus: "source found",
      aliExpressSearchUrl,
      alibabaSourcingUrl,
      zendropSourcingUrl,
      wiioSourcingUrl,
      sourcingConfidence: "near match from AliExpress; verify exact match manually",
      aliExpressResultCount: listings.length,
      aliExpressSourcePrice: best.price || "",
      aliexpressSourcePrice: best.price || "",
      sourcePrice: best.price || "",
      productCost: moneyToNumber(best.price),
      shippingCost: moneyToNumber(best.shippingCost),
      shippingTime: best.shippingDays ? `${best.shippingDays} days` : "unknown",
      estimatedShippingDays: best.shippingDays,
      warehouseLocation: best.warehouseLocation || "",
      sourceAppearsBranded: best.sourceAppearsBranded === true,
      aliExpressSourceUrl: best.url || "",
      aliExpressSourceTitle: best.title || "",
      aliExpressListings: listings,
      aliExpressNotes: `Selected source candidate: ${best.title}`,
    };
  } catch (err) {
    if (context) {
      await context.close().catch(() => {});
      context = null;
    }

    const manual = await openAliForeground(
      product,
      `unexpected AliExpress error: ${err.message}`
    );

    context = manual.context;
    const listings = (await extractAliListings(manual.page)).map(enrichListing);
    console.log(`[aliexpress] Success after manual step: extracted ${listings.length} listing(s).`);

    const best = chooseBestListing(listings);

    if (!best) {
      return {
        aliExpressStatus: "manual verification needed",
        aliExpressSearchUrl,
        alibabaSourcingUrl,
        zendropSourcingUrl,
        wiioSourcingUrl,
        sourcingConfidence: "low; no exact AliExpress source extracted",
        aliExpressSourcePrice: "",
        aliExpressSourceUrl: "",
        aliExpressSourceTitle: "",
        aliExpressListings: listings,
        aliExpressResultCount: listings.length,
        aliExpressNotes: "AliExpress still unclear after manual foreground step.",
      };
    }

    console.log(`[aliexpress] Success: selected source ${best.price || "unknown price"} - ${best.title}`);

    return {
      aliExpressStatus: "source found",
      aliExpressSearchUrl,
      alibabaSourcingUrl,
      zendropSourcingUrl,
      wiioSourcingUrl,
      sourcingConfidence: "near match from AliExpress after manual step; verify exact match manually",
      aliExpressResultCount: listings.length,
      aliExpressSourcePrice: best.price || "",
      aliexpressSourcePrice: best.price || "",
      sourcePrice: best.price || "",
      productCost: moneyToNumber(best.price),
      shippingCost: moneyToNumber(best.shippingCost),
      shippingTime: best.shippingDays ? `${best.shippingDays} days` : "unknown",
      estimatedShippingDays: best.shippingDays,
      warehouseLocation: best.warehouseLocation || "",
      sourceAppearsBranded: best.sourceAppearsBranded === true,
      aliExpressSourceUrl: best.url || "",
      aliExpressSourceTitle: best.title || "",
      aliExpressListings: listings,
      aliExpressNotes: `Selected source candidate after manual step: ${best.title}`,
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export async function researchAliExpressSources(input) {
  if (Array.isArray(input)) {
    const results = [];

    for (const product of input) {
      const ali = await checkAliExpressProduct(product);
      results.push({
        ...product,
        ...ali,
      });
    }

    return results;
  }

  return await checkAliExpressProduct(input);
}

export async function loginAliExpress() {
  console.log("[aliexpress] Login/captcha is handled on demand in foreground only when needed.");
  return {
    ok: true,
    loginRequired: false,
  };
}

// Compatibility aliases.
export const checkAliExpress = checkAliExpressProduct;
export const searchAliExpress = checkAliExpressProduct;
export const researchAliExpress = researchAliExpressSources;
export const findAliExpressSources = researchAliExpressSources;
export const findAliExpressSource = checkAliExpressProduct;
export const sourceAliExpressProduct = checkAliExpressProduct;

export default researchAliExpressSources;
