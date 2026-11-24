'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const motion=matchMedia('(prefers-reduced-motion: reduce)'), connection=navigator.connection;
const conserve=()=>motion.matches||!!connection?.saveData;
const destinations=[
 {city:'Mexico City',country:'Mexico',nights:5,price:890,photo:'mexico',category:'Culture escape'},
 {city:'Lisbon',country:'Portugal',nights:5,price:1080,photo:'lisbon',category:'City break'},
 {city:'Tokyo',country:'Japan',nights:8,price:1860,photo:'tokyo',category:'Best balance'},
 {city:'Marrakech',country:'Morocco',nights:6,price:1340,photo:'marrakech',category:'Most memorable'},
 {city:'Istanbul',country:'Türkiye',nights:7,price:1240,photo:'istanbul',category:'Best balance'},
 {city:'Sydney',country:'Australia',nights:10,price:2640,photo:'sydney',category:'Most memorable'}
];
let origin='Toronto', selected=[0,1,2], routeIndex=0, animations=[];
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arrow='<svg class="icon" aria-hidden="true"><use href="#arrow"/></svg>';
function price(d){return origin==='Toronto'?`<div class="price-label">Illustrative estimate</div><div class="price">~${d.price.toLocaleString('en-CA')} <small>CAD</small></div>`:'<div class="price-label">Toronto example</div><div class="price" style="font-size:14px">Price unavailable</div>'}
function renderCards(){
 $('#trips').innerHTML=selected.map(i=>{const d=destinations[i];return `<article class="trip"><div class="trip-photo"><img src="assets/fresh-b/v3/${d.photo}.jpg" alt="${d.city}, ${d.country}" width="1200" height="960" loading="lazy"><span class="category">${d.category}</span></div><div class="trip-body"><div class="place"><h3>${d.city}</h3><span class="country">${d.country}</span></div><div class="meta"><span>${d.nights} nights</span><span aria-hidden="true">·</span><span class="origin">from ${escapeHTML(origin)}</span></div><div class="trip-bottom"><div>${price(d)}</div><button class="view-trip" data-trip="${i}" aria-label="View trip to ${d.city}">View Trip ${arrow}</button></div></div></article>`}).join('');
}
renderCards();
$('#from').addEventListener('input',()=>{origin=$('#from').value.trim()||'Toronto';renderCards();$('#ideas-status').textContent=origin==='Toronto'?'':`Destination inspiration only. No pricing is available from ${origin}.`});

