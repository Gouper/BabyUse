"use strict";
const cloud = require("wx-server-sdk");
const crypto = require("node:crypto");
const { empty, execute, snapshot, day } = require("./domain");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const key = (v) => crypto.createHash("sha256").update(v).digest("hex");
const doc = (tx, col, id) => tx.collection(col).doc(id);
async function get(ref) {
  try {
    return (await ref.get()).data;
  } catch (e) {
    if (/not exist|不存在|not found/i.test(e.message || "")) return null;
    throw e;
  }
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
        let reserved = false;
        await db.runTransaction(async (tx) => {
          const ref = doc(tx, "baby_families", original._id);
          const current = await get(ref);
          if (!current) return;
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
          reserved = true;
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
      return { ok: true, data: await scheduler() };
    }
    if (!actor) throw Error("缺少微信身份");
    const action = event.action,
      p = event.payload || {};
    const routeId = key(actor);
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
          if (!current) throw Error("家庭不存在");
          const data = execute(current.state, actor, action, p);
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
      const ref = doc(tx, "baby_families", route.familyId);
      const current = await get(ref);
      if (!current) throw Error("家庭不存在");
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
