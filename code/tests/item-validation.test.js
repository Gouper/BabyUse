const test = require('node:test');
const assert = require('node:assert/strict');
const {execute,empty}=require('../cloudfunctions/api/domain');
function create(payload) {
 const s=empty();let id=0;
 const call=(action,p)=>execute(s,'a',action,p,{now:'2026-11-19T04:00:00.000Z',id:()=>String(++id)});
 call('createFamily',{name:'家',babyName:'宝宝'});
 return call('createItem',{name:'奶粉',unit:'罐',mode:'container',expiryMode:'opened',...payload});
}
test('item creation reports opening duration rather than stock quantity',()=>{
 for(const openDays of ['',undefined,0,-1,'abc',Infinity]) assert.throws(()=>create({openDays}),/开封后可使用天数/);
 assert.equal(create({openDays:28}).openDays,28);
});
test('item creation validates package size with its own field name',()=>{
 for(const packSize of ['',0,-1,'abc',Infinity]) assert.throws(()=>create({openDays:28,packSize}),/每包包含/);
 assert.equal(create({openDays:28}).packSize,1);
});
