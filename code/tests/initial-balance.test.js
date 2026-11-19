const test=require('node:test'),assert=require('node:assert/strict');
const {execute,empty,snapshot}=require('../cloudfunctions/api/domain');
function setup(mode='quantity',expiryMode='none') {
 const s=empty();let n=0;
 const call=(action,p={})=>execute(s,'a',action,p,{now:'2026-11-19T04:00:00Z',id:()=>String(++n)});
 call('createFamily',{name:'家',babyName:'宝宝'});
 const item=call('createItem',{name:'用品',unit:'个',mode,expiryMode,openDays:30});
 const intake=(source,date,quantity,extra={})=>call('intake',{source,requestId:'intake-'+(++n),rows:[{itemId:item.id,quantity,date,...extra}]});
 const available=()=>call('snapshot').items[0].available;
 return {s,item,call,intake,available};
}
test('initial counts replace earlier counts in either entry order; use subtracts from newest business day',()=>{
 for(const reverse of [false,true]) {
 const h=setup();if(reverse){h.intake('initial','2026-11-18',77);h.intake('initial','2026-11-19',70);}else{h.intake('initial','2026-11-19',70);h.intake('initial','2026-11-18',77);}
 h.call('use',{itemId:h.item.id,date:'2026-11-19',quantity:7});assert.equal(h.available(),63);
 const persisted=JSON.parse(JSON.stringify(h.s));assert.equal(snapshot(persisted,'2026-11-19').items[0].available,63);
 }
});
test('same intake groups same-item rows but separate intakes replace; purchases after baseline add',()=>{
 const h=setup();h.intake('purchase','2026-11-18',100);
 const p={source:'initial',requestId:'group',rows:[{itemId:h.item.id,date:'2026-11-19',quantity:40,expiry:'2027-01-01'},{itemId:h.item.id,date:'2026-11-19',quantity:30,expiry:'2027-02-01'}]};
 h.call('intake',p);h.call('intake',p);assert.equal(h.available(),70);assert.equal(h.s.batches.length,3);
 h.intake('purchase','2026-11-19',10);h.call('use',{itemId:h.item.id,date:'2026-11-19',quantity:7});assert.equal(h.available(),73);
 h.intake('initial','2026-11-19',50);assert.equal(h.available(),50);
});
test('same-day purchase and use before a recount are absorbed; later events are retained',()=>{
 const h=setup();h.intake('purchase','2026-11-19',100);h.call('use',{itemId:h.item.id,quantity:10});h.intake('initial','2026-11-19',70);
 h.intake('purchase','2026-11-19',5);h.call('use',{itemId:h.item.id,quantity:7});assert.equal(h.available(),68);
});
test('explicit count and initial follow the same business-date and same-day sequence ordering',()=>{
 const h=setup();h.intake('initial','2026-11-18',77);h.call('count',{itemId:h.item.id,date:'2026-11-19',quantity:70,reason:'实点'});
 h.intake('initial','2026-11-18',80);assert.equal(h.available(),70);
 h.call('use',{itemId:h.item.id,quantity:7});assert.equal(h.available(),63);
});
test('initial respects FEFO and does not resurrect expiry stock from old counts',()=>{
 const h=setup('quantity','package');h.intake('initial','2026-11-18',77,{expiry:'2026-11-18'});
 h.call('intake',{source:'initial',requestId:'fresh',rows:[{itemId:h.item.id,date:'2026-11-19',quantity:40,expiry:'2027-02-01'},{itemId:h.item.id,date:'2026-11-19',quantity:30,expiry:'2027-01-01'}]});
 h.call('use',{itemId:h.item.id,quantity:7});const view=h.call('snapshot').items[0];assert.equal(view.available,63);assert.equal(view.batches[0].remaining,0);assert.equal(view.batches[2].remaining,23);
});
test('container initial resets unopened stock and preserves already-open container references',()=>{
 const h=setup('container');h.intake('initial','2026-11-18',3);const c=h.call('open',{itemId:h.item.id,date:'2026-11-18'});
 h.intake('initial','2026-11-19',4);const view=h.call('snapshot').items[0];assert.equal(view.unopened,4);assert.equal(view.using,1);assert.equal(h.s.containers[0].id,c.id);
 h.call('finish',{containerId:c.id});assert.equal(h.available(),4);
});
test('an opened container on a counted intake row is included once in that row quantity',()=>{
 const h=setup('container');h.intake('initial','2026-11-18',5);h.intake('initial','2026-11-19',3,{openedAt:'2026-11-19'});assert.equal(h.available(),2);assert.equal(h.call('snapshot').items[0].using,1);
});
test('opening after an explicit count decreases unopened inventory',()=>{
 const h=setup('container');h.intake('purchase','2026-11-18',5);h.call('count',{itemId:h.item.id,date:'2026-11-18',quantity:4,reason:'清点'});
 h.call('open',{itemId:h.item.id,date:'2026-11-19'});assert.equal(h.available(),3);
});

