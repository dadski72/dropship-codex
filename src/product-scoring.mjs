function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9$%.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function moneyToNumber(value) {
  const s = String(value ?? "").toLowerCase().replace(/,/g, "").trim();
  const m = s.match(/([\d.]+)/);
  if (!m) return 0;

  let n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;

  if (s.includes("k")) n *= 1000;
  if (s.includes("m")) n *= 1000000;

  return n;
}

function percentToNumber(value) {
  const m = String(value ?? "").match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundMoney(value) {
  return Math.round((numberOrZero(value) + Number.EPSILON) * 100) / 100;
}

const FACEBOOK_CROWD_REJECT_COUNT = Number(process.env.FACEBOOK_CROWD_REJECT_COUNT || 20);
const FACEBOOK_CROWD_WARN_COUNT = Number(process.env.FACEBOOK_CROWD_WARN_COUNT || 8);

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

function searchTitleOf(product) {
  return (
    product?.sourcingSearchTitle ||
    product?.alternativeSearchTitle ||
    product?.genericProductTitle ||
    titleOf(product)
  );
}

function cleanQuery(value) {
  return String(value ?? "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^\w\s&'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

const SOURCE_STOP_WORDS = new Set([
  "with",
  "for",
  "and",
  "the",
  "from",
  "home",
  "new",
  "arrival",
  "portable",
  "set",
  "kit",
  "pcs",
  "piece",
  "multi",
  "best",
  "sale",
  "summer",
  "vibes",
  "gift",
]);

function meaningfulTokens(value) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !SOURCE_STOP_WORDS.has(token));
}

function sourceMatchScore(product) {
  const sourceTitle = product?.aliExpressSourceTitle || product?.sourceTitle || "";
  if (!sourceTitle) return null;

  const productTokens = new Set(meaningfulTokens(searchTitleOf(product)));
  const sourceTokens = new Set(meaningfulTokens(sourceTitle));

  if (productTokens.size === 0 || sourceTokens.size === 0) return null;

  let overlap = 0;
  for (const token of productTokens) {
    if (sourceTokens.has(token)) overlap += 1;
  }

  return overlap / Math.min(productTokens.size, 12);
}

function encodedQuery(product) {
  return encodeURIComponent(cleanQuery(searchTitleOf(product)));
}

function getText(product) {
  return normalize([
    product?.title,
    product?.productTitle,
    product?.name,
    product?.shop,
    product?.shopName,
    product?.sellerName,
    product?.brand,
    product?.brandName,
    product?.category,
    product?.rawText,
    product?.notes,
    product?.summary,
    product?.aliExpressSourceTitle,
    product?.facebookSearchTextWithResults,
    product?.facebookWinningQuery,
  ].filter(Boolean).join(" "));
}

function getSellPrice(product) {
  return (
    moneyToNumber(product?.recommendedSellingPrice) ||
    moneyToNumber(product?.sellingPriceEstimate) ||
    moneyToNumber(product?.targetSellPrice) ||
    moneyToNumber(product?.sellPrice) ||
    moneyToNumber(product?.avgUnitPrice) ||
    moneyToNumber(product?.averageUnitPrice) ||
    moneyToNumber(product?.price)
  );
}

function getRevenue(product) {
  return (
    moneyToNumber(product?.thirtyDayRevenue) ||
    moneyToNumber(product?.revenue30d) ||
    moneyToNumber(product?.revenue) ||
    moneyToNumber(product?.monthlyRevenue)
  );
}

function getSales(product) {
  return (
    moneyToNumber(product?.thirtyDaySales) ||
    moneyToNumber(product?.sales30d) ||
    moneyToNumber(product?.salesVolume) ||
    moneyToNumber(product?.itemSold) ||
    moneyToNumber(product?.sold)
  );
}

function getRating(product) {
  const m = String(product?.rating ?? product?.reviewRating ?? product?.rawText ?? "").match(/\b([1-5](?:\.\d)?)\b/);
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) ? n : 0;
}

function getReviewCount(product) {
  return (
    moneyToNumber(product?.reviewCount) ||
    moneyToNumber(product?.reviews) ||
    moneyToNumber(product?.ratingReviews) ||
    0
  );
}

function getSourcePrice(product) {
  return (
    moneyToNumber(product?.productCost) ||
    moneyToNumber(product?.aliExpressSourcePrice) ||
    moneyToNumber(product?.aliexpressSourcePrice) ||
    moneyToNumber(product?.sourcePrice) ||
    moneyToNumber(product?.aliPrice) ||
    moneyToNumber(product?.preferredSourcePrice)
  );
}

