import { chromium } from "playwright";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { applyProductScoring, scoreProduct } from "./product-scoring.mjs";

const CDP_URL = "http://127.0.0.1:9222";
const KALODATA_URL = "https://www.kalodata.com/product";
const DEFAULT_FILTERED_PAGE_LIMIT = Number(process.env.KALODATA_MAX_PAGES || 2);
const DEFAULT_START_PAGE = Number(process.env.KALODATA_START_PAGE || 1);
const DEFAULT_PRODUCT_LIMIT = Number(process.env.KALODATA_MAX_PRODUCTS || 250);
const DEFAULT_REVENUE_WINDOW_DAYS = Number(process.env.KALODATA_REVENUE_WINDOW_DAYS || 30);
const DEFAULT_REVENUE_PER_DAY_MIN = Number(process.env.KALODATA_REVENUE_PER_DAY_MIN || 1000);
const DEFAULT_REVENUE_MIN = String(Math.round(DEFAULT_REVENUE_PER_DAY_MIN * DEFAULT_REVENUE_WINDOW_DAYS));

const KALODATA_LEFT_FILTERS = {
  revenue: {
    label: "Revenue($)",
    min: process.env.KALODATA_REVENUE_MIN || DEFAULT_REVENUE_MIN,
    max: process.env.KALODATA_REVENUE_MAX || "300000",
  },
  averageUnitPrice: {
    label: "Avg. Unit Price($)",
    min: process.env.KALODATA_PRICE_MIN || "80",
    max: process.env.KALODATA_PRICE_MAX || "200",
  },
  revenueGrowthRate: {
    label: "Revenue Growth Rate",
    min: process.env.KALODATA_GROWTH_MIN || "10",
    max: process.env.KALODATA_GROWTH_MAX || "",
  },
  categories: (process.env.KALODATA_CATEGORIES || [
    "Pet Supplies",
    "Home Appliances",
    "Household Appliances",
    "Kitchenware",
    "Home Improvement",
    "Tools",
    "Phones & Electronics",
    "Sports & Outdoor",
  ].join("|")).split("|").map((value) => value.trim()).filter(Boolean),
};

async function waitForEnter(message) {
  const rl = readline.createInterface({ input, output });
  await rl.question(`\n${message}\nPress Enter in this terminal when done... `);
  rl.close();
}

function moneyToNumber(value) {
  const s = String(value ?? "").toLowerCase().replace(/,/g, "").trim();
  const m = s.match(/([\d.]+)/);
  if (!m) return 0;

  let n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;

  if (s.includes("k")) n *= 1000;
  if (s.includes("m")) n *= 1000000;

  return n;
}

function parseMoney(value) {
  const m = String(value || "").match(/\$[\d,.]+(?:\s*[kKmM])?/);
  return m ? m[0].replace(/\s+/g, "") : "";
}

function parseRevenue(text) {
  const matches = String(text || "").match(/\$[\d,.]+[kKmM]/g) || [];
  return matches[0] || "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanTitleFromRowText(text) {
  let s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  s = s.replace(/^\d+\s+/, "");

  const priceIndex = s.search(/\s\$[\d,.]+/);
  if (priceIndex > 20) {
    s = s.slice(0, priceIndex).trim();
  }

  return s;
}

