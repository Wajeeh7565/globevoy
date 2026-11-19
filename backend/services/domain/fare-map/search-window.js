'use strict';
const DAY=86400000;
function sixMonthsAfter(s){
 const d=new Date(s+'T00:00:00Z'),target=d.getUTCMonth()+6;
 const last=new Date(Date.UTC(d.getUTCFullYear(),target+1,0)).getUTCDate();
 return new Date(Date.UTC(d.getUTCFullYear(),target,Math.min(d.getUTCDate(),last))).toISOString().slice(0,10);
}
function collectionMonthCount(now=Date.now()){
 const start=new Date(now),horizon=Date.parse(sixMonthsAfter(start.toISOString().slice(0,10))+'T00:00:00Z');
 // Last eligible departure + the maximum supported 35-night trip.
 const last=new Date(horizon+34*DAY);
 return (last.getUTCFullYear()-start.getUTCFullYear())*12+last.getUTCMonth()-start.getUTCMonth()+1;
}
module.exports={sixMonthsAfter,collectionMonthCount};
