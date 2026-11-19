const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const script = fs.readFileSync(require.resolve("../pages/items/items.js"), "utf8");
const template = fs.readFileSync(require.resolve("../pages/items/items.wxml"), "utf8");
const noFamily = { family: null, members: [], items: [] };
const admin = { id: "me", role: "admin" };
function household(id) {
  return {
    family: { id },
    currentMemberId: admin.id,
    members: [admin],
    items: [{ id: "item", name: "纸尿裤" }],
  };
}

function openPage(snapshot) {
  const calls = [];
  const navigation = [];
  const modals = [];
  let page;
  vm.runInNewContext(script, {
    Page(definition) {
      page = definition;
      page.setData = (values) => Object.assign(page.data, values);
    },
    require: () => ({
      api: async (action) => {
        calls.push(action);
        return snapshot();
      },
      requestId: () => "request",
      error: (e) => assert.fail(e.message),
    }),
    wx: {
      navigateTo: ({ url }) => navigation.push(url),
      switchTab: ({ url }) => navigation.push(url),
      showModal: (modal) => modals.push(modal),
    },
  });
  return { page, calls, navigation, modals };
}

test("items without a family only route to the family tab", async () => {
  const { page, navigation, modals } = openPage(() => noFamily);
  await page.load();
  const event = { currentTarget: { dataset: { id: "item", source: "initial" } }, detail: { value: ["item"] } };
  page.add();
  page.intake(event);
  page.detail(event);
  page.recordUse(event);
  page.select(event);
  page.bulk();
  assert.equal(navigation.length, 0);
  assert.equal(modals.length, 0);
  page.openFamily();
  assert.deepEqual(navigation, ["/pages/family/family"]);
  assert.match(template, /wx:elif="{{!family}}"/);
  assert.match(template, /bindtap="openFamily">创建或加入家庭/);
});

test("items fail closed during refresh and after a request error", async () => {
  let respond = () => household("first");
  const { page, navigation } = openPage(() => respond());
  await page.load();
  page.add();
  assert.equal(navigation.length, 1);
  let fail;
  respond = () => new Promise((_, reject) => { fail = reject; });
  const loading = page.load();
  page.add();
  assert.equal(navigation.length, 1);
  fail({ errMsg: "网络不可用" });
  await loading;
  page.add();
  assert.equal(navigation.length, 1);
  assert.equal(page.data.error, "网络不可用");
  respond = () => household("first");
  await page.load();
  page.add();
  assert.equal(navigation.length, 2);
});

test("a pending bulk confirmation cannot operate after the family changes", async () => {
  let current = household("first");
  const { page, calls, modals } = openPage(() => current);
  await page.load();
  page.select({ detail: { value: ["item"] } });
  page.bulk();
  assert.equal(modals.length, 1);
  current = household("second");
  await page.load();
  await modals[0].success({ confirm: true });
  assert.deepEqual(calls, ["snapshot", "snapshot"]);
  assert.equal(page.data.selected.length, 0);
});
