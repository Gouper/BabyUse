const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup({ failFirstLoad = false } = {}) {
 let page;const calls=[], navigations=[];
 const items=[{id:'a',name:'尿裤',spec:'L码',unit:'片',packSize:52,mode:'quantity',expiryMode:'none'}, {id:'b',name:'奶粉',spec:'900g',unit:'罐',packSize:1,mode:'container',expiryMode:'opened'}];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/intake/intake.js'),'utf8'),{
  Page:p=>page=p,require:()=>({today:()=> '2026-11-19',requestId:()=> 'request',error(){},api:async(action,p)=>{calls.push({action,p});if(action==='snapshot'){if(failFirstLoad){failFirstLoad=false;throw new Error('加载失败');}return {items};}if(action==='preview')return [{raw:'未匹配',itemId:null,quantity:2}];return [];}}),
  wx:{showToast(){},navigateBack(){},navigateTo: options=>navigations.push(options),getStorageSync(){},setStorageSync(){}}
 });
 page.data=JSON.parse(JSON.stringify(page.data));
 page.setData=(data,cb)=>{for(const [key,value] of Object.entries(data)){const m=key.match(/^rows\[(\d+)\]\.(.+)$/);if(m)page.data.rows[Number(m[1])][m[2]]=value;else page.data[key]=value;}if(cb)cb();};
 return {page,calls,navigations};
}
const event=(value,n=0,key)=>({detail:{value},currentTarget:{dataset:{n,key}}});
const supplyEvent=(id,n)=>({detail:{id},currentTarget:{dataset:{n}}});
test('first catalog item and repeated selections create distinct prefilled rows',async()=>{
 const {page}=setup();await page.onLoad({source:'initial'});
 page.add(supplyEvent('unknown'));assert.equal(page.data.rows.length,0);
 page.add(supplyEvent('a'));page.add(supplyEvent('a'));page.add(supplyEvent('b'));
 assert.equal(page.data.rows.length,3);assert.equal(page.data.rows[0].packSize,52);assert.equal(page.data.rows[0].spec,'L码');assert.equal(page.data.rows[0].unit,'片');assert.equal(page.data.rows[2].itemMode,'container');
 assert.equal(new Set(page.data.rows.map(row=>row.rowKey)).size,3);
});
test('quantity stepper and optional dates invalidate preview and can be cleared',async()=>{
 const {page}=setup();await page.onLoad({source:'initial'});page.add(supplyEvent('b'));page.preview();assert.equal(page.data.preview,true);
 page.step({currentTarget:{dataset:{n:0,delta:1}}});assert.equal(page.data.rows[0].quantity,2);assert.equal(page.data.preview,false);
 page.change(event('2026-11-01',0,'openedAt'));assert.equal(page.data.rows[0].openedAt,'2026-11-01');page.clearDate(event('',0,'openedAt'));assert.equal(page.data.rows[0].openedAt,'');
 page.change(event('0.5',0,'quantity'));assert.equal(page.data.rows[0].quantity,'0.5');
});
test('unmatched parsed row can select first item and packaging disclosure does not invalidate payload',async()=>{
 const {page,calls}=setup();await page.onLoad({source:'initial'});await page.parse();assert.equal(page.data.rows[0].itemId,'');
 page.pick(supplyEvent('a',0));assert.equal(page.data.rows[0].itemId,'a');assert.equal(page.data.rows[0].quantity,2);assert.equal(page.data.rows[0].packSize,52);
 page.preview();const fingerprint=page.fingerprint();page.toggleDetails(event('',0));assert.equal(page.fingerprint(),fingerprint);
 await page.save();const payload=calls.find(c=>c.action==='intake').p;assert.equal(payload.rows[0].packSize,52);assert.equal(payload.rows[0].quantity,2);assert.equal(payload.rows[0].showDetails,undefined);
});

test('importing and reimporting text preserves hand-selected rows without duplicating imports',async()=>{
 const {page}=setup();await page.onLoad({source:'initial'});page.add(supplyEvent('a'));
 page.change(event('4',0,'quantity'));await page.parse();assert.equal(page.data.rows.length,2);
 assert.equal(page.data.rows[0].itemId,'a');assert.equal(page.data.rows[0].quantity,'4');
 await page.parse();assert.equal(page.data.rows.length,2);assert.equal(page.data.rows[0].quantity,'4');
 assert.equal(page.data.rows[1].parsed,true);
});

test('creating a new supply from a row keeps other rows, the date and the draft text',async()=>{
 const {page,navigations}=setup();await page.onLoad({source:'purchase'});
 page.add(supplyEvent('a'));page.date(event('2026-10-01'));page.text(event('清单内容'));await page.parse();
 const firstRow=page.data.rows[0];
 page.createSupply(supplyEvent(null,1));
 assert.equal(navigations[0].url,'/pages/editor/editor?kind=item&fromIntake=1');
 const saved={id:'c',name:'棉柔巾',spec:'80抽',unit:'抽',packSize:80,mode:'quantity',expiryMode:'none'};
 navigations[0].events.itemCreated(saved);
 assert.equal(page.data.rows[0],firstRow);assert.equal(page.data.date,'2026-10-01');assert.equal(page.data.text,'清单内容');
 assert.equal(page.data.rows[1].itemId,'c');assert.equal(page.data.rows[1].quantity,2);assert.equal(page.data.rows[1].packSize,80);
 assert.equal(page.data.items.find(item=>item.id==='c').name,'棉柔巾');
});

test('row identity survives position changes and a delayed editor event after page resume',async()=>{
 const {page,navigations}=setup();await page.onLoad({source:'purchase'});
 page.add(supplyEvent('a'));page.add(supplyEvent('b'));
 const originalKey=page.data.rows[1].rowKey;
 page.createSupply(supplyEvent(null,1));
 page.onShow();page.remove(event('',0));
 page.step({currentTarget:{dataset:{n:0,delta:1}}});
 navigations[0].events.itemCreated({id:'c',name:'棉柔巾',unit:'抽'});
 assert.equal(page.data.rows[0].itemId,'c');
 assert.equal(page.data.rows[0].rowKey,originalKey);
 assert.equal(page.data.rows[0].quantity,2);
});

test('cancel and malformed create results leave intake unchanged and allow another attempt',async()=>{
 const {page,navigations}=setup();await page.onLoad({source:'purchase'});
 page.createSupply(supplyEvent());page.createSupply(supplyEvent());assert.equal(navigations.length,1);
 page.onShow();assert.equal(page.data.rows.length,0);
 page.createSupply(supplyEvent());navigations[1].events.itemCreated({name:'缺少用品编号'});
 assert.equal(page.data.rows.length,0);
 page.onShow();page.createSupply(supplyEvent());
 const saved={id:'c',name:'棉柔巾',unit:'抽',packSize:80};
 navigations[2].events.itemCreated(saved);navigations[2].events.itemCreated(saved);
 assert.equal(page.data.rows.length,1);assert.equal(page.data.rows[0].itemId,'c');
});

test('intake launched after item creation preselects once when catalog loading succeeds',async()=>{
 const {page}=setup({failFirstLoad:true});await page.onLoad({source:'purchase',itemId:'b'});
 assert.equal(page.data.rows.length,0);
 await page.loadItems();assert.equal(page.data.rows[0].itemId,'b');
 await page.loadItems();assert.equal(page.data.rows.length,1);
});
