'use strict';
const fs=require('fs'); const path=require('path');
const diversity=require('../src/services/route-diversity-687b');
let pass=0, fail=0; function check(name, ok, detail=''){ if(ok){pass++; console.log('[PASS]',name);} else {fail++; console.error('[FAIL]',name,detail||'');}}
const PREVIEW='https://686d-preview.dttux5e6ddtzb.amplifyapp.com'; const PROD='https://globevoy.com';
check('P3 version marker', diversity.VERSION==='GV-REC-687B-P3', diversity.VERSION);
check('Production origin constant exact', diversity.PRODUCTION_ORIGIN_687B===PROD, diversity.PRODUCTION_ORIGIN_687B);
check('Production origin enables 687B without env flag', diversity.enabled({__gvRequestOrigin687B:PROD})===true);
check('Preview origin no longer enables 687B', diversity.enabled({__gvRequestOrigin687B:PREVIEW})===false);
check('Unknown origin does not enable 687B', diversity.enabled({__gvRequestOrigin687B:'https://evil.example'})===false);
check('No Origin does not enable 687B', diversity.enabled({})===false);
const lambda=fs.readFileSync(path.join(__dirname,'../src/lambda.js'),'utf8');
check('Lambda injects request Origin into private 687B marker', lambda.includes("next.__gvRequestOrigin687B = headerValue683K(headers, 'origin')"));
check('Lambda deletes public spoof before trusted injection', lambda.includes('delete next.__gvRequestOrigin687B'));
check('Generated-tour endpoint passes trusted 687B query', lambda.includes('getGeneratedTour(generatedTourQuery687BP1(canary683K.query, event.headers || {}))'));
const svc=fs.readFileSync(path.join(__dirname,'../src/services/route-diversity-687b.js'),'utf8');
check('No 687B enable env var required', !svc.includes('ENABLE_AI_ASSISTED_ROUTE_DIVERSITY_687B') && !svc.includes('GV_AI_ROUTE_DIVERSITY_687B'));
check('Production origin is sole P3 activation gate', svc.includes('return clean(query.__gvRequestOrigin687B) === PRODUCTION_ORIGIN_687B'));
console.log(`\nGV-REC-687B-P3: ${pass}/${pass+fail} PASS`); if(fail) process.exit(1);
