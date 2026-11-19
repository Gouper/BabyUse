const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const family = { id: "old-family", name: "宝宝之家" };
const admin = { id: "me", role: "admin" };
const active = { family, currentMemberId: admin.id, members: [admin], invites: [] };
const inactive = { family: null, members: [] };
const recoverable = {
  id: family.id,
  name: family.name,
  recoverUntil: Date.parse("2026-11-22T01:02:03Z"),
};
const testNow = Date.parse("2026-11-19T12:00:00Z");

function openPage(respond) {
  const calls = [];
  const modals = [];
  const clipboard = [];
  let now = testNow;
  let page;
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../pages/family/family.js"), "utf8"),
    {
      Page: (definition) => {
        page = definition;
        page.setData = (data) => Object.assign(page.data, data);
      },
      wx: {
        showModal: (modal) => modals.push(modal),
        setClipboardData: ({ data }) => clipboard.push(data),
      },
      Date: class extends Date {
        static now() { return now; }
      },
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
  return { page, calls, modals, clipboard, setNow: (value) => { now = value; } };
}

const invitation = {
  id: "invite",
  token: "abcde123-4567-8901-2345-678901234567",
  expiresAt: new Date(testNow + 86400000).toISOString(),
};

function invitationEvent(id) {
  return { currentTarget: { dataset: { id, token: "untrusted-token" } } };
}

test("a new invitation can be copied before the follow-up snapshot returns", async () => {
  let finishSnapshot;
  let startSnapshot;
  const snapshotStarted = new Promise((resolve) => { startSnapshot = resolve; });
  const refresh = new Promise((resolve) => { finishSnapshot = resolve; });
  let initial = true;
  const { page, clipboard } = openPage((action) => {
    if (action === "invite") return invitation;
    if (initial) return active;
    startSnapshot();
    return refresh;
  });
  await page.load();
  initial = false;
  const generating = page.invite();
  await snapshotStarted;
  page.copyInvite(invitationEvent(invitation.id));
  assert.deepEqual(clipboard, [invitation.token]);
  finishSnapshot({ ...active, invites: [invitation] });
  await generating;
  assert.equal(page.data.invites.length, 1);
  assert.match(page.onShareAppMessage().path, new RegExp(invitation.token));
});

test("reopening the family lists saved codes and ignores revoked, expired and unauthorized copy requests", async () => {
  const revoked = { ...invitation, id: "revoked", revoked: true };
  const expired = { ...invitation, id: "expired", expiresAt: "2000-01-01T00:00:00.000Z" };
  let snapshot = { ...active, invites: [invitation, revoked, expired] };
  const { page, clipboard } = openPage(() => snapshot);
  await page.load();
  assert.deepEqual(Array.from(page.data.invites, (item) => item.available), [true, false, false]);
  for (const item of snapshot.invites) page.copyInvite(invitationEvent(item.id));
  assert.deepEqual(clipboard, [invitation.token]);
  snapshot = { ...snapshot, members: [{ ...admin, role: "member" }] };
  await page.load();
  page.copyInvite(invitationEvent(invitation.id));
  assert.deepEqual(clipboard, [invitation.token]);
  assert.equal(page.data.invites.length, 0);
});

test("a code that expires while the page is open is no longer copied or shared", async () => {
  const { page, clipboard, setNow } = openPage(() => ({ ...active, invites: [invitation] }));
  await page.load();
  setNow(Date.parse(invitation.expiresAt));
  page.copyInvite(invitationEvent(invitation.id));
  assert.deepEqual(clipboard, []);
  assert.equal(page.onShareAppMessage().path, "/pages/family/family");
});

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
