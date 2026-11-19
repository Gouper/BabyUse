const test = require('node:test');
const assert = require('node:assert/strict');
const {series,layout,isConsumption} = require('../pages/trends/chart');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const records = [
 {id:'a',type:'initial',date:'2026-11-01',quantity:10},
 {id:'b',type:'use',date:'2026-11-03',endDate:'2026-11-05',quantity:3},
 {id:'c',type:'purchase',date:'2026-11-10',quantity:5},
];
test('trend series keeps actual records and full interval without generating missing days',()=>{
 assert.deepEqual(series(records,0,false,'2026-11-03').map(p=>p.value),[7,12]);
 const uses=series(records,1,false,''); assert.equal(uses.length,1);assert.equal(uses[0].endDate,'2026-11-05');
 assert.deepEqual(series(records,2,false,'').map(p=>p.value),[5]);
});
test('container chart tracks unopened stock and count while consumption tracks finish',()=>{
 const rows=[{id:'a',date:'2026-11-01',type:'initial',quantity:5},{id:'b',date:'2026-11-02',type:'open',quantity:1},{id:'c',date:'2026-11-03',type:'finish',quantity:1},{id:'d',date:'2026-11-04',type:'count',quantity:2}];
 assert.deepEqual(series(rows,0,true,'').map(p=>p.value),[5,4,4,2]);
 assert.deepEqual(series(rows,1,true,'').map(p=>p.value),[1]);
});
test('stock trend replaces previous counts and groups rows from one count', () => {
 const rows = [
  {id:'old',type:'initial',date:'2026-11-18',requestId:'old',quantity:77},
  {id:'new1',type:'initial',date:'2026-11-19',requestId:'new',quantity:50},
  {id:'new2',type:'initial',date:'2026-11-19',requestId:'new',quantity:20},
  {id:'use',type:'use',date:'2026-11-19',quantity:7},
 ];
 assert.deepEqual(series(rows,0,false,'').map(p=>p.value),[77,70,63]);
 assert.deepEqual(series(rows,2,false,''),[]);
});
test('line geometry spaces dates proportionally, handles negative values, one point and empty series',()=>{
 const graph=layout(series(records,0,false,''),360,280);
 assert.ok(Math.abs((graph.points[1].x-graph.points[0].x)/(graph.points[2].x-graph.points[0].x)-2/9)<0.0001);
 const one=layout([{date:'2026-11-01',value:-3}],360,280);assert.equal(one.points[0].x,196);assert.ok(Number.isFinite(one.points[0].y));assert.equal(one.ticks.length,1);
 assert.equal(layout([],360,280).points.length,0);
});
function pageHarness(api) {
 let page;const operations=[];
 const context=new Proxy({}, {get(target,key) {if(!(key in target)) target[key]=(...args)=>operations.push([key,...args]);return target[key];}});
 const canvas={getContext:()=>context};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/trends/trends.js'),'utf8'),{
  Page:p=>page=p,require:name=>name==='./chart'?{series,layout,isConsumption}:{api,error(){},today:()=> '2026-11-19'},
  wx:{getWindowInfo:()=>({pixelRatio:2}),createSelectorQuery:()=>{const query={in:()=>query,select:()=>query,fields:()=>query,exec:fn=>fn([{node:canvas,width:360,height:280}])};return query;}}
 });
 page.data=JSON.parse(JSON.stringify(page.data));page.setData=(data,cb)=>{Object.assign(page.data,data);if(cb)cb();};
 return {page,operations,canvas};
}
test('canvas draws a connected line, dated axes and actual point markers',()=>{
 const {page,operations,canvas}=pageHarness();page.all=records;page.data.mode=0;page.data.unit='片';page.chart();
 assert.equal(canvas.width,720);assert.equal(operations.filter(o=>o[0]==='arc').length,3);
 assert.ok(operations.some(o=>o[0]==='lineTo'));assert.ok(operations.some(o=>o[0]==='fillText' && o[1]==='2026-11-01'));
});
test('trend page opens on recorded consumption and its detail list follows the selected trend', async () => {
 const {page}=pageHarness(async action => action === 'snapshot'
  ? {items:[{id:'diapers',name:'纸尿裤',unit:'片',mode:'quantity'}]}
  : records);
 await page.onLoad();
 assert.equal(page.data.mode,1);
 assert.equal(page.data.lastPoint.value,3);
 assert.equal(page.data.lastPoint.endDate,'2026-11-05');
 assert.equal(page.data.rows.map(r=>r.type).join(','),'use');
 page.mode({currentTarget:{dataset:{mode:2}}});
 assert.equal(page.data.lastPoint.value,5);
 assert.equal(page.data.rows.map(r=>r.type).join(','),'purchase');
});
test('multi-day totals are separate markers outside the daily-use line', () => {
 const {page,operations}=pageHarness();
 page.all=[
  {id:'first',date:'2026-11-01',type:'use',quantity:2},
  records[1],
  {id:'last',date:'2026-11-06',type:'use',quantity:1},
 ];
 page.chart();
 assert.equal(page.data.hasIntervals,true);
 const [,x,y,radius]=operations.filter(o=>o[0]==='arc')[1];
 assert.equal(radius,5);
 assert.ok(!operations.some(o=>o[0]==='lineTo' && o[1]===x && o[2]===y));
});
test('late requests cannot replace a newly selected item chart',async()=>{
 const pending=[];const {page}=pageHarness(()=>new Promise(resolve=>pending.push(resolve)));
 page.data.items=[{id:'a',unit:'片'},{id:'b',unit:'罐'}];
 const first=page.load();page.data.index=1;const second=page.load();
 pending[1]([{id:'new',date:'2026-11-10',type:'use',quantity:2}]);await second;
 pending[0](records);await first;
 assert.equal(page.data.rows[0].id,'new');assert.equal(page.data.unit,'罐');
});

