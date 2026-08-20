(function(){
  'use strict';
  const flags=window.GLOBEVOY_EXPERIMENT_FLAGS||{};
  if(flags.multicityExplorerVisible!==true||flags.multicityExplorerKillSwitch===true)return;
  const singleForm=document.getElementById('search-form');
  if(!singleForm)return;
  const css=document.createElement('link');css.rel='stylesheet';css.href='multicity-explorer/styles.css?v=11.11.2';document.head.appendChild(css);
  const switcher=document.createElement('nav');switcher.className='gv-home-trip-switch';switcher.setAttribute('aria-label','Trip type');switcher.innerHTML='<button type="button" class="active" aria-pressed="true">Single destination</button><button type="button" aria-pressed="false">Multi-city</button>';
  const [single,multi]=switcher.querySelectorAll('button');singleForm.insertAdjacentElement('beforebegin',switcher);
  const panel=document.createElement('section');panel.className='gv-home-multicity-panel';panel.hidden=true;panel.innerHTML='<form id="gv-home-mc-form"><label>Departure city<select id="gv-home-origin"><option value="YYZ">Toronto / YYZ</option><option value="NYC">New York / NYC area</option></select></label><label>Total budget<input id="gv-home-budget" type="number" min="500" step="50" value="5000"></label><label>Currency<select id="gv-home-currency"><option value="CAD">CAD</option><option value="USD">USD</option><option value="AUD">AUD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></label><p class="gv-home-mc-message">Globevoy will choose strong dates and city combinations. You can refine dates, duration and preferences in the planner.</p><button class="gv-home-mc-submit" type="submit">Plan a multi-city trip</button></form>';
  switcher.insertAdjacentElement('afterend',panel);
  function setMode(mode){const isMulti=mode==='multi';document.body.classList.toggle('gv-home-multi-active',isMulti);single.classList.toggle('active',!isMulti);multi.classList.toggle('active',isMulti);single.setAttribute('aria-pressed',isMulti?'false':'true');multi.setAttribute('aria-pressed',isMulti?'true':'false');panel.hidden=!isMulti;}
  single.addEventListener('click',()=>setMode('single'));multi.addEventListener('click',()=>setMode('multi'));
  panel.querySelector('#gv-home-origin').addEventListener('change',event=>{const currency=panel.querySelector('#gv-home-currency');if(event.target.value==='YYZ')currency.value='CAD';else if(event.target.value==='NYC')currency.value='USD';});
  panel.querySelector('form').addEventListener('submit',event=>{event.preventDefault();const u=new URL('explore.html',location.href);u.searchParams.set('mode','multicity');u.searchParams.set('origin',panel.querySelector('#gv-home-origin').value);u.searchParams.set('budget',panel.querySelector('#gv-home-budget').value||'5000');u.searchParams.set('currency',panel.querySelector('#gv-home-currency').value||'CAD');['tripMode','dateMode','month','duration','minNights','maxNights','departure','return','preferences'].forEach(key=>u.searchParams.delete(key));location.href=u.href;});
})();
