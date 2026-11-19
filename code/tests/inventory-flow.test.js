const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const domain = require("../cloudfunctions/api/domain");
const chart = require("../pages/trends/chart");

const root = join(__dirname, "..");
const input = (value, dataset = {}) => ({
  detail: { value },
  currentTarget: { dataset },
});

// Run real page handlers and the client API against one in-memory family.
function miniProgram() {
  const state = domain.empty();
  const storage = new Map();
  const notices = [];
  const modalAnswers = [];
  const lines = [];
  let path;
  const ctx = {
    scale() {},
    clearRect() { lines.length = 0; },
    fillText() {},
    fill() {},
    arc() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    stroke() { lines.push(path); },
  };
  const selector = {
    in() { return this; },
    select() { return this; },
    fields() { return this; },
    exec(callback) {
      callback([{ node: { getContext: () => ctx }, width: 360, height: 240 }]);
    },
  };
  let ms = Date.parse("2026-11-19T04:00:00Z");
  let id = 0;
  let route;
  const DateAtTestTime = class extends Date {
    static now() {
      return ms;
    }
  };
  const wx = {
    createSelectorQuery: () => selector,
    getWindowInfo: () => ({ pixelRatio: 1 }),
    cloud: {
      async callFunction({ name, data }) {
        assert.equal(name, "api");
        try {
          const reply = domain.execute(state, "parent", data.action, data.payload, {
            now: new Date(ms).toISOString(),
            id: () => String(++id),
          });
          return { result: { ok: true, data: structuredClone(reply) } };
        } catch (error) {
          return { result: { ok: false, error: error.message } };
        }
      },
    },
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    showToast: ({ title }) => notices.push(title),
    showModal({ title, content, success }) {
      const answer = modalAnswers.shift();
      assert.ok(answer, content);
      assert.equal(title, answer.title);
      return success({ confirm: answer.confirm });
    },
    navigateBack: () => {},
    navigateTo: ({ url }) => { route = url; },
  };
  const module = { exports: {} };
  runInNewContext(readFileSync(join(root, "utils/api.js"), "utf8"), {
    module, wx, Date: DateAtTestTime,
    require: () => ({ envId: "local-test" }),
  });
  const api = module.exports;

  function page(name) {
    let instance;
    runInNewContext(readFileSync(join(root, name + ".js"), "utf8"), {
      wx,
      Page: (definition) => { instance = definition; },
      require: (path) => path.endsWith('/api') ? api : path === "./chart" ? chart : require('node:module').createRequire(join(root, name + '.js'))(path),
    });
    instance.setData = function (patch, done) {
      for (const [key, value] of Object.entries(patch)) {
        const path = key.replace(/\[(\d+)\]/g, ".$1").split(".");
        const field = path.pop();
        const target = path.reduce((value, part) => value[part], this.data);
        target[field] = value;
      }
      done?.();
    };
    return instance;
  }

  return {
    page: (name) => page("pages/" + name + "/" + name),
    api: api.api,
    notices,
    answerModal: (title, confirm) => modalAnswers.push({ title, confirm }),
    lines,
    advanceTo: (date) => { ms = Date.parse(date + "T04:00:00Z"); },
    async follow() {
      assert.ok(route, "页面操作应打开下一页");
      const url = new URL(route, "https://mini-program.test");
      route = null;
      const target = page(url.pathname.slice(1));
      await target.onLoad?.(Object.fromEntries(url.searchParams));
      return target;
    },
  };
}

async function setup() {
  const app = miniProgram();
  await app.api("createFamily", { name: "测试家庭" });
  return { app, home: app.page("index"), items: app.page("items") };
}

async function addItem(app, items, fields, expiryIndex = 0, modeIndex = 0) {
  items.add();
  const editor = await app.follow();
  editor.mode(input(modeIndex));
  editor.expiry(input(expiryIndex));
  for (const [key, value] of Object.entries(fields)) editor.input(input(value, { key }));
  await editor.save();
  assert.equal(app.notices.at(-1), "已保存");
  await items.load();
  const item = items.data.visible.find((item) => item.name === fields.name);
  assert.ok(item);
  assert.equal(item.available, 0);
  assert.equal(item.batches.length, 0);
  return item;
}

async function prepareIntake(app, date, rows) {
  const form = await app.follow();
  form.date(input(date));
  for (const [n, row] of rows.entries()) {
    form.add({ detail: { id: row.itemId } });
    form.change(input(row.quantity, { n, key: "quantity" }));
    if (row.expiry) form.change(input(row.expiry, { n, key: "expiry" }));
  }
  form.preview();
  assert.equal(form.data.preview, true);
  return form;
}

