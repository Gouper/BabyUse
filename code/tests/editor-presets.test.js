const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');

const file = path.resolve(__dirname, '../pages/editor/editor.js');
const load = createRequire(file);
const event = (key, value) => ({ currentTarget: { dataset: { key } }, detail: { value } });
const preset = index => ({ currentTarget: { dataset: { index } } });

function setup() {
  let page;
  const created = { id: 'new id', name: '奶粉', unit: '罐' };
  const navigation = [];
  const api = { today: () => '2026-11-19', requestId: () => 'request', api: async () => created, error: error => { throw error; } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: definition => { page = definition; },
    require: name => name.endsWith('/api') ? api : load(name),
    wx: {
      showToast() {},
      navigateBack: () => navigation.push('back'),
      redirectTo: ({ url }) => navigation.push(url),
    },
  });
  page.setData = function(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      const field = parts.pop();
      parts.reduce((target, part) => target[part], this.data)[field] = value;
    }
  };
  page.getOpenerEventChannel = () => ({ emit: (type, item) => navigation.push([type, item]) });
  return { page, navigation, created };
}

test('changing types updates suggestions and keeps user choices for review', async () => {
  const { page } = setup();
  await page.onLoad({ kind: 'item' });
  page.preset(preset(0));
  assert.equal(page.data.choiceOptions.spec[1].value, 'NB');
  assert.equal(page.data.quickOptions.spec[3], 'L 码');
  page.input(event('spec', '家用大码'));
  page.input(event('packSize', '52'));
  page.preset(preset(1));
  assert.equal(page.data.choiceOptions.spec[1].value, '400 g');
  assert.equal(page.data.quickOptions.spec[0], '400 g');
  assert.equal(page.data.choiceOptions.spec.at(-1).label, '其他，自己填写');
  assert.equal(page.data.form.spec, '家用大码');
  assert.equal(page.data.form.packSize, '52');
  assert.equal(page.data.packReview, true);
  assert.equal(page.validateItem(), false);
  assert.match(page.data.fieldErrors.packSize, /核对/);
  page.input(event('packSize', '1'));
  page.input(event('openDays', '28'));
  assert.equal(page.validateItem(), true);
});

test('choosing a custom option accepts a handwritten value and a suggestion can replace it', async () => {
  const { page } = setup();
  await page.onLoad({ kind: 'item' });
  page.preset(preset(0));
  const customOption = page.data.choiceOptions.spec.length - 1;
  page.chooseField(event('spec', String(customOption)));
  assert.equal(page.data.manualFields.spec, true);
  page.input(event('spec', '加宽型'));
  assert.equal(page.data.form.spec, '加宽型');
  page.chooseQuickOption({ currentTarget: { dataset: { key: 'spec', value: 'L 码' } } });
  assert.equal(page.data.manualFields.spec, false);
  assert.equal(page.data.form.spec, 'L 码');
});

test('changing to another type with the same unit still requires confirming packaging', async () => {
  const { page } = setup();
  await page.onLoad({ kind: 'item' });
  page.preset(preset(0));
  page.input(event('packSize', '52'));
  page.preset(preset(4));
  assert.equal(page.data.form.unit, '片');
  assert.equal(page.data.form.packSize, '52');
  assert.equal(page.validateItem(), false);
  assert.match(page.data.fieldErrors.packSize, /核对/);
  page.confirmValue(event('packSize'));
  assert.equal(page.validateItem(), true);
});

test('a fractional packaging conversion needs confirmation after changing unit', async () => {
  const { page } = setup();
  await page.onLoad({ kind: 'item' });
  page.preset(preset(0));
  page.input(event('packSize', '0.5'));
  page.input(event('unit', '包'));
  assert.equal(page.data.packReview, true);
  assert.equal(page.validateItem(), false);
  assert.match(page.data.fieldErrors.packSize, /核对/);
});

test('new item returns its saved identity to the open intake page', async () => {
  const { page, navigation, created } = setup();
  await page.onLoad({ kind: 'item', fromIntake: '1' });
  page.preset(preset(1));
  page.input(event('openDays', '28'));
  await page.save();
  assert.deepEqual(navigation, [['itemCreated', created], 'back']);
});

test('a separately created item can continue directly to stock entry', async () => {
  const { page, navigation } = setup();
  await page.onLoad({ kind: 'item' });
  page.preset(preset(1));
  page.input(event('openDays', '28'));
  await page.save();
  assert.equal(page.data.createdItem.id, 'new id');
  page.continueToIntake({ currentTarget: { dataset: { source: 'initial' } } });
  assert.deepEqual(navigation, ['/pages/intake/intake?source=initial&itemId=new%20id']);
});
