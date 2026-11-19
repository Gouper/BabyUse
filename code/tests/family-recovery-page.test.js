const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const family = { id: "old-family", name: "宝宝之家" };
const admin = { id: "me", role: "admin" };
const active = { family, currentMemberId: admin.id, members: [admin] };
const inactive = { family: null, members: [] };
const recoverable = {
  id: family.id,
  name: family.name,
  recoverUntil: Date.parse("2026-11-22T01:02:03Z"),
};

function openPage(respond) {
  const calls = [];
  const modals = [];
  let page;
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../pages/family/family.js"), "utf8"),
    {
      Page: (definition) => {
        page = definition;
        page.setData = (data) => Object.assign(page.data, data);
      },
      wx: { showModal: (modal) => modals.push(modal) },
      require: (module) =>
        module.endsWith("/api")
          ? {
              api: async (action, payload) => {
                calls.push({ action, payload });
                return respond(action);
              },
              error: (error) => assert.fail(error.message),
              requestId: () => "request",
            }
          : {},
    },
  );
  return { page, calls, modals };
}

test("sole member confirms closure of the displayed family", async () => {
  let snapshot = active;
  const { page, calls, modals } = openPage((action) => {
    if (action === "snapshot") return snapshot;
    if (action === "closeFamily") snapshot = inactive;
    if (action === "listRecoverableFamilies") return [recoverable];
  });
  await page.load();
  page.setData({ shareToken: "old-invitation" });
  page.leave();
  assert.match(modals[0].content, /72 小时.*原微信账号/);
  assert.equal(calls.length, 1);
  await modals[0].success({ confirm: true });
  assert.equal(calls[1].action, "closeFamily");
  assert.equal(calls[1].payload.familyId, family.id);
  assert.equal(page.data.family, null);
  assert.equal(page.data.shareToken, "");
});

test("leaving a family with other members uses the regular leave action", async () => {
  const { page, calls, modals } = openPage(() => ({
    ...active,
    members: [admin, { id: "other", role: "admin" }],
  }));
  await page.load();
  page.leave();
  assert.equal(modals[0].title, "退出家庭？");
  await modals[0].success({ confirm: true });
  assert.equal(calls[1].action, "leave");
  assert.equal(calls[1].payload.familyId, family.id);
});

test("a refreshed family hides an invitation that is now revoked", async () => {
  const { page } = openPage(() => ({
    ...active,
    invites: [{ token: "old-invitation", revoked: true }],
  }));
  page.setData({ family, shareToken: "old-invitation" });
  await page.load();
  assert.equal(page.data.shareToken, "");
});

test("no-family page lists the recovery deadline and restores by family ID", async () => {
  let snapshot = inactive;
  const { page, calls, modals } = openPage((action) => {
    if (action === "snapshot") return snapshot;
    if (action === "listRecoverableFamilies") return [recoverable];
    if (action === "restoreFamily") snapshot = active;
  });
  await page.load();
  assert.equal(page.data.recoverableFamilies[0].deadline, "2026-11-22 09:02:03");
  page.restore({ currentTarget: { dataset: { id: family.id } } });
  await modals[0].success({ confirm: false });
  assert.equal(calls.length, 2);
  page.restore({ currentTarget: { dataset: { id: family.id } } });
  await modals[1].success({ confirm: true });
  assert.equal(calls[2].action, "restoreFamily");
  assert.equal(calls[2].payload.familyId, family.id);
  assert.equal(page.data.family.id, family.id);
  assert.equal(page.data.recoverableFamilies.length, 0);
});
