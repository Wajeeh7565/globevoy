(function(root,factory){
  if(typeof module==='object'&&module.exports){
    module.exports=factory(
      require('./optimizer'),
      require('./city-intelligence-500'),
      require('../multicity-preview/demo-data'),
      require('./flexible-date-windows')
    );
  }else{
    root.GlobevoyAutomaticCityRecommender=factory(
      root.GlobevoyFlexibleDurationOptimizer,
      root.GLOBEVOY_CITY_INTELLIGENCE_500,
      root.GLOBEVOY_MEHDI_DEMO_DATA,
      root.GlobevoyFlexibleDateWindows
    );
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(optimizer,intelligenceArtifact,defaultData,discoveryWindows){
  'use strict';
  const MAX_RECOMMENDATIONS=3;
  const NATURE_NEUTRAL_SCORE=0.68;
  const NATURE_MEANINGFUL_THRESHOLD=0.34;
  const NATURE_DIFFERENTIABLE_SPREAD=0.08;
  const PREFERENCE_WEIGHT=0.20;
  const PREFERENCE_THEMES={
    'history-and-culture':['history-and-culture','culture'],
    food:['food'],beaches:['beach'],nightlife:['nightlife'],nature:['nature'],relaxation:['relaxation'],
    shopping:['shopping'],family:['family'],romantic:['romantic'],adventure:['adventure']
  };
  const CONFIDENCE_SCORE={high:1,medium:0.72,'medium-low':0.55,low:0.35};
  const SOURCE_SCORE={'live-exact':1,'recently-cached':0.88,cached:0.72,replay:0.62,estimated:0.45,unavailable:0};
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
  const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function validDate(v){if(!DATE_RE.test(String(v||'')))return false;const d=new Date(`${v}T00:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;}
  function dateDiff(a,b){return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000);}
  function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,Number(v)||0));}
  function round(v,n=2){const p=10**n;return Math.round((Number(v)+Number.EPSILON)*p)/p;}
  function monthLabel(ym){const m=/^(\d{4})-(\d{2})$/.exec(String(ym||''));return m?`${MONTH_NAMES[Number(m[2])-1]} ${m[1]}`:String(ym||'');}
  function activeIntelligenceRecords(flags){
    const records=(intelligenceArtifact&&intelligenceArtifact.records)||[];
    return flags&&flags.enable500CityDiscovery===true?records:records.slice(0,250);
  }
  function cityMap(flags){return new Map(activeIntelligenceRecords(flags).map(r=>[r.cityId,r]));}
  function availableMonths(dataOverride){
    const data=dataOverride||defaultData;const set=new Set();
    for(const w of discoveryWindows||[]) if(/^\d{4}-\d{2}$/.test(w.month||'')) set.add(w.month);
    for(const route of data.routes||[]) for(const w of route.windows||[]) if(/^\d{4}-\d{2}$/.test(w.preferredMonth||'')) set.add(w.preferredMonth);
    return [...set].sort();
  }
  function normalizePreferences(values){
    const arr=Array.isArray(values)?values:values?[values]:[];
    const out=[];for(const raw of arr){const v=String(raw||'').trim();if(PREFERENCE_THEMES[v]&&!out.includes(v))out.push(v);if(out.length===3)break;}return out;
  }
  function themeScore(city,preferences){
    if(!preferences.length)return NATURE_NEUTRAL_SCORE;
    let total=0;
    for(const pref of preferences){
      const keys=PREFERENCE_THEMES[pref];
      total+=Math.max(...keys.map(k=>{const raw=city&&city.themeScores?city.themeScores[k]:null;return Number(raw==null?1:raw);}))/5;
    }
    return clamp(total/preferences.length);
  }
  function evidenceText(city){
    return [
      ...((city&&city.rankingStyles)||[]),
      ...((city&&city.usefulPairingCharacteristics)||[]),
      ...((city&&city.primaryTravelThemes)||[]),
      ...((city&&city.secondaryTravelThemes)||[])
    ].join(' ').toLowerCase();
  }
  function cityNatureProfile(city){
    const explicit=clamp(Math.max(Number(city&&city.natureStrength||1),Number(city&&city.themeScores&&city.themeScores.nature||1))/5);
    const coastal=clamp(Number(city&&city.beachCoastalStrength||city&&city.themeScores&&city.themeScores.beach||1)/5);
    const relaxation=clamp(Number(city&&city.relaxationStrength||city&&city.themeScores&&city.themeScores.relaxation||1)/5);
    const text=evidenceText(city);
    const strongLandscape=/(?:nature|outdoor|mountain|scenic|landscape|desert|island|alpine|highland|forest|park)/.test(text);
    const coastalLandscape=/(?:coast|coastal|waterfront|beach|warm-weather)/.test(text);
    const landscape=strongLandscape?1:coastalLandscape?0.75:0;
    const primary=(city&&city.primaryTravelThemes||[]).includes('nature')?1:(city&&city.primaryTravelThemes||[]).includes('beach')?0.7:0;
    const pairing=(city&&city.usefulPairingCharacteristics||[]).includes('urban-and-nature contrast')?1:(city&&city.usefulPairingCharacteristics||[]).includes('city-and-coast contrast')?0.8:0;
    const affinity=clamp(0.35*explicit+0.25*landscape+0.20*coastal+0.08*relaxation+0.07*primary+0.05*pairing);
    return {affinity,explicit,coastal,relaxation,landscape,primary,pairing,strongLandscape,coastalLandscape};
  }
  function routeNatureProfile(cities,routeMeta){
    const cityProfiles=cities.map(cityNatureProfile);
    const average=cityProfiles.reduce((s,x)=>s+x.affinity,0)/Math.max(1,cityProfiles.length);
    const maximum=Math.max(...cityProfiles.map(x=>x.affinity),0);
    const minimum=Math.min(...cityProfiles.map(x=>x.affinity),1);
    const routeStyles=(routeMeta&&routeMeta.routeStyles||[]).map(x=>String(x).toLowerCase());
    const routeNatureEvidence=routeStyles.includes('nature')?1:routeStyles.includes('coast')?0.75:0;
    const pairingEvidence=cities.some(c=>(c.usefulPairingCharacteristics||[]).some(x=>['urban-and-nature contrast','city-and-coast contrast'].includes(x)))?1:0;
    const contrast=clamp((maximum-minimum)*1.5);
    const affinity=clamp(0.67*average+0.13*maximum+0.10*routeNatureEvidence+0.05*pairingEvidence+0.05*contrast);
    const coastalCities=cities.filter((c,i)=>cityProfiles[i].coastal>=0.55||cityProfiles[i].coastalLandscape).map(c=>c.city);
    const outdoorCities=cities.filter((c,i)=>cityProfiles[i].strongLandscape||cityProfiles[i].explicit>=0.6).map(c=>c.city);
    const routePreferenceScore=clamp(0.45+0.55*affinity);
    const contributionPoints=round(PREFERENCE_WEIGHT*100*routePreferenceScore,2);
    const bonusPointsVsNeutral=round(PREFERENCE_WEIGHT*100*(routePreferenceScore-NATURE_NEUTRAL_SCORE),2);
    return {affinity,routePreferenceScore,contributionPoints,bonusPointsVsNeutral,maximumContributionPoints:PREFERENCE_WEIGHT*100,cityProfiles,coastalCities,outdoorCities,routeNatureEvidence,pairingEvidence,contrast,meaningful:affinity>=NATURE_MEANINGFUL_THRESHOLD};
  }
  function preferenceMatchScore(cities,preferences,routeMeta,natureProfile){
    if(!preferences.length)return NATURE_NEUTRAL_SCORE;
    const values=preferences.map(pref=>pref==='nature'?natureProfile.routePreferenceScore:cities.reduce((s,c)=>s+themeScore(c,[pref]),0)/cities.length);
    return clamp(values.reduce((a,b)=>a+b,0)/values.length);
  }
  function seasonalScore(city,month){
    if(!city||!month)return 0.55;const name=MONTH_NAMES[Number(month.slice(5,7))-1];
    return (city.idealSeasonsOrMonths||[]).includes(name)?1:0.58;
  }
  function publicEligible(city,allowCandidates){
    if(!city)return false;
    return city.discoveryEligible===true;
  }
  function cityMixScore(cities){
    if(!cities.length)return 0;
    const themes=new Set();for(const c of cities)for(const t of c.primaryTravelThemes||[])themes.add(t);
    const diversity=clamp(themes.size/(cities.length*3));
    const paces=new Set(cities.map(c=>c.typicalTripPace));
    return clamp(0.65*diversity+0.35*Math.min(1,paces.size/2));
  }
  function intercitySimplicity(tour){
    if(!(tour.transport||[]).length)return 0;
    const scores=tour.transport.map(x=>{const t=String(x.type||'').toLowerCase();if(t==='rail')return 1;if(t==='road')return 0.78;if(t==='ferry')return 0.7;if(t==='regional flight'||t==='short flight')return 0.58;return 0.3;});
    return scores.reduce((a,b)=>a+b,0)/scores.length;
  }
  function budgetFit(tour){
    const b=tour.budget||{};const usable=Number(b.usableCoreBudget&&b.usableCoreBudget.amount||0);const remain=Number(b.remainingCoreRoom&&b.remainingCoreRoom.amount||0);
    if(!usable)return 0;const ratio=remain/usable;return clamp(1-Math.abs(ratio-0.18)/0.55);
  }
  function estimatedValue(tour){
    const b=tour.budget||{};const usable=Number(b.usableCoreBudget&&b.usableCoreBudget.amount||0);const total=Number(b.estimatedCoreTotal&&b.estimatedCoreTotal.amount||0);
    return usable>0?clamp((usable-total)/usable+0.65):0;
  }
  function paceScore(cities,preferences){
    const wantsRelax=preferences.includes('relaxation');const wantsAdventure=preferences.includes('adventure');
    if(!wantsRelax&&!wantsAdventure)return 0.72;
    const target=wantsRelax?'relaxed':'active';return cities.some(c=>c.typicalTripPace===target)?1:0.55;
  }
  function natureExplanation(profile){
    if(!profile||!profile.meaningful)return '';
    if(profile.outdoorCities.length>=2)return `This recommendation ranks higher for Nature because ${profile.outdoorCities.slice(0,2).join(' and ')} both carry classified outdoor or landscape-oriented strengths.`;
    if(profile.outdoorCities.length===1&&profile.coastalCities.length)return `The route balances city exploration with stronger outdoor or coastal character around ${profile.outdoorCities[0]}.`;
    if(profile.coastalCities.length>=2)return `This combination offers stronger classified coastal character and a more relaxed outdoor-oriented contrast.`;
    if(profile.coastalCities.length===1)return `${profile.coastalCities[0]} adds classified coastal character, giving the itinerary a stronger Nature fit without changing its practical city structure.`;
    if(profile.routeNatureEvidence)return 'The reviewed route carries a stronger nature-oriented contrast than the other eligible city combinations.';
    return '';
  }
  function explanation(tour,cities,preferences,natureProfile){
    const names=tour.cities.map(c=>c.city);const anchor=cities[0],comp=cities.slice(1);
    const shared=[];for(const p of preferences){if(p==='nature'?natureProfile&&natureProfile.meaningful:cities.some(c=>themeScore(c,[p])>=0.7))shared.push(p.replaceAll('-',' '));}
    const transport=(tour.transport||[]).map(x=>String(x.type||'transport')).join(' and ');
    const cityCount=names.length;
    const durationReason=cityCount===2?`${tour.totalNights} nights give both cities enough time without rushing.`:`${tour.totalNights} nights support three reviewed stays while keeping every transfer continuous.`;
    const complementVerb=comp.length===1?'adds':'add';const character=comp.length?`${anchor.city} provides the main anchor, while ${comp.map(c=>c.city).join(' and ')} ${complementVerb} ${comp[0].primaryTravelThemes.slice(0,2).join(' and ')} contrast.`:`The route balances a strong anchor and practical complement.`;
    const natureText=preferences.includes('nature')?natureExplanation(natureProfile):'';
    const nonNature=shared.filter(x=>x!=='nature');
    const interest=nonNature.length?`It matches your interest in ${nonNature.slice(0,2).join(' and ')}.`:shared.includes('nature')?'':'It offers a balanced mix of culture, value and practical movement.';
    return `${character} ${transport?`The ${transport} connection keeps the route coherent. `:''}${durationReason} ${natureText?`${natureText} `:''}${interest}`.trim();
  }
  function travellerFit(cities,preferences,natureProfile){
    const supported=preferences.filter(p=>p!=='nature'||natureProfile&&natureProfile.meaningful);
    if(supported.length)return `Best for travellers prioritizing ${supported.map(x=>x.replaceAll('-',' ')).join(', ')}.`;
    const top=new Map();for(const c of cities)for(const t of c.primaryTravelThemes||[])top.set(t,(top.get(t)||0)+1);
    const themes=[...top.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0].replaceAll('-',' '));
    return `Best for travellers who want ${themes.join(' and ')} without an overpacked itinerary.`;
  }
  function enrich(tour,input,flags,map,routeMeta){
    const intel=tour.cities.map(c=>map.get(c.id)).filter(Boolean);
    if(intel.length!==tour.cities.length)return null;
    if(!intel.every(c=>publicEligible(c,flags.internalCandidateCityEvaluation)))return null;
    const natureProfile=routeNatureProfile(intel,routeMeta);
    const pref=preferenceMatchScore(intel,input.preferences,routeMeta,natureProfile);
    const season=intel.reduce((s,c)=>s+seasonalScore(c,tour.departureDate.slice(0,7)),0)/intel.length;
    const mix=cityMixScore(intel);const budget=budgetFit(tour);const value=estimatedValue(tour);
    const source=SOURCE_SCORE[tour.sourceMode]||0.35;const practical=intercitySimplicity(tour);
    const anchor=Number(intel[0].anchorSuitability||3)/5;const pace=paceScore(intel,input.preferences);
    const base=clamp(Number(tour.score||0)/100);
    const total=100*(0.20*base+0.15*budget+0.11*value+0.10*source+0.10*practical+0.20*pref+0.05*season+0.04*mix+0.03*anchor+0.02*pace);
    tour.automaticCitySelection=true;tour.manualDestinationSelectionRequired=false;
    tour.intelligence={preferenceMatch:round(pref*100,1),seasonalSuitability:round(season*100,1),cityMix:round(mix*100,1),budgetFit:round(budget*100,1),estimatedValue:round(value*100,1),sourceConfidence:round(source*100,1),intercitySimplicity:round(practical*100,1),anchorQuality:round(anchor*100,1),paceMatch:round(pace*100,1),natureAffinity:round(natureProfile.affinity*100,1),naturePreferenceScore:round(natureProfile.routePreferenceScore*100,1),naturePreferenceContribution:input.preferences.includes('nature')?natureProfile.contributionPoints:0,naturePreferenceBonusVsNeutral:input.preferences.includes('nature')?natureProfile.bonusPointsVsNeutral:0,natureMaximumContribution:natureProfile.maximumContributionPoints,natureEvidence:{coastalCities:natureProfile.coastalCities,outdoorCities:natureProfile.outdoorCities,routeNatureEvidence:natureProfile.routeNatureEvidence,pairingEvidence:natureProfile.pairingEvidence,meaningful:natureProfile.meaningful}};
    tour.automaticScore=round(total,2);tour.originalScore=tour.score;tour.score=tour.automaticScore;
    tour.recommendationExplanation=explanation(tour,intel,input.preferences,natureProfile);
    tour.travellerFit=travellerFit(intel,input.preferences,natureProfile);
    tour.preferenceMatches=input.preferences.filter(p=>p==='nature'?natureProfile.meaningful:intel.some(c=>themeScore(c,[p])>=0.7));
    tour.cityIntelligence=intel.map(c=>({cityId:c.cityId,primaryTravelThemes:c.primaryTravelThemes,typicalTripPace:c.typicalTripPace}));
    return tour;
  }
  function uniqueRoutes(tours){const seen=new Set();return tours.filter(t=>{const key=t.cities.map(c=>c.id).join('|');if(seen.has(key))return false;seen.add(key);return true;});}
  function chooseThree(pool){
    const sorted=uniqueRoutes([...pool].sort((a,b)=>b.automaticScore-a.automaticScore));if(!sorted.length)return [];
    const selected=[];const used=new Set();
    const add=(tour,label)=>{if(!tour||used.has(tour.routeId))return;used.add(tour.routeId);tour.recommendationLabel=label;selected.push(tour);};
    add(sorted[0],"Globevoy's best match");
    add(sorted.filter(t=>!used.has(t.routeId)).sort((a,b)=>b.intelligence.estimatedValue-a.intelligence.estimatedValue||b.automaticScore-a.automaticScore)[0],'Best estimated value');
    const remaining=sorted.filter(t=>!used.has(t.routeId));
    let third=remaining.sort((a,b)=>b.intelligence.cityMix-a.intelligence.cityMix||b.automaticScore-a.automaticScore)[0];
    let label='Best city mix';
    if(third&&third.preferenceMatches.includes('relaxation'))label='Most relaxed';
    else if(third&&third.preferenceMatches.includes('beaches'))label='Best beach and city combination';
    else if(third&&third.preferenceMatches.includes('history-and-culture'))label='Best cultural trip';
    add(third,label);
    return selected.slice(0,MAX_RECOMMENDATIONS);
  }
  function normalizeInput(raw,data,flags){
    const dateMode=['anytime','month','exact'].includes(raw.dateMode)?raw.dateMode:'anytime';
    const months=availableMonths(data);let selectedMonths=[];
    if(dateMode==='anytime')selectedMonths=months;
    else if(dateMode==='month'){
      // GV-DATA-410R2: allow any valid YYYY-MM; optimizer derives planning dates from nearest
      // available replay window when the selected month has no exact observation.
      // Do NOT silently convert to anytime mode — the traveller's month is authoritative.
      const m=String(raw.preferredMonth||'');
      if(!/^\d{4}-\d{2}$/.test(m))throw new Error('A valid travel month is required (YYYY-MM).');
      selectedMonths=[m];
    }else{
      // GV-DATA-410R2: exact-date mode — use the departure month directly as the planning
      // month. This gives the optimizer a specific target and avoids silently looping over
      // replay months (Oct/Nov) when the user has specified August or July exact dates.
      const dep=String(raw.exactDepartureDate||'');const ret=String(raw.exactReturnDate||'');if(!dep||!ret)throw new Error('Enter both exact departure and return dates.');if(!validDate(dep)||!validDate(ret))throw new Error('Exact dates must be valid dates.');const nights=dateDiff(dep,ret);if(nights<=0)throw new Error('Return date must be after departure date.');if(nights<7)throw new Error('Exact date range must be at least 7 nights.');if(nights>14)throw new Error('Exact date range must be no more than 14 nights.');const requested=raw.totalNights==null||raw.totalNights===''||raw.totalNights==='auto'?'auto':Number(raw.totalNights);if(requested!=='auto'&&requested!==nights)throw new Error('Exact dates conflict with the selected duration.');const min=Number(raw.minimumNights||7),max=Number(raw.maximumNights||14);if(nights<min||nights>max)throw new Error('Exact dates fall outside the preferred duration range.');
      // Always use the departure month — never the replay months — so Aug exact dates
      // produce Aug tours regardless of whether Oct/Nov replay data exists.
      selectedMonths=[dep.slice(0,7)];
    }
    const preferences=normalizePreferences(raw.preferences);
    return {...raw,dateMode,selectedMonths,preferences,internalCandidateCityEvaluation:flags.internalCandidateCityEvaluation===true||flags.enable500CityDiscovery===true,aiClassificationDebug:flags.aiClassificationDebug===true};
  }
  function recommend(raw,dataOverride,flagOverride){
    const data=dataOverride||defaultData;const flags={internalCandidateCityEvaluation:false,enable500CityDiscovery:false,aiClassificationDebug:false,...(flagOverride||{})};
    const activeRecords=activeIntelligenceRecords(flags);
    const input=normalizeInput(raw,data,flags);const map=cityMap(flags);const routeMap=new Map((data.routes||[]).map(r=>[r.routeId,r]));const all=[];const errors=[];let windowsEvaluated=0;
    for(const month of input.selectedMonths){
      try{
        const result=optimizer.optimize({...input,preferredMonth:month,exactDepartureDate:input.dateMode==='exact'?input.exactDepartureDate:'',exactReturnDate:input.dateMode==='exact'?input.exactReturnDate:''},data);
        windowsEvaluated+=Number(result.diagnostics&&result.diagnostics.dateWindowsEvaluated||0);
        for(const sourceTour of result.tours||[]){const tour=enrich(JSON.parse(JSON.stringify(sourceTour)),input,flags,map,routeMap.get(sourceTour.routeId));if(tour)all.push(tour);}
      }catch(error){errors.push({month,message:error.message});}
    }
    const bestByRoute=new Map();for(const t of all){const cur=bestByRoute.get(t.routeId);if(!cur||t.automaticScore>cur.automaticScore)bestByRoute.set(t.routeId,t);}
    const pool=[...bestByRoute.values()];const tours=chooseThree(pool);
    const natureRoutes=pool.map(t=>({routeId:t.routeId,affinity:Number(t.intelligence.natureAffinity||0),preferenceContribution:Number(t.intelligence.naturePreferenceContribution||0),automaticScore:t.automaticScore})).sort((a,b)=>b.affinity-a.affinity||b.automaticScore-a.automaticScore);
    const natureSpread=natureRoutes.length>=2?round((natureRoutes[0].affinity-natureRoutes[natureRoutes.length-1].affinity)/100,3):0;
    const monthsEvaluated=input.selectedMonths.length;
    function buildNoResultReason(){
      if(tours.length>0)return null;
      const monthErr=errors.some(e=>/month|evidence|supported/i.test(e.message));
      if(monthErr&&input.dateMode!=='anytime')return 'unsupported-date-window';
      if(all.length===0)return 'budget-or-coverage';
      if(pool.length===0&&input.preferences&&input.preferences.length>0)return 'preferences-too-restrictive';
      if(pool.length===0&&input.minimumNights!=null&&input.maximumNights!=null&&(Number(input.maximumNights)-Number(input.minimumNights))<3)return 'duration-too-narrow';
      return 'no-eligible-route';
    }
    function buildSuggestions(reason){
      if(tours.length>0)return [];
      const hasPrefs=input.preferences&&input.preferences.length>0;
      const narrowDuration=input.minimumNights!=null&&input.maximumNights!=null&&(Number(input.maximumNights)-Number(input.minimumNights))<3;
      if(reason==='unsupported-date-window')return['"Anytime" dates — Globevoy will use the best available planning window','Increase your total budget'];
      if(reason==='budget-or-coverage')return['Increase your total budget','"Anytime" dates — broadest available search','Allow a wider range of nights (try 7 to 14)'];
      if(reason==='preferences-too-restrictive')return['Try "No preference" to see all eligible combinations','Select fewer interests (one instead of three)','Increase your total budget'];
      if(reason==='duration-too-narrow')return['Allow a wider range of nights (try 7 to 14)','Increase your total budget'];
      if(hasPrefs)return['Increase your total budget','Try "No preference" to see all eligible combinations',narrowDuration?'Allow a wider range of nights':'"Anytime" dates for the broadest search'];
      return['Increase your total budget','Allow a wider range of nights','"Anytime" dates for the broadest search'];
    }
    const noResultReason=buildNoResultReason();
    const result={
      status:tours.length>=3?'ready':tours.length?'limited-results':'no-suitable-trip',
      input,availableMonths:availableMonths(data),monthsEvaluated,windowsEvaluated,candidateToursEvaluated:all.length,eligibleRouteCount:pool.length,
      tours,errors,publicCandidateFlagEnabled:flags.internalCandidateCityEvaluation===true||flags.enable500CityDiscovery===true,
      preferenceDiagnostics:{nature:{selected:input.preferences.includes('nature'),eligibleRouteCount:natureRoutes.length,differentiable:natureRoutes.length>=2&&natureSpread>=NATURE_DIFFERENTIABLE_SPREAD,affinitySpread:natureSpread,materialSpreadThreshold:NATURE_DIFFERENTIABLE_SPREAD,routes:natureRoutes}},
      summary:tours.length?`Evaluated ${windowsEvaluated} planning windows across ${monthsEvaluated} month${monthsEvaluated===1?'':'s'} and selected ${tours.length} differentiated trips.`:'No trips matched your current search. Try adjusting your budget, dates or preferences.',
      limitation:'These are planning estimates based on price history. Check partner sites for current fares before booking.',
      noResultReason,
      suggestions:buildSuggestions(noResultReason),
      classificationDebug:flags.aiClassificationDebug?{records:activeRecords.length}:undefined
    };
    return result;
  }
  return {recommend,availableMonths,normalizePreferences,publicEligible,cityNatureProfile,routeNatureProfile,MAX_RECOMMENDATIONS,NATURE_MEANINGFUL_THRESHOLD,NATURE_DIFFERENTIABLE_SPREAD};
});
