(function(){
'use strict';
const q=new URLSearchParams(location.search),$=s=>document.querySelector(s);
let offer=null;try{offer=JSON.parse(sessionStorage.getItem('gv-selected-offer')||'null')}catch(_){offer=null}
const currency=(q.get('currency')||'CAD').toUpperCase(),prefix={CAD:'C$',USD:'$',AUD:'A$',EUR:'€',GBP:'£'}[currency]||'C$';
const fmt=v=>prefix+Math.round(Number(v||0)).toLocaleString('en-CA');
const city=q.get('city')||offer?.city||'Destination',country=q.get('country')||offer?.country||'',origin=q.get('origin')||'Toronto (YYZ)',dep=q.get('departureDate')||'',ret=q.get('returnDate')||'',travellers=Math.max(1,Number(q.get('passengers')||1));
const trip=Number(q.get('total')||offer?.total||0),remaining=Number(q.get('remaining')||offer?.remaining||0);
const set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
set('#gv-booking-title',`Booking options for ${city}`);set('#gv-booking-route',`${origin} → ${[city,country].filter(Boolean).join(', ')}`);set('#gv-booking-dates',dep?`${dep}${ret?' – '+ret:''}`:'Flexible dates');set('#gv-booking-travellers',`${travellers} ${travellers===1?'traveller':'travellers'}`);set('#gv-booking-estimate',fmt(trip));set('#gv-booking-remaining',fmt(remaining));
const back=new URLSearchParams(q);$('#gv-booking-back').href='trip.html?'+back.toString();
const valid=u=>/^https?:\/\//i.test(String(u||''));const flight=offer?.flightUrl||q.get('flightUrl'),hotel=offer?.hotelUrl||q.get('hotelUrl');
if(valid(flight)){const a=$('#gv-booking-flight');a.href=flight;a.hidden=false}if(valid(hotel)){const a=$('#gv-booking-stay');a.href=hotel;a.hidden=false}if(!valid(flight)&&!valid(hotel))$('#gv-booking-unavailable').hidden=false;
})();