function getShippingCost(product, productCost) {
  const explicitValue = [
    product?.shippingCost,
    product?.aliExpressShippingCost,
    product?.sourceShippingCost,
  ].find((value) => value !== undefined && value !== null && String(value).trim() !== "");

  if (explicitValue !== undefined) {
    if (normalize(explicitValue).includes("free")) return 0;
    return moneyToNumber(explicitValue);
  }

  const text = normalize([
    product?.shippingText,
    product?.aliExpressShippingText,
    product?.aliExpressSourceTitle,
    product?.aliExpressNotes,
    product?.rawText,
  ].filter(Boolean).join(" "));

  if (text.includes("free shipping")) return 0;
  if (productCost > 0) return roundMoney(clamp(productCost * 0.15, 8, 28));
  return 0;
}

function getShippingDays(product) {
  const direct = Number(product?.shippingDays ?? product?.estimatedShippingDays ?? product?.aliExpressShippingDays);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const text = String([
    product?.shippingTime,
    product?.shippingText,
    product?.aliExpressShippingText,
    product?.aliExpressNotes,
    product?.rawText,
  ].filter(Boolean).join(" "));

  const range = text.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*days?/i);
  if (range) return Number(range[2]);

  const single = text.match(/(\d{1,2})\s*days?/i);
  if (single) return Number(single[1]);

  return null;
}

function getGrowth(product) {
  const direct =
    percentToNumber(product?.trendVelocity) ??
    percentToNumber(product?.revenueGrowth) ??
    percentToNumber(product?.growth) ??
    percentToNumber(product?.growthRate);

  if (direct !== null) return direct;

  return percentToNumber(product?.rawText);
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

const REGULATED_REJECT_TERMS = [
  "fda",
  "fda approved",
  "fda cleared",
  "fda registered",
  "protein",
  "protein powder",
  "whey",
  "beverage",
  "edible",
  "ingestible",
  "supplement",
  "gummy",
  "gummies",
  "vitamin",
  "probiotic",
  "ashwagandha",
  "l theanine",
  "collagen peptide",
  "digestive enzyme",
  "weight loss",
  "cutting drink",
  "teeth whitening",
  "mouthwash",
  "skin care",
  "skincare",
  "anti aging",
  "anti aging care",
  "anti-aging",
  "pdrn",
  "volufiline",
  "nad ",
  "egf",
  "serum",
  "sunscreen",
  "acne",
  "ipl hair removal",
  "laser hair removal",
  "kojic",
  "turmeric spray",
  "hair growth",
  "medical",
  "pain relief",
  "cbd",
  "thc",
  "nicotine",
  "vape",
  "alcohol",
  "adult toy",
  "sex toy"
];

const HIGH_LIABILITY_TERMS = [
  "weapon",
  "taser",
  "pepper spray",
  "chainsaw",
  "mini chainsaw",
  "gas powered",
  "gas stove",
  "propane",
  "burner",
  "disc cooker",
  "outdoor cooker",
  "fuel caddy",
  "car seat",
  "booster car seat",
  "infant car seat",
  "crib",
  "baby gate",
  "kids bumper car",
  "ride on toys",
  "electric scooter",
  "helmet",
  "medical device"
];

const OBVIOUS_BRAND_TERMS = [
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
  "ar zopa",
  "arzopa",
  "kodak",
  "nike",
  "vans",
  "birkenstock",
  "new balance",
  "nobull",
  "dewalt",
  "jbl",
  "graco",
  "baby trend",
  "wikico",
  "rovsun",
  "keter",
  "magcubic",
  "simple modern",
  "skullcandy",
  "clinique",
  "tarte",
  "maryruth",
  "neocell",
  "hismile",
  "dr melaxin",
  "dr.melaxin",
  "medicube",
  "ecoflow",
  "phlur",
  "conair",
  "wahl",
  "phlur",
  "vivaia",
  "portland leather goods",
  "portland leather",
  "portland",
  "petlibro",
  "songmics",
  "garvee",
  "tribesigns",
  "skin1004",
  "mixsoon",
  "euhomy",
  "amerlife",
  "luvme",
  "ownscalp"
];

const SEASONAL_REJECT_TERMS = [
  "summervibes",
  "summer vibes",
  "memorial day",
  "fathersdaygift",
  "father s day",
  "fathers day",
  "mothersdaygift",
  "mother s day",
  "mothers day",
  "christmas",
  "halloween",
  "thanksgiving",
  "valentine",
  "easter",
  "new year gift",
  "holiday gift",
  "seasonal",
  "back to school",
  "spring break",
  "black friday",
  "cyber monday"
];

const MEMORABILIA_REJECT_TERMS = [
  "memorabilia",
  "collectible",
  "collectibles",
  "trading card",
  "trading cards",
  "sports card",
  "sports cards",
  "hobby box",
  "card break",
  "case hit",
  "pick your team",
  "panini",
  "flawless football",
  "fanatics",
  "signed authentic",
  "autographed",
  "authentic football helmet",
  "world cup sticker",
  "official sticker collection",
  "pokemon",
  "tcg ",
  "energy break",
  "book bundle",
  "romance novels",
  "novel",
  "paperback",
  "hardcover"
];

const RETAIL_AVAILABILITY_RISK_TERMS = [
  "walmart",
  "target",
  "costco",
  "sam s club",
  "home depot",
  "lowe s",
  "best buy",
  "amazon basics",
  "countertop ice maker",
  "ice maker",
  "pedestal fan",
  "standing fan",
  "tower fan",
  "circulator fan",
  "box fan",
  "air purifier",
  "wet dry vacuum",
  "wet dry hard floor cleaner",
  "hard floor cleaner",
  "vacuum mop",
  "walking pad",
  "treadmill",
  "dehumidifier",
  "humidifier",
  "space heater",
  "portable air conditioner",
  "portable ac",
  "coffee maker",
  "blender",
  "toaster",
  "microwave",
  "rice cooker",
  "slow cooker",
  "air fryer"
];

const PROBLEM_TERMS = [
  "cleaner",
  "stain",
  "vacuum",
  "mop",
  "steam",
  "steamer",
  "odor",
  "pet",
  "cat litter",
  "litter box",
  "dog",
  "allergen",
  "storage",
  "organizer",
  "bathroom",
  "kitchen",
  "car",
  "sleep",
  "comforter",
  "blanket",
  "cooling",
  "heating",
  "washer",
  "portable",
  "space saving",
  "cordless",
  "leak",
  "clutter",
  "humidity",
  "mosquito",
  "pest",
  "backup camera",
  "monitor"
];

const DEMO_TERMS = [
  "stain",
  "cleaner",
  "steam",
  "vacuum",
  "mop",
  "litter box",
  "organizer",
  "before",
  "after",
  "odor",
  "pet",
  "portable",
  "cordless",
  "foldable",
  "rotating",
  "led",
  "camera",
  "self cleaning",
  "anti tangle",
  "waterproof"
];

const TRUSTED_BRAND_COMPETITION_TERMS = [
  ...OBVIOUS_BRAND_TERMS,
  "dyson",
  "black decker",
  "hamilton beach",
  "oster",
  "keurig",
  "homedics",
  "lg",
  "samsung",
  "sony",
  "apple"
];

function firstHit(text, terms) {
  const paddedText = ` ${text} `;
  return terms.find((term) => {
    const normalizedTerm = normalize(term);
    if (!normalizedTerm) return false;
    return paddedText.includes(` ${normalizedTerm} `);
  }) || "";
}

function officialShopRejectReason(product) {
  if (product?.tiktokOfficialShop === true) {
    return "Official shop risk: TikTok identified an official shop.";
  }

  const status = normalize(product?.tiktokStatus);
  const matchedEvidence = normalize(product?.tiktokOfficialShopEvidence?.matchedSnippet);

  if (status.includes("branded") && status.includes("official shop")) {
    return "Official shop risk: TikTok status marked branded / official shop risk.";
  }

  if (matchedEvidence.includes("official shop") || matchedEvidence.includes("official store")) {
    return "Official shop risk: TikTok official-shop evidence matched this product.";
  }

  return "";
}

function leadingBrandTerm(product) {
  const generic = new Set([
    "usb",
    "led",
    "fhd",
    "uhd",
    "hdr",
    "wifi",
    "bluetooth",
    "btu",
    "tsa",
    "abs",
    "diy",
    "rgb",
  ]);

  const title = String(titleOf(product)).replace(/^\[[^\]]+\]\s*/, "").trim();
  const match = title.match(/^([A-Z][A-Z0-9]{2,})\b/);
  if (!match) return "";

  const term = normalize(match[1]);
  if (!term || generic.has(term)) return "";
  return term;
}

