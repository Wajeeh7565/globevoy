'use strict';
// GV-FAREMAP-001 — nightly fare map, ingest side.
//
// For one origin (Travelpayouts city/metro code) and one month, ask the
// Travelpayouts Data API (cached Aviasales searches, free) for the cheapest
// one-way fare to EVERY destination it knows, and normalise the rows into
// fare-map records. No booking, no live quote: these are planning prices that
// the search later narrows down and then live-checks with Ignav.

const VERSION = 'GV-FAREMAP-001';
const DEFAULT_ENDPOINT = 'https://api.travelpayouts.com/graphql/v1/query';
const PAGE_SIZE = 30;           // Travelpayouts GraphQL max per page
const MAX_PAGES = 34;             // up to 1,000 destinations per origin+month

function code(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : '';
}
function month(value) {
  const s = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : '';
}
function isoDate(value) {
  const s = String(value || '').slice(0, 10);
  const d = new Date(s + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s ? s : '';
}

// GV-DATA-COMFORT-001: FARE_MAP_COLLECT_COMFORT=on also asks for number_of_changes and
// duration (checked against the live schema on 2026-11-27); same request, same cost.
function comfortEnabled(env = process.env) { return String(env.FARE_MAP_COLLECT_COMFORT || '').trim().toLowerCase() === 'on'; }
function buildQuery(origin, departMonth, offset, comfort = false) {
  // origin/month are validated to [A-Z]{3} / YYYY-MM before interpolation.
  return `{
  prices_one_way(
    params: { origin: "${origin}", depart_months: "${departMonth}-01", no_lowcost: false }
    grouping: DIRECTIONS
    paging: { limit: ${PAGE_SIZE} offset: ${Number(offset) || 0} }
    sorting: VALUE_ASC
  ) {
    destination_city_iata
    departure_at
    value${comfort ? '\n    number_of_changes\n    duration' : ''}
  }
}`;
}

// Travelpayouts returns `value` in the account's price currency (RUB by
// default), converted with the same rule as the existing production code.
// Only fields that query already uses are requested (an unknown field would
// fail the whole request); stops/duration stay null for now.
const { convertFlightValueToUsd } = require('../../providers/flights/travelpayouts/travelpayouts');
function toRecord(origin, departMonth, row, observedAt, toUsd = convertFlightValueToUsd) {
  const destination = code(row?.destination_city_iata);
  const priceUsd = Number(toUsd(row?.value));
  if (!['USD','CAD','RUB'].includes(String(process.env.TRAVELPAYOUTS_PRICE_CURRENCY || 'RUB').toUpperCase()) && toUsd === convertFlightValueToUsd) return null;
  if (!destination || destination === origin || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const date = isoDate(row?.departure_at);
  return {
    origin,
    month: departMonth,
    destination,
    priceUsd: Math.round(priceUsd * 100) / 100,
    departureDate: date && date.startsWith(departMonth) ? date : null,
    stops: Number.isFinite(Number(row?.number_of_changes)) ? Number(row.number_of_changes) : null,
    durationMinutes: Number.isFinite(Number(row?.duration)) ? Number(row.duration) : null,
    source: 'travelpayouts-cached',
    observedAt
  };
}

// One shared request pacer is passed by the job, including pages and retries.
function createPacer({ clock = Date.now, sleep = ms => new Promise(r => setTimeout(r,ms)), intervalMs = 1100 } = {}) {
  let next = 0;
  return async deadline => {
    const delay = Math.max(0,next-clock());
    if (clock()+delay+1000 >= deadline) throw Object.assign(new Error('deadline'),{code:'time-budget'});
    if(delay) await sleep(delay);
    next=clock()+intervalMs;
  };
}
async function ingestOriginMonth(options = {}) {
  const { origin, month: departMonth, token, fetch: fetchFn = globalThis.fetch, endpoint, now, toUsd } = options;
  const o=code(origin),m=month(departMonth);
  if(!o||!m)return {ok:false,reason:'invalid-origin-or-month',records:[],requests:0,retries:0};
  if(!token)return {ok:false,reason:'travelpayouts-token-missing',records:[],requests:0,retries:0};
  if(!toUsd&&(!['USD','CAD','RUB'].includes(String(process.env.TRAVELPAYOUTS_PRICE_CURRENCY||'RUB').toUpperCase())||!Number.isFinite(convertFlightValueToUsd(1))||convertFlightValueToUsd(1)<=0))return {ok:false,reason:'invalid-fx-configuration',records:[],requests:0,retries:0};
  const clock=options.clock||Date.now,sleep=options.sleep|| (ms=>new Promise(r=>setTimeout(r,ms)));
  const pace=options.pace||createPacer({clock,sleep});
  const deadline=options.deadline||clock()+43000,seen=new Map();
  let requests=0,retries=0,offset=Number(options.offset)||0;
  const finish=(ok,reason,extra={})=>({ok,reason,records:[...seen.values()],requests,retries,nextOffset:offset,...extra});
  const startingPage = Math.floor(offset / PAGE_SIZE);
  for(let page=startingPage;page<Math.min(MAX_PAGES,startingPage+(options.maxPages||MAX_PAGES));page++) {
    let payload;
    for(let attempt=0;attempt<3;attempt++) {
      let reason,status=0,transient=false;
      try {
        await pace(deadline);
        const remaining=Math.min(7000,deadline-clock()-500);
        if(remaining<1000)return finish(false,'time-budget');
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),remaining);
        try {
          requests++;
          const response=await fetchFn(endpoint||DEFAULT_ENDPOINT,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Access-Token':token},body:JSON.stringify({query:buildQuery(o,m,offset,options.comfort??comfortEnabled(options.env||process.env))}),signal:controller.signal});
          status=response.status;
          // 429 bodies are often HTML, so classify before parsing JSON. No immediate retry.
          if(status===429) return finish(false,'rate-limited',{retryAfterSeconds:Math.min(3600,Math.max(60,Number(response.headers?.get?.('retry-after'))||60))});
          const text=await response.text();
          if(!response.ok){reason=status>=500?'provider-server-error':status===401||status===403?'provider-auth-error':'provider-http-error';transient=status>=500;}
          else {
            try{payload=JSON.parse(text)}catch{reason='provider-invalid-json';}
            if(payload?.errors?.length){reason='provider-graphql-error';payload=null;}
            else if(!reason&&!Array.isArray(payload?.data?.prices_one_way)){reason='provider-invalid-schema';payload=null;}
          }
        } finally{clearTimeout(timer)}
      }catch(e){reason=e.code==='time-budget'?'time-budget':e.name==='AbortError'?'provider-timeout':'provider-network-error';transient=reason==='provider-timeout'||reason==='provider-network-error';}
      if(!reason)break;
      if(!transient||attempt===2)return finish(false,reason,{httpStatus:status});
      const backoff=500*2**attempt;
      if(clock()+backoff+1000>=deadline)return finish(false,'time-budget');
      retries++;await sleep(backoff);
    }
    for(const row of payload.data.prices_one_way){
      const rec=toRecord(o,m,row,new Date(now??clock()).toISOString(),toUsd);
      if(rec&&(!seen.has(rec.destination)||seen.get(rec.destination).priceUsd>rec.priceUsd))seen.set(rec.destination,rec);
    }
    if(payload.data.prices_one_way.length<PAGE_SIZE)return finish(true,null,{nextOffset:0});
    offset+=PAGE_SIZE;
  }
  return finish(false,'pagination-budget');
}

// The next N months starting from `now` (current month included), YYYY-MM.
function upcomingMonths(count = 6, now = Date.now()) {
  const d = new Date(now);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    out.push(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// Distinct Travelpayouts origin codes for every origin-eligible city.
function originCodesFromRegistry(registry) {
  const rows = Array.isArray(registry) ? registry : (registry?.records || registry?.cities || []);
  const codes = new Set();
  for (const city of rows) {
    if (city?.origin?.eligible === false) continue;
    const c = code(city?.origin?.providerLocationCode || city?.origin?.preferredAirportCode);
    if (c) codes.add(c);
  }
  return [...codes].sort();
}

module.exports = { VERSION, ingestOriginMonth, upcomingMonths, originCodesFromRegistry, createPacer, _internal: { buildQuery, toRecord, code, month } };
