'use strict';
// GV-FAREMAP-001 — rolling fare-map refresh job.
//
// Runs on a schedule (EventBridge, every 5 minutes, input {"globevoyJob":"fare-map"}). Each run works
// through the next slice of (origin × month) tasks inside a time budget,
// saves where it got to, and the next run carries on. One full cycle covers
// every origin-eligible city × the next 6 months; then it starts again.
// Off unless ENABLE_FARE_MAP_JOB=true and FARE_MAP_TABLE + TRAVELPAYOUTS_TOKEN are set.

const ingest = require('./fare-map-ingest');
const store = require('./fare-map-store');

const FLAG = 'ENABLE_FARE_MAP_JOB';
const {collectionMonthCount}=require('./search-window');
const DEFAULT_TIME_BUDGET_MS = 45 * 1000;        // inside the shared Lambda's 60 s timeout
const DEFAULT_PAUSE_MS = 250;                    // polite pacing between Travelpayouts requests

function enabled(env = process.env) {
  return String(env[FLAG] || '').trim().toLowerCase() === 'true' && Boolean(store.tableName(env)) && Boolean(String(env.TRAVELPAYOUTS_TOKEN || '').trim());
}

function buildTasks(origins, months) {
  const tasks = [];
  for (const m of months) for (const o of origins) tasks.push({ origin: o, month: m });
  return tasks;
}