function productTextBlob(product) {
  return [
    product?.title,
    product?.shop,
    product?.category,
    product?.rawText,
    product?.productUrl,
    product?.kalodataUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasHardRejectTerm(product) {
  const text = productTextBlob(product);

  const rejectTerms = [
    "supplement",
    "gummies",
    "vitamin",
    "probiotic",
    "collagen peptides",
    "mouthwash",
    "teeth whitening",
    "skincare",
    "skin care",
    "anti-aging",
    "anti aging",
    "pdrn",
    "volufiline",
    "medicube",
    "dr.melaxin",
    "dr melaxin",
    "tarte",
    "hismile",
    "neocell",
    "leefar",
    "maryruth",
    "physician's choice",
    "shark",
    "ninja",
    "ecoflow",
    "volt",
    "electric bike",
    "ebike",
    "e-bike",
    "fajas",
    "shapewear",
    "shaperx",
    "shapermint",
  ];

  return rejectTerms.some((term) => text.includes(term));
}

function isProblemSolvingProduct(product) {
  const text = productTextBlob(product);

  const goodTerms = [
    "cleaner",
    "vacuum",
    "fan",
    "air purifier",
    "litter box",
    "walking pad",
    "treadmill",
    "steam cleaner",
    "steamer",
    "comforter",
    "blanket",
    "washer",
    "organizer",
    "storage",
    "pet",
    "home",
    "kitchen",
    "bathroom",
    "car",
  ];

  return goodTerms.some((term) => text.includes(term));
}

async function connectToKalodataChrome() {
  let browser;

  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    throw new Error(
      "Kalodata Chrome is not running with remote debugging. Run: npm run kalodata:chrome"
    );
  }

  const context = browser.contexts()[0];
  if (!context) throw new Error("No Chrome context found.");

  let page = context.pages().find((p) =>
    p.url().includes("kalodata.com")
  );

  if (!page) {
    page = await context.newPage();
    await page.goto(KALODATA_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  }

  return { browser, context, page };
}

async function isCloudflareVerification(page) {
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");

  return (
    bodyText.includes("Performing security verification") ||
    bodyText.includes("Verify you are human") ||
    bodyText.includes("This website uses a security service") ||
    bodyText.includes("Just a moment")
  );
}

async function dismissPopups(page) {
  await page.locator("text=Got it").click({ timeout: 1500 }).catch(() => {});
  await page.locator("button:has-text('Got it')").click({ timeout: 1500 }).catch(() => {});
  await page.locator(".ant-modal-close").click({ timeout: 1500 }).catch(() => {});
}

async function waitUntilKalodataReady(page) {
  for (;;) {
    if (!page.url().includes("kalodata.com/product")) {
      await page.goto(KALODATA_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }).catch(() => {});
    }

    await page.waitForTimeout(3000);

    if (await isCloudflareVerification(page)) {
      await waitForEnter(
        "Kalodata security verification is still showing. Complete it manually in the NORMAL Chrome window."
      );
      continue;
    }

    await dismissPopups(page);

    const ready = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const hasNoResults =
        /no\s+(data|result|product)s?/i.test(bodyText) ||
        bodyText.includes("No Data");

      return (
        bodyText.includes("Product Info") &&
        bodyText.includes("Revenue") &&
        (/\$\d/.test(bodyText) || hasNoResults)
      );
    }).catch(() => false);

    if (ready) return;

    await waitForEnter(
      "Kalodata product table is not ready. Finish login/page setup manually in Chrome."
    );
  }
}

async function setPageSize50(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (bodyText.includes("50 / page")) return;

  const selectors = [
    "text=/\\d+\\s*\\/\\s*page/i",
    ".ant-select-selector",
    "[class*='pagination'] [class*='select']",
  ];

  for (const selector of selectors) {
    try {
      const el = page.locator(selector).last();
      if ((await el.count()) === 0) continue;

      await el.click({ timeout: 3000 });
      await page.waitForTimeout(500);

      const option = page.locator("text=50 / page").last();
      if ((await option.count()) > 0) {
        await option.click({ timeout: 3000 });
        await page.waitForTimeout(3000);
        return;
      }
    } catch {
      // continue
    }
  }
}

async function clickFilterByLabel(page, label) {
  await dismissPopups(page);

  const exact = new RegExp(`^${escapeRegExp(label)}$`, "i");
  const locators = [
    page.getByText(exact).first(),
    page.locator(`text="${label}"`).first(),
    page.locator(`[class*='filter']:has-text("${label}")`).first(),
  ];

  for (const locator of locators) {
    try {
      if ((await locator.count()) === 0) continue;
      await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await locator.click({ timeout: 3000 });
      await page.waitForTimeout(700);
      return true;
    } catch {
      // try the next locator
    }
  }

  console.log(`[kalodata] Filter not found: ${label}`);
  return false;
}