async function intake(app, date, rows) {
  const form = await prepareIntake(app, date, rows);
  await form.save();
  assert.equal(form.saved, true);
}

async function use(app, home, item, date, quantity) {
  home.recordUse(input(undefined, { id: item.id }));
  const form = await app.follow();
  form.input(input(date, { key: "date" }));
  form.input(input(quantity, { key: "quantity" }));
  await form.save();
  assert.equal(form.saved, true);
}

function points(trend, mode) {
  trend.mode(input(undefined, { mode }));
  return Array.from(trend.data.points, ({ date, value }) => [date, value]);
}

function records(page) {
  return Array.from(page.data.records, ({ date, type, quantity }) => [date, type, quantity]);
}

test("历史期初库存、补记每日消耗和新购入库同步到余量、流水及三种趋势", async () => {
  const { app, home, items } = await setup();
  const item = await addItem(app, items, { name: "尿不湿", unit: "片", packSize: "50" });
  items.intake(input(undefined, { source: "initial" }));
  await intake(app, "2026-11-13", [{ itemId: item.id, quantity: "2" }]);

  await use(app, home, item, "2026-11-14", "6");
  await use(app, home, item, "2026-11-17", "5");
  await use(app, home, item, "2026-11-15", "7");
  await home.load();
  assert.equal(home.data.supplies[0].available, 82);
  assert.equal(home.data.supplies[0].estimate, "约 13.7 天");

  home.intake();
  await intake(app, "2026-11-19", [{ itemId: item.id, quantity: "1" }]);
  await home.load();
  assert.equal(home.data.supplies[0].available, 132);

  home.records();
  const ledger = await app.follow();
  await ledger.load();
  assert.deepEqual(records(ledger), [
    ["2026-11-19", "purchase", 50],
    ["2026-11-15", "use", 7],
    ["2026-11-17", "use", 5],
    ["2026-11-14", "use", 6],
    ["2026-11-13", "initial", 100],
  ]);

  home.trends();
  const trend = await app.follow();
  assert.equal(trend.data.unit, "片");
  assert.deepEqual(points(trend, 0), [
    ["2026-11-13", 100], ["2026-11-14", 94], ["2026-11-15", 87],
    ["2026-11-17", 82], ["2026-11-19", 132],
  ]);
  assert.deepEqual(points(trend, 1), [
    ["2026-11-14", 6], ["2026-11-15", 7], ["2026-11-17", 5],
  ]);
  const [[x1, y1], [x2, y2], [x3, y3]] = app.lines.at(-1);
  assert.equal(app.lines.at(-1).length, 3);
  assert.equal(x3 - x2, 2 * (x2 - x1));
  assert.ok(y2 < y1 && y3 > y1, "更大的用量应画在更高的位置");
  assert.deepEqual(points(trend, 2), [["2026-11-19", 50]]);

  trend.setData({ from: "2026-11-15", to: "2026-11-17" });
  await trend.load();
  assert.deepEqual(points(trend, 0), [["2026-11-15", 87], ["2026-11-17", 82]]);
  assert.deepEqual(points(trend, 2), []);
});

test("历史消耗更正后再撤销，首页余量、趋势和审计流水同步更新", async () => {
  const { app, home, items } = await setup();
  const item = await addItem(app, items, { name: "纸尿裤", unit: "片" });
  items.intake(input(undefined, { source: "initial" }));
  await intake(app, "2026-11-16", [{ itemId: item.id, quantity: "30" }]);
  await use(app, home, item, "2026-11-17", "8");
  await home.load();
  assert.equal(home.data.supplies[0].available, 22);

  home.records();
  const ledger = await app.follow();
  await ledger.load();
  const original = ledger.data.records.find((r) => r.type === "use");
  ledger.edit(input(undefined, { id: original.id, item: item.id, type: original.type }));
  const edit = await app.follow();
  edit.input(input("5", { key: "quantity" }));
  edit.input(input("2026-11-18", { key: "date" }));
  await edit.save();
  assert.equal(edit.saved, true);

  await home.load();
  assert.equal(home.data.supplies[0].available, 25);
  home.trends();
  const trend = await app.follow();
  assert.deepEqual(points(trend, 1), [["2026-11-18", 5]]);
  assert.deepEqual(points(trend, 0).map(([, quantity]) => quantity), [30, 25]);
  await ledger.load();
  const corrected = ledger.data.records.find((r) => r.type === "use" && !r.voided);
  assert.equal(corrected.relatedId, original.id);
  assert.equal(ledger.data.records.find((r) => r.id === original.id).voided, true);

  app.answerModal("撤销这条记录？", true);
  await ledger.undo(input(undefined, { id: corrected.id }));
  await ledger.load();
  assert.equal(ledger.data.records.find((r) => r.id === corrected.id).voided, true);
  assert.equal(ledger.data.records.find((r) => r.type === "undo").relatedId, corrected.id);
  await home.load();
  assert.equal(home.data.supplies[0].available, 30);
  await trend.load();
  assert.deepEqual(points(trend, 1), []);
  assert.deepEqual(points(trend, 0), [["2026-11-16", 30]]);
});

