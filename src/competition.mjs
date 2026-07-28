import { buildCompetitorUrls, moneyToNumber } from "./product-scoring.mjs";

function titleOf(product) {
  return (
    product?.title ||
    product?.productTitle ||
    product?.product ||
    product?.name ||
    product?.productName ||
    "Unknown product"
  );
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9$%.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const trustedBrandTerms = [
  "uwant",
  "bissell",
  "shark",
  "hoover",
  "dripex",
  "elemara",
  "teant",
  "levoit",
  "eureka",
  "costway",
  "ottocast",
  "cowsar",
  "vevor",
  "dreame",
  "arzopa",
  "kodak",
  "nike",
  "vans",
  "birkenstock",
  "new balance",
  "dewalt",
  "jbl",
  "dyson",
  "black decker",
  "hamilton beach",
  "keurig",
];

const easyRetailTerms = [
  "ice maker",
  "air fryer",
  "air purifier",
  "fan",
  "treadmill",
  "walking pad",
  "vacuum",
  "floor cleaner",
  "portable monitor",
  "luggage",
  "mattress",
  "patio furniture",
  "chair",
  "shoe",
  "speaker",
];

function priceRangeFromAliExpress(product) {
  const prices = Array.isArray(product?.aliExpressListings)
    ? product.aliExpressListings.map((listing) => moneyToNumber(listing.price)).filter((price) => price > 0)
    : [];

  if (prices.length === 0) return "";
  return `$${Math.min(...prices).toFixed(2)}-$${Math.max(...prices).toFixed(2)}`;
}

export async function researchCompetition(input) {
  if (Array.isArray(input)) {
    const results = [];
    for (const product of input) {
      results.push(await researchCompetition(product));
    }
    return results;
  }

  const product = input || {};
  const text = normalize([
    titleOf(product),
    product.rawText,
    product.shopName,
    product.brandName,
    product.category,
  ].filter(Boolean).join(" "));

  const trustedBrandHit = trustedBrandTerms.find((term) => text.includes(term)) || "";
  const easyRetailHit = easyRetailTerms.find((term) => text.includes(term)) || "";
  const competitorUrls = buildCompetitorUrls(product);
  const competitorPriceRange = product.competitorPriceRange || priceRangeFromAliExpress(product) || "unknown";
  const competitionLevel = trustedBrandHit || easyRetailHit ? "high" : "manual verification needed";
  const notes = [
    "Generated Amazon, Walmart, TikTok Shop, Google Shopping, and AliExpress competitor-check URLs.",
    trustedBrandHit ? `Trusted-brand term found: ${trustedBrandHit}.` : "",
    easyRetailHit ? `Likely easy retail availability term found: ${easyRetailHit}.` : "",
    competitorPriceRange !== "unknown" ? `AliExpress visible source price range: ${competitorPriceRange}.` : "",
  ].filter(Boolean).join(" ");

  return {
    ...product,
    competitorUrls,
    competitorPriceRange,
    trustedBrandCompetitorRisk: Boolean(trustedBrandHit),
    amazonWalmartUnderTargetLikely: Boolean(easyRetailHit),
    competitionLevel,
    competitionNotes: notes,
    competitionResearchStatus: "search URLs generated; inspect competitor pages before ad spend",
  };
}

export default researchCompetition;