async function clickApplyIfAvailable(page) {
  const applyLocators = [
    page.getByRole("button", { name: /^apply$/i }).last(),
    page.locator("button:has-text('Apply')").last(),
    page.locator("text=/^Apply$/i").last(),
  ];

  for (const locator of applyLocators) {
    try {
      if ((await locator.count()) === 0) continue;
      const enabled = await locator.isEnabled().catch(() => true);
      if (!enabled) continue;
      await locator.click({ timeout: 3000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1800);
      return true;
    } catch {
      // try the next apply target
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

async function fillVisibleInput(page, labelRegex, value) {
  if (!value) return true;

  const locators = [
    page.getByPlaceholder(labelRegex).last(),
    page.locator(`input[placeholder*="${/max/i.test(String(labelRegex)) ? "Max" : "Min"}" i]:visible`).last(),
  ];

  for (const locator of locators) {
    try {
      if ((await locator.count()) === 0) continue;
      await locator.click({ timeout: 2000 });
      await locator.fill(String(value), { timeout: 3000 });
      return true;
    } catch {
      // try the next input
    }
  }

  return false;
}

async function applyNumericFilter(page, { label, min, max }) {
  console.log(`[kalodata] Applying filter: ${label} ${min || ""}${max ? `-${max}` : "+"}`);

  if (!(await clickFilterByLabel(page, label))) return false;

  const minFilled = await fillVisibleInput(page, /min/i, min);
  const maxFilled = await fillVisibleInput(page, /max/i, max);

  if (!minFilled && !maxFilled) {
    console.log(`[kalodata] Could not find min/max inputs for ${label}.`);
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }

  const applied = await clickApplyIfAvailable(page);
  console.log(`[kalodata] ${applied ? "Applied" : "Skipped"} filter: ${label}`);
  return applied;
}

async function applyCategoryFilters(page, categories) {
  if (!categories.length) return false;

  console.log(`[kalodata] Applying category filters: ${categories.join(", ")}`);

  if (!(await clickFilterByLabel(page, "Category"))) return false;

  let selected = 0;

  for (const category of categories) {
    const search = page.getByPlaceholder(/search category/i).last();

    if ((await search.count().catch(() => 0)) > 0) {
      await search.fill(category, { timeout: 3000 }).catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(900);
    }

    const categoryLabel = page.getByText(new RegExp(`^${escapeRegExp(category)}$`, "i")).last();

    try {
      if ((await categoryLabel.count()) === 0) continue;
      await categoryLabel.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});

      const row = categoryLabel.locator("xpath=ancestor::*[self::label or self::li or self::div][1]");
      const checkbox = row.locator("input[type='checkbox'], .ant-checkbox-input").first();

      if ((await checkbox.count().catch(() => 0)) > 0) {
        const checked = await checkbox.isChecked().catch(() => false);
        if (!checked) await checkbox.click({ timeout: 3000 }).catch(() => categoryLabel.click({ timeout: 3000 }));
      } else {
        await categoryLabel.click({ timeout: 3000 });
      }

      selected += 1;
      await page.waitForTimeout(400);
    } catch {
      // Some category rows open submenus instead of selecting. Continue best-effort.
    }
  }

  const applied = await clickApplyIfAvailable(page);
  console.log(`[kalodata] ${applied ? "Applied" : "Skipped"} ${selected} category filter(s).`);
  return applied && selected > 0;
}

async function applyChoiceFilter(page, label, choices) {
  console.log(`[kalodata] Trying choice filter: ${label}`);

  if (!(await clickFilterByLabel(page, label))) return false;

  for (const choice of choices) {
    const locator = page.getByText(new RegExp(`^${escapeRegExp(choice)}$`, "i")).last();
    try {
      if ((await locator.count()) === 0) continue;
      await locator.click({ timeout: 3000 });
      const applied = await clickApplyIfAvailable(page);
      console.log(`[kalodata] ${applied ? "Applied" : "Selected"} ${label}: ${choice}`);
      return true;
    } catch {
      // try the next choice
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

async function applyKalodataLeftFilters(page) {
  console.log("[kalodata] Applying Kalodata left-side filters.");
  if (!process.env.KALODATA_REVENUE_MIN) {
    console.log(`[kalodata] Revenue floor: $${DEFAULT_REVENUE_PER_DAY_MIN}/day x ${DEFAULT_REVENUE_WINDOW_DAYS} days = $${KALODATA_LEFT_FILTERS.revenue.min}.`);
  }

  await applyNumericFilter(page, KALODATA_LEFT_FILTERS.revenue).catch((err) => {
    console.log(`[kalodata] Revenue filter skipped: ${err.message}`);
  });

  await applyNumericFilter(page, KALODATA_LEFT_FILTERS.averageUnitPrice).catch((err) => {
    console.log(`[kalodata] Avg. Unit Price filter skipped: ${err.message}`);
  });

  await applyNumericFilter(page, KALODATA_LEFT_FILTERS.revenueGrowthRate).catch((err) => {
    console.log(`[kalodata] Revenue Growth Rate filter skipped: ${err.message}`);
  });

  await applyCategoryFilters(page, KALODATA_LEFT_FILTERS.categories).catch((err) => {
    console.log(`[kalodata] Category filter skipped: ${err.message}`);
  });

  await applyChoiceFilter(page, "Is Affiliate Product", ["Yes", "True", "Affiliate"]).catch((err) => {
    console.log(`[kalodata] Affiliate filter skipped: ${err.message}`);
  });

  await applyChoiceFilter(page, "Shipping Option", ["Local Shipping", "United States", "US", "Fast Shipping", "Free Shipping"]).catch((err) => {
    console.log(`[kalodata] Shipping filter skipped: ${err.message}`);
  });

  await waitUntilKalodataReady(page);
}

async function scrollTable(page) {
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(600);
  }

  await page.mouse.wheel(0, -6000);
  await page.waitForTimeout(1000);
}

async function clickNextPage(page) {
  const beforeRows = await extractRowsInBrowser(page).catch(() => []);
  const beforeFirst = normalizeText(beforeRows[0]?.rawText || "");

  const nextLocators = [
    page.locator(".ant-pagination-next:not(.ant-pagination-disabled)").first(),
    page.locator("li[title='Next Page']:not(.ant-pagination-disabled)").first(),
    page.getByRole("button", { name: /next/i }).last(),
    page.locator("[aria-label='Next Page'], [aria-label='next page']").last(),
  ];

  for (const locator of nextLocators) {
    try {
      if ((await locator.count()) === 0) continue;
      const className = await locator.getAttribute("class").catch(() => "");
      const ariaDisabled = await locator.getAttribute("aria-disabled").catch(() => "");
      if (/disabled/i.test(className || "") || ariaDisabled === "true") continue;

      await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await locator.click({ timeout: 3000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const afterRows = await extractRowsInBrowser(page).catch(() => []);
      const afterFirst = normalizeText(afterRows[0]?.rawText || "");
      if (afterRows.length > 0 && afterFirst !== beforeFirst) return true;
    } catch {
      // try the next next-page control
    }
  }

  return false;
}

async function currentPaginationPage(page) {
  return await page.evaluate(() => {
    const active = document.querySelector(".ant-pagination-item-active");
    const text = active?.textContent?.replace(/\s+/g, " ").trim() || "";
    const number = Number(text);
    return Number.isFinite(number) && number > 0 ? number : null;
  }).catch(() => null);
}

async function clickPaginationPage(page, pageNumber) {
  const pageText = String(pageNumber);
  const locators = [
    page.locator(`.ant-pagination-item-${pageNumber}`).first(),
    page.locator(`li[title="${pageText}"]`).first(),
    page.locator(".ant-pagination-item").filter({ hasText: new RegExp(`^\\s*${pageNumber}\\s*$`) }).first(),
  ];

  for (const locator of locators) {
    try {
      if ((await locator.count()) === 0) continue;
      const className = await locator.getAttribute("class").catch(() => "");
      if (/active/i.test(className || "")) return true;

      await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await locator.click({ timeout: 3000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2500);
      return true;
    } catch {
      // try the next pagination locator
    }
  }

  return false;
}

async function goToFilteredStartPage(page, pageNumber) {
  const target = Number(pageNumber);
  if (!Number.isFinite(target) || target < 1) return;

  console.log(`[kalodata] Moving filtered table to Kalodata page ${target}.`);

  const current = await currentPaginationPage(page);
  if (current === target) {
    console.log(`[kalodata] Already on Kalodata page ${target}.`);
    return;
  }

  if (await clickPaginationPage(page, target)) {
    return;
  }

  if (target === 1) {
    console.log("[kalodata] Could not click page 1 directly; reloading product page and reapplying filters.");
    await page.goto(KALODATA_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }).catch(() => {});
    await waitUntilKalodataReady(page);
    await applyKalodataLeftFilters(page);
    await setPageSize50(page);
    await clickPaginationPage(page, 1).catch(() => {});
    return;
  }

  let active = current || 1;
  while (active < target) {
    const advanced = await clickNextPage(page);
    if (!advanced) break;
    active = await currentPaginationPage(page) || active + 1;
  }
}

async function extractRowsInBrowser(page) {
  return await page.evaluate(() => {
    function normalize(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function abs(href) {
      if (!href) return "";
      try {
        return new URL(href, location.origin).toString();
      } catch {
        return "";
      }
    }

    function isBadRowText(text) {
      const t = normalize(text);

      if (!t) return true;
      if (t.length < 40) return true;
      if (t.startsWith("Product Info Revenue")) return true;
      if (t.includes("Go toPage")) return true;
      if (t.includes("Filtering Conditions")) return true;
      if (t.includes("All Products")) return true;
      if (!/^\d+\s+/.test(t)) return true;
      if (!/\$[\d,.]+/.test(t)) return true;

      return false;
    }

    const candidateSelectors = [
      "tr.ant-table-row",
      ".ant-table-row[data-row-key]",
      "[data-row-key]",
      "[class*='table-row']",
      "[role='row']",
    ];

    const seen = new Set();
    const rows = [];

    for (const selector of candidateSelectors) {
      const elements = [...document.querySelectorAll(selector)];

      for (const [index, el] of elements.entries()) {
        const text = normalize(el.innerText || el.textContent || "");

        if (isBadRowText(text)) continue;
        if (seen.has(text)) continue;
        seen.add(text);

        const anchors = [...el.querySelectorAll("a[href]")]
          .map((a) => a.getAttribute("href") || "")
          .filter(Boolean);

        const preferredHref =
          anchors.find((h) =>
            /\/product\/|product\/detail|product\?|goods|item/i.test(h)
          ) ||
          anchors[0] ||
          "";

        const imgs = [...el.querySelectorAll("img[src]")]
          .map((img) => img.getAttribute("src") || "")
          .filter(Boolean);

        rows.push({
          _selector: selector,
          _index: index,
          rawText: text,
          productUrl: abs(preferredHref),
          kalodataUrl: abs(preferredHref),
          imageUrl: abs(imgs[0] || ""),
        });
      }
    }

    return rows;
  });
}


function shouldTryClickForUrl(row) {
  const parsed = parseRow(row);
  const price = moneyToNumber(parsed.price);

  if (parsed.productUrl || parsed.kalodataUrl) return false;
  if (price < 80 || price > 200) return false;
  if (hasHardRejectTerm(parsed)) return false;

  return true;
}

async function restoreKalodataList(page) {
  if (!page.url().includes("kalodata.com/product")) {
    await page.goto(KALODATA_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }).catch(() => {});
  }

  await waitUntilKalodataReady(page).catch(() => {});
  await setPageSize50(page).catch(() => {});
  await page.waitForTimeout(1200);
}

async function clickRowAndCaptureUrl(page, rowInfo) {
  if (rowInfo.productUrl || rowInfo.kalodataUrl) {
    return rowInfo.kalodataUrl || rowInfo.productUrl;
  }

  if (!rowInfo._selector || rowInfo._index === undefined) {
    return "";
  }

  const beforeUrl = page.url();

  try {
    const result = await page.evaluate(async ({ selector, index, beforeUrl }) => {
      function abs(href) {
        if (!href) return "";
        try {
          return new URL(href, location.origin).toString();
        } catch {
          return "";
        }
      }

      const rows = [...document.querySelectorAll(selector)];
      const row = rows[index];

      if (!row) {
        return { url: "", mode: "row-not-found" };
      }

      // First try normal href extraction.
      const anchors = [...row.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href") || "")
        .filter(Boolean);

      const preferredHref =
        anchors.find((h) =>
          /\/product\/|product\/detail|product\?|goods|item/i.test(h)
        ) ||
        anchors[0] ||
        "";

      if (preferredHref) {
        return {
          url: abs(preferredHref),
          mode: "href",
        };
      }

      // Prevent row click from opening/focusing a new tab.
      const oldOpen = window.open;
      window.__kalodataLastOpenUrl = "";

      window.open = function patchedWindowOpen(url) {
        window.__kalodataLastOpenUrl = url ? String(url) : "";
        return null;
      };

      const candidates = [
        row.querySelector("[class*='product']"),
        row.querySelector("td"),
        row,
      ].filter(Boolean);

      try {
        for (const el of candidates) {
          try {
            el.scrollIntoView({
              block: "center",
              inline: "center",
            });

            el.dispatchEvent(new MouseEvent("mouseover", {
              bubbles: true,
              cancelable: true,
              view: window,
            }));

            el.dispatchEvent(new MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              view: window,
            }));

            el.click();

            el.dispatchEvent(new MouseEvent("mouseup", {
              bubbles: true,
              cancelable: true,
              view: window,
            }));

            await new Promise((resolve) => setTimeout(resolve, 1200));

            if (window.__kalodataLastOpenUrl) {
              return {
                url: abs(window.__kalodataLastOpenUrl),
                mode: "window-open-blocked",
              };
            }

            if (location.href !== beforeUrl) {
              return {
                url: location.href,
                mode: "same-tab-navigation",
              };
            }
          } catch {
            // try next element
          }
        }
      } finally {
        window.open = oldOpen;
      }

      return {
        url: "",
        mode: "no-url-found",
      };
    }, {
      selector: rowInfo._selector,
      index: rowInfo._index,
      beforeUrl,
    });

    const capturedUrl = result?.url || "";

    if (
      capturedUrl &&
      capturedUrl !== beforeUrl &&
      capturedUrl.includes("kalodata.com")
    ) {
      // If the DOM click navigated the current tab, restore list page.
      if (page.url() !== beforeUrl) {
        await page.goBack({
          waitUntil: "domcontentloaded",
          timeout: 30000,
        }).catch(() => {
          return page.goto(KALODATA_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          }).catch(() => {});
        });

        await restoreKalodataList(page).catch(() => {});
      }

      return capturedUrl;
    }

    // Optional fallback: real Playwright click.
    // Disabled by default because it can steal focus.
    if (process.env.ALLOW_FOCUS_CLICK !== "1") {
      return "";
    }

    console.log("[kalodata] ALLOW_FOCUS_CLICK=1 enabled; using real click fallback.");

    const row = page.locator(rowInfo._selector).nth(rowInfo._index);
    await row.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});

    const popupPromise = page.waitForEvent("popup", { timeout: 2500 }).catch(() => null);

    await row.click({
      timeout: 5000,
      force: true,
    });

    const popup = await popupPromise;
    await page.waitForTimeout(1500);

    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      const popupUrl = popup.url();
      await popup.close().catch(() => {});

      if (popupUrl && popupUrl.includes("kalodata.com")) {
        return popupUrl;
      }
    }

    const afterUrl = page.url();

    if (afterUrl && afterUrl !== beforeUrl && afterUrl.includes("kalodata.com")) {
      await page.goBack({
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }).catch(() => {
        return page.goto(KALODATA_URL, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        }).catch(() => {});
      });

      await restoreKalodataList(page).catch(() => {});
      return afterUrl;
    }

    return "";
  } catch {
    return "";
  }
}