test("新购入库连续点保存只记一笔，相同内容提示后可取消或确认另一笔", async () => {
  const { app, home, items } = await setup();
  const item = await addItem(app, items, { name: "棉柔巾", unit: "张", packSize: "20" });
  const date = "2026-11-19";
  const rows = [{ itemId: item.id, quantity: "2" }];
  home.intake();
  const form = await prepareIntake(app, date, rows);
  await Promise.all([form.save(), form.save()]);
  assert.equal(form.saved, true);

  home.intake();
  const same = await prepareIntake(app, date, rows);
  app.answerModal("可能重复入库", false);
  await same.save();
  assert.equal(same.saved, undefined);
  await home.load();
  assert.equal(home.data.supplies[0].available, 40);
  home.trends();
  const trend = await app.follow();
  assert.deepEqual(points(trend, 2), [[date, 40]]);

  app.answerModal("可能重复入库", true);
  await same.save();
  assert.equal(same.saved, true);
  await home.load();
  assert.equal(home.data.supplies[0].available, 80);
  await trend.load();
  assert.deepEqual(points(trend, 2), [[date, 40], [date, 40]]);
});

test("补记历史实点库存后，后来补录盘点前的消耗不会二次扣库存", async () => {
  const { app, home, items } = await setup();
  const item = await addItem(app, items, { name: "棉柔巾", unit: "张" });
  items.intake(input(undefined, { source: "initial" }));
  await intake(app, "2026-11-13", [{ itemId: item.id, quantity: "30" }]);

  home.historicalCount();
  const count = await app.follow();
  count.selectItem({ detail: { id: item.id } });
  count.input(input("2026-11-15", { key: "date" }));
  count.input(input("20", { key: "quantity" }));
  await count.save();
  assert.equal(count.saved, true);
  await use(app, home, item, "2026-11-17", "4");
  await use(app, home, item, "2026-11-14", "6");
  await home.load();
  assert.equal(home.data.supplies[0].available, 16);

  home.trends();
  const trend = await app.follow();
  assert.deepEqual(points(trend, 0), [
    ["2026-11-13", 30], ["2026-11-14", 24], ["2026-11-15", 20], ["2026-11-17", 16],
  ]);
  assert.deepEqual(points(trend, 1), [["2026-11-14", 6], ["2026-11-17", 4]]);
});

test("包装有效期从采购批次进入首页提醒，过期报损不再影响可用量或正常消耗", async () => {
  const { app, home, items } = await setup();
  const item = await addItem(app, items, {
    name: "护肤用品", unit: "包", expiryWarningDays: "2",
  }, 1);
  home.intake();
  await intake(app, "2026-11-19", [
    { itemId: item.id, quantity: "4", expiry: "2026-11-30" },
    { itemId: item.id, quantity: "3", expiry: "2026-11-20" },
  ]);
  await use(app, home, item, "2026-11-19", "1");
  items.detail(input(undefined, { id: item.id }));
  const detail = await app.follow();
  await detail.load();
  assert.equal(detail.data.item.available, 6);
  const near = detail.data.batches.find((b) => b.expiry === "2026-11-20");
  assert.equal(near.remaining, 2);
  await home.load();
  assert.ok(home.data.alerts.some((alert) => alert.type === "expiry" && alert.batchId === near.id));

  app.advanceTo("2026-11-20");
  await home.load();
  assert.equal(home.data.supplies[0].available, 6);
  app.advanceTo("2026-11-21");
  await home.load();
  assert.equal(home.data.supplies[0].available, 4);
  assert.ok(home.data.alerts.some((alert) => alert.type === "expired" && alert.batchId === near.id));
  home.trends();
  const beforeLoss = await app.follow();
  points(beforeLoss, 0);
  assert.equal(beforeLoss.data.lastPoint.value, 6);

  detail.record(input(undefined, { kind: "loss", batch: near.id }));
  const loss = await app.follow();
  loss.input(input("2", { key: "quantity" }));
  loss.input(input("过期丢弃", { key: "reason" }));
  await loss.save();
  assert.equal(loss.saved, true);
  await home.load();
  assert.equal(home.data.supplies[0].available, 4);
  assert.equal(home.data.alerts.some((alert) => alert.batchId === near.id), false);

  home.trends();
  const trend = await app.follow();
  points(trend, 0);
  assert.equal(trend.data.lastPoint.value, 4);
  assert.ok(trend.data.rows.some((r) => r.type === "loss" && r.quantity === 2));
  assert.deepEqual(points(trend, 1), [["2026-11-19", 1]]);
  assert.ok(trend.data.rows.every((r) => r.type === "use"));
  assert.deepEqual(points(trend, 2), [["2026-11-19", 4], ["2026-11-19", 3]]);
  assert.ok(trend.data.rows.every((r) => r.type === "purchase"));
});

