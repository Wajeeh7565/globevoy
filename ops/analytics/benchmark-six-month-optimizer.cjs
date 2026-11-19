'use strict';
// No SDK/client, provider requests, or AWS access. Synthetic coverage stress test.
const {performance}=require('node:perf_hooks');
const {fixture}=require('../../tests/backend/fare-map-fixtures.cjs');
const optimizer=require('../../backend/services/domain/fare-map/fare-map-optimizer');
const f=fixture(48),original=[...f.map.values()].flat();f.map.clear();
for(let month=2;month<=7;month++)for(const duration of [8,14])for(const base of original){
 const d=base.departureDate.endsWith('-01')?3:base.departureDate.endsWith('-05')?7:3+duration;
 const r={...base,month:`2027-${String(month).padStart(2,'0')}`,departureDate:`2027-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`};
 const key=r.origin+'#'+r.month;f.map.set(key,[...(f.map.get(key)||[]),r]);
}
global.fetch=()=>{throw Error('Network forbidden by benchmark');};
(async()=>{
 const times=[],heapBefore=process.memoryUsage().heapUsed;let result;
 for(let i=0;i<7;i++){const start=performance.now();result=await optimizer.search({origin:'LHR',budget:5000,travelers:2},{...f.options,rows:f.rows});times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);
 console.log(JSON.stringify({environment:'synthetic in-memory fixtures; warm process; not DynamoDB or Lambda latency',cities:f.dest.length,departureMonths:6,durationsWithEvidence:[8,14],rounds:7,
 medianMs:+times[3].toFixed(2),maxMs:+times.at(-1).toFixed(2),heapDeltaBytes:process.memoryUsage().heapUsed-heapBefore,
 tours:result.tours.length,observedReturnedDurations:[...new Set(result.tours.map(t=>t.tripDurationNights))],diagnostics:result.diagnostics},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