function itemRangeForPage(kalodataPage, pageSize) {
  const start = ((kalodataPage - 1) * pageSize) + 1;
  const end = kalodataPage * pageSize;
  return { start, end };
}

async function enrichRowsWithClickedUrls(page, rows, { kalodataPage = 1, pageSize = rows.length || 50 } = {}) {
  const enriched = [];
  const range = itemRangeForPage(kalodataPage, pageSize);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (!shouldTryClickForUrl(row)) {
      enriched.push(row);
      continue;
    }

    const absoluteItem = range.start + i;

    console.log(`[kalodata] Capturing URL for page ${kalodataPage} item ${absoluteItem}: ${cleanTitleFromRowText(row.rawText).slice(0, 80)}`);

    const capturedUrl = await clickRowAndCaptureUrl(page, row);

    enriched.push({
      ...row,
      productUrl: capturedUrl || row.productUrl || "",
      kalodataUrl: capturedUrl || row.kalodataUrl || row.productUrl || "",
    });

    await restoreKalodataList(page).catch(() => {});
  }

  return enriched;
}

function parseRow(row) {
  const rawText = row.rawText || "";

  return {
    title: cleanTitleFromRowText(rawText),
    productUrl: row.productUrl || "",
    kalodataUrl: row.kalodataUrl || row.productUrl || "",
    price: parseMoney(rawText),
    revenue: parseRevenue(rawText),
    sales: "",
    shop: "",
    category: "",
    imageUrl: row.imageUrl || "",
    rawText,
  };
}

