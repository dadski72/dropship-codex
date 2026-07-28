import { chromium } from "playwright";
import path from "node:path";

const ROOT = "/Users/dadski/Projects/dropship-codex";

const SITES = {
  kalodata: {
    url: "https://www.kalodata.com/product",
    profile: path.join(ROOT, "profiles/kalodata"),
  },
  facebook: {
    url: "https://www.facebook.com/ads/library",
    profile: path.join(ROOT, "profiles/facebook"),
  },
  aliexpress: {
    url: "https://www.aliexpress.us",
    profile: path.join(ROOT, "profiles/aliexpress"),
  },
  tiktok: {
    url: "https://www.tiktok.com",
    profile: path.join(ROOT, "profiles/tiktok"),
  },
};

const siteName = process.argv[2];
const site = SITES[siteName];

if (!site) {
  console.error(`Usage: node src/open-playwright-profile.mjs <${Object.keys(SITES).join("|")}>`);
  process.exit(1);
}

const context = await chromium.launchPersistentContext(site.profile, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
  ],
});

const page = context.pages()[0] || await context.newPage();
await page.goto(site.url, { waitUntil: "domcontentloaded" });

console.log(`Opened ${siteName} with Playwright bundled browser.`);
console.log("Close the browser window when done.");

await new Promise(() => {});
