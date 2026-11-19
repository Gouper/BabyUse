const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function editor(snapshot) {
  let page; const calls = [], errors = [], routes = [];
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../pages/editor/editor.js'), 'utf8'), {
    Page: p => { page = p; }, require: name => name.endsWith('/api') ? ({ today: () => '2026-11-19', requestId: () => 'request', error: e => errors.push(e.message), api: async (a,p) => { calls.push({a,p}); return snapshot; } }) : require('../pages/editor/' + name),
    wx: { showToast() {}, navigateBack() { routes.push('back'); } }
  });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = function(values) { for (const [key,value] of Object.entries(values)) { const keys=key.split('.'); if(keys.length===2) this.data[keys[0]][keys[1]]=value; else this.data[key]=value; } };
  return { page, calls, errors, routes };
}
const snapshot = { items: [{id:'a', name:'尿裤', mode:'quantity', unit:'片', available:10}, {id:'b', name:'奶粉', mode:'container', unit:'罐', available:2}, {id:'x',deleted:true}], containers:[{id:'c',itemId:'b',openedAt:'2026-11-18'}] };
test('single form selects supplies, validates quantity, saves without batch or extra navigation', async () => {
 const {page,calls,errors,routes}=editor(snapshot);
 await page.onLoad({kind:'use'}); assert.equal(page.data.items.length,2);
 await page.save(); assert.equal(errors.length,1); assert.equal(calls.length,1);
 page.selectItem({detail:{id:'a'}}); await page.save(); assert.equal(errors.length,2);
 page.data.form.quantity='2'; await page.save();
 assert.equal(calls[1].a,'use'); assert.equal(calls[1].p.quantity,2); assert.equal(calls[1].p.batchId,undefined); assert.equal(routes.length,1);
 await page.save(); assert.equal(calls.length,2);
});
test('container use records opening or selected container finish on the same form', async () => {
 const {page,calls}=editor(snapshot); await page.onLoad({kind:'use',itemId:'b'});
 await page.save(); assert.equal(calls[1].a,'open'); assert.equal(calls[1].p.batchId,undefined);
 const next=editor(snapshot); await next.page.onLoad({kind:'use',itemId:'b'}); next.page.selectUsageAction({detail:{value:'1'}}); await next.page.save();
 assert.equal(next.calls[1].a,'finish'); assert.equal(next.calls[1].p.containerId,'c');
});
test('hidden multi-day fields cannot silently affect a single-day save',async()=>{
 const {page}=editor(snapshot); await page.onLoad({kind:'use',itemId:'a'});
 page.data.moreUsage=true; page.data.form.endDate='2026-11-19'; page.toggleMoreUsage(); assert.equal(page.data.form.endDate,'');
 page.data.form.endDate='2026-11-19'; page.chooseItem(1); assert.equal(page.data.form.endDate,'');
});
test('loading errors and missing active containers block saving', async()=>{
 const broken=editor({}); await broken.page.onLoad({kind:'use'}); await broken.page.save(); assert.equal(broken.calls.length,1); assert.ok(broken.page.data.loadError);
 const empty=editor({...snapshot,containers:[]}); await empty.page.onLoad({kind:'use',itemId:'b'}); empty.page.selectUsageAction({detail:{value:'1'}}); await empty.page.save(); assert.equal(empty.calls.length,1); assert.equal(empty.errors.length,1);
});

test('historical inventory records the selected date and accepts a counted zero', async () => {
  const { page, calls, errors } = editor(snapshot);
  await page.onLoad({ kind: 'count', history: '1' });
  page.selectItem({ detail: { id: 'a' } });
  await page.save();
  assert.match(errors[0], /清点日期/);
  page.data.form.date = '2026-11-17';
  await page.save();
  assert.match(errors[1], /剩余数量/);
  assert.equal(calls.length, 1);
  page.data.form.quantity = '0';
  await page.save();
  assert.equal(calls[1].a, 'count');
  assert.equal(calls[1].p.itemId, 'a');
  assert.equal(calls[1].p.date, '2026-11-17');
  assert.equal(calls[1].p.quantity, 0);
  assert.ok(calls[1].p.reason);
});

test('item form identifies missing opening duration inline before sending createItem', async()=>{
 const {page,calls}=editor(snapshot); await page.onLoad({kind:'item'});
 page.preset({currentTarget:{dataset:{index:1}}});
 await page.save();
 assert.equal(calls.length,0); assert.match(page.data.fieldErrors.openDays,/开封/);
 page.input({currentTarget:{dataset:{key:'openDays'}},detail:{value:'28'}});
 await page.save(); assert.equal(calls[0].a,'createItem'); assert.equal(calls[0].p.openDays,28);
});
test('item form rejects invalid name, unit, package size and reminder settings', async()=>{
 const {page,calls}=editor(snapshot); await page.onLoad({kind:'item'});
 await page.save(); assert.ok(page.data.fieldErrors.name); assert.ok(page.data.fieldErrors.unit);
 page.data.form.name='用品';page.data.form.unit='片';page.data.form.packSize='';page.data.form.lowStock=-1;
 await page.save();assert.ok(page.data.fieldErrors.packSize);assert.ok(page.data.fieldErrors.lowStock);assert.equal(calls.length,0);
});