function isValidProduct(p) {
  if (!p.title) return false;
  if (p.title === "Product Info") return false;
  if (p.rawText.includes("Product Info Revenue Revenue Trend")) return false;
  if (!/\$/.test(p.rawText)) return false;
  return true;
}

export async function loginKalodata() {
  console.log("[kalodata] Use npm run kalodata:chrome first, then pass Cloudflare manually.");
  return {
    ok: true,
    loginRequired: false,
  };
}

export async function collectKalodataProducts() {
  const { browser, page } = await connectToKalodataChrome();

  try {
    console.log("[kalodata] Connected to normal Chrome via CDP.");
    await waitUntilKalodataReady(page);

    console.log("[kalodata] Product page ready.");
    await applyKalodataLeftFilters(page);
    await setPageSize50(page);
    await goToFilteredStartPage(page, DEFAULT_START_PAGE);

    const allRows = [];
    const seenRows = new Set();
    const pageLimit = Number.isFinite(DEFAULT_FILTERED_PAGE_LIMIT) && DEFAULT_FILTERED_PAGE_LIMIT > 0
      ? DEFAULT_FILTERED_PAGE_LIMIT
      : 2;

    for (let pageIndex = 1; pageIndex <= pageLimit; pageIndex += 1) {
      const kalodataPage = (Number.isFinite(DEFAULT_START_PAGE) && DEFAULT_START_PAGE > 0 ? DEFAULT_START_PAGE : 1) + pageIndex - 1;
      console.log(`[kalodata] Scrolling Kalodata page ${kalodataPage} (${pageIndex}/${pageLimit} requested).`);
      await scrollTable(page);

      console.log(`[kalodata] Extracting products from Kalodata page ${kalodataPage}.`);
      const rawRows = await extractRowsInBrowser(page);

      console.log(`[kalodata] Capturing product URLs for Kalodata page ${kalodataPage} candidate rows.`);
      const rows = await enrichRowsWithClickedUrls(page, rawRows, {
        kalodataPage,
        pageSize: 50,
      });

      for (const row of rows) {
        const key = normalizeText(row.productUrl || row.kalodataUrl || row.rawText);
        if (!key || seenRows.has(key)) continue;
        seenRows.add(key);
        allRows.push(row);
      }

      if (pageIndex >= pageLimit) break;

      const advanced = await clickNextPage(page);
      if (!advanced) {
        console.log("[kalodata] No additional filtered pages found.");
        break;
      }
    }

    const productLimit = Number.isFinite(DEFAULT_PRODUCT_LIMIT) && DEFAULT_PRODUCT_LIMIT > 0
      ? DEFAULT_PRODUCT_LIMIT
      : 250;

    const products = allRows
      .map(parseRow)
      .filter(isValidProduct)
      .slice(0, productLimit);

    console.log(`[kalodata] Extracted ${products.length} products.`);

    return products;
  } finally {
    // Do not close user's Chrome. Only detach Playwright from CDP.
    await browser.close().catch(() => {});
  }
}

