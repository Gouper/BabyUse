const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const domain = require("../cloudfunctions/api/domain");
function harness(env = {}) {
  const rows = new Map();
  let now = Date.now();
  const Clock = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  };
  let actor = "a",
    tail = Promise.resolve(),
    sends = 0;
  const ref = (c, id) => ({
    get: async () => {
      const value = rows.get(c + "/" + id);
      if (!value) throw Error("document not exist");
      return { data: JSON.parse(JSON.stringify(value)) };
    },
    set: async ({ data }) => {
      if (env.beforeSet) await env.beforeSet(c, data);
      rows.set(c + "/" + id, { ...JSON.parse(JSON.stringify(data)), _id: id });
    },
    remove: async () => rows.delete(c + "/" + id),
  });
  const query = (c, n = 0, lim = 100, filters = {}) => {
    const matches = ([k, v]) =>
      k.startsWith(c + "/") &&
      Object.entries(filters).every(([field, value]) => {
        if (value?.gt !== undefined) return v[field] > value.gt;
        if (value?.lte !== undefined) return v[field] <= value.lte;
        return v[field] === value;
      });
    return {
      doc: (id) => ref(c, id),
      where: (next) => query(c, n, lim, next),
      field: () => query(c, n, lim, filters),
      skip: (next) => query(c, next, lim, filters),
      limit: (next) => query(c, n, next, filters),
      get: async () => ({
        data: [...rows.entries()]
          .filter(matches)
          .slice(n, n + lim)
          .map(([, v]) => v),
      }),
      remove: async () => {
        if (env.beforeQueryRemove) await env.beforeQueryRemove(c);
        for (const row of rows) if (matches(row)) rows.delete(row[0]);
      },
    };
  };
  const db = {
    command: { gt: (gt) => ({ gt }), lte: (lte) => ({ lte }) },
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
      Date: Clock,
    },
  );
  return {
    call: (action, payload = {}) => exports.main({ action, payload }),
    invoke: (e) => exports.main(e),
    actor: (v) => {
      actor = v;
    },
    rows,
    advance: (milliseconds) => {
      now += milliseconds;
    },
    now: () => now,
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
test("sole member closes and recovers inventory with the original WeChat identity", async () => {
  const h = harness();
  const { id: familyId } = (await h.call("createFamily", { name: "家" })).data;
  const item = (await h.call("createItem", {
    name: "纸尿裤", unit: "片", mode: "quantity", expiryMode: "none",
  })).data;
  await h.call("intake", {
    requestId: "buy",
    source: "purchase",
    rows: [{ itemId: item.id, quantity: 20 }],
  });
  const invite = (await h.call("invite")).data;
  const join = { token: invite.token, requestId: "join" };
  h.actor("b");
  assert.equal((await h.call("join", join)).ok, true);
  h.actor("a");
  assert.equal((await h.call("removeMember", { memberId: "b" })).ok, true);
  await h.call("subscribe", { accepted: true });
  const original = (await h.call("snapshot")).data;
  const close = { familyId, requestId: "close" };
  const restore = { familyId, requestId: "restore" };
  assert.equal((await h.call("closeFamily", close)).ok, true);
  assert.equal((await h.call("closeFamily", close)).ok, true);
  assert.equal((await h.call("snapshot")).data.family, null);
  h.actor("b");
  assert.equal((await h.call("join", join)).ok, false);
  assert.equal((await h.call("listRecoverableFamilies", { actor: "a" })).data.length, 0);
  assert.equal((await h.call("restoreFamily", { ...restore, actor: "a" })).ok, false);
  h.actor("a");
  const [recoverable] = (await h.call("listRecoverableFamilies")).data;
  assert.equal(recoverable.id, familyId);
  assert.equal(recoverable.name, "家");
  assert.equal(recoverable.recoverUntil, h.now() + 72 * 60 * 60 * 1000);
  assert.equal((await h.call("restoreFamily", restore)).ok, true);
  assert.equal((await h.call("restoreFamily", restore)).ok, true);
  assert.equal((await h.call("closeFamily", close)).ok, true);
  const restored = (await h.call("snapshot")).data;
  assert.equal(restored.family.id, familyId);
  assert.equal(restored.members[0].role, "admin");
  assert.equal(restored.members[0].subscribed, false);
  assert.deepEqual(restored.items, original.items);
  assert.deepEqual(restored.records, original.records);
  assert.equal((await h.call("listRecoverableFamilies")).data.length, 0);
  h.actor("b");
  assert.equal((await h.call("join", join)).ok, false);
  assert.equal((await h.call("snapshot")).data.family, null);
});
test("restoring requires an empty route and a fresh close requires the displayed household", async () => {
  const h = harness();
  const { id: familyId } = (await h.call("createFamily")).data;
  await h.call("closeFamily", { familyId });
  const { id: secondId } = (await h.call("createFamily")).data;
  assert.equal((await h.call("restoreFamily", { familyId })).ok, false);
  assert.equal((await h.call("leave", { familyId })).ok, false);
  assert.equal((await h.call("closeFamily", { familyId })).ok, false);
  assert.equal((await h.call("snapshot")).data.family.id, secondId);
  assert.equal((await h.call("closeFamily", { familyId: secondId })).ok, true);
  assert.equal((await h.call("listRecoverableFamilies")).data.length, 2);
});
test("a member joining first prevents an already-confirmed closure", async () => {
  const h = harness();
  const { id: familyId } = (await h.call("createFamily")).data;
  const { token } = (await h.call("invite")).data;
  h.actor("b");
  const joining = h.call("join", { token });
  await joining;
  h.actor("a");
  assert.equal((await h.call("closeFamily", { familyId })).ok, false);
  assert.equal((await h.call("leave", { familyId })).ok, false);
  assert.equal((await h.call("snapshot")).data.members.length, 2);
});
test("closing first prevents an overlapping join with a stale invitation", async () => {
  const h = harness();
  const { id: familyId } = (await h.call("createFamily")).data;
  const { token } = (await h.call("invite")).data;
  const closing = h.call("closeFamily", { familyId });
  h.actor("b");
  const joining = h.call("join", { token });
  const [closed, joined] = await Promise.all([closing, joining]);
  assert.equal(closed.ok, true);
  assert.equal(joined.ok, false);
  assert.equal((await h.call("snapshot")).data.family, null);
});
test("recovery expires at 72 hours and its timer cleans up without a reminder template", async () => {
  const h = harness();
  const { id: familyId } = (await h.call("createFamily")).data;
  await h.call("invite");
  const cleanup = { Type: "Timer", TriggerName: "family-recovery-cleanup" };
  assert.equal((await h.invoke(cleanup)).ok, false);
  assert.equal((await h.call("closeFamily", { familyId })).ok, true);
  h.advance(72 * 60 * 60 * 1000 - 1);
  assert.equal((await h.call("listRecoverableFamilies")).data.length, 1);
  h.actor(undefined);
  assert.equal((await h.invoke(cleanup)).data.removed, 0);
  h.advance(1);
  h.actor("a");
  assert.equal((await h.call("listRecoverableFamilies")).data.length, 0);
  assert.equal((await h.call("restoreFamily", { familyId })).ok, false);
  h.actor(undefined);
  assert.equal((await h.invoke(cleanup)).data.removed, 1);
  assert.equal(h.rows.has("baby_families/" + familyId), false);
  assert.equal([...h.rows.keys()].some((k) => k.startsWith("baby_invites/")), false);
  assert.equal((await h.invoke(cleanup)).data.removed, 0);
});
test("cleanup cannot erase a restoration already validated before expiry", async () => {
  const env = {};
  const h = harness(env);
  const { id: familyId } = (await h.call("createFamily")).data;
  await h.call("closeFamily", { familyId });
  h.advance(72 * 60 * 60 * 1000 - 1);
  let accepted;
  const ready = new Promise((resolve) => { accepted = resolve; });
  let commit;
  const pending = new Promise((resolve) => { commit = resolve; });
  env.beforeSet = async (collection, data) => {
    if (collection === "baby_families" && data.state) {
      accepted();
      await pending;
    }
  };
  const restore = h.call("restoreFamily", { familyId });
  await ready;
  h.advance(1);
  h.actor(undefined);
  const cleanup = h.invoke({ Type: "Timer", TriggerName: "family-recovery-cleanup" });
  await new Promise(setImmediate);
  commit();
  const [restored, cleaned] = await Promise.all([restore, cleanup]);
  assert.equal(restored.ok, true);
  assert.equal(cleaned.data.removed, 0);
  h.actor("a");
  assert.equal((await h.call("snapshot")).data.family.id, familyId);
});
test("expiry cleanup resumes if invitation lookup removal fails", async () => {
  const env = {};
  const h = harness(env);
  const { id: familyId } = (await h.call("createFamily")).data;
  await h.call("invite");
  await h.call("closeFamily", { familyId });
  h.advance(72 * 60 * 60 * 1000);
  const cleanup = { Type: "Timer", TriggerName: "family-recovery-cleanup" };
  env.beforeQueryRemove = () => { throw Error("temporarily unavailable"); };
  h.actor(undefined);
  assert.equal((await h.invoke(cleanup)).ok, false);
  assert.equal(h.rows.get("baby_families/" + familyId).state, undefined);
  delete env.beforeQueryRemove;
  assert.equal((await h.invoke(cleanup)).data.removed, 1);
  assert.equal(h.rows.size, 0);
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
