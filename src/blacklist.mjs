import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const BLACKLIST_PATH = path.join(ROOT, "config/product-blacklist.json");

const DEFAULT_BLACKLIST = [
  "Teant",
  "Shark StainForce"
];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureBlacklistFile() {
  await fs.mkdir(path.dirname(BLACKLIST_PATH), { recursive: true });

  try {
    await fs.access(BLACKLIST_PATH);
  } catch {
    await fs.writeFile(
      BLACKLIST_PATH,
      JSON.stringify({ terms: DEFAULT_BLACKLIST }, null, 2),
      "utf8"
    );
  }
}

export async function loadProductBlacklist() {
  await ensureBlacklistFile();

  const raw = await fs.readFile(BLACKLIST_PATH, "utf8");
  const parsed = JSON.parse(raw);

  const terms = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.terms)
      ? parsed.terms
      : [];

  return [...new Set(
    terms
      .map((term) => String(term ?? "").trim())
      .filter(Boolean)
  )];
}

export async function saveProductBlacklist(terms) {
  const cleaned = [...new Set(
    terms
      .map((term) => String(term ?? "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  await fs.mkdir(path.dirname(BLACKLIST_PATH), { recursive: true });

  await fs.writeFile(
    BLACKLIST_PATH,
    JSON.stringify({ terms: cleaned }, null, 2) + "\n",
    "utf8"
  );

  return cleaned;
}

export async function addProductBlacklistTerms(termsToAdd) {
  const current = await loadProductBlacklist();
  const byNormalized = new Map(current.map((term) => [normalize(term), term]));

  for (const term of termsToAdd) {
    const clean = String(term ?? "").trim();
    if (!clean) continue;
    byNormalized.set(normalize(clean), clean);
  }

  return await saveProductBlacklist([...byNormalized.values()]);
}

export async function removeProductBlacklistTerms(termsToRemove) {
  const current = await loadProductBlacklist();
  const removeSet = new Set(termsToRemove.map(normalize));

  const remaining = current.filter((term) => !removeSet.has(normalize(term)));

  return await saveProductBlacklist(remaining);
}

export function productBlacklistBlob(product) {
  return normalize([
    product?.title,
    product?.productTitle,
    product?.name,
    product?.product,
    product?.brand,
    product?.brandName,
    product?.shop,
    product?.shopName,
    product?.seller,
    product?.storeName,
    product?.merchant,
    product?.url,
    product?.productUrl,
    product?.productURL,
    product?.kalodataUrl,
    product?.kalodataURL,
    product?.sourceUrl,
    product?.notes,
    product?.summary,
  ].filter(Boolean).join(" "));
}

export function isProductBlacklisted(product, terms) {
  const blob = productBlacklistBlob(product);

  return terms.some((term) => {
    const normalizedTerm = normalize(term);
    return normalizedTerm && blob.includes(normalizedTerm);
  });
}

async function cli() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(`
Usage:
  npm run blacklist:list
  npm run blacklist:add -- "TERM"
  npm run blacklist:remove -- "TERM"

Examples:
  npm run blacklist:add -- "Shark StainForce"
  npm run blacklist:add -- "Teant" "Medicube"
  npm run blacklist:remove -- "Shark StainForce"
`);
    return;
  }

  if (command === "list") {
    const terms = await loadProductBlacklist();

    console.log("\nProduct blacklist:");
    if (terms.length === 0) {
      console.log("  empty");
    } else {
      terms.forEach((term, index) => {
        console.log(`  ${index + 1}. ${term}`);
      });
    }

    console.log(`\nFile: ${BLACKLIST_PATH}\n`);
    return;
  }

  if (command === "add") {
    if (args.length === 0) {
      console.error('Missing term. Example: npm run blacklist:add -- "Shark StainForce"');
      process.exit(1);
    }

    const updated = await addProductBlacklistTerms(args);
    console.log("\nAdded blacklist term(s):");
    args.forEach((term) => console.log(`  + ${term}`));
    console.log(`\nTotal blacklist terms: ${updated.length}\n`);
    return;
  }

  if (command === "remove" || command === "rm" || command === "delete") {
    if (args.length === 0) {
      console.error('Missing term. Example: npm run blacklist:remove -- "Shark StainForce"');
      process.exit(1);
    }

    const updated = await removeProductBlacklistTerms(args);
    console.log("\nRemoved blacklist term(s):");
    args.forEach((term) => console.log(`  - ${term}`));
    console.log(`\nTotal blacklist terms: ${updated.length}\n`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
