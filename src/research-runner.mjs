import { collectKalodataProducts, filterCandidateProducts, loginKalodata } from './kalodata.mjs';
import { loginFacebook, researchFacebookAds } from './facebook-ads.mjs';
import { loginAliExpress, researchAliExpress } from './aliexpress.mjs';
import { loginTikTok, researchTikTok } from './tiktok.mjs';
import { researchCompetition } from './competition.mjs';
import { buildAlternativeCandidate, isMeaningfulAlternative } from './alternatives.mjs';
import { buildReportRows, generateReports } from './report.mjs';
import { writeJson } from './browser.mjs';
import { governmentRegulatoryRiskReason, scoreProduct } from './product-scoring.mjs';

const command = process.argv[2] || 'research';
const site = process.argv[3];
const reportProductLimit = Math.max(1, Number(process.env.REPORT_PRODUCT_LIMIT || 5) || 5);
const candidatePoolLimit = Math.max(20, reportProductLimit * 4);
const officialAlternativeMinScore = Math.max(1, Number(process.env.OFFICIAL_SHOP_ALTERNATIVE_MIN_SCORE || 50) || 50);

function isOfficialShopRisk(product) {
  if (product?.tiktokOfficialShop === true) return true;

  const status = String(product?.tiktokStatus || '').toLowerCase();
  return status.includes('branded') && status.includes('official shop');
}

async function main() {
  if (command === 'login') {
    await runLogin(site);
    return;
  }

  if (command !== 'research') {
    throw new Error(`Unknown command: ${command}`);
  }

  console.log('[runner] Starting local Codex + Playwright dropshipping research run.');
  console.log(`[runner] Report product limit: ${reportProductLimit}.`);
  const rawProducts = await collectKalodataProducts();
  await writeJson('kalodata-products.json', rawProducts);
  console.log(`[runner] Saved ${rawProducts.length} raw Kalodata product(s).`);
  const candidates = filterCandidateProducts(rawProducts).slice(0, candidatePoolLimit);
  await writeJson('candidate-products.json', candidates);
  console.log(`[runner] Filtered to ${candidates.length} candidate products.`);

  const validatedProducts = [];
  const evaluatedProducts = [];
  const allTikTokResults = [];
  const allFacebookResults = [];
  const allAliExpressResults = [];
  const allCompetitionResults = [];
  const batchSize = 5;

  for (let start = 0; start < candidates.length && validatedProducts.length < reportProductLimit; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize);
    console.log(`[runner] Validating candidates ${start + 1}-${start + batch.length} of ${candidates.length}.`);

    const tiktokBatch = await researchTikTok(batch);
    allTikTokResults.push(...tiktokBatch);

    const officialShopProducts = tiktokBatch.filter((product) => isOfficialShopRisk(product));
    const officialAlternativeCandidates = [];
    const tiktokRejected = officialShopProducts.map((product) => {
      const leadScore = scoreProduct(product, { phase: 'lead' });
      const regulatoryRisk = governmentRegulatoryRiskReason(product);

      if (regulatoryRisk) {
        return scoreProduct({
          ...product,
          notes: [product.notes, `Alternative sourcing skipped because this niche may need government/FDA compliance: ${regulatoryRisk}`].filter(Boolean).join(' | '),
        });
      }

      if (leadScore.productScore >= officialAlternativeMinScore && isMeaningfulAlternative(product)) {
        const alternative = buildAlternativeCandidate(product, { leadScore: leadScore.productScore });
        officialAlternativeCandidates.push(alternative);
        console.log(`[runner] Official-shop item scored ${leadScore.productScore}; researching alternative source niche: ${alternative.sourcingSearchTitle}`);
      }

      return scoreProduct({
        ...product,
        notes: [product.notes, leadScore.productScore >= officialAlternativeMinScore
          ? 'Exact product rejected as official shop/branded; alternative sourcing candidate created when niche is not regulated.'
          : `Exact product rejected as official shop/branded; lead score ${leadScore.productScore} below alternative threshold ${officialAlternativeMinScore}.`
        ].filter(Boolean).join(' | '),
      });
    });
    const tiktokSurvivors = tiktokBatch.filter((product) => !isOfficialShopRisk(product));
    evaluatedProducts.push(...tiktokRejected);
    console.log(`[runner] TikTok official-shop check kept ${tiktokSurvivors.length}/${tiktokBatch.length} candidate(s); created ${officialAlternativeCandidates.length} official-shop alternative candidate(s).`);

    const sourceCandidates = [...tiktokSurvivors, ...officialAlternativeCandidates];

    if (sourceCandidates.length === 0) {
      continue;
    }

    const facebookBatch = await researchFacebookAds(sourceCandidates);
    allFacebookResults.push(...facebookBatch);

    const aliexpressBatch = await researchAliExpress(facebookBatch);
    allAliExpressResults.push(...aliexpressBatch);

    const competitionBatch = await researchCompetition(aliexpressBatch);
    allCompetitionResults.push(...competitionBatch);

    const scoredBatch = competitionBatch.map((product) => scoreProduct(product));
    evaluatedProducts.push(...scoredBatch);

    const finalSurvivors = scoredBatch.filter((product) => product.productDecision !== 'Reject');
    validatedProducts.push(...finalSurvivors);
    console.log(`[runner] Fully validated candidate count: ${validatedProducts.length}/${reportProductLimit}.`);
  }

  await writeJson('tiktok-results.json', allTikTokResults);
  await writeJson('facebook-results.json', allFacebookResults);
  await writeJson('aliexpress-results.json', allAliExpressResults);
  await writeJson('competition-results.json', allCompetitionResults);
  await writeJson('evaluated-products.json', evaluatedProducts);
  await writeJson('validated-products.json', validatedProducts);

  const reportProducts = validatedProducts.slice(0, reportProductLimit);
  const reportInput = evaluatedProducts.length > 0
    ? evaluatedProducts
    : (candidates.length > 0 ? candidates : rawProducts).map((product) => scoreProduct(product));
  const reportRows = buildReportRows(reportInput, { limit: reportProductLimit });
  console.log("[runner] Final enriched product sample:", {
    title: reportRows[0]?.title,
    score: reportRows[0]?.productScore,
    classification: reportRows[0]?.classification,
    sellingPrice: reportRows[0]?.recommendedSellingPrice,
    landedCost: reportRows[0]?.landedCost,
    maxCpaFor15PctNet: reportRows[0]?.maxCpaFor15PctNet,
    tiktokStatus: reportRows[0]?.tiktokStatus,
  });

  if (reportRows.length === 0) {
    console.log('[runner] No test/watchlist products survived. Report will include rejected products and reasons.');
  }

  await generateReports(reportInput, { limit: reportProductLimit });
  console.log('[runner] Research run complete.');
}

async function runLogin(target) {
  if (target === 'kalodata') return loginKalodata();
  if (target === 'facebook') return loginFacebook();
  if (target === 'aliexpress') return loginAliExpress();
  if (target === 'tiktok') return loginTikTok();
  throw new Error('Usage: node src/research-runner.mjs login <kalodata|facebook|aliexpress|tiktok>');
}

main().catch((error) => {
  console.error(`[runner] ${error?.stack ?? error}`);
  process.exitCode = 1;
});
