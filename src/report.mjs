import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { scoreProduct } from "./product-scoring.mjs";

const ROOT = "/Users/dadski/Projects/dropship-codex";
const OUTPUT_DIR = path.join(ROOT, "output");
const HTML_PATH = path.join(OUTPUT_DIR, "research-report.html");
const MD_PATH = path.join(OUTPUT_DIR, "research-report.md");

function reportLimit(options = {}) {
  return Math.max(1, Number(options.limit || process.env.REPORT_PRODUCT_LIMIT || 5) || 5);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mdEscape(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

function pick(obj, keys, fallback = "") {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
}

function productTitle(p) {
  return pick(p, ["title", "productTitle", "product", "name", "productName"], "Unknown product");
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const nicheStopWords = new Set([
  "unbranded",
  "oem",
  "alternative",
  "automatic",
  "smart",
  "upgraded",
  "portable",
  "wireless",
  "with",
  "for",
  "and",
  "the",
  "home",
  "new",
  "app",
  "control",
  "wifi",
  "wi",
  "fi",
  "days",
  "capacity",
]);

function productNicheKey(product) {
  const text = normalizeText([
    product?.genericProductTitle,
    product?.sourcingSearchTitle,
    product?.alternativeSearchTitle,
    productTitle(product),
  ].filter(Boolean).join(" "));

  if (text.includes("cat") && text.includes("feeder")) return "automatic-cat-feeder";
  if (text.includes("pet feeder") || text.includes("food dispenser")) return "automatic-pet-feeder";
  if (text.includes("cat") && text.includes("litter box")) return "self-cleaning-cat-litter-box";
  if (text.includes("ice maker")) return "countertop-ice-maker";
  if (text.includes("air purifier")) return "air-purifier";
  if (text.includes("walking pad") || text.includes("treadmill")) return "walking-pad-treadmill";
  if (text.includes("portable monitor")) return "portable-monitor";
  if (text.includes("backdrop stand")) return "backdrop-stand";
  if (text.includes("impact wrench")) return "impact-wrench";
  if (text.includes("luggage") || text.includes("suitcase")) return "luggage-set";
  if (text.includes("curling iron")) return "curling-iron";

  const tokens = text
    .split(" ")
    .filter((token) => token.length >= 4 && !nicheStopWords.has(token) && !/^\d+$/.test(token));

  return tokens.length >= 3 ? `generic:${tokens.slice(0, 6).join("-")}` : `title:${text}`;
}

function uniqueBestByNiche(products) {
  const seen = new Set();
  const unique = [];

  for (const product of products) {
    const key = productNicheKey(product);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(product);
  }

  return unique;
}

function kalodataUrl(p) {
  return pick(p, ["kalodataUrl", "kalodataURL", "productUrl", "productURL", "url", "href", "link"], "");
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value || "unknown";
  return `$${n.toFixed(2)}`;
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "unknown";
  return `${(n * 100).toFixed(1)}%`;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [value];
}

function asExternalLinks(value) {
  return asArray(value)
    .map((entry) => typeof entry === "string" ? { site: "Link", url: entry } : entry)
    .filter((entry) => entry?.url);
}

function sourceUrl(p) {
  return (
    p?.sourcingUrl ||
    p?.aliExpressSourceUrl ||
    p?.aliexpressSourceUrl ||
    p?.sourceUrl ||
    p?.sourcingUrls?.aliExpress ||
    ""
  );
}

function scoreAll(products) {
  const seen = new Set();
  return (Array.isArray(products) ? products : [])
    .map((product) => scoreProduct(product))
    .filter((product) => {
      const key = `${productTitle(product)}|${kalodataUrl(product)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const scoreDiff = (b.productScore ?? 0) - (a.productScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.maxCpaFor15PctNet ?? 0) - (a.maxCpaFor15PctNet ?? 0);
    });
}

function topProducts(products, options = {}) {
  const limit = reportLimit(options);
  const accepted = scoreAll(products)
    .filter((p) => p.classification !== "Reject" && p.productDecision !== "Reject");

  return uniqueBestByNiche(accepted).slice(0, limit);
}

function rejectedProducts(products) {
  return scoreAll(products)
    .filter((p) => p.classification === "Reject" || p.productDecision === "Reject")
    .slice(0, 30);
}

function reportStats(products, options = {}) {
  const limit = reportLimit(options);
  const all = scoreAll(products);
  const accepted = all.filter((p) => p.classification !== "Reject" && p.productDecision !== "Reject");
  const uniqueAccepted = uniqueBestByNiche(accepted);
  const rejected = all.filter((p) => p.classification === "Reject" || p.productDecision === "Reject");

  return {
    limit,
    evaluatedCount: all.length,
    acceptedCount: accepted.length,
    uniqueAcceptedCount: uniqueAccepted.length,
    duplicateAcceptedCount: accepted.length - uniqueAccepted.length,
    shownAcceptedCount: Math.min(uniqueAccepted.length, limit),
    rejectedCount: rejected.length,
  };
}

function linkHtml(label, url) {
  if (!url) return htmlEscape(label || "");
  return `<a href="${htmlEscape(url)}" target="_blank" rel="noopener noreferrer">${htmlEscape(label || url)}</a>`;
}

function linkMd(label, url) {
  if (!url) return mdEscape(label || "");
  return `[${mdEscape(label || url)}](${url})`;
}

function linksHtml(links) {
  const list = asExternalLinks(links);
  if (list.length === 0) return "<span>None found</span>";

  return `<ul>${list.map((entry) => `<li>${linkHtml(entry.site || "Link", entry.url)}</li>`).join("")}</ul>`;
}

function linksMd(links) {
  const list = asExternalLinks(links);
  if (list.length === 0) return "- None found";
  return list.map((entry) => `- ${linkMd(entry.site || "Link", entry.url)}`).join("\n");
}

function sourcingLinks(p) {
  const urls = p.sourcingUrls || {};
  return [
    { site: "AliExpress source/search", url: sourceUrl(p) || urls.aliExpress },
    { site: "Alibaba search", url: p.alibabaSourcingUrl || urls.alibaba },
    { site: "Zendrop possibility", url: p.zendropSourcingUrl || urls.zendrop },
    { site: "Wiio possibility", url: p.wiioSourcingUrl || urls.wiio },
  ].filter((entry) => entry.url);
}

function whyWon(p) {
  return asArray(p.productSelectionReasons).join(" ") || "Passed the current profit, demand, competition, sourcing, and risk scoring checks.";
}

function rejectReason(p) {
  return asArray(p.rejectionReasons).join(" ") ||
    asArray(p.productWarnings).join(" ") ||
    p.mainRisk ||
    "Rejected by conservative scoring.";
}

function kalodataEvidence(p) {
  return [
    `Price: ${formatMoney(p.recommendedSellingPrice || p.targetSellPrice)}`,
    `Revenue: ${pick(p, ["thirtyDayRevenue", "revenue30d", "revenue", "monthlyRevenue"], "unknown")}`,
    `Sales volume: ${pick(p, ["thirtyDaySales", "sales30d", "salesVolume", "itemSold", "sold"], "unknown")}`,
    `Rating/reviews: ${pick(p, ["rating", "reviewRating"], "unknown")} / ${pick(p, ["reviewCount", "reviews"], "unknown")}`,
    `Seller: ${pick(p, ["shopName", "shop", "sellerName"], "unknown")}`,
    `Category: ${pick(p, ["category"], "unknown")}`,
    `Trend velocity: ${pick(p, ["trendVelocity", "revenueGrowth", "growth", "growthRate"], "unknown")}`,
  ];
}

function marginMathRows(p) {
  return [
    ["Selling price", formatMoney(p.recommendedSellingPrice)],
    ["Product cost", formatMoney(p.productCost)],
    ["Shipping cost", formatMoney(p.shippingCost)],
    ["Landed cost", formatMoney(p.landedCost)],
    ["Payment fee", formatMoney(p.paymentFee)],
    ["Return reserve", formatMoney(p.returnReserve)],
    ["Gross profit before ads", formatMoney(p.grossProfitBeforeAds)],
    ["Gross margin", formatPct(p.grossMarginPct)],
    ["Break-even CPA", formatMoney(p.breakEvenCpa)],
    ["Max CPA for 15% net", formatMoney(p.maxCpaFor15PctNet)],
  ];
}

function competitionSummary(p) {
  const advertiserNames = asArray(p.facebookAdvertiserNames).slice(0, 5).join(", ");
  const facebookBasis = p.facebookCrowdingSignalCount && p.facebookCrowdingSignalBasis
    ? `Facebook count basis: ${p.facebookCrowdingSignalCount} ${p.facebookCrowdingSignalBasis} signal(s).`
    : "";
  const facebookAdvertisers = advertiserNames
    ? `Sample advertiser/page names: ${advertiserNames}.`
    : "";

  return [
    p.competitionNotes || "Manual competitor-page inspection required before ad spend.",
    p.facebookCrowdingReason,
    facebookBasis,
    facebookAdvertisers,
  ].filter(Boolean).join(" ");
}

function buildHtml(products, options = {}) {
  const limit = reportLimit(options);
  const top = topProducts(products, { limit });
  const rejected = rejectedProducts(products);
  const stats = reportStats(products, { limit });

  const summaryCards = top.map((p, index) => `
    <article class="summary-card">
      <h3>#${index + 1} ${linkHtml(productTitle(p), kalodataUrl(p))}</h3>
      <p>${htmlEscape(whyWon(p))}</p>
      <dl>
        <dt>Selling price</dt><dd>${htmlEscape(formatMoney(p.recommendedSellingPrice))}</dd>
        <dt>Landed cost</dt><dd>${htmlEscape(formatMoney(p.landedCost))}</dd>
        <dt>Gross margin</dt><dd>${htmlEscape(formatPct(p.grossMarginPct))}</dd>
        <dt>Max CPA for 15% net</dt><dd>${htmlEscape(formatMoney(p.maxCpaFor15PctNet))}</dd>
        <dt>Main risk</dt><dd>${htmlEscape(p.mainRisk || "Manual verification required")}</dd>
      </dl>
    </article>
  `).join("");

  const candidateRows = top.map((p, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${linkHtml(productTitle(p), kalodataUrl(p))}</td>
      <td>${htmlEscape(p.productScore ?? "")}</td>
      <td>${htmlEscape(p.classification ?? "")}</td>
      <td>${kalodataUrl(p) ? linkHtml("Open", kalodataUrl(p)) : ""}</td>
      <td>${htmlEscape(formatMoney(p.recommendedSellingPrice))}</td>
      <td>${sourceUrl(p) ? linkHtml("Open source", sourceUrl(p)) : "Not confirmed"}</td>
      <td>${htmlEscape(formatMoney(p.landedCost))}</td>
      <td>${htmlEscape(formatPct(p.grossMarginPct))}</td>
      <td>${htmlEscape(formatMoney(p.maxCpaFor15PctNet))}</td>
      <td>${htmlEscape(p.shippingTime || "unknown")}</td>
      <td>${htmlEscape(p.competitionLevel || "manual verification needed")}</td>
      <td>${htmlEscape(p.brandRisk || "unknown")}</td>
      <td>${htmlEscape(p.recommendation || p.finalDecision || "")}</td>
    </tr>
  `).join("");

  const detailSections = top.map((p, index) => `
    <section class="detail">
      <h2>${index + 1}. ${linkHtml(productTitle(p), kalodataUrl(p))}</h2>
      <p><strong>Product summary:</strong> ${htmlEscape(productTitle(p))}</p>
      ${p.alternativeForOfficialShop ? `<p><strong>Alternative note:</strong> Original TikTok item was official shop/branded. This row is for a similar unbranded/OEM source search, not the exact official product.</p>` : ""}
      <p><strong>Problem it solves:</strong> ${htmlEscape(p.problemSolved || "Unclear")}</p>
      <p><strong>Target customer:</strong> ${htmlEscape(p.targetCustomer || "People with the pain point described by the product title; verify audience manually.")}</p>
      <p><strong>Suggested angle/hook:</strong> ${htmlEscape(p.suggestedAngle || "Show the problem, then the product solving it in the first 3 seconds.")}</p>
      <h3>Kalodata evidence</h3>
      <ul>${kalodataEvidence(p).map((line) => `<li>${htmlEscape(line)}</li>`).join("")}</ul>
      <h3>Sourcing links</h3>
      ${linksHtml(sourcingLinks(p))}
      <p><strong>Sourcing confidence:</strong> ${htmlEscape(p.sourcingConfidence || "low")}</p>
      <h3>Competitor links</h3>
      ${linksHtml(p.competitorUrls)}
      <p><strong>Competitor price range:</strong> ${htmlEscape(p.competitorPriceRange || "unknown")}</p>
      <h3>Margin math</h3>
      <table class="mini-table"><tbody>${marginMathRows(p).map(([k, v]) => `<tr><th>${htmlEscape(k)}</th><td>${htmlEscape(v)}</td></tr>`).join("")}</tbody></table>
      <h3>Competition analysis</h3>
      <p>${htmlEscape(competitionSummary(p))}</p>
      <h3>Risk analysis</h3>
      <p>${htmlEscape(asArray(p.productWarnings).join(" ") || p.mainRisk || "No major automated risk found, but manual verification is required.")}</p>
      <p><strong>Final decision:</strong> ${htmlEscape(p.finalDecision || p.productDecision || "Manual verification")}</p>
    </section>
  `).join("");

  const rejectedRows = rejected.map((p) => `
    <tr>
      <td>${linkHtml(productTitle(p), kalodataUrl(p))}</td>
      <td>${htmlEscape(p.productScore ?? 0)}</td>
      <td>${htmlEscape(rejectReason(p))}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Dropshipping Niche Scout</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 18px; color: #1f2933; background: #fff; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { margin-top: 30px; }
    h3 { margin: 16px 0 8px; }
    .meta { color: #52606d; margin-bottom: 18px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .summary-card { border: 1px solid #d5dde5; border-radius: 6px; padding: 12px; }
    .summary-card h3 { margin-top: 0; }
    dl { display: grid; grid-template-columns: 150px 1fr; gap: 4px 10px; margin: 0; }
    dt { color: #52606d; }
    dd { margin: 0; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 10px 0 20px; }
    th, td { border: 1px solid #d5dde5; padding: 9px; vertical-align: top; word-break: break-word; }
    th { background: #f1f3f5; text-align: left; }
    tr:nth-child(even) { background: #fafbfc; }
    .mini-table { max-width: 620px; }
    .detail { border-top: 2px solid #e5eaf0; padding-top: 8px; }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Dropshipping Niche Scout</h1>
  <div class="meta">Requested ${limit} report product(s). Showing ${stats.shownAcceptedCount} unique accepted niche candidate(s) out of ${stats.evaluatedCount} evaluated product(s); ${stats.rejectedCount} were rejected or blocked and ${stats.duplicateAcceptedCount} similar accepted product(s) were suppressed so only the best item per niche is shown. Products are not recommended just because they are trending.</div>

  <h2>Executive Summary</h2>
  ${summaryCards || "<p>No products met the minimum test/watchlist threshold. Review the rejected-products section for the exact blockers.</p>"}

  <h2>Candidate Table</h2>
  <table>
    <thead>
      <tr>
        <th>Rank</th>
        <th>Product</th>
        <th>Score</th>
        <th>Classification</th>
        <th>Kalodata URL</th>
        <th>Selling price estimate</th>
        <th>Sourcing URL</th>
        <th>Landed cost</th>
        <th>Gross margin %</th>
        <th>Max CPA for 15% net</th>
        <th>Shipping time</th>
        <th>Competition level</th>
        <th>Brand risk</th>
        <th>Recommendation</th>
      </tr>
    </thead>
    <tbody>
      ${candidateRows || '<tr><td colspan="14">No products passed the current conservative thresholds.</td></tr>'}
    </tbody>
  </table>

  <h2>Detailed Product Sections</h2>
  ${detailSections || "<p>No detailed product sections because there are no accepted candidates.</p>"}

  <h2>Rejected Products</h2>
  <table>
    <thead><tr><th>Product</th><th>Score</th><th>Why rejected</th></tr></thead>
    <tbody>${rejectedRows || '<tr><td colspan="3">No rejected products were recorded.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

function buildMarkdown(products, options = {}) {
  const limit = reportLimit(options);
  const top = topProducts(products, { limit });
  const rejected = rejectedProducts(products);
  const stats = reportStats(products, { limit });
  const lines = [];

  lines.push("# Dropshipping Niche Scout");
  lines.push("");
  lines.push(`Requested ${limit} report product(s). Showing ${stats.shownAcceptedCount} unique accepted niche candidate(s) out of ${stats.evaluatedCount} evaluated product(s); ${stats.rejectedCount} were rejected or blocked and ${stats.duplicateAcceptedCount} similar accepted product(s) were suppressed so only the best item per niche is shown. Products are not recommended just because they are trending.`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");

  if (top.length === 0) {
    lines.push("No products met the minimum test/watchlist threshold. Review the rejected-products section for the exact blockers.");
  } else {
    top.forEach((p, index) => {
      lines.push(`### ${index + 1}. ${linkMd(productTitle(p), kalodataUrl(p))}`);
      lines.push(`- Why it won: ${mdEscape(whyWon(p))}`);
      lines.push(`- Expected selling price: ${formatMoney(p.recommendedSellingPrice)}`);
      lines.push(`- Landed cost: ${formatMoney(p.landedCost)}`);
      lines.push(`- Expected gross margin: ${formatPct(p.grossMarginPct)}`);
      lines.push(`- Max CPA for 15% net: ${formatMoney(p.maxCpaFor15PctNet)}`);
      lines.push(`- Main risk: ${mdEscape(p.mainRisk || "Manual verification required")}`);
      lines.push("");
    });
  }

  lines.push("## Candidate table");
  lines.push("");
  const header = [
    "Rank",
    "Product",
    "Score",
    "Classification",
    "Kalodata URL",
    "Selling price estimate",
    "Sourcing URL",
    "Landed cost",
    "Gross margin %",
    "Max CPA for 15% net",
    "Shipping time",
    "Competition level",
    "Brand risk",
    "Recommendation",
  ];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  if (top.length === 0) {
    lines.push("| No products passed the current conservative thresholds. |  |  |  |  |  |  |  |  |  |  |  |  |  |");
  } else {
    top.forEach((p, index) => {
      const row = [
        index + 1,
        linkMd(productTitle(p), kalodataUrl(p)),
        p.productScore ?? "",
        p.classification ?? "",
        kalodataUrl(p) ? linkMd("Open", kalodataUrl(p)) : "",
        formatMoney(p.recommendedSellingPrice),
        sourceUrl(p) ? linkMd("Open source", sourceUrl(p)) : "Not confirmed",
        formatMoney(p.landedCost),
        formatPct(p.grossMarginPct),
        formatMoney(p.maxCpaFor15PctNet),
        p.shippingTime || "unknown",
        p.competitionLevel || "manual verification needed",
        p.brandRisk || "unknown",
        p.recommendation || p.finalDecision || "",
      ];
      lines.push(`| ${row.map(mdEscape).join(" | ")} |`);
    });
  }

  lines.push("");
  lines.push("## Detailed product sections");
  lines.push("");

  if (top.length === 0) {
    lines.push("No detailed product sections because there are no accepted candidates.");
    lines.push("");
  } else {
    top.forEach((p, index) => {
      lines.push(`### ${index + 1}. ${linkMd(productTitle(p), kalodataUrl(p))}`);
      lines.push("");
      lines.push(`Product summary: ${mdEscape(productTitle(p))}`);
      lines.push("");
      if (p.alternativeForOfficialShop) {
        lines.push("Alternative note: Original TikTok item was official shop/branded. This row is for a similar unbranded/OEM source search, not the exact official product.");
        lines.push("");
      }
      lines.push(`Problem it solves: ${mdEscape(p.problemSolved || "Unclear")}`);
      lines.push("");
      lines.push(`Target customer: ${mdEscape(p.targetCustomer || "People with the pain point described by the product title; verify audience manually.")}`);
      lines.push("");
      lines.push(`Suggested angle/hook: ${mdEscape(p.suggestedAngle || "Show the problem, then the product solving it in the first 3 seconds.")}`);
      lines.push("");
      lines.push("Kalodata evidence:");
      kalodataEvidence(p).forEach((line) => lines.push(`- ${mdEscape(line)}`));
      lines.push("");
      lines.push("Sourcing links:");
      lines.push(linksMd(sourcingLinks(p)));
      lines.push(`- Sourcing confidence: ${mdEscape(p.sourcingConfidence || "low")}`);
      lines.push("");
      lines.push("Competitor links:");
      lines.push(linksMd(p.competitorUrls));
      lines.push(`- Competitor price range: ${mdEscape(p.competitorPriceRange || "unknown")}`);
      lines.push("");
      lines.push("Margin math:");
      marginMathRows(p).forEach(([k, v]) => lines.push(`- ${k}: ${v}`));
      lines.push("");
      lines.push(`Competition analysis: ${mdEscape(competitionSummary(p))}`);
      lines.push("");
      lines.push(`Risk analysis: ${mdEscape(asArray(p.productWarnings).join(" ") || p.mainRisk || "No major automated risk found, but manual verification is required.")}`);
      lines.push("");
      lines.push(`Final decision: ${mdEscape(p.finalDecision || p.productDecision || "Manual verification")}`);
      lines.push("");
    });
  }

  lines.push("## Rejected products");
  lines.push("");
  lines.push("| Product | Score | Why rejected |");
  lines.push("| --- | --- | --- |");

  if (rejected.length === 0) {
    lines.push("| No rejected products were recorded. |  |  |");
  } else {
    rejected.forEach((p) => {
      lines.push(`| ${mdEscape(linkMd(productTitle(p), kalodataUrl(p)))} | ${mdEscape(p.productScore ?? 0)} | ${mdEscape(rejectReason(p))} |`);
    });
  }

  lines.push("");
  return lines.join("\n");
}

function openFile(filePath) {
  const child = spawn("open", [filePath], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
}

export function buildReportRows(products, options = {}) {
  return topProducts(products, options);
}

export async function writeResearchReport(products, options = {}) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const html = buildHtml(products, options);
  const md = buildMarkdown(products, options);

  await fs.writeFile(HTML_PATH, html, "utf8");
  await fs.writeFile(MD_PATH, md, "utf8");

  console.log(`[report] Saved report to ${HTML_PATH}`);
  console.log(`[report] Saved report to ${MD_PATH}`);

  if (options.open !== false) {
    openFile(HTML_PATH);
  }

  return {
    htmlPath: HTML_PATH,
    mdPath: MD_PATH,
    count: topProducts(products, options).length,
  };
}

export async function generateReports(productsOrRows, options = {}) {
  return await writeResearchReport(productsOrRows, {
    open: true,
    ...options,
  });
}

export const generateResearchReport = writeResearchReport;
export const generateReport = writeResearchReport;
export const writeReport = writeResearchReport;
export const saveReport = writeResearchReport;
export const saveResearchReport = writeResearchReport;

export default writeResearchReport;