async function runFareMapJob(options={}) {
  const env=options.env||process.env;
  if(!enabled(env))return {ok:true,ran:false,reason:'disabled'};
  const {randomUUID}=require('node:crypto'),owner=randomUUID(),clock=options.clock||Date.now;
  const started=clock(),deadline=started+Math.min(45000,Math.max(1000,Number(options.timeBudgetMs||env.FARE_MAP_TIME_BUDGET_MS)||DEFAULT_TIME_BUDGET_MS));
  const origins=options.origins||ingest.originCodesFromRegistry(options.registry||require('../../../data/unified-city-registry-1000.json'));
  const tasks=buildTasks(origins,ingest.upcomingMonths(collectionMonthCount(options.now??clock()),options.now??clock()));
  const opts={env,dynamo:options.dynamo,nowMs:clock()};
  let cursor;
  try{cursor=await store.readCursor(opts)}catch{return {ok:false,ran:false,reason:'dynamodb-cursor-read-error'}}
  if(cursor.retryAt>clock())return {ok:true,ran:false,reason:'provider-cooldown',retryAt:cursor.retryAt};
  if(cursor.leaseUntil>clock())return {ok:true,ran:false,reason:'overlapping-run'};
  // Resume by stable task identity, not by an index whose meaning changes at UTC month rollover.
  let index=cursor.taskKey?tasks.findIndex(t=>`${t.origin}#${t.month}`===cursor.taskKey):cursor.index;
  if(index<0||index>=tasks.length)index=0;
  const lease={...cursor,index,owner,leaseUntil:clock()+120000};
  try{await store.writeCursor(lease,{...opts,acquire:true})}catch(e){return {ok:false,ran:false,reason:e.name==='ConditionalCheckFailedException'?'overlapping-run':'dynamodb-lease-error'}}
  let retryAt=0;
  let offset=cursor.taskKey===`${tasks[index]?.origin}#${tasks[index]?.month}`?cursor.offset:0;
  const summary={ok:true,ran:true,tasksTotal:tasks.length,startIndex:index,done:0,written:0,requests:0,retries:0,dynamoRetries:0,failures:0,empty:0,partial:0,rateLimited:false,failureCategories:{},coveredDestinations:0};
  const pace=options.pace||ingest.createPacer({clock,sleep:options.sleep,intervalMs:Math.max(1100,options.pauseMs||DEFAULT_PAUSE_MS)});
  const log=options.log|| (event=>console.log(JSON.stringify(event)));
  const destinations=new Set();
  try {
    while(index<tasks.length&&summary.done<(options.maxTasks||Infinity)&&clock()+1500<deadline){
      const task=tasks[index];
      const result=await ingest.ingestOriginMonth({...task,token:env.TRAVELPAYOUTS_TOKEN,fetch:options.fetch,now:options.now,clock,sleep:options.sleep,pace,deadline:deadline-5000,maxPages:3,offset});
      summary.requests+=result.requests;summary.retries+=result.retries||0;
      let reason=result.reason;
      try{if(result.records.length){summary.written+=await store.writeRecords(result.records,{...opts,nowMs:clock(),sleepFn:options.sleep,stats:summary});result.records.forEach(r=>destinations.add(r.destination))}}
      catch(e){summary.written+=e.written||0;reason=e.code||'dynamodb-error';}
      if(reason==='provider-http-error'){
        // A 4xx other than 401/403/429 is permanent for this origin/month (e.g. a
        // city code Travelpayouts does not accept). Retrying it every run would
        // block the whole cycle, so record it and move on to the next task.
        summary.failures++;summary.skipped=(summary.skipped||0)+1;summary.lastReason=reason;
        summary.failureCategories[reason]=(summary.failureCategories[reason]||0)+1;
        summary.skippedTasks=[...(summary.skippedTasks||[]),`${task.origin}#${task.month}:${result.httpStatus||'4xx'}`].slice(-20);
        summary.done++;offset=0;index++;
        await store.writeCursor({...lease,index,taskKey:tasks[index]?`${tasks[index].origin}#${tasks[index].month}`:null,offset,lastRun:summary},{...opts,nowMs:clock(),owner});
        continue;
      }
      if(reason){
        // Keep task/offset on failure. Replaying successful writes is idempotent by existing fare keys.
        summary.failures+=reason==='time-budget'||reason==='pagination-budget'?0:1;
        summary.partial+=reason==='time-budget'||reason==='pagination-budget'?1:0;
        summary.lastReason=reason;summary.failureCategories[reason]=(summary.failureCategories[reason]||0)+1;
        summary.rateLimited=reason==='rate-limited';
        if(summary.rateLimited)retryAt=clock()+(result.retryAfterSeconds||60)*1000;
        if(!reason.startsWith('dynamodb'))offset=result.nextOffset||0;
        if(reason==='pagination-budget'&&summary.requests<30&&clock()+8000<deadline){
          await store.writeCursor({...lease,index,taskKey:`${task.origin}#${task.month}`,offset,lastRun:summary},{...opts,nowMs:clock(),owner});
          continue;
        }
        break;
      }
      summary.done++;if(!result.records.length)summary.empty++;offset=0;index++;
      // Persist each completed task while retaining the lease, before processing the next task.
      await store.writeCursor({...lease,index,taskKey:tasks[index]?`${tasks[index].origin}#${tasks[index].month}`:null,offset,lastRun:summary},{...opts,nowMs:clock(),owner});
    }
  }catch{summary.ok=false;summary.lastReason='dynamodb-checkpoint-error';summary.failures++;}
  summary.coveredDestinations=destinations.size;
  summary.ok=summary.ok&&summary.failures-(summary.skipped||0)===0;
  summary.successRate=summary.done+summary.failures?summary.done/(summary.done+summary.failures):null;
  const finishedCycle=index>=tasks.length;
  try{await store.writeCursor({...lease,index:finishedCycle?0:index,taskKey:finishedCycle?null:`${tasks[index]?.origin}#${tasks[index]?.month}`,offset,retryAt,owner:null,leaseUntil:0,lastRun:summary},{...opts,nowMs:clock(),owner})}
  catch{summary.ok=false;summary.lastReason='dynamodb-cursor-write-error';}
  log({component:'fare-map',...summary,endIndex:index,finishedCycle,ms:clock()-started});
  return {...summary,endIndex:index,finishedCycle,ms:clock()-started};
}

// Scheduled events reach the normal Lambda handler; this recognises them.
// Either a custom input {"globevoyJob":"fare-map"} (EventBridge Scheduler), or a
// standard EventBridge "Scheduled Event" from a rule named globevoy-fare-map….
function isFareMapEvent(event) {
  if (!event) return false;
  if (event.globevoyJob === 'fare-map' || event?.detail?.globevoyJob === 'fare-map') return true;
  return event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event'
    && Array.isArray(event.resources) && event.resources.some(r => /:rule\/globevoy-fare-map[A-Za-z0-9_.-]*$/.test(String(r)));
}

module.exports = { FLAG, enabled, runFareMapJob, isFareMapEvent, _internal: { buildTasks } };