let motionPaused=false;
$('#more').addEventListener('click',()=>{const open=$('#options').hidden;$('#options').hidden=!open;$('#more').setAttribute('aria-expanded',String(open));$('#more').firstChild.textContent=open?'Fewer Options ':'More Options '});
const travelerInput=$('#travelers');
function syncTravelers(){const n=Number(travelerInput.value);$('.adult-unit').textContent=n===1?'adult':'adults';$('#fewer-travelers').disabled=n<=1;$('#more-travelers').disabled=n>=12}
function changeTravelers(delta){travelerInput.stepUp(delta);travelerInput.dispatchEvent(new Event('input',{bubbles:true}))}
$('#fewer-travelers').addEventListener('click',()=>changeTravelers(-1));
$('#more-travelers').addEventListener('click',()=>changeTravelers(1));
travelerInput.addEventListener('input',syncTravelers);travelerInput.addEventListener('change',()=>{if(!travelerInput.value)travelerInput.value='1';travelerInput.value=String(Math.max(1,Math.min(12,Math.round(Number(travelerInput.value)||1))));syncTravelers()});syncTravelers();
$('#shuffle').addEventListener('click',async()=>{
 const button=$('#shuffle');button.disabled=true;
 let next;do{const pool=[...destinations.keys()];for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}next=pool.slice(0,3)}while([...next].sort().join()===[...selected].sort().join());
 if(!conserve())await Promise.all($$('.trip').map((card,i)=>card.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(12px)'}],{duration:180,delay:i*35,easing:'ease-in'}).finished));
 selected=next;renderCards();
 if(!conserve())await Promise.all($$('.trip').map((card,i)=>card.animate([{opacity:0,transform:'translateY(18px)',clipPath:'inset(4% 0 0)'},{opacity:1,transform:'translateY(0)',clipPath:'inset(0)'}],{duration:500,delay:i*70,easing:'cubic-bezier(.16,1,.3,1)'}).finished));
 $('#ideas-status').textContent=`New ideas: ${selected.map(i=>destinations[i].city).join(', ')}.`;button.disabled=false;
});
$('#trips').addEventListener('click',e=>{const button=e.target.closest('[data-trip]');if(!button)return;const d=destinations[Number(button.dataset.trip)];$('#dialog-content').innerHTML=`<img src="assets/fresh-b/v3/${d.photo}.jpg" alt="${d.city}" style="margin-top:16px"><h2 id="dialog-title">${d.city}, ${d.country}</h2><p>${d.nights} nights · from ${escapeHTML(origin)}</p><div style="margin:18px 0">${price(d)}</div><p>Flights and stays are illustrative. Use the search form for current trip options.</p>`;$('#trip-dialog').showModal()});
$('#close-dialog').addEventListener('click',()=>$('#trip-dialog').close());

/* One animation clock, three independently suspended experiences, two media buffers each. */
const clip=(key)=>({key,poster:`assets/fresh-b/v4/${key}.jpg`,video:key==='marrakech'?null:`assets/fresh-b/v4/${key}.mp4`});
class SceneDeck {
 constructor(element,first){
  this.element=element;this.active=0;this.generation=0;this.running=false;this.fades=[];this.key='';
  element.innerHTML=[0,1].map(()=>'<div class="scene"><img alt=""><video muted autoplay playsinline preload="none" aria-hidden="true"></video></div>').join('');
  this.layers=[...element.children];
  this.layers.forEach(layer=>{const v=layer.querySelector('video');v.muted=true;v.addEventListener('playing',()=>{if(this.running&&layer===this.layers[this.active])v.classList.add('ready');else v.pause()});v.addEventListener('error',()=>{v.classList.remove('ready');if(layer===this.layers[this.active])element.dataset.fallback='true'})});
  this.show(first,false);
 }
 async show(key,transition=true,callbacks={}){
  if(key===this.key){++this.generation;this.commit=callbacks.commit;this.fades.forEach(a=>a.cancel());this.fades=[];this.layers.forEach((l,i)=>{l.classList.toggle('is-current',i===this.active);if(i!==this.active)l.querySelector('video').pause()});if(callbacks.rewind){const v=this.layers[this.active].querySelector('video');v.currentTime=0;if(this.running)this.playActive()}callbacks.commit?.();return}
  const gen=++this.generation;this.fades.forEach(a=>a.cancel());this.fades=[];this.commit=callbacks.commit;
  const old=this.layers[this.active],next=this.layers[1-this.active],v=next.querySelector('video'),img=next.querySelector('img');
  v.pause();v.classList.remove('ready');v.removeAttribute('src');v.load();img.src=clip(key).poster;
  try{await img.decode()}catch{}
  if(gen!==this.generation)return;
  this.active=1-this.active;this.key=key;this.element.dataset.scene=key;this.element.dataset.fallback='false';
  const animate=transition&&!conserve()&&this.running;
  if(animate)callbacks.start?.();
  this.layers.forEach((l,i)=>l.classList.toggle('is-current',i===this.active));
  if(animate){
   const incoming=next.animate([{opacity:0},{opacity:1}],{duration:900,easing:'ease-in-out'});
   const outgoing=old.animate([{opacity:1},{opacity:0}],{duration:900,easing:'ease-in-out'});
   this.fades=[incoming,outgoing];
   if(!this.running)this.fades.forEach(a=>a.pause());
   outgoing.finished.then(()=>{if(gen===this.generation){old.querySelector('video').pause();callbacks.commit?.()}}).catch(()=>{});
  }else{old.querySelector('video').pause();callbacks.commit?.()}
  if(this.running)this.playActive();
 }
 async playActive(){
  const layer=this.layers[this.active],v=layer.querySelector('video'),key=this.key;if(!key||!this.running||conserve()||!clip(key).video)return;
  if(!v.getAttribute('src')){v.src=clip(key).video;v.load()}
  try{await v.play();if(!this.running||layer!==this.layers[this.active])v.pause()}catch{if(layer===this.layers[this.active]&&this.running){this.element.dataset.fallback='true';this.onBlocked?.()}}
 }
 setRunning(run){
  if(this.running===run)return;this.running=run;
  this.fades.forEach(a=>{if(a.playState==='finished'||a.playState==='idle')return;run?a.play():a.pause()});
  if(run)this.playActive();else this.layers.forEach(l=>l.querySelector('video').pause());
 }
 staticOnly(){this.setRunning(false);this.fades.forEach(a=>a.cancel());this.fades=[];this.commit?.();this.layers.forEach(l=>{const v=l.querySelector('video');v.pause();v.removeAttribute('src');v.load();v.classList.remove('ready')})}
}
const heroScenes=[['safari','African safari'],['mountain','Mountain adventure'],['architecture','Florence, Italy']];
const flightScenes=[['takeoff','Taking flight'],['airport','At the airport']];
const JOURNEY_HOLD_MS=3000, JOURNEY_TRAVEL_MS=1200;
const JOURNEY_STEP_MS=JOURNEY_HOLD_MS+JOURNEY_TRAVEL_MS;
const JOURNEY_DURATION_MS=3*JOURNEY_HOLD_MS+2*JOURNEY_TRAVEL_MS;
const journeys=[
 {title:'Mediterranean to Morocco',mode:'plane',label:'Flight-inspired journey',stops:[['lisbon','Lisbon','Portugal'],['seville','Seville','Spain'],['marrakech','Marrakech','Morocco']]},
 {title:"Europe’s Royal Capitals",mode:'train',label:'Rail-inspired journey',stops:[['prague','Prague','Czechia'],['vienna','Vienna','Austria'],['budapest','Budapest','Hungary']]},
 {title:'East Asia Explorer',mode:'plane',label:'Flight-inspired journey',stops:[['tokyo','Tokyo','Japan'],['seoul','Seoul','South Korea'],['taipei','Taipei','Taiwan']]}
];
function setPlayButton(button,paused,label){button.setAttribute('aria-pressed',String(!paused));button.setAttribute('aria-label',(paused?'Play ':'Pause ')+label);button.querySelector('use').setAttribute('href',paused?'#play':'#pause');button.querySelector('span').textContent=paused?'Play '+(label==='journey'?'journey':'films'):'Pause '+(label==='journey'?'journey':'films')}
class Reel {
 constructor(root,deck,items,button,change){this.root=root;this.items=items;this.index=0;this.elapsed=0;this.paused=conserve();this.visible=false;this.button=button;this.change=change;this.deck=new SceneDeck(deck,items[0][0]);this.deck.onBlocked=()=>{this.paused=true;this.sync()};button?.addEventListener('click',()=>{if(conserve()){this.select((this.index+1)%items.length);return}this.paused=!this.paused;this.sync()});this.sync();observeExperience(this);}
 sync(){const on=this.visible&&!this.paused&&!motionPaused&&!conserve()&&!document.hidden;this.deck.setRunning(on);if(!this.button)return;setPlayButton(this.button,this.paused||motionPaused||conserve(),'background films');if(conserve()){this.button.querySelector('span').textContent='Next scene';this.button.setAttribute('aria-label','Show next still scene');this.button.querySelector('use').setAttribute('href','#arrow')}}
 select(index){this.index=index;this.elapsed=0;this.deck.show(this.items[index][0]);this.change?.(index);this.sync()}
 tick(dt){if(this.visible&&!this.paused&&!motionPaused&&!conserve()&&!document.hidden){this.elapsed+=dt;if(this.elapsed>=6000)this.select((this.index+1)%this.items.length)}}
}
const experiences=[];
const visibilityObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{const exp=experiences.find(x=>x.root===entry.target);if(exp){exp.visible=entry.isIntersecting;exp.sync()}}),{threshold:.12});
function observeExperience(exp){experiences.push(exp);visibilityObserver.observe(exp.root)}
const heroReel=new Reel($('.hero'),$('#hero-deck'),heroScenes,null,i=>{$('#hero-scene-name').textContent=heroScenes[i][1];$$('[data-hero-scene]').forEach((b,n)=>b.setAttribute('aria-pressed',String(n===i)))});
$$('[data-hero-scene]').forEach((b,i)=>b.addEventListener('click',()=>heroReel.select(i)));
const howReel=new Reel($('.how'),$('#how-deck'),flightScenes,null);
class Journey {
 constructor(){this.root=$('#route-panel');this.index=0;this.city=0;this.elapsed=0;this.progress=0;this.paused=conserve();this.visible=false;this.deck=new SceneDeck($('#journey-deck'),'lisbon');this.deck.onBlocked=()=>{this.paused=true;this.sync()};this.select(0,false);observeExperience(this)}
 select(index,announce=true){
  this.index=index;this.elapsed=0;this.city=-1;this.progress=0;
  $$('[role=tab]').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1});
  this.root.setAttribute('aria-labelledby','tab-'+index);const j=journeys[index];
  $('#journey-mode').textContent=j.label;$('#transport-use').setAttribute('href','#'+j.mode);
  $('#stops').innerHTML=j.stops.map((s,i)=>`<button class="stop" data-stop="${i}" aria-label="Show ${s[1]}, ${s[2]}"><span class="marker" aria-hidden="true"></span><span class="stop-name">${s[1]}</span><small>${s[2]}</small></button>`).join('');
  $$('#stops button').forEach((b,i)=>b.addEventListener('click',()=>{this.paused=true;this.sync();this.elapsed=i*JOURNEY_STEP_MS;this.setCity(i,true);this.updateProgress(i/2)}));
  this.setCity(0,announce);this.updateProgress(0);this.sync();
 }
 setCity(i,announce=false){if(i===this.city)return;this.city=i;const s=journeys[this.index].stops[i],caption=$('.journey-caption');this.deck.show(s[0],true,{rewind:true,start:()=>{caption.style.opacity='0'},commit:()=>{if(this.deck.key!==s[0])return;caption.style.opacity='1';$('#active-city').textContent=s[1];$('#active-country').textContent=s[2];$('#destination-count').textContent=`${i+1} / 3`}});
  $$('#stops button').forEach((b,n)=>{b.classList.toggle('is-reached',n<=i);if(n===i)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current')});
  this.root.dataset.journey=String(this.index);this.root.dataset.destination=String(i);
  if(announce)$('#route-announcement').textContent=journeys[this.index].title+': '+s[1]+', '+s[2]+'. Illustrative journey.';
 }
 updateProgress(p){this.progress=p;$('#timeline-fill').style.transform=`scaleX(${p})`;$('#transport-position').style.transform=`translateX(${p*100}%)`;this.root.dataset.progress=p.toFixed(4);$('#journey-progress').setAttribute('aria-valuenow',String(Math.round(p*100)));$('#journey-progress').setAttribute('aria-valuetext',`${journeys[this.index].stops[this.city][1]}, stop ${this.city+1} of 3`)}
 sync(){this.deck.setRunning(this.visible&&!this.paused&&!motionPaused&&!conserve()&&!document.hidden)}
 tick(dt){if(!this.visible||this.paused||motionPaused||conserve()||document.hidden)return;this.elapsed+=dt;if(this.elapsed>=JOURNEY_DURATION_MS){this.select((this.index+1)%3,false);return}
  const city=Math.min(2,Math.floor(this.elapsed/JOURNEY_STEP_MS));
  const local=this.elapsed-city*JOURNEY_STEP_MS;
  const u=city<2?Math.max(0,Math.min(1,(local-JOURNEY_HOLD_MS)/JOURNEY_TRAVEL_MS)):0;
  const eased=u*u*(3-2*u);
  this.root.dataset.phase=u>0?'travelling':'visiting';
  this.setCity(city);this.updateProgress((city+eased)/2);
 }
}
const journey=new Journey();
function syncMotionControl(){const b=$('#motion-toggle'),off=conserve(),label=off?'Reduced motion enabled':motionPaused?'Resume all motion':'Pause all motion';b.disabled=off;b.setAttribute('aria-label',label);b.title=label;b.setAttribute('aria-pressed',String(motionPaused||off));b.querySelector('use').setAttribute('href',motionPaused||off?'#play':'#pause')}
$('#motion-toggle').addEventListener('click',()=>{motionPaused=!motionPaused;if(!motionPaused)experiences.forEach(e=>e.paused=false);experiences.forEach(e=>e.sync());syncMotionControl()});syncMotionControl();
$$('[role=tab]').forEach((b,i)=>{b.addEventListener('click',()=>journey.select(i));b.addEventListener('keydown',e=>{let n;if(e.key==='ArrowRight')n=(i+1)%3;if(e.key==='ArrowLeft')n=(i+2)%3;if(e.key==='Home')n=0;if(e.key==='End')n=2;if(n!==undefined){e.preventDefault();$('#tab-'+n).focus();journey.select(n)}})});
let last=performance.now();
function frame(now){const dt=Math.min(now-last,100);last=now;experiences.forEach(e=>e.tick(dt));requestAnimationFrame(frame)}requestAnimationFrame(frame);
function syncAll(){syncMotionControl();experiences.forEach(e=>{if(conserve()){e.paused=true;e.deck.staticOnly()}e.sync()})}
motion.addEventListener('change',syncAll);connection?.addEventListener('change',syncAll);document.addEventListener('visibilitychange',syncAll);
