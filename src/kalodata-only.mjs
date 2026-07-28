// Scoped runner: Kalodata collection + scoring only (no TikTok/FB/AliExpress validation).
import { collectKalodataProducts, filterCandidateProducts } from "./kalodata.mjs";
import { scoreProduct } from "./product-scoring.mjs";
import { writeJson } from "./browser.mjs";

const raw = await collectKalodataProducts();
console.log(`[kalodata-only] Collected ${raw.length} raw products.`);
await writeJson("kalodata-only-raw.json", raw);

const candidates = filterCandidateProducts(raw);
console.log(`[kalodata-only] ${candidates.length} candidates after filtering.`);

const scored = candidates
  .map((p) => {
    try {
      const s = scoreProduct(p, { phase: "lead" });
      return { ...p, _score: s.productScore ?? 0, _scoreNotes: s.notes || s.reasons || null };
    } catch {
      return { ...p, _score: 0 };
    }
  })
  .sort((a, b) => (b._score || 0) - (a._score || 0));

await writeJson("kalodata-only-scored.json", scored);

const top = scored.slice(0, 25).map((p, i) => ({
  rank: i + 1,
  score: p._score,
  title: p.title || p.name,
  price: p.price || p.averageUnitPrice || p.avgUnitPrice,
  revenue: p.revenue,
  growth: p.revenueGrowthRate || p.growth,
  sold: p.itemSold || p.sold,
  commission: p.commissionRate || p.commission,
  category: p.category,
}));
console.log("[kalodata-only] TOP 25:");
console.log(JSON.stringify(top, null, 2));
