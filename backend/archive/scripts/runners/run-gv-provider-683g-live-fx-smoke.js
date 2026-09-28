'use strict';
const fs = require('fs');
const path = require('path');
const fx = require('./services/shared/fx-normalization-683g');

process.env.ENABLE_BOC_FX_683G='true';
process.env.ENABLE_FX_NORMALIZATION_683G='true';
process.env.GV_BOC_FX_CACHE_TTL_SECONDS=process.env.GV_BOC_FX_CACHE_TTL_SECONDS || '21600';
process.env.GV_BOC_FX_MAX_AGE_HOURS=process.env.GV_BOC_FX_MAX_AGE_HOURS || '120';

const cases = [
  { name:'YYZ-LIS Duffel evidence', amount:312.80, providerCurrency:'USD', displayCurrency:'CAD' },
  { name:'DUB-SSH Duffel evidence', amount:248.89, providerCurrency:'USD', displayCurrency:'EUR' },
  { name:'GBP display check', amount:312.80, providerCurrency:'USD', displayCurrency:'GBP' },
  { name:'AUD display check', amount:312.80, providerCurrency:'USD', displayCurrency:'AUD' },
  { name:'LAX-LAS identity', amount:55.98, providerCurrency:'USD', displayCurrency:'USD' }
];

(async()=>{
  console.log('=== GV-PROVIDER-683G-R1 Bank of Canada live FX normalization smoke ===');
  console.log('LOCAL ONLY. No AWS deployment. No ranking change. No order. No payment. No booking.');
  console.log('Bank of Canada daily exchange rates are treated as indicative display normalization, not transactional/bookable FX.');
  const rows=[];
  for(const c of cases){
    process.stdout.write(`${c.name}: ${c.providerCurrency} ${c.amount.toFixed(2)} -> ${c.displayCurrency} ... `);
    const r=await fx.normalizeAmount683G(c);
    if(!r.supported){ console.log(`UNAVAILABLE ${r.reason}`); rows.push({...c,supported:false,reason:r.reason}); continue; }
    console.log(`${r.displayCurrency} ${r.displayAmount.toFixed(2)}; rate=${r.crossRate}; rateDate=${r.rateDate||'IDENTITY'}; source=${r.provider}`);
    rows.push({...c,supported:true,result:r});
  }
  const converted=rows.filter(r=>r.supported && r.providerCurrency!==r.displayCurrency);
  const identity=rows.find(r=>r.providerCurrency===r.displayCurrency);
  const decision=converted.length===4 && identity?.supported ? 'BOC_FX_NORMALIZATION_TECHNICALLY_PROMISING' : 'BOC_FX_NORMALIZATION_REVIEW_REQUIRED';
  console.log(`Decision: ${decision}`);
  console.log(`Converted live checks: ${converted.length}/4; identity: ${identity?.supported?'PASS':'FAIL'}`);
  const outDir=process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname,'GV-PROVIDER-683G-LIVE-OUTPUT');
  fs.mkdirSync(outDir,{recursive:true});
  const output={version:'GV-PROVIDER-683G-R1',capturedAt:new Date().toISOString(),decision,commercialApproved:false,rankingEnabled:false,productionApproved:false,cases:rows};
  fs.writeFileSync(path.join(outDir,'GV-PROVIDER-683G-LIVE-FX.json'),JSON.stringify(output,null,2));
  const md=['# GV-PROVIDER-683G-R1 — Live FX Smoke','',`Captured: ${output.capturedAt}`,'',`Decision: **${decision}**`,'','Bank of Canada daily rates are indicative display-normalization evidence. Original Duffel/provider amounts and currencies remain canonical.','','| Case | Provider | Display | Rate date | Status |','|---|---:|---:|---|---|'];
  for(const row of rows){ const r=row.result; md.push(`| ${row.name} | ${row.providerCurrency} ${row.amount.toFixed(2)} | ${r?`${r.displayCurrency} ${r.displayAmount.toFixed(2)}`:'—'} | ${r?.rateDate||'—'} | ${row.supported?'PASS':row.reason} |`); }
  fs.writeFileSync(path.join(outDir,'GV-PROVIDER-683G-LIVE-FX.md'),md.join('\n')+'\n');
  console.log(`Outputs: ${outDir}`);
  if(decision!=='BOC_FX_NORMALIZATION_TECHNICALLY_PROMISING') process.exitCode=2;
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
