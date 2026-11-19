const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const domain = require("../cloudfunctions/api/domain");
function harness(env = {}) {
  const rows = new Map();
  let actor = "a",
    tail = Promise.resolve(),
    sends = 0;
  const ref = (c, id) => ({
    get: async () => {
      const value = rows.get(c + "/" + id);
      if (!value) throw Error("document not exist");
      return { data: JSON.parse(JSON.stringify(value)) };
    },
    set: async ({ data }) =>
      rows.set(c + "/" + id, { ...JSON.parse(JSON.stringify(data)), _id: id }),
    remove: async () => rows.delete(c + "/" + id),
  });
  const query = (c, n = 0, lim = 100) => ({
    doc: (id) => ref(c, id),
    skip: (next) => query(c, next, lim),
    limit: (next) => query(c, n, next),
    get: async () => ({
      data: [...rows.entries()]
        .filter(([k]) => k.startsWith(c + "/"))
        .slice(n, n + lim)
        .map(([, v]) => v),
    }),
  });
  const db = {
    collection: (c) => query(c),
    runTransaction: (fn) => {
      const result = tail.then(() => fn(db));
      tail = result.catch(() => {});
      return result;
    },
  };
  const cloud = {
    DYNAMIC_CURRENT_ENV: "test",
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: actor }),
    openapi: {
      subscribeMessage: {
        send: async () => {
          sends++;
          if (env.failSend) throw Error("denied");
        },
      },
    },
  };
  const exports = {};
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../cloudfunctions/api/index"), "utf8"),
    {
      require: (n) =>
        n === "wx-server-sdk" ? cloud : n === "./domain" ? domain : require(n),
      exports,
      process: { env },
      console,
    },
  );
  return {
    call: (action, payload = {}) => exports.main({ action, payload }),
    invoke: (e) => exports.main(e),
    actor: (v) => {
      actor = v;
    },
    rows,
    get sends() {
      return sends;
    },
  };
}
test("adapter uses OPENID and refuses client timer entry", async () => {
  const h = harness();
  await h.call("createFamily", { name: "家" });
  assert.equal(
    (
      await h.call("createItem", {
        name: "裤",
        unit: "片",
        mode: "quantity",
        expiryMode: "none",
        actor: "admin",
      })
    ).ok,
    true,
  );
  h.actor("b");
  assert.equal(
    (await h.call("deleteItems", { actor: "a", ids: [] })).ok,
    false,
  );
  assert.equal((await h.invoke({ Type: "Timer" })).ok, false);
  assert.equal((await h.call("scheduledCheck")).ok, false);
});
test("adapter idempotency remains consistent under concurrent retry", async () => {
  const h = harness();
  await h.call("createFamily");
  const item = (
    await h.call("createItem", {
      name: "裤",
      unit: "片",
      mode: "quantity",
      expiryMode: "none",
    })
  ).data;
  const intake = {
    requestId: "buy",
    source: "purchase",
    rows: [{ itemId: item.id, quantity: 20 }],
  };
  await Promise.all([h.call("intake", intake), h.call("intake", intake)]);
  await Promise.all([
    h.call("use", { requestId: "use", itemId: item.id, quantity: 2 }),
    h.call("use", { requestId: "use", itemId: item.id, quantity: 2 }),
  ]);
  assert.equal((await h.call("snapshot")).data.items[0].available, 18);
});
test("removed member cannot use a stale family route", async () => {
  const h = harness();
  await h.call("createFamily");
  const inv = (await h.call("invite")).data;
  h.actor("b");
  await h.call("join", { token: inv.token });
  h.actor("a");
  await h.call("removeMember", { memberId: "b" });
  h.actor("b");
  assert.equal((await h.call("use", { itemId: "x", quantity: 1 })).ok, false);
  assert.equal((await h.call("snapshot")).data.family, null);
});
async function withAlert(env) {
  const h = harness(env);
  await h.call("createFamily");
  await h.call("createItem", {
    name: "裤",
    unit: "片",
    mode: "quantity",
    expiryMode: "none",
    lowStock: 10,
  });
  await h.call("subscribe", { accepted: true });
  h.actor(undefined);
  return h;
}
test("scheduler missing template retains subscription", async () => {
  const h = await withAlert({});
  const r = await h.invoke({ Type: "Timer" });
  assert.equal(r.data.status, "blocked");
  const family = [...h.rows.entries()].find(([k]) =>
    k.startsWith("baby_families/"),
  )[1];
  assert.equal(family.state.members[0].subscribed, true);
  assert.equal(h.sends, 0);
});
test("scheduler records successful delivery once per alert level", async () => {
  const h = await withAlert({ SUBSCRIBE_TEMPLATE_ID: "t" });
  assert.equal((await h.invoke({ Type: "Timer" })).data.sent, 1);
  assert.equal((await h.invoke({ Type: "Timer" })).data.sent, 0);
  assert.equal(h.sends, 1);
  const family = [...h.rows.entries()].find(([k]) =>
    k.startsWith("baby_families/"),
  )[1];
  assert.equal(family.state.notifications[0].status, "sent");
});
test("scheduler records failure without pretending success", async () => {
  const h = await withAlert({ SUBSCRIBE_TEMPLATE_ID: "t", failSend: true });
  assert.equal((await h.invoke({ Type: "Timer" })).data.sent, 0);
  const family = [...h.rows.entries()].find(([k]) =>
    k.startsWith("baby_families/"),
  )[1];
  assert.equal(family.state.notifications[0].status, "failed");
});