function hasUnbrandedSource(product) {
  const text = normalize([
    product?.aliExpressSourceTitle,
    product?.sourceBrandStatus,
    product?.sourcingNotes,
    product?.aliExpressNotes,
  ].filter(Boolean).join(" "));

  if (
    text.includes("required") ||
    text.includes("not confirmed") ||
    text.includes("must be verified") ||
    text.includes("alternative needed") ||
    text.includes("created from official shop")
  ) {
    return false;
  }

  return (
    text.includes("unbranded") ||
    text.includes("oem") ||
    text.includes("white label") ||
    text.includes("no logo")
  );
}

function officialShopNameTerms(product) {
  const source = [
    product?.tiktokOfficialShopEvidence?.matchedSnippet,
    product?.tiktokNotes,
  ].filter(Boolean).join(" ");

  const text = normalize(source);
  const match = text.match(/(.{2,120}?)(?:official shop|officialshop|official store|verified shop|verified store|authorized store|authorized seller)/);
  if (!match) return [];

  let shopName = match[1]
    .replace(/\b(free shipping|shipping|delivery|coupon|shop|store)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?[km]?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = shopName.split(" ").filter(Boolean);
  if (words.length > 5) shopName = words.slice(-5).join(" ");
  if (!shopName || shopName.length < 3) return [];

  const terms = new Set([shopName]);
  if (shopName.endsWith(" goods")) terms.add(shopName.replace(/\s+goods$/, ""));

  return [...terms].filter((term) => term.length >= 3);
}

function officialAlternativeBrandLeakReason(product) {
  if (!product?.alternativeForOfficialShop) return "";

  const candidateText = normalize([
    product?.title,
    product?.productTitle,
    product?.genericProductTitle,
    product?.sourcingSearchTitle,
    product?.alternativeSearchTitle,
  ].filter(Boolean).join(" "));

  const terms = [
    ...officialShopNameTerms(product),
    ...OBVIOUS_BRAND_TERMS,
  ].map(normalize).filter(Boolean);
  const hit = terms.find((term) => candidateText.includes(term));

  if (hit) {
    return `Official-shop alternative still references brand/shop term (${hit}); reject exact official product.`;
  }

  if (product?.originalOfficialShopUrl && product?.tiktokUrl === product.originalOfficialShopUrl) {
    return "Official-shop alternative still points to the original TikTok Shop PDP.";
  }

  return "";
}

function brandCompetitionText(product, fallbackText) {
  if (!product?.alternativeForOfficialShop) return fallbackText;

  return normalize([
    product?.title,
    product?.productTitle,
    product?.genericProductTitle,
    product?.sourcingSearchTitle,
    product?.alternativeSearchTitle,
    product?.aliExpressSourceTitle,
    product?.sourceTitle,
    product?.brand,
    product?.brandName,
  ].filter(Boolean).join(" "));
}

function brandRiskReason(product, text) {
  const alternativeLeak = officialAlternativeBrandLeakReason(product);
  if (alternativeLeak) return alternativeLeak;

  const official = officialShopRejectReason(product);
  if (official) return official;

  const brandText = brandCompetitionText(product, text);
  const brand = firstHit(brandText, OBVIOUS_BRAND_TERMS);
  const leadingBrand = leadingBrandTerm(product);
  const hit = brand || leadingBrand;
  if (!hit) return "";

  if (hasUnbrandedSource(product)) {
    return "";
  }

  return `Branded/proprietary risk: visible brand or trademark term (${hit}) and no unbranded/OEM source confirmed.`;
}

function regulatoryRiskReason(text) {
  const regulated = firstHit(text, REGULATED_REJECT_TERMS);
  if (regulated) return `Government regulation/FDA/medical/adult product risk: ${regulated}.`;

  const liability = firstHit(text, HIGH_LIABILITY_TERMS);
  if (liability) return `High liability or safety-critical product risk: ${liability}.`;

  return "";
}

export function governmentRegulatoryRiskReason(product) {
  return regulatoryRiskReason(getText(product));
}

function seasonalRejectReason(text) {
  const hit = firstHit(text, SEASONAL_REJECT_TERMS);
  return hit ? `Seasonal product risk: ${hit}.` : "";
}

function memorabiliaRejectReason(text) {
  const hit = firstHit(text, MEMORABILIA_REJECT_TERMS);
  return hit ? `Memorabilia/collectible product risk: ${hit}.` : "";
}

function retailAvailabilityRiskReason(text) {
  const hit = firstHit(text, RETAIL_AVAILABILITY_RISK_TERMS);
  return hit ? `Retail availability risk: appears easy to buy from Amazon/Walmart/large stores (${hit}).` : "";
}

export function buildSourcingUrls(product) {
  const q = encodedQuery(product);
  const aliSearch = product?.aliExpressSearchUrl || `https://www.aliexpress.us/w/wholesale-${q}.html`;

  return {
    aliExpress: product?.aliExpressSourceUrl || product?.aliexpressSourceUrl || product?.sourceUrl || aliSearch,
    aliExpressSearch: aliSearch,
    alibaba: product?.alibabaSourcingUrl || `https://www.alibaba.com/trade/search?SearchText=${q}`,
    zendrop: product?.zendropSourcingUrl || `https://www.zendrop.com/products?search=${q}`,
    wiio: product?.wiioSourcingUrl || `https://www.wiio.io/search?keyword=${q}`,
  };
}

export function buildCompetitorUrls(product) {
  const q = encodedQuery(product);
  const urls = [
    { site: "Amazon", url: product?.amazonCompetitorUrl || `https://www.amazon.com/s?k=${q}` },
    { site: "Walmart", url: product?.walmartCompetitorUrl || `https://www.walmart.com/search?q=${q}` },
    { site: "TikTok Shop", url: product?.tiktokUrl || `https://www.tiktok.com/shop/s/${q}` },
    { site: "Google Shopping", url: product?.googleShoppingUrl || `https://www.google.com/search?tbm=shop&q=${q}` },
    { site: "AliExpress", url: product?.aliExpressSearchUrl || `https://www.aliexpress.us/w/wholesale-${q}.html` },
  ];

  const extra = Array.isArray(product?.competitorUrls) ? product.competitorUrls : [];
  const normalizedExtra = extra
    .map((entry) => typeof entry === "string" ? { site: "Competitor", url: entry } : entry)
    .filter((entry) => entry?.url);

  const seen = new Set();
  return [...normalizedExtra, ...urls].filter((entry) => {
    if (!entry?.url || seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

function estimateSellingPrice(product, text, warnings) {
  const observed = getSellPrice(product);
  const competitorLow = moneyToNumber(product?.competitorLowPrice);
  let price = observed || 0;

  if (price <= 0 && competitorLow > 0) price = competitorLow;
  if (price <= 0) price = 99.99;

  if (competitorLow > 0 && competitorLow < price) {
    price = Math.max(80, Math.min(price, competitorLow));
    warnings.push("Selling price capped because competitor pricing appears lower.");
  }

  if (includesAny(text, TRUSTED_BRAND_COMPETITION_TERMS) && price > 149.99) {
    price = Math.min(price, 149.99);
    warnings.push("Selling price capped because trusted-brand competition is likely.");
  }

  if (price >= 80 && price <= 200) return roundMoney(price);
  return roundMoney(price);
}

function computeFinancials(product, sellingPrice) {
  const productCost = getSourcePrice(product);
  const shippingCost = getShippingCost(product, productCost);
  const landedCost = roundMoney(productCost + shippingCost);
  const paymentFee = roundMoney(sellingPrice * 0.029 + 0.30);
  const returnReserve = roundMoney(sellingPrice * 0.08);
  const grossProfitBeforeAds = roundMoney(sellingPrice - landedCost - paymentFee);
  const grossMarginPct = sellingPrice > 0 ? grossProfitBeforeAds / sellingPrice : 0;
  const breakEvenCpa = roundMoney(sellingPrice - landedCost - paymentFee - returnReserve);
  const maxCpaFor15PctNet = roundMoney(
    sellingPrice - landedCost - paymentFee - returnReserve - (sellingPrice * 0.15)
  );

  return {
    productCost,
    shippingCost,
    landedCost,
    paymentFee,
    returnReserve,
    grossProfitBeforeAds,
    grossMarginPct,
    breakEvenCpa,
    maxCpaFor15PctNet,
    landedCostRatio: sellingPrice > 0 ? landedCost / sellingPrice : 1,
  };
}

function profitabilityScore(financials) {
  const ratio = financials.landedCostRatio;
  const maxCpa = financials.maxCpaFor15PctNet;

  if (ratio <= 0.35 && maxCpa >= 40) return 35;
  if (ratio <= 0.45 && maxCpa >= 30) return 25;
  if (ratio <= 0.55 && maxCpa >= 25) return 15;
  return 0;
}

function facebookCrowdingSignal(product) {
  const uniqueAdvertisers = Math.max(
    numberOrZero(product?.facebookUniqueAdvertiserCount),
    numberOrZero(product?.facebookAdvertiserCount),
    numberOrZero(product?.fbUniqueAdvertiserCount),
    numberOrZero(product?.fbAdvertiserCount)
  );

  if (uniqueAdvertisers > 0) {
    return {
      count: uniqueAdvertisers,
      basis: "unique advertiser/page",
    };
  }

  return {
    count: Math.max(
      numberOrZero(product?.facebookVisibleResultCount),
      numberOrZero(product?.facebookAdCount),
      numberOrZero(product?.facebookRawAdCount),
      numberOrZero(product?.fbVisibleResultCount),
      numberOrZero(product?.fbAdCount)
    ),
    basis: "raw ad/result",
  };
}

function facebookAdSignalCount(product) {
  return facebookCrowdingSignal(product).count;
}

function facebookCrowding(product) {
  const signal = facebookCrowdingSignal(product);
  const count = signal.count;
  const basis = signal.basis;
  const query = product?.facebookWinningQuery || product?.facebookSearchTextWithResults || "";

  if (count >= FACEBOOK_CROWD_REJECT_COUNT) {
    return {
      count,
      basis,
      level: "high",
      isReject: true,
      reason: `Facebook niche crowding risk: ${count} ${basis} signal(s) for "${query || "matched query"}"; too crowded for a clean test.`,
    };
  }

  if (count >= FACEBOOK_CROWD_WARN_COUNT) {
    return {
      count,
      basis,
      level: "medium",
      isReject: false,
      reason: `Facebook niche crowding warning: ${count} ${basis} signal(s) for "${query || "matched query"}"; creative angle must be clearly different.`,
    };
  }

  if (count > 0) {
    return {
      count,
      basis,
      level: "low",
      isReject: false,
      reason: `Facebook demand signal without heavy crowding: ${count} ${basis} signal(s).`,
    };
  }

  return {
    count,
    basis,
    level: "unknown",
    isReject: false,
    reason: "No Facebook crowding signal found; demand still needs manual validation.",
  };
}

function demandScore(product, text) {
  let score = 0;
  const revenue = getRevenue(product);
  const sales = getSales(product);
  const rating = getRating(product);
  const reviews = getReviewCount(product);
  const growth = getGrowth(product);
  const fbAds = facebookAdSignalCount(product);

  if (revenue >= 50000 && revenue <= 300000) score += 8;
  else if (revenue >= 15000) score += 5;
  else if (revenue > 0) score += 2;

  if (sales >= 300) score += 4;
  else if (sales >= 75) score += 2;

  if (rating >= 4.4 && reviews >= 50) score += 3;
  else if (reviews >= 20) score += 1;

  if (growth !== null && growth >= 10 && growth <= 200) score += 3;
  else if (growth !== null && growth > 200) score += 1;

  if (fbAds > 0 || normalize(product?.facebookAdsStatus).includes("active ads found")) score += 2;

  if (includesAny(text, ["fake", "replica", "dupe"])) score -= 3;

  return clamp(score, 0, 20);
}

function competitionScore(product, text, warnings) {
  const marketText = brandCompetitionText(product, text);
  const retailRisk = retailAvailabilityRiskReason(marketText);
  const trustedBrandHit = firstHit(marketText, TRUSTED_BRAND_COMPETITION_TERMS);
  const fbCrowding = facebookCrowding(product);
  const saturated =
    normalize(product?.competitionLevel).includes("high") ||
    normalize(product?.competitionNotes).includes("saturated") ||
    fbCrowding.isReject;

  if (retailRisk || trustedBrandHit || saturated) {
    if (retailRisk) warnings.push(retailRisk);
    if (trustedBrandHit) warnings.push(`Trusted-brand competition risk: ${trustedBrandHit}.`);
    if (fbCrowding.isReject) warnings.push(fbCrowding.reason);
    return 0;
  }

  if (fbCrowding.level === "medium") {
    warnings.push(fbCrowding.reason);
    return 4;
  }

  if (fbCrowding.level === "low") return 12;

  const competitorCount = buildCompetitorUrls(product).length;
  if (competitorCount >= 3) return 8;
  return 15;
}

function adDemoScore(text) {
  let score = 0;
  if (includesAny(text, PROBLEM_TERMS)) score += 4;
  if (includesAny(text, DEMO_TERMS)) score += 4;
  if (includesAny(text, ["pet", "car", "home", "cleaning", "organization", "odor", "convenience", "safety"])) score += 2;
  return clamp(score, 0, 10);
}

function sourcingQualityScore(product, financials, shippingDays, text, warnings) {
  let score = 0;
  const hasSource = Boolean(product?.aliExpressSourceUrl || product?.sourceUrl);
  const exactness = normalize(product?.sourcingConfidence || product?.aliExpressStatus || "");
  const warehouse = normalize(product?.warehouseLocation || product?.shipFrom || product?.aliExpressWarehouse);
  const listings = Number(product?.aliExpressResultCount || 0);
  const matchScore = sourceMatchScore(product);

  if (hasSource && financials.productCost > 0) score += 3;
  if (exactness.includes("exact") || exactness.includes("near") || exactness.includes("source found")) score += 1;
  if (matchScore !== null && matchScore >= 0.25) score += 2;
  if (matchScore !== null && matchScore < 0.18) warnings.push("AliExpress source title does not closely match the Kalodata product title.");
  if (hasUnbrandedSource(product) || !firstHit(text, OBVIOUS_BRAND_TERMS)) score += 2;
  if (warehouse.includes("united states") || warehouse.includes(" us ") || warehouse === "us" || (shippingDays !== null && shippingDays <= 10)) score += 2;
  else if (shippingDays === null) warnings.push("Shipping time is unknown and must be manually verified.");
  if (listings >= 5) score += 1;

  return clamp(score, 0, 10);
}

function riskScore(text, financials, shippingDays, warnings) {
  let score = 10;

  if (regulatoryRiskReason(text)) score -= 7;
  if (includesAny(text, ["glass", "ceramic", "mirror", "fragile"])) score -= 3;
  if (includesAny(text, ["furniture", "cabinet", "mattress", "treadmill", "chair", "sofa", "patio set"])) score -= 3;
  if (financials.productCost > 80 || financials.landedCost > 100) score -= 2;
  if (shippingDays !== null && shippingDays > 14) {
    score -= 4;
    warnings.push(`Shipping time over 14 days (${shippingDays} days).`);
  }

  return clamp(score, 0, 10);
}

function classify(score) {
  if (score >= 85) return "Strong test candidate";
  if (score >= 75) return "Possible test candidate";
  if (score >= 65) return "Watchlist only";
  return "Reject";
}

function finalDecisionFor(classification) {
  if (classification === "Strong test candidate" || classification === "Possible test candidate") return "Test";
  if (classification === "Watchlist only") return "Watchlist";
  return "Reject";
}

function competitionLevel(product, competitionPoints, text) {
  const fbCrowding = facebookCrowding(product);
  if (fbCrowding.level === "high") return "high / crowded on Facebook";
  if (fbCrowding.level === "medium") return "medium / watch Facebook crowding";
  if (fbCrowding.level === "low" && competitionPoints >= 12) return "low / light Facebook ads";

  const direct = product?.competitionLevel;
  if (direct && direct !== "manual verification needed") return direct;
  if (competitionPoints === 0 || retailAvailabilityRiskReason(text)) return "high";
  if (competitionPoints < 15) return "medium";
  return "low";
}

function mainRisk(rejectionReasons, warnings) {
  return rejectionReasons[0] || warnings[0] || "Manual verification required.";
}

export function scoreProduct(product, options = {}) {
  const phase = options.phase || "final";
  const text = getText(product);
  const reasons = [];
  const warnings = [];
  const rejectionReasons = [];

  const regulatoryRisk = regulatoryRiskReason(text);
  const seasonalRisk = seasonalRejectReason(text);
  const memorabiliaRisk = memorabiliaRejectReason(text);
  const brandRisk = brandRiskReason(product, text);
  const retailRisk = retailAvailabilityRiskReason(brandCompetitionText(product, text));
  const leadHardReject = phase === "lead" && Boolean(regulatoryRisk || seasonalRisk || memorabiliaRisk);
  const fbCrowding = facebookCrowding(product);

  if (regulatoryRisk) rejectionReasons.push(regulatoryRisk);
  if (seasonalRisk) rejectionReasons.push(seasonalRisk);
  if (memorabiliaRisk) rejectionReasons.push(memorabiliaRisk);
  if (brandRisk) rejectionReasons.push(brandRisk);

  const sellingPrice = estimateSellingPrice(product, text, warnings);
  const financials = computeFinancials(product, sellingPrice);
  const shippingDays = getShippingDays(product);
  const matchScore = sourceMatchScore(product);
  const profitPoints = phase === "lead" && financials.productCost <= 0
    ? (sellingPrice >= 80 && sellingPrice <= 200 ? 15 : 0)
    : profitabilityScore(financials);
  const demandPoints = demandScore(product, text);
  const competitionPoints = competitionScore(product, text, warnings);
  const demoPoints = adDemoScore(text);
  const sourcingPoints = phase === "lead" && financials.productCost <= 0
    ? 3
    : sourcingQualityScore(product, financials, shippingDays, text, warnings);
  const riskPoints = riskScore(text, financials, shippingDays, warnings);

  if (sellingPrice < 80 || sellingPrice > 200) {
    rejectionReasons.push(`Selling price estimate is outside $80-$200 target (${sellingPrice || "unknown"}).`);
  }

  if (phase !== "lead") {
    if (financials.productCost <= 0) {
      rejectionReasons.push("Poor sourcing: no confirmed product cost/source price.");
    }
    if (matchScore !== null && matchScore < 0.18) {
      rejectionReasons.push("Poor sourcing: AliExpress source title does not match the Kalodata product closely enough.");
    }
    if (financials.grossMarginPct < 0.45) {
      rejectionReasons.push(`Gross margin below 45% (${(financials.grossMarginPct * 100).toFixed(1)}%).`);
    }
    if (financials.maxCpaFor15PctNet < 25) {
      rejectionReasons.push(`Max CPA for 15% net is below $25 ($${financials.maxCpaFor15PctNet.toFixed(2)}).`);
    }
    if (financials.landedCostRatio > 0.55) {
      rejectionReasons.push(`Landed cost exceeds 55% of selling price (${(financials.landedCostRatio * 100).toFixed(1)}%).`);
    }
    if (shippingDays !== null && shippingDays > 14 && !normalize(product?.warehouseLocation).includes("united states")) {
      rejectionReasons.push(`Shipping time exceeds 14 days without confirmed US warehouse (${shippingDays} days).`);
    }
    if (retailRisk || competitionPoints === 0) {
      rejectionReasons.push(retailRisk || "Competition risk: trusted brands or saturated channels appear to control this item.");
    }
    if (fbCrowding.isReject) {
      rejectionReasons.push(fbCrowding.reason);
    }
  }

  if (includesAny(text, PROBLEM_TERMS)) reasons.push("Solves a clear problem.");
  else warnings.push("Problem solved is unclear.");

  if (demoPoints >= 7) reasons.push("Strong visual demo/video potential.");
  if (demandPoints >= 10) reasons.push("Kalodata/social demand proof is present.");
  if (profitPoints >= 25) reasons.push("Financials leave room for paid ads.");
  if (sourcingPoints >= 7) reasons.push("Sourcing quality looks usable.");

  let totalScore = Math.round(
    profitPoints + demandPoints + competitionPoints + demoPoints + sourcingPoints + riskPoints
  );

  if (rejectionReasons.length > 0 && phase !== "lead") totalScore = Math.min(totalScore, 64);
  if (phase !== "lead" && fbCrowding.level === "medium") totalScore = Math.min(totalScore, 74);
  if (leadHardReject) totalScore = Math.min(totalScore, 59);

  const classification = phase === "lead"
    ? (leadHardReject
        ? "Reject"
        : totalScore >= 45
          ? "Lead candidate"
          : totalScore >= 35
            ? "Lead watchlist"
            : "Reject")
    : (rejectionReasons.length > 0
        ? "Reject"
        : classify(totalScore));
  const productDecision = phase === "lead"
    ? (classification === "Reject" ? "Reject" : "Candidate")
    : finalDecisionFor(classification);
  const sourceUrls = buildSourcingUrls(product);
  const competitorUrls = buildCompetitorUrls(product);
  const sourceConfidence = product?.sourcingConfidence || (
    product?.aliExpressSourceUrl ? "near match from AliExpress; verify exact match manually" : "low; source not confirmed"
  );
  const adjustedSourceConfidence = matchScore !== null && matchScore < 0.18
    ? "low; AliExpress source title does not match the product closely enough"
    : sourceConfidence;

  return {
    ...product,
    recommendedSellingPrice: sellingPrice,
    sellingPriceEstimate: sellingPrice,
    targetSellPrice: sellingPrice,
    productCost: roundMoney(financials.productCost),
    shippingCost: roundMoney(financials.shippingCost),
    landedCost: financials.landedCost,
    paymentFee: financials.paymentFee,
    returnReserve: financials.returnReserve,
    grossProfitBeforeAds: financials.grossProfitBeforeAds,
    grossMarginPct: financials.grossMarginPct,
    breakEvenCpa: financials.breakEvenCpa,
    maxCpaFor15PctNet: financials.maxCpaFor15PctNet,
    landedCostRatio: financials.landedCostRatio,
    profitabilityScore: profitPoints,
    demandProofScore: demandPoints,
    competitionScore: competitionPoints,
    facebookNicheCrowding: fbCrowding.level,
    facebookCrowdingSignalCount: fbCrowding.count,
    facebookCrowdingSignalBasis: fbCrowding.basis,
    facebookCrowdingReason: fbCrowding.reason,
    adDemoScore: demoPoints,
    sourcingQualityScore: sourcingPoints,
    riskScore: riskPoints,
    productScore: clamp(totalScore, 0, 100),
    classification,
    productDecision,
    decision: productDecision,
    finalDecision: productDecision,
    problemSolved: includesAny(text, PROBLEM_TERMS) ? "Likely" : "Unclear",
    brandRisk: brandRisk ? "high" : product?.brandRisk || "low",
    retailAvailabilityRisk: retailRisk ? "high" : product?.retailAvailabilityRisk || "unknown",
    competitionLevel: competitionLevel(product, competitionPoints, text),
    competitorUrls,
    sourcingUrls: sourceUrls,
    sourcingUrl: product?.aliExpressSourceUrl || sourceUrls.aliExpress,
    alibabaSourcingUrl: sourceUrls.alibaba,
    zendropSourcingUrl: sourceUrls.zendrop,
    wiioSourcingUrl: sourceUrls.wiio,
    sourceMatchScore: matchScore,
    sourcingConfidence: adjustedSourceConfidence,
    shippingTime: shippingDays === null ? product?.shippingTime || "unknown" : `${shippingDays} days`,
    estimatedShippingDays: shippingDays,
    productSelectionReasons: reasons,
    productWarnings: [...new Set([...warnings, ...rejectionReasons])],
    rejectionReasons: [...new Set(rejectionReasons)],
    recommendation: productDecision === "Test"
      ? "Test only after exact source and competitor pricing are manually verified."
      : productDecision === "Watchlist"
        ? "Watchlist; needs better proof before spending on ads."
        : "Reject for now.",
    mainRisk: mainRisk(rejectionReasons, warnings),
    selectionNotes: [
      reasons.length ? `Reasons: ${reasons.join("; ")}` : "",
      warnings.length ? `Warnings: ${warnings.join("; ")}` : "",
      rejectionReasons.length ? `Rejected because: ${rejectionReasons.join("; ")}` : "",
    ].filter(Boolean).join(" | "),
  };
}

export function applyProductScoring(products) {
  if (!Array.isArray(products)) return [];

  return products
    .map((product) => scoreProduct(product, { phase: "lead" }))
    .filter((p) => p.productDecision !== "Reject")
    .sort((a, b) => {
      const scoreDiff = (b.productScore ?? 0) - (a.productScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;

      return getRevenue(b) - getRevenue(a);
    });
}

export default applyProductScoring;