test('existing additive-era conflicts do not block household snapshot and current count repairs them',()=>{
 const h=setup();h.intake('initial','2026-11-18',50);h.intake('purchase','2026-11-19',20);h.call('use',{itemId:h.item.id,quantity:40});
 // Simulate persisted data produced by the old additive implementation.
 h.s.batches[1].source='initial';h.s.records.find(r=>r.batchId===h.s.batches[1].id).type='initial';
 const view=h.call('snapshot').items[0];assert.equal(view.available,0);assert.equal(view.inventoryConflict,true);assert.match(view.inventoryWarning,/重新盘点/);
 assert.ok(view.batches.every(b=>b.remaining>=0));
 h.call('count',{itemId:h.item.id,date:'2026-11-19',quantity:8,reason:'核对实物'});
 assert.equal(h.available(),8);assert.equal(h.call('snapshot').items[0].inventoryConflict,false);
});
test('new backdated stocktake is rejected atomically if it cannot cover a later recorded use',()=>{
 const h=setup();h.intake('initial','2026-11-17',50);h.call('use',{itemId:h.item.id,date:'2026-11-19',quantity:40});
 const before=JSON.stringify(h.s);assert.throws(()=>h.intake('initial','2026-11-18',20),/库存不足/);
 assert.equal(JSON.stringify(h.s),before);assert.equal(h.available(),10);
});
test('legacy containers linked to an obsolete batch retain their reference without negative stock',()=>{
 const h=setup('container','package');const older=h.intake('initial','2026-11-18',5,{expiry:'2026-11-18'});
 h.intake('initial','2026-11-19',4,{expiry:'2027-01-01'});const c=h.call('open',{itemId:h.item.id,date:'2026-11-19'});
 // Prior versions could pick an earlier batch after a later stocktake.
 h.s.containers.find(x=>x.id===c.id).batchId=older[0].id;
 h.s.records.find(r=>r.type==='open' && r.containerId===c.id).batchId=older[0].id;
 const view=h.call('snapshot').items[0];assert.equal(view.available,3);assert.equal(view.using,1);assert.ok(view.batches.every(b=>b.remaining>=0));
});
test('read at an earlier date never exposes negative batches from later container openings',()=>{
 const h=setup('container');h.intake('initial','2026-11-18',4);h.call('open',{itemId:h.item.id,date:'2026-11-19'});
 const view=snapshot(h.s,'2026-11-18').items[0];assert.ok(view.available>=0);assert.ok(view.batches.every(b=>b.remaining>=0));
});

test('a later explicit count cannot resurrect expiry batches superseded by a newer initial list',()=>{
 const h=setup('quantity','package');h.intake('initial','2026-11-18',77,{expiry:'2026-11-18'});
 h.intake('initial','2026-11-19',70,{expiry:'2027-01-01'});
 h.call('count',{itemId:h.item.id,quantity:60,reason:'实点'});
 const view=h.call('snapshot').items[0];assert.equal(view.available,60);assert.equal(view.batches[0].remaining,0);
});
