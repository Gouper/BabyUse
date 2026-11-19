// Local, dependency-free rasterization for WeChat tab-bar icons.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const S = 96, scale = 3;
const shapes = {
  index: { lines: [[[8,19],[8,12],[12,7],[20,7],[24,12],[24,19],[27,22],[5,22],[8,19]],[[13,26],[19,26]]], circles: [] },
  items: { lines: [[[5,11],[16,6],[27,11],[16,16],[5,11],[5,24],[16,29],[27,24],[27,11]],[[16,16],[16,29]],[[11,9],[22,14]]], circles: [] },
  records: { lines: [[[9,5],[25,5],[25,28],[7,28],[7,5],[9,5]],[[5,11],[10,11]],[[5,21],[10,21]],[[14,12],[21,12]],[[14,18],[21,18]],[[14,24],[19,24]]], circles: [] },
  family: { lines: [], circles: [[12,11,4],[23,12,3]], arcs: [[12,25,8,Math.PI,2*Math.PI],[24,25,5,Math.PI,2*Math.PI]] }
};
function crc(b) { let c=0xffffffff; for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0; }
function chunk(type,data){const t=Buffer.from(type),l=Buffer.alloc(4),c=Buffer.alloc(4);l.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([l,t,data,c]);}
function render(shape,hex){const rgb=hex.match(/../g).map(v=>parseInt(v,16));const segments=[];for(const line of shape.lines)for(let n=1;n<line.length;n++)segments.push([line[n-1],line[n]]);for(const [x,y,r,start=0,end=2*Math.PI] of [...shape.circles,...(shape.arcs||[])])for(let i=0;i<80;i++){const a=start+(end-start)*i/80,b=start+(end-start)*(i+1)/80;segments.push([[x+Math.cos(a)*r,y+Math.sin(a)*r],[x+Math.cos(b)*r,y+Math.sin(b)*r]])}const rows=[];for(let y=0;y<S;y++){const row=Buffer.alloc(S*4+1);for(let x=0;x<S;x++){let hit=0;for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++){const px=(x+(sx+.5)/2)/scale,py=(y+(sy+.5)/2)/scale;for(const [[ax,ay],[bx,by]] of segments){const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));if(Math.hypot(px-ax-t*dx,py-ay-t*dy)<.95){hit++;break}}}const o=1+x*4;row[o]=rgb[0];row[o+1]=rgb[1];row[o+2]=rgb[2];row[o+3]=Math.round(hit/4*255)}rows.push(row)}const h=Buffer.alloc(13);h.writeUInt32BE(S);h.writeUInt32BE(S,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);}
const root=path.join(__dirname,'..'),dir=path.join(root,'assets','tabs');fs.mkdirSync(dir,{recursive:true});for(const [name,shape]of Object.entries(shapes))for(const selected of [false,true])fs.writeFileSync(path.join(dir,name+(selected?'-active':'')+'.png'),render(shape,selected?'7561CF':'938B9F'));
const { dark } = require('../theme.json');
for (const name of ['index', 'items', 'family']) {
  fs.writeFileSync(path.join(root, dark[name + 'Icon']), render(shapes[name], dark.tabText.slice(1)));
  fs.writeFileSync(path.join(root, dark[name + 'SelectedIcon']), render(shapes[name], dark.tabSelected.slice(1)));
}
