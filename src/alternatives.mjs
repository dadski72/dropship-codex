function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(product) {
  return (
    product?.title ||
    product?.productTitle ||
    product?.product ||
    product?.name ||
    product?.productName ||
    ""
  );
}

const brandTerms = [
  "uwant",
  "bissell",
  "shark",
  "hoover",
  "dripex",
  "elemara",
  "teant",
  "levoit",
  "corebreeze",
  "vital",
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
  "graco",
  "baby trend",
  "simple modern",
  "skullcandy",
  "clinique",
  "tarte",
  "maryruth",
  "neocell",
  "hismile",
  "medicube",
  "ecoflow",
  "conair",
  "wahl",
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
  "ownscalp",
  "fda",
  "official",
];

const noisyTerms = [
  "official",
  "brandday",
  "memorialday",
  "memorial day",
  "fathersdaygift",
  "father s day",
  "mothersdaygift",
  "mother s day",
  "tiktokshopmemorialday",
  "tiktok exclusive",
  "new arrival",
  "limited time offer",
  "from stockx",
  "global picks",
];

function stripBracketTags(value) {
  return String(value ?? "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/【[^】]+】/g, " ");
}

function removeTerms(value, terms) {
  let result = ` ${value} `;
  for (const term of terms) {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
    result = result.replace(pattern, " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

function officialShopNameTerms(product) {
  const source = [
    product?.tiktokOfficialShopEvidence?.matchedSnippet,
    product?.tiktokNotes,
  ].filter(Boolean).join(" ");

  const normalized = normalize(source);
  const match = normalized.match(/(.{2,120}?)(?:official shop|officialshop|official store|verified shop|verified store|authorized store|authorized seller)/);
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
  if (shopName.endsWith(" official")) terms.add(shopName.replace(/\s+official$/, ""));

  return [...terms].filter((term) => term.length >= 3);
}

function leadingBrandPhrase(value) {
  const words = String(value ?? "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^【[^】]+】\s*/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4);

  const phrase = [];
  for (const word of words) {
    const cleaned = word.replace(/[^A-Za-z0-9&'-]/g, "");
    if (!cleaned) break;
    if (/^(smart|automatic|portable|wireless|electric|heavy|duty|new|upgraded|foldable)$/i.test(cleaned)) break;
    if (/^[A-Z][a-zA-Z0-9&'-]{2,}$/.test(cleaned) || /^[A-Z0-9]{3,}$/.test(cleaned)) {
      phrase.push(cleaned);
      continue;
    }
    break;
  }

  return phrase.length ? phrase.join(" ") : "";
}

export function genericAlternativeTitle(product) {
  const title = titleOf(product);
  const dynamicBrandTerms = [
    ...officialShopNameTerms(product),
    leadingBrandPhrase(title),
  ].filter(Boolean);

  let generic = stripBracketTags(title);
  generic = removeTerms(generic, dynamicBrandTerms);
  generic = removeTerms(generic, noisyTerms);
  generic = removeTerms(generic, brandTerms);
  generic = generic
    .replace(/[#|].*$/g, " ")
    .replace(/\b[A-Z]?\d{2,}[A-Z0-9-]*\b/gi, " ")
    .replace(/\b[A-Z]{2,}[- ]?[A-Z0-9]{2,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (generic.length < 20) {
    generic = stripBracketTags(title)
      .replace(new RegExp(`^${leadingBrandPhrase(title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ")
      .replace(/[#|].*$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    generic = removeTerms(generic, dynamicBrandTerms);
    generic = removeTerms(generic, noisyTerms);
    generic = removeTerms(generic, brandTerms);
  }

  return generic.slice(0, 160);
}

export function buildAlternativeCandidate(product, { leadScore = 0 } = {}) {
  const generic = genericAlternativeTitle(product);

  return {
    ...product,
    title: `${generic} - unbranded/OEM alternative`,
    productTitle: generic,
    genericProductTitle: generic,
    sourcingSearchTitle: generic,
    alternativeSearchTitle: generic,
    alternativeForOfficialShop: true,
    originalOfficialShopTitle: titleOf(product),
    originalOfficialShopUrl: product?.tiktokUrl || "",
    originalKalodataUrl: product?.kalodataUrl || product?.productUrl || "",
    originalLeadScore: leadScore,
    tiktokOfficialShop: false,
    tiktokOfficialShopEvidence: undefined,
    tiktokStatus: "alternative source search candidate",
    tiktokUrl: "",
    brandRisk: "alternative needed",
    sourceBrandStatus: "unbranded/OEM alternative required; not confirmed",
    sourcingConfidence: "low; created from official-shop item and unbranded/OEM source must be verified",
    notes: [
      product?.notes,
      `Original item was official shop/branded. Researching similar unbranded/OEM niche instead: ${generic}`,
    ].filter(Boolean).join(" | "),
  };
}

export function isMeaningfulAlternative(product) {
  const title = normalize(genericAlternativeTitle(product));
  const dynamicBrands = officialShopNameTerms(product).map(normalize);
  const blockedTerms = [...brandTerms.map(normalize), ...dynamicBrands].filter(Boolean);
  const hasBlockedBrand = blockedTerms.some((term) => title.includes(term));

  return title.length >= 20 && title.split(" ").length >= 3 && !hasBlockedBrand;
}
