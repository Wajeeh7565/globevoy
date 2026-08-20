'use strict';
const assert = require('assert');
const path = require('path');
const service = require('./services/fx-normalization-683g');
const lambda = require('./lambda');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const fixtureDate = '2026-08-13';
const rates = { FXUSDCAD: 1.40, FXEURCAD: 1.60, FXGBPCAD: 1.88, FXAUDCAD: 0.98 };
let fetchCount = 0;
async function fixtureFetch(url) {
  fetchCount += 1;
  const series = Object.keys(rates).find(k => String(url).includes(`/${k}/`));
  return {
    ok: Boolean(series), status: series ? 200 : 404,
    async text() { return JSON.stringify(series ? { observations: [{ d: fixtureDate, [series]: { v: String(rates[series]) } }] } : {}); }
  };
}
const nowMs = Date.parse('2026-08-14T02:00:00Z');
const env = { ENABLE_BOC_FX_683G:'true', ENABLE_FX_NORMALIZATION_683G:'true', GV_BOC_FX_MAX_AGE_HOURS:'120', GV_BOC_FX_CACHE_TTL_SECONDS:'21600' };

(async()=>{
  service.clearCache683G();
  check('683G version locked', ()=>assert.equal(service.FX_VERSION_683G,'GV-PROVIDER-683G-R1'));
  check('683G supported currencies locked', ()=>assert.deepEqual(service.SUPPORTED_CURRENCIES_683G,['USD','CAD','AUD','EUR','GBP']));
  check('683G maps USD series', ()=>assert.equal(service.SERIES_TO_CAD_683G.USD,'FXUSDCAD'));
  check('683G maps EUR series', ()=>assert.equal(service.SERIES_TO_CAD_683G.EUR,'FXEURCAD'));
  check('683G maps GBP series', ()=>assert.equal(service.SERIES_TO_CAD_683G.GBP,'FXGBPCAD'));
  check('683G maps AUD series', ()=>assert.equal(service.SERIES_TO_CAD_683G.AUD,'FXAUDCAD'));
  check('683G rejects unsupported currency', ()=>assert.equal(service.safeCurrency('JPY'),null));
  check('683G money rounding deterministic', ()=>assert.equal(service.roundMoney(123.456),123.46));
  check('683G rate age deterministic', ()=>assert(service.rateAgeHours(fixtureDate,nowMs)>0));
  check('683G date skew deterministic', ()=>assert.equal(service.dateSkewDays('2026-08-13','2026-08-14'),1));
  check('683G uses only official Bank of Canada Valet host', ()=>assert(service.valetUrl683G('FXUSDCAD').startsWith('https://www.bankofcanada.ca/valet/observations/')));
  const parsed=service.parseLatestSeriesObservation683G({observations:[{d:fixtureDate,FXUSDCAD:{v:'1.40'}}]},'FXUSDCAD',nowMs,120);
  check('683G parses latest rate', ()=>assert(parsed.supported && parsed.rateToCad===1.4));
  const newestFirst=service.parseLatestSeriesObservation683G({observations:[
    {d:'2026-08-13',FXUSDCAD:{v:'1.3938'}},
    {d:'2026-08-12',FXUSDCAD:{v:'1.3930'}},
    {d:'2026-07-30',FXUSDCAD:{v:'1.4014'}}
  ]},'FXUSDCAD',nowMs,120);
  check('683G-R1 selects newest observation from Valet newest-first payload', ()=>assert(newestFirst.supported && newestFirst.rateDate==='2026-08-13' && newestFirst.rateToCad===1.3938));
  const outOfOrder=service.parseLatestSeriesObservation683G({observations:[
    {d:'2026-08-11',FXUSDCAD:{v:'1.3927'}},
    {d:'2026-08-13',FXUSDCAD:{v:'1.3938'}},
    {d:'2026-08-12',FXUSDCAD:{v:'1.3930'}}
  ]},'FXUSDCAD',nowMs,120);
  check('683G-R1 newest selection is order-independent', ()=>assert(outOfOrder.supported && outOfOrder.rateDate==='2026-08-13'));
  const stale=service.parseLatestSeriesObservation683G({observations:[{d:'2026-07-01',FXUSDCAD:{v:'1.40'}}]},'FXUSDCAD',nowMs,120);
  check('683G stale rate fails closed', ()=>assert(!stale.supported && stale.reason==='fx-rate-stale'));
  const cad=await service.normalizeAmount683G({amount:100,providerCurrency:'USD',displayCurrency:'CAD'},{fetch:fixtureFetch,env,nowMs});
  check('683G USD to CAD conversion', ()=>assert(cad.supported && cad.displayAmount===140));
  const eur=await service.normalizeAmount683G({amount:100,providerCurrency:'USD',displayCurrency:'EUR'},{fetch:fixtureFetch,env,nowMs});
  check('683G USD to EUR cross conversion', ()=>assert(eur.supported && eur.displayAmount===87.5));
  const gbp=await service.normalizeAmount683G({amount:100,providerCurrency:'USD',displayCurrency:'GBP'},{fetch:fixtureFetch,env,nowMs});
  check('683G USD to GBP cross conversion', ()=>assert(gbp.supported && gbp.displayAmount===74.47));
  const aud=await service.normalizeAmount683G({amount:100,providerCurrency:'USD',displayCurrency:'AUD'},{fetch:fixtureFetch,env,nowMs});
  check('683G USD to AUD cross conversion', ()=>assert(aud.supported && aud.displayAmount===142.86));
  const identity=await service.normalizeAmount683G({amount:55.98,providerCurrency:'USD',displayCurrency:'USD'},{fetch:fixtureFetch,env,nowMs});
  check('683G same currency is identity', ()=>assert(identity.supported && identity.displayAmount===55.98 && identity.conversionApplied===false));
  check('683G identity makes no provider call', ()=>assert(identity.fxEvidence.source==='IDENTITY'));
  check('683G preserves provider amount', ()=>assert(eur.providerAmount===100 && eur.providerCurrency==='USD'));
  check('683G keeps conversion display-only', ()=>assert(eur.displayOnly===true && eur.rankingEligible===false && eur.productionApproved===false));
  check('683G marks Bank of Canada rates indicative', ()=>assert(eur.indicative===true && eur.fxEvidence.indicative===true));
  check('683G records rate date', ()=>assert(eur.rateDate===fixtureDate));
  check('683G records cross-rate provenance', ()=>assert(eur.fxEvidence.providerRateSeries==='FXUSDCAD' && eur.fxEvidence.displayRateSeries==='FXEURCAD'));
  const obs={provider:'duffel-live-683d',totalPrice:312.8,price:312.8,currency:'USD',origin:'YYZ',destination:'LIS',priceEvidence:{amount:312.8,currency:'USD'}};
  const norm=await service.normalizeObservation683G(obs,'CAD',{fetch:fixtureFetch,env,nowMs});
  check('683G observation normalization supported', ()=>assert(norm.supported));
  check('683G does not overwrite totalPrice', ()=>assert(norm.normalizedObservation.totalPrice===312.8));
  check('683G does not overwrite provider currency', ()=>assert(norm.normalizedObservation.currency==='USD'));
  check('683G adds separate display price', ()=>assert(norm.normalizedObservation.displayPrice===437.92 && norm.normalizedObservation.displayCurrency==='CAD'));
  check('683G preserves original price evidence', ()=>assert(norm.normalizedObservation.priceEvidence.currency==='USD' && norm.normalizedObservation.priceEvidence.amount===312.8));
  const invalidAmount=await service.normalizeAmount683G({amount:0,providerCurrency:'USD',displayCurrency:'CAD'},{fetch:fixtureFetch,env,nowMs});
  check('683G invalid amount fails closed', ()=>assert(!invalidAmount.supported && invalidAmount.reason==='invalid-provider-amount'));
  const invalidTarget=await service.normalizeAmount683G({amount:100,providerCurrency:'USD',displayCurrency:'JPY'},{fetch:fixtureFetch,env,nowMs});
  check('683G unsupported display currency fails closed', ()=>assert(!invalidTarget.supported));
  const disabled=await service.normalizeAmount683G({amount:100,providerCurrency:'USD',displayCurrency:'CAD'},{fetch:fixtureFetch,env:{},nowMs});
  check('683G disabled flags fail closed', ()=>assert(!disabled.supported && disabled.reason==='fx-683g-disabled'));
  const st=service.status683G(env);
  check('683G status says ranking off', ()=>assert(st.rankingEnabled===false && st.productionApproved===false));
  check('683G requires no secret', ()=>assert(st.secretRequired===false && st.secretValuesReturned===false));
  check('683G has no booking/payment capability', ()=>assert(st.orderCapability===false && st.paymentCapability===false && st.bookingCapability===false));
  // Cache: multiple normalization requests should not keep calling the same series.
  const before=fetchCount;
  await service.normalizeAmount683G({amount:200,providerCurrency:'USD',displayCurrency:'EUR'},{fetch:fixtureFetch,env,nowMs});
  const after=fetchCount;
  check('683G series cache avoids repeated network fetch', ()=>assert.equal(after,before));
  // Lambda endpoint auth and response using identity path (no network needed).
  process.env.GV_PROVIDER_COVERAGE_ADMIN_TOKEN='683g-test-admin';
  process.env.ENABLE_BOC_FX_683G='true';
  process.env.ENABLE_FX_NORMALIZATION_683G='true';
  const denied=await lambda.handler({rawPath:'/api/provider-fx-normalize/683g',requestContext:{http:{method:'POST'}},headers:{},body:JSON.stringify({amount:55.98,providerCurrency:'USD',displayCurrency:'USD'})});
  check('683G endpoint requires admin authorization', ()=>assert.equal(denied.statusCode,403));
  const allowed=await lambda.handler({rawPath:'/api/provider-fx-normalize/683g',requestContext:{http:{method:'POST'}},headers:{'x-gv-admin-token':'683g-test-admin'},body:JSON.stringify({amount:55.98,providerCurrency:'USD',displayCurrency:'USD'})});
  const allowedBody=JSON.parse(allowed.body);
  check('683G authorized endpoint returns shadow normalization', ()=>assert.equal(allowed.statusCode,200)&&allowedBody.ok===true&&allowedBody.shadow===true);
  check('683G endpoint remains ranking off', ()=>assert(allowedBody.fxStatus.rankingEnabled===false));
  const lambdaText=require('fs').readFileSync(path.join(__dirname,'lambda.js'),'utf8');
  const serverText=require('fs').readFileSync(path.join(__dirname,'server.js'),'utf8');
  check('683G endpoint exists in Lambda and local server', ()=>assert(lambdaText.includes('/api/provider-fx-normalize/683g')&&serverText.includes('/api/provider-fx-normalize/683g')));
  const svcText=require('fs').readFileSync(path.join(__dirname,'services','fx-normalization-683g.js'),'utf8');
  check('683G source contains no API credential', ()=>assert(!/api[_-]?key\s*[:=]\s*["'][^"']+/i.test(svcText)));
  check('683G source contains no order/payment endpoint', ()=>assert(!svcText.includes('/air/orders')&&!svcText.includes('/payments')));
  check('683G source never mutates provider totalPrice', ()=>assert(svcText.includes('totalPrice: observation.totalPrice')));
  check('683G source never mutates provider currency', ()=>assert(svcText.includes('currency: observation.currency')));
  check('683G uses daily rate cache', ()=>assert(svcText.includes('seriesCache683G')&&svcText.includes('GV_BOC_FX_CACHE_TTL_SECONDS')));
  check('683G has stale-rate guardrail', ()=>assert(svcText.includes('fx-rate-stale')&&svcText.includes('GV_BOC_FX_MAX_AGE_HOURS')));
  check('683G uses CAD pivot cross-rate', ()=>assert(svcText.includes('fromRate.rateToCad / toRate.rateToCad')));
  console.log(`PASS ${passed}/49 - GV-PROVIDER-683G-R1 backend`);
  if(process.exitCode) process.exit(1);
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
