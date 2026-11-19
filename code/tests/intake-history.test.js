const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
function harness() {
 let page, previous = '', modals = 0, requests = 0;
 const calls = [], errors = [];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/intake/intake.js'),'utf8'), {
  Page: p => page = p,
  require: () => ({ today: () => '2026-11-19', requestId: () => 'r' + (++requests), error: e => errors.push(e.message), api: async (action,payload) => {calls.push({action,payload});return {items:[]};} }),
  wx: { getStorageSync: () => previous, setStorageSync: (k,v) => previous=v, showToast(){}, navigateBack(){},showModal(options){modals++;options.success({confirm:true});} }
 });
 page.data = JSON.parse(JSON.stringify(page.data));
 page.setData = data => Object.assign(page.data,data);
 page.data.rows=[{itemId:'a',quantity:2,packSize:50}];
 return {page,calls,errors,setPrevious:v=>previous=v,modals:()=>modals};
}
test('intake defaults to today and sends historical date for every row',async()=>{
 const h=harness();assert.equal(h.page.data.date,'2026-11-19');
 h.page.date({detail:{value:'2026-10-01'}});h.page.preview();await h.page.save();
 assert.equal(h.calls[0].action,'intake');assert.equal(h.calls[0].payload.rows[0].date,'2026-10-01');
 assert.equal(h.calls[0].payload.rows[0].quantity,2);
});
test('date changes invalidate preview and duplicate approval; future and invalid dates are rejected',async()=>{
 const h=harness();h.page.preview();h.page.confirmedFingerprint=h.page.fingerprint();
 h.page.date({detail:{value:'2026-11-18'}});assert.equal(h.page.data.preview,false);assert.equal(h.page.confirmedFingerprint,'');
 await h.page.save();assert.equal(h.calls.length,0);
 for(const date of ['2026-11-20','2026-02-30','invalid']) {
  h.page.date({detail:{value:date}});h.page.preview();assert.equal(h.page.data.preview,false);
 }
 assert.ok(h.errors.length>=4);
});
test('duplicate fingerprint includes source and business date as well as rows',async()=>{
 const h=harness();const baseline=h.page.fingerprint();h.setPrevious(baseline);
 h.page.date({detail:{value:'2026-11-18'}});assert.notEqual(h.page.fingerprint(),baseline);
 h.page.data.source='purchase';const purchase=h.page.fingerprint();h.page.data.source='initial';assert.notEqual(h.page.fingerprint(),purchase);
 h.page.preview();await h.page.save();assert.equal(h.modals(),0);
 const duplicate=harness();duplicate.setPrevious(duplicate.page.fingerprint());duplicate.page.preview();await duplicate.page.save();assert.equal(duplicate.modals(),1);
});
test('historical date is preserved and changed row contents require a fresh preview',async()=>{
 const h=harness();h.page.date({detail:{value:'2026-10-01'}});h.page.preview();
 h.page.data.rows[0].quantity=3;await h.page.save();assert.equal(h.calls.length,0);
 h.page.preview();await h.page.save();assert.equal(h.calls[0].payload.rows[0].date,'2026-10-01');
});

test('historical intake is retained by domain and returned on its actual business date',()=>{
 const {execute,empty}=require('../cloudfunctions/api/domain');
 const state=empty();let n=0;
 const call=(action,payload)=>execute(state,'member',action,payload,{now:'2026-11-19T04:00:00Z',id:()=>String(++n)});
 call('createFamily',{name:'家',babyName:'宝宝'});
 const item=call('createItem',{name:'尿裤',unit:'片',mode:'quantity',expiryMode:'none'});
 call('intake',{source:'purchase',requestId:'historical',rows:[{itemId:item.id,quantity:2,packSize:50,date:'2026-10-01'}]});
 assert.equal(state.batches[0].date,'2026-10-01');
 const rows=call('trends',{itemId:item.id,to:'2026-10-31'});
 assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-01');assert.equal(rows[0].quantity,100);
});