test('a new load clears the previous summary and the template hides canvas without usable points',async()=>{
 const {page}=pageHarness(async()=>[]);
 page.data.items=[{id:'a',unit:'片'}];page.data.lastPoint={value:99};
 const loading=page.load();assert.equal(page.data.lastPoint,null);await loading;
 const template=fs.readFileSync(path.join(__dirname,'../pages/trends/trends.wxml'),'utf8');
 assert.match(template,/<canvas wx:if="{{points.length && !loading && !chartError}}"/);
 assert.doesNotMatch(template,/更新趋势/);
});

test('a first real count anchors display-only balances before historical use',()=>{
 for(const type of ['initial','count']) {
  const rows=[{id:'yesterday',type:'use',date:'2026-11-18',quantity:7},{id:'today',type,date:'2026-11-19',quantity:70}];
  const original=JSON.stringify(rows);const points=series(rows,0,false,'');
  assert.deepEqual(points.map(p=>p.value),[77,70]);assert.equal(points[0].inferred,true);assert.equal(points[1].inferred,false);
  assert.equal(points[0].date,'2026-11-18');assert.equal(points[0].id,'yesterday');assert.equal(JSON.stringify(rows),original);
 }
});
test('historical purchases reverse by subtraction and loss reverses by addition',()=>{
 const rows=[{id:'purchase',type:'purchase',date:'2026-11-16',quantity:10},{id:'loss',type:'loss',date:'2026-11-17',quantity:3},{id:'use',type:'use',date:'2026-11-18',quantity:7},{id:'count',type:'count',date:'2026-11-19',quantity:70}];
 assert.deepEqual(series(rows,0,false,'').map(p=>p.value),[70,80,77,70]);
 assert.deepEqual(series(rows,0,false,'2026-11-18').map(p=>p.value),[77,70]);
 assert.deepEqual(series(rows,2,false,'').map(p=>p.value),[10]);
});
test('existing real historical stocktakes win over inference and same-day sequence is preserved',()=>{
 const rows=[{id:'old',type:'initial',date:'2026-11-17',quantity:100},{id:'use',type:'use',date:'2026-11-18',quantity:7},{id:'today',type:'count',date:'2026-11-19',quantity:70}];
 assert.deepEqual(series(rows,0,false,'').map(p=>p.value),[100,93,70]);assert.ok(series(rows,0,false,'').every(p=>!p.inferred));
 const same=[{id:'use',type:'use',date:'2026-11-19',quantity:7},{id:'count',type:'count',date:'2026-11-19',quantity:70}];
 assert.deepEqual(series(same,0,false,'').map(p=>p.value),[77,70]);
});
test('grouped initial rows form one complete inference anchor',()=>{
 const rows=[{id:'use',type:'use',date:'2026-11-18',quantity:7},{id:'first',type:'initial',requestId:'same',date:'2026-11-19',quantity:50},{id:'second',type:'initial',requestId:'same',date:'2026-11-19',quantity:20}];
 assert.deepEqual(series(rows,0,false,'').map(p=>p.value),[77,70]);
});
test('negative inference, intervals crossing an anchor, and container ambiguity never invent balances',()=>{
 const negative=[{id:'p',type:'purchase',date:'2026-11-18',quantity:100},{id:'c',type:'count',date:'2026-11-19',quantity:70}];
 assert.deepEqual(series(negative,0,false,'').map(p=>p.value),[70]);
 const crossing=[{id:'u',type:'use',date:'2026-11-17',endDate:'2026-11-19',quantity:7},{id:'c',type:'count',date:'2026-11-19',quantity:70}];
 assert.deepEqual(series(crossing,0,false,'').map(p=>p.value),[70]);
 const container=[{id:'o',type:'open',date:'2026-11-18',quantity:1},{id:'c',type:'count',date:'2026-11-19',quantity:4}];
 assert.deepEqual(series(container,0,true,'').map(p=>p.value),[4]);
});

test('container purchase history remains visible without inference and same-day crossing intervals stay unknown',()=>{
 const container=[{id:'p',type:'purchase',date:'2026-11-17',quantity:5},{id:'o',type:'open',date:'2026-11-18',quantity:1},{id:'c',type:'count',date:'2026-11-19',quantity:4}];
 assert.deepEqual(series(container,0,true,'').map(p=>p.value),[5,4,4]);assert.ok(series(container,0,true,'').every(p=>!p.inferred));
 const crossing=[{id:'u',type:'use',date:'2026-11-19',endDate:'2026-11-20',quantity:7},{id:'c',type:'count',date:'2026-11-19',quantity:70}];
 assert.deepEqual(series(crossing,0,false,'').map(p=>p.value),[70]);
});
