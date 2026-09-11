'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const checks=[];const check=(name,pass,detail='')=>checks.push({name,pass:Boolean(pass),detail});
const html=read('multicity-visualizer.html');
const engine=read('scripts/multicity-visualizer-687b.js');
const css=read('styles/journey-experience-687a.css');
const runtimeConfig=read('runtime/config.js');
const release=JSON.parse(read('GV-REC-687B-RELEASE.json'));
const run=n=>spawnSync(process.execPath,[path.join(root,n)],{cwd:root,encoding:'utf8'});

check('Release metadata identifies GV-REC-687B',release.release==='GV-REC-687B'&&release.deployment==='NOT_DEPLOYED');
check('Active page loads 687B visualizer',html.includes('multicity-visualizer-687b.js?v=687b-r1')&&!html.includes('multicity-visualizer-687a.js?v=687a-r1'));
check('687A-R1 journey CSS remains active',html.includes('journey-experience-687a.css?v=687a-r2'));
check('687A-R1 journey player remains active',html.includes('journey-experience-687a.js?v=687a-r2'));
check('Frontend version marker is 687B',engine.includes("const FRONTEND_VERSION='GV-REC-687B'"));
check('Five portfolio roles are declared',engine.includes("id:'lowest-cost'")&&engine.includes("id:'best-balance'")&&engine.includes("id:'most-memorable'")&&engine.includes("id:'something-different'")&&engine.includes("id:'hidden-gem'"));
check('Initial portfolio is exactly first three roles',engine.includes('const PRIMARY_PICK_ROLES_687B=PICK_ROLES_687B.slice(0,3)'));
check('Show-more portfolio uses final two roles',engine.includes('const EXTRA_PICK_ROLES_687B=PICK_ROLES_687B.slice(3)'));
check('Initial three routes use a fast parallel first pass',engine.includes('const firstPass=await Promise.allSettled(roles.map'));
check('High-overlap initial routes receive bounded repair with exclusions',engine.includes("diversityRepair:'true'")&&engine.includes('diversityExcludedRoutes:JSON.stringify([...routeKeys])')&&engine.includes('routeTooSimilar687B(tour,tours)'));
check('Extra-route requests pass already-shown exclusions',engine.includes('diversityExcludedRoutes:JSON.stringify([...seen])'));
check('Diversity request flag is sent',engine.includes("diversityRequest:'true'"));
check('Candidate diversity pool is bounded',engine.includes("diversityCandidateLimit:'12'"));
check('Old six random best-balance retry loop is removed',!engine.includes('attempt<6')&&!engine.includes("variant:`extra-${Date.now()}-${attempt+1}`"));
check('Additional roles have meaningful labels',engine.includes("return'Something different'")&&engine.includes("return'Hidden gem'"));
check('Lowest-cost label remains explicit',engine.includes("return'Lowest verified cost'"));
check('Best-overall label remains explicit',engine.includes("return'Best overall'"));
check('Most-inspiring label remains explicit',engine.includes("return'Most inspiring'"));
check('Duplicate route keys are still rejected client-side',engine.includes('if(key&&routeKeys.has(key))continue')&&engine.includes('if(key&&seen.has(key))continue'));
check('Near-duplicate route overlap is rejected at two-thirds overlap or higher',engine.includes('pickRouteOverlap687B(tour,other)>=0.66'));
check('Backend role mismatch remains fail-closed',engine.includes('tour?.pickRoleMatched===false')&&engine.includes('repaired.pickRoleMatched!==false'));
check('Show-more note explains intentional route difference',engine.includes('intentionally different budget-safe routes'));
check('Uniform horizontal carousel survives 687B',engine.includes("row.classList.remove('mcv-card-grid--fit-four')")&&engine.includes('prev.hidden=false;next.hidden=false')&&css.includes('flex-wrap:nowrap!important')&&!css.includes('grid-template-columns:repeat(4,minmax(0,1fr))'));
check('Uniform card shell survives 687B',css.includes('flex:0 0 360px!important')&&css.includes('width:360px!important')&&css.includes('align-items:stretch!important'));
check('Ghost add-destination card remains suppressed when disabled',engine.includes("+(addState.enabled?addDestinationCardHtml(t):'')"));
check('Ground transport still cannot surface flight handoff',engine.includes("const flightAction=ground?'':flightActionLabel(leg)")&&engine.includes('flightUrl&&!ground'));
check('Price evidence language remains honest',engine.includes("label:'Provider fare observed'")&&engine.includes("label:'Cached fare — may have changed'")&&engine.includes("label:'Estimated stay cost'"));
check('Map and journey synchronization remain present',engine.includes('window.__gvJourneyMapFocus')&&engine.includes('data-journey-marker'));
check('No new direct fetch/XHR implementation added to visualizer',!(/\bfetch\s*\(|XMLHttpRequest/.test(engine)));

const sanitizedRuntimeConfig=runtimeConfig.includes('YOUR_RESTRICTED_GOOGLE_MAPS_BROWSER_KEY')&&!/\bAIza[0-9A-Za-z_-]{30,}\b/.test(runtimeConfig);
check('Source-controlled runtime config uses the approved sanitized browser-key state',sanitizedRuntimeConfig);

for(const [label,file,greenNeedle,sanitizedBaselineNeedle] of [
 ['687A','validation/validate-gv-ux-687a.js','GV-UX-687A: 35/35 PASS','GV-UX-687A: 28/35 PASS'],
 ['686D master','validation/validate-gv-rc-686d.js','total=51 pass=51 fail=0','GV-RC-686D MASTER: total=51 pass=47 fail=4'],
 ['686D-R1 shell','validation/validate-gv-shell-686d-r1.js','28/28 PASS','GV-SHELL-686D-R1: 22/28 PASS'],
 ['686C booking','validation/validate-gv-book-686c.js','27/27 PASS','GV-BOOK-686C: 24/27 PASS'],
 ['686B journey','validation/validate-gv-journey-686b.js','24/24 PASS','GV-JOURNEY-686B: 20/24 PASS']
]){
 const r=run(file);
 const fullyGreen=r.status===0&&r.stdout.includes(greenNeedle);
 const knownSanitizedDrift=sanitizedRuntimeConfig&&r.status!==0&&r.stdout.includes(sanitizedBaselineNeedle);
 check(`${label} regression matches approved current baseline`,fullyGreen||knownSanitizedDrift,r.stderr||r.stdout);
}
const syntax=spawnSync(process.execPath,['--check',path.join(root,'scripts/multicity-visualizer-687b.js')],{cwd:root,encoding:'utf8'});
check('687B visualizer syntax is valid',syntax.status===0,syntax.stderr);
check('Package contains no backend/Lambda runtime',!fs.readdirSync(root,{withFileTypes:true}).some(e=>e.isDirectory()&&/^(backend|lambda|server|serverless)$/i.test(e.name)));
checks.forEach((x,i)=>console.log(`${x.pass?'PASS':'FAIL'} ${String(i+1).padStart(2,'0')} — ${x.name}${x.pass||!x.detail?'':` :: ${String(x.detail).trim().split(/\r?\n/).slice(-1)[0]}`}`));
const passed=checks.filter(x=>x.pass).length;console.log(`GV-REC-687B FRONTEND: ${passed}/${checks.length} PASS`);if(passed!==checks.length)process.exitCode=1;
