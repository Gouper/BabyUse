"use strict";
const cloud = require("wx-server-sdk");
const crypto = require("node:crypto");
const { empty, execute, snapshot, day } = require("./domain");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const key = (v) => crypto.createHash("sha256").update(v).digest("hex");
const doc = (tx, col, id) => tx.collection(col).doc(id);
const recoveryWindow = 72 * 60 * 60 * 1000;
const recoveryList = (family) => ({
  id: family._id,
  name: family.recoverName,
  recoverUntil: family.recoverUntil,
});
async function get(ref) {
  try {
    return (await ref.get()).data;
  } catch (e) {
    if (/not exist|不存在|not found/i.test(e.message || "")) return null;
    throw e;
  }
}
async function listRecoverableFamilies(routeId) {
  const families = [];
  const query = db
    .collection("baby_families")
    .where({
      recoverOwner: routeId,
      recoverUntil: db.command.gt(Date.now()),
    })
    .field({ _id: true, recoverName: true, recoverUntil: true });
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const { data } = await query.skip(offset).limit(limit).get();
    for (const family of data) {
      if (family.recoverUntil > Date.now()) families.push(recoveryList(family));
    }
    if (data.length < limit) return families;
  }
}
async function changeRecovery(actor, action, p) {
  const { familyId, requestId } = p;
  if (typeof familyId !== "string" || !familyId) throw Error("缺少家庭编号");
  const routeId = key(actor);
  const requestKey = requestId && actor + ":" + action + ":" + requestId;
  return db.runTransaction(async (tx) => {
    const routeRef = doc(tx, "baby_routes", routeId);
    const route = await get(routeRef);
    const ref = doc(tx, "baby_families", familyId);
    const current = await get(ref);
    const state = current?.state;
    if (requestKey && state?.requests?.[requestKey])
      return state.requests[requestKey];
    if (action === "closeFamily") {
      if (route?.familyId !== familyId || !current || current.recoverUntil)
        throw Error("当前家庭已变更，请刷新后重试");
      if (state.members.length !== 1 || state.members[0].id !== actor)
        throw Error("只有家庭的最后一位成员可以关闭家庭");
      const recoverUntil = Date.now() + recoveryWindow;
      const result = { familyId, recoverUntil };
      state.members = [];
      state.invites = [];
      if (requestKey) state.requests[requestKey] = result;
      await ref.set({
        data: {
          state,
          recoverName: state.family.name,
          recoverOwner: routeId,
          recoverUntil,
        },
      });
      await routeRef.remove();
      return result;
    }
    if (route) throw Error("请先退出当前家庭");
    if (current?.recoverOwner !== routeId || current.recoverUntil <= Date.now())
      throw Error("家庭不可找回或找回期限已过");
    state.members = [{ id: actor, role: "admin", subscribed: false }];
    if (requestKey) state.requests[requestKey] = state.family;
    await ref.set({ data: { state } });
    await routeRef.set({ data: { familyId } });
    return state.family;
  });
}
async function cleanExpiredFamilies() {
  const cutoff = Date.now();
  const { data } = await db
    .collection("baby_families")
    .where({ recoverUntil: db.command.lte(cutoff) })
    .field({ _id: true })
    .limit(100)
    .get();
  let removed = 0;
  for (const family of data) {
    const expired = await db.runTransaction(async (tx) => {
      const ref = doc(tx, "baby_families", family._id);
      const current = await get(ref);
      if (!current?.recoverUntil || current.recoverUntil > cutoff) return false;
      // Removing the archive payload in the transaction makes expiry and
      // restoration mutually exclusive. Keep a marker for cleanup retries.
      if (current.state)
        await ref.set({ data: { recoverUntil: current.recoverUntil } });
      return true;
    });
    if (!expired) continue;
    await db.collection("baby_invites").where({ familyId: family._id }).remove();
    const ref = doc(db, "baby_families", family._id);
    await ref.remove();
    removed++;
  }
  return { removed };
}
async function scheduler() {
  if (!process.env.SUBSCRIBE_TEMPLATE_ID)
    return {
      sent: 0,
      status: "blocked",
      error: "缺少订阅模板配置，授权保持不变",
    };
  let offset = 0,
    sent = 0;
  for (;;) {
    const result = await db
      .collection("baby_families")
      .skip(offset)
      .limit(100)
      .get();
    for (const original of result.data) {
      if (original.recoverUntil) continue;
      const view = snapshot(original.state, day(new Date().toISOString()));
      for (const member of original.state.members.filter((m) => m.subscribed)) {
        const alertKey = (a) =>
          key(JSON.stringify([a.itemId, a.batchId, a.containerId, a.type]));
        const alerts = view.alerts.filter(
          (a) =>
            !original.state.items.find((i) => i.id === a.itemId)?.deleted &&
            !original.state.notifications.some(
              (n) =>
                n.memberId === member.id &&
                n.status === "sent" &&
                (n.alertKeys || []).includes(alertKey(a)),
            ),
        );
        if (!alerts.length) continue;
        const fingerprint = key(
          JSON.stringify(
            alerts
              .map((a) => [a.itemId, a.batchId, a.containerId, a.type])
              .sort(),
          ),
        );
        const reserved = await db.runTransaction(async (tx) => {
          const ref = doc(tx, "baby_families", original._id);
          const current = await get(ref);
          if (!current || current.recoverUntil) return;
          const m = current.state.members.find((m) => m.id === member.id);
          if (!m || !m.subscribed) return;
          if (
            current.state.notifications.some(
              (n) =>
                n.memberId === member.id &&
                n.fingerprint === fingerprint &&
                ["sent", "sending"].includes(n.status),
            )
          )
            return;
          current.state.notifications.push({
            memberId: member.id,
            fingerprint,
            alertKeys: alerts.map(alertKey),
            status: "sending",
            at: new Date().toISOString(),
          });
          m.subscribed = false;
          await ref.set({
            data: { state: JSON.parse(JSON.stringify(current.state)) },
          });
          return true;
        });
        if (!reserved) continue;
        let status = "failed",
          error = "缺少订阅模板配置";
        if (process.env.SUBSCRIBE_TEMPLATE_ID) {
          try {
            await cloud.openapi.subscribeMessage.send({
              touser: member.id,
              templateId: process.env.SUBSCRIBE_TEMPLATE_ID,
              page: "pages/index/index",
              data: {
                [process.env.SUBSCRIBE_THING_KEY || "thing1"]: {
                  value: `宝宝用品有${alerts.length}项待处理`,
                },
                [process.env.SUBSCRIBE_DATE_KEY || "time2"]: {
                  value: day(new Date().toISOString()),
                },
              },
            });
            status = "sent";
            error = "";
            sent++;
          } catch (e) {
            error = e.message;
          }
        }
        await db.runTransaction(async (tx) => {
          const ref = doc(tx, "baby_families", original._id);
          const current = await get(ref);
          if (!current || current.recoverUntil) return;
          const n = current.state.notifications.find(
            (n) =>
              n.memberId === member.id &&
              n.fingerprint === fingerprint &&
              n.status === "sending",
          );
          if (n) {
            n.status = status;
            n.error = error;
            await ref.set({
              data: { state: JSON.parse(JSON.stringify(current.state)) },
            });
          }
        });
      }
    }
    if (result.data.length < 100) break;
    offset += 100;
  }
  return { sent };
}
exports.main = async (event = {}) => {
  try {
    const actor = cloud.getWXContext().OPENID;
    if (event.Type === "Timer" || event.action === "scheduledCheck") {
      if (actor) throw Error("定时入口禁止客户端调用");
      if (event.Type !== "Timer") throw Error("仅允许定时触发器");
      const data =
        event.TriggerName === "family-recovery-cleanup"
          ? await cleanExpiredFamilies()
          : await scheduler();
      return { ok: true, data };
    }
    if (!actor) throw Error("缺少微信身份");
    const action = event.action,
      p = event.payload || {};
    const routeId = key(actor);
    if (action === "listRecoverableFamilies")
      return { ok: true, data: await listRecoverableFamilies(routeId) };
    if (action === "closeFamily" || action === "restoreFamily")
      return { ok: true, data: await changeRecovery(actor, action, p) };
    if (action === "createFamily") {
      const familyId = crypto.randomUUID();
      return {
        ok: true,
        data: await db.runTransaction(async (tx) => {
          if (await get(doc(tx, "baby_routes", routeId)))
            throw Error("已加入家庭");
          const state = empty();
          const data = execute(state, actor, action, p);
          state.family.id = familyId;
          await doc(tx, "baby_families", familyId).set({
            data: { state: JSON.parse(JSON.stringify(state)) },
          });
          await doc(tx, "baby_routes", routeId).set({ data: { familyId } });
          return { ...data, id: familyId };
        }),
      };
    }
    if (action === "join") {
      const invite = await get(
        db.collection("baby_invites").doc(key(p.token || "")),
      );
      if (!invite) throw Error("邀请失效");
      return {
        ok: true,
        data: await db.runTransaction(async (tx) => {
          const route = await get(doc(tx, "baby_routes", routeId));
          if (route && route.familyId !== invite.familyId)
            throw Error("请先退出当前家庭");
          const ref = doc(tx, "baby_families", invite.familyId);
          const current = await get(ref);
          if (!current || current.recoverUntil) throw Error("邀请已失效");
          const data = execute(current.state, actor, action, { token: p.token });
          await ref.set({
            data: { state: JSON.parse(JSON.stringify(current.state)) },
          });
          await doc(tx, "baby_routes", routeId).set({
            data: { familyId: invite.familyId },
          });
          return data;
        }),
      };
    }
    const route = await get(db.collection("baby_routes").doc(routeId));
    if (!route) {
      if (action === "snapshot")
        return { ok: true, data: { ...empty(), alerts: [] } };
      throw Error("请先创建或加入家庭");
    }
    const data = await db.runTransaction(async (tx) => {
      const currentRoute = await get(doc(tx, "baby_routes", routeId));
      if (
        currentRoute?.familyId !== route.familyId ||
        (action === "leave" && p.familyId && p.familyId !== route.familyId)
      )
        throw Error("当前家庭已变更，请刷新后重试");
      const ref = doc(tx, "baby_families", route.familyId);
      const current = await get(ref);
      if (!current || current.recoverUntil) throw Error("家庭不存在");
      const state = current.state;
      const result = execute(state, actor, action, p);
      if (!["snapshot", "preview", "trends"].includes(action)) {
        await ref.set({ data: { state: JSON.parse(JSON.stringify(state)) } });
        if (action === "invite")
          await doc(tx, "baby_invites", key(result.token)).set({
            data: { familyId: route.familyId },
          });
        if (action === "removeMember" || action === "leave")
          await doc(
            tx,
            "baby_routes",
            key(action === "leave" ? actor : p.memberId),
          ).remove();
      }
      return result;
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message || "操作失败" };
  }
};
