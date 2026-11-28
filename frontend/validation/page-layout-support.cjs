'use strict';
// Current source-layout assertions used by the cumulative historical validators.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const layout=require('../../ops/frontend/page-layout.json');
function promotedPageContentPreserved(name,html) {
 if(!/^[a-z0-9-]+\.html$/.test(name))return false;
 const move=layout.promotions.find(item=>item.to==='frontend/'+name);
 if(!move)return false;
 const current=html===undefined?fs.readFileSync(path.join(root,'pages',name),'utf8'):String(html);
 // A recorded, approved content edit (ops/frontend/page-layout.json approvedContentEdits).
 if((layout.approvedContentEdits||[]).some(e=>e.page==='frontend/pages/'+name&&e.sha256===crypto.createHash('sha256').update(current).digest('hex')))return true;
 // Reverse only the location-dependent changes; all actual content must match.
 const original=current.replace(/((?:src|href)=["'])\.\//g,'$1../').replace('data-depth="0"','data-depth="1"');
 return crypto.createHash('sha256').update(original).digest('hex')===move.originalSha256;
}
module.exports={promotedPageContentPreserved};
