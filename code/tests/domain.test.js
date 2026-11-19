const test = require("node:test");
const assert = require("node:assert/strict");
const { execute, empty } = require("../cloudfunctions/api/domain");
function setup() {
  let s = empty();
  let n = 0;
  const call = (action, p = {}, who = "a") =>
    execute(s, who, action, p, {
      now: "2026-11-19T04:00:00.000Z",
      id: () => String(++n),
    });
  call("createFamily", { name: "家", babyName: "宝宝" });
  call("createItem", {
    name: "尿裤",
    unit: "片",
    mode: "quantity",
    expiryMode: "none",
    lowStock: 10,
  });
  return { s, call };
}
test("FEFO and idempotent intake", () => {
  const { s, call } = setup();
  const p = {
    requestId: "x",
    rows: [{ itemId: "2", quantity: 100, expiry: "2027-01-01" }],
    source: "purchase",
  };
  call("intake", p);
  call("intake", p);
  call("use", { itemId: "2", quantity: 3, date: "2026-11-19" });
  assert.equal(call("snapshot").items[0].available, 97);
  assert.equal(s.batches.length, 1);
});
test("family isolation", () => {
  const { call } = setup();
  assert.throws(() => call("snapshot", {}, "outsider"), /家庭/);
});
test("count absorbs earlier backfill and undo", () => {
  const { call } = setup();
  call("intake", {
    requestId: "x",
    rows: [{ itemId: "2", quantity: 100 }],
    source: "initial",
  });
  call("count", {
    itemId: "2",
    quantity: 80,
    date: "2026-11-19",
    reason: "清点",
  });
  let r = call("use", { itemId: "2", quantity: 10, date: "2026-11-18" });
  assert.equal(call("snapshot").items[0].available, 80);
  call("undo", { recordId: r.id });
  assert.equal(call("snapshot").items[0].available, 80);
});
test("ordinary member cannot delete and last admin stays", () => {
  const { call } = setup();
  let invite = call("invite");
  call("join", { token: invite.token }, "b");
  assert.throws(() => call("deleteItems", { ids: ["2"] }, "b"), /管理员/);
  assert.throws(
    () => call("setRole", { memberId: "a", role: "member" }),
    /管理员/,
  );
});
test("expiry excludes available but retains expired stock and loss once", () => {
  const { s, call } = setup();
  s.items[0].expiryMode = "package";
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [{ itemId: "2", quantity: 100, expiry: "2026-11-18" }],
  });
  assert.equal(call("snapshot").items[0].available, 0);
  assert.equal(call("snapshot").items[0].batches[0].remaining, 100);
  call("loss", {
    itemId: "2",
    quantity: 100,
    reason: "过期",
    date: "2026-11-19",
  });
  assert.equal(call("snapshot").items[0].batches[0].remaining, 0);
});
test("invalid mutation is atomic and retried use is idempotent", () => {
  const { s, call } = setup();
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [{ itemId: "2", quantity: 20 }],
  });
  assert.throws(() => call("use", { itemId: "2", quantity: 30 }), /库存不足/);
  assert.equal(s.records.length, 1);
  call("use", { requestId: "u", itemId: "2", quantity: 2 });
  call("use", { requestId: "u", itemId: "2", quantity: 2 });
  assert.equal(call("snapshot").items[0].available, 18);
});
test("container open does not consume and loss excluded from sample", () => {
  const { s, call } = setup();
  s.items[0].mode = "container";
  call("intake", {
    requestId: "x",
    source: "purchase",
    rows: [{ itemId: "2", quantity: 3 }],
  });
  const c = call("open", { itemId: "2" });
  assert.equal(call("snapshot").items[0].unopened, 2);
  assert.equal(call("snapshot").items[0].using, 1);
  call("loss", { itemId: "2", containerId: c.id, reason: "丢弃" });
  assert.equal(call("snapshot").items[0].estimate.days, null);
  assert.equal(call("snapshot").items[0].available, 2);
});
test("same day count order and historical edit", () => {
  const { call } = setup();
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [{ itemId: "2", quantity: 100 }],
  });
  const r = call("use", { itemId: "2", quantity: 10 });
  call("count", { itemId: "2", quantity: 80, reason: "清点" });
  call("use", { itemId: "2", quantity: 5 });
  assert.equal(call("snapshot").items[0].available, 75);
  call("editUse", { recordId: r.id, quantity: 20, date: "2026-11-18" });
  assert.equal(call("snapshot").items[0].available, 75);
});
test("members cannot see invitation token", () => {
  const { call } = setup();
  const inv = call("invite");
  call("join", { token: inv.token }, "b");
  assert.deepEqual(call("snapshot", {}, "b").invites, []);
});
test("interval crossing count requires explicit split", () => {
  const { call } = setup();
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [{ itemId: "2", quantity: 100, date: "2026-11-16" }],
  });
  call("count", {
    itemId: "2",
    quantity: 80,
    date: "2026-11-18",
    reason: "清点",
  });
  assert.throws(
    () =>
      call("use", {
        itemId: "2",
        quantity: 10,
        date: "2026-11-17",
        endDate: "2026-11-19",
      }),
    /盘点/,
  );
});
test("container opened expiry affects only that container", () => {
  const { s, call } = setup();
  Object.assign(s.items[0], {
    mode: "container",
    expiryMode: "opened",
    openDays: 2,
  });
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [
      {
        itemId: "2",
        quantity: 3,
        openedAt: "2026-11-15",
        expiry: "2027-01-01",
      },
    ],
  });
  assert.equal(call("snapshot").items[0].available, 2);
});
test("container count after finish preserves counted unopened units", () => {
  const { s, call } = setup();
  s.items[0].mode = "container";
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [{ itemId: "2", quantity: 3 }],
  });
  const c = call("open", { itemId: "2" });
  call("finish", { containerId: c.id });
  call("count", { itemId: "2", quantity: 2, reason: "清点" });
  assert.equal(call("snapshot").items[0].unopened, 2);
});
test("expired unopened container can be discarded", () => {
  const { s, call } = setup();
  Object.assign(s.items[0], { mode: "container", expiryMode: "package" });
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [{ itemId: "2", quantity: 2, expiry: "2026-11-18" }],
  });
  call("loss", { itemId: "2", quantity: 2, reason: "过期" });
  assert.equal(call("snapshot").items[0].batches[0].remaining, 0);
});
test("container count preserves in-use containers separately", () => {
  const { s, call } = setup();
  s.items[0].mode = "container";
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [{ itemId: "2", quantity: 3 }],
  });
  call("open", { itemId: "2" });
  call("count", { itemId: "2", quantity: 4, reason: "清点未开封" });
  const item = call("snapshot").items[0];
  assert.equal(item.unopened, 4);
  assert.equal(item.using, 1);
  assert.equal(item.available, 4);
});
test("container default open uses earliest expiry", () => {
  const { s, call } = setup();
  Object.assign(s.items[0], { mode: "container", expiryMode: "package" });
  const batches = call("intake", {
    requestId: "x",
    source: "initial",
    rows: [
      { itemId: "2", quantity: 1, expiry: "2027-12-01" },
      { itemId: "2", quantity: 1, expiry: "2027-01-01" },
    ],
  });
  assert.equal(call("open", { itemId: "2" }).batchId, batches[1].id);
});
test("finished containers can be corrected and undone with audit history", () => {
  const { s, call } = setup();
  s.items[0].mode = "container";
  call("intake", {
    requestId: "x",
    source: "initial",
    rows: [{ itemId: "2", quantity: 1, date: "2026-11-15" }],
  });
  const c = call("open", { itemId: "2", date: "2026-11-15" });
  const r = call("finish", { containerId: c.id, date: "2026-11-18" });
  const corrected = call("edit", { recordId: r.id, date: "2026-11-19" });
  assert.equal(s.containers[0].endedAt, "2026-11-19");
  assert.equal(s.records.find((x) => x.id === r.id).voided, true);
  call("undo", { recordId: corrected.id });
  assert.equal(call("snapshot").items[0].using, 1);
});
