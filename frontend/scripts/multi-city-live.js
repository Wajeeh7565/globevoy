(function(){
  'use strict';
  const q=new URLSearchParams(location.search);
  const get=(k,d)=>q.get(k)||d;
  const summary=document.querySelector('main section');
  const editTrigger=[...document.querySelectorAll('button')].find(b=>b.textContent.toLowerCase().includes('edit search'));
  const panel=document.createElement('section');
  panel.id='gv-multi-edit-panel'; panel.className='gv-multi-edit-panel'; panel.hidden=true;
  panel.innerHTML=`<div class="gv-edit-head"><div><strong>Edit Multi-city search</strong><p>Update the same choices used on the homepage.</p></div><button type="button" id="gv-multi-close">×</button></div>
  <div class="gv-edit-grid">
    <label>Leaving from<input id="mc-origin" type="text"></label><label>Total budget<input id="mc-budget" type="number" min="300"></label><label>Travellers<select id="mc-passengers"><option value="1">1 traveller</option><option value="2">2 travellers</option><option value="3">3 travellers</option></select></label>
    <label>Trip length<select id="mc-nights"><option value="5">4–6 nights</option><option value="8">7–9 nights</option><option value="12">10–14 nights</option></select></label><label>Preferred cities<select id="mc-cities"><option value="2">2 cities</option><option value="3">3 cities</option></select></label><label>Travel pace<select id="mc-pace"><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="faster">Faster</option></select></label>
    <label>Transport<select id="mc-transport"><option value="best">Best available</option><option value="train">Prefer train</option><option value="flight">Prefer flights</option><option value="bus">Prefer bus</option></select></label><label>Continent<select id="mc-region"><option>All continents</option><option>North America</option><option>Europe</option><option>Asia</option><option>Africa</option><option>South America</option><option>Oceania</option></select></label><label>Hotel style<select id="mc-hotel"><option>Best balance</option><option>Best location</option><option>Best value</option><option>Higher guest rating</option></select></label><label>Date mode<select id="mc-date-mode"><option value="flexible">Flexible dates</option><option value="exact">Exact dates</option></select></label><label>Preferred month<input id="mc-month" type="month"></label><label>Flexibility<select id="mc-flex-window"><option value="7">±7 days</option><option value="3">±3 days</option><option value="month">Anytime in selected month</option></select></label>
  </div><div class="gv-edit-actions"><a id="gv-back-home" href="index.html?mode=multi">Back to homepage</a><button type="button" id="gv-multi-update">Update results</button></div>`;
  const main=document.querySelector('main'); main.insertBefore(panel,main.firstChild);
  const fields={origin:'mc-origin',budget:'mc-budget',passengers:'mc-passengers',nights:'mc-nights',cities:'mc-cities',pace:'mc-pace',transport:'mc-transport',region:'mc-region',hotelStyle:'mc-hotel',dateMode:'mc-date-mode',preferredMonth:'mc-month',flexWindow:'mc-flex-window'};
  Object.entries(fields).forEach(([k,id])=>{const el=document.getElementById(id);if(el)el.value=get(k,el.value||'');});
  const backHome=document.getElementById('gv-back-home');if(backHome){const homeParams=new URLSearchParams(q);homeParams.set('mode','multi');backHome.href='index.html?'+homeParams.toString();}
  function toggle(){panel.hidden=!panel.hidden; if(!panel.hidden)panel.scrollIntoView({behavior:'smooth',block:'start'});}
  editTrigger&&editTrigger.addEventListener('click',toggle); document.getElementById('gv-multi-close').addEventListener('click',toggle);
  document.getElementById('gv-multi-update').addEventListener('click',()=>{Object.entries(fields).forEach(([k,id])=>{const el=document.getElementById(id);if(el&&el.value)q.set(k,el.value)});q.set('mode','multi');location.href='multi-city.html?'+q.toString();});
  // Update visible top summary without changing the approved route-body design.
  const textNodes=[]; const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n; while(n=walker.nextNode())textNodes.push(n);
  const origin=get('origin','Toronto – YYZ'), budget=get('budget','1500'), passengers=get('passengers','1'), nights=get('nights','6'), cities=get('cities','2');
  textNodes.forEach(t=>{const v=t.nodeValue.trim(); if(v==='Toronto – YYZ')t.nodeValue=t.nodeValue.replace(v,origin); else if(v==='C$1,500')t.nodeValue=t.nodeValue.replace(v,'C$'+Number(budget).toLocaleString('en-CA')); else if(v==='1 traveller')t.nodeValue=t.nodeValue.replace(v,passengers+' traveller'+(passengers==='1'?'':'s')); else if(v==='6 nights')t.nodeValue=t.nodeValue.replace(v,nights+' nights'); else if(v==='2 cities')t.nodeValue=t.nodeValue.replace(v,cities+' cities');});
  const notice=document.createElement('div');notice.className='gv-runtime-notice';notice.textContent='Search preferences loaded. Multi-city recommendation engine wiring is completed in GV-UI-541D; this page currently preserves the approved route design and editable search flow.';main.insertBefore(notice,panel.nextSibling);
})();