export function filterCandidateProducts(products) {
  if (!Array.isArray(products)) return [];

  const scored = applyProductScoring(products);
  const reportLimit = Math.max(1, Number(process.env.REPORT_PRODUCT_LIMIT || 5) || 5);
  const candidateLimit = Math.max(15, reportLimit * 4);

  // Keep enough for AliExpress/FB checks, but already ranked by the new score.
  let filtered = scored.slice(0, candidateLimit);

  if (filtered.length === 0 && products.length > 0) {
    console.log("[kalodata] No strict lead candidates survived; keeping top scored raw leads for report/debug visibility.");
    filtered = products
      .map((product) => scoreProduct(product, { phase: "lead" }))
      .sort((a, b) => (b.productScore ?? 0) - (a.productScore ?? 0))
      .slice(0, candidateLimit);
  }

  console.log(`[kalodata] Scored ${products.length} products. Kept top ${filtered.length} candidates.`);
  console.log("[kalodata] Top scored candidates:");
  filtered.slice(0, 5).forEach((p, index) => {
    console.log(`  ${index + 1}. score=${p.productScore} ${p.title}`);
  });

  return filtered;
}

export const scrapeKalodataProducts = collectKalodataProducts;
export const getKalodataProducts = collectKalodataProducts;
export default collectKalodataProducts;