test("按开封管理的用品分别记录开封与用完，首页采用较早的到期日期", async () => {
  const { app, home, items } = await setup();
  const item = await addItem(app, items, {
    name: "抚触油", unit: "瓶", openDays: "3", openWarningDays: "1",
  }, 2, 1);
  home.intake();
  await intake(app, "2026-11-19", [
    { itemId: item.id, quantity: "1", expiry: "2026-11-30" },
    { itemId: item.id, quantity: "1", expiry: "2026-11-21" },
  ]);

  await use(app, home, item, "2026-11-19");
  items.detail(input(undefined, { id: item.id }));
  const detail = await app.follow();
  await detail.load();
  assert.equal(detail.data.item.unopened, 1);
  assert.equal(detail.data.item.using, 1);
  const [container] = detail.data.containers;
  assert.equal(detail.data.batches.find((b) => b.id === container.batchId).expiry, "2026-11-21");

  app.advanceTo("2026-11-20");
  await home.load();
  assert.ok(home.data.alerts.some((a) => a.type === "opened" && a.containerId === container.id));
  home.trends();
  const beforeFinish = await app.follow();
  assert.deepEqual(points(beforeFinish, 1), []);

  home.recordUse(input(undefined, { id: item.id }));
  const form = await app.follow();
  form.selectUsageAction(input("1"));
  assert.equal(form.data.activeContainers[0].id, container.id);
  await form.save();
  assert.equal(form.saved, true);
  await detail.load();
  assert.equal(detail.data.item.unopened, 1);
  assert.equal(detail.data.item.using, 0);

  await home.load();
  assert.equal(home.data.alerts.some((a) => a.containerId === container.id), false);
  home.trends();
  const trend = await app.follow();
  assert.deepEqual(points(trend, 1), [["2026-11-20", 1]]);
  assert.deepEqual(points(trend, 0).map(([, value]) => value), [1, 2, 1, 1]);
});

test("晚补上一天的整理清单不会累加到首页余量或趋势", async () => {
  const { app, home, items } = await setup();
  const item = await addItem(app, items, { name: "纸尿裤", unit: "片" });
  items.intake(input(undefined, { source: "initial" }));
  await intake(app, "2026-11-19", [{ itemId: item.id, quantity: "70" }]);
  await use(app, home, item, "2026-11-19", "7");
  items.intake(input(undefined, { source: "initial" }));
  await intake(app, "2026-11-18", [{ itemId: item.id, quantity: "77" }]);

  await home.load();
  assert.equal(home.data.supplies[0].available, 63);
  home.trends();
  const trend = await app.follow();
  assert.deepEqual(points(trend, 0), [
    ["2026-11-18", 77],
    ["2026-11-19", 70],
    ["2026-11-19", 63],
  ]);
});

test("补记昨天用量只倒推昨天的余量，今天实点库存保持不变", async () => {
  const { app, home, items } = await setup();
  const item = await addItem(app, items, { name: "纸尿裤", unit: "片" });
  items.intake(input(undefined, { source: "initial" }));
  await intake(app, "2026-11-19", [{ itemId: item.id, quantity: "70" }]);
  await use(app, home, item, "2026-11-18", "7");
  await home.load();
  assert.equal(home.data.supplies[0].available, 70);

  home.trends();
  const trend = await app.follow();
  assert.deepEqual(points(trend, 0), [["2026-11-18", 77], ["2026-11-19", 70]]);
  assert.equal(trend.data.inferredPoints[0].value, 77);
  assert.deepEqual(points(trend, 1), [["2026-11-18", 7]]);

  trend.setData({ to: "2026-11-18" });
  await trend.load();
  assert.deepEqual(points(trend, 0), [["2026-11-18", 77]]);
  assert.equal(trend.data.rows.length, 1);
  assert.equal(trend.data.rows[0].type, "use");
});
