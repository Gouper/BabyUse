"use strict";
const DAY = 86400000;
const empty = () => ({
  family: null,
  members: [],
  items: [],
  batches: [],
  containers: [],
  records: [],
  invites: [],
  requests: {},
  notifications: [],
});
const fail = (m) => {
  throw Error(m);
};
const num = (v, zero = false) => {
  v = Number(v);
  if (!Number.isFinite(v) || (zero ? v < 0 : v <= 0))
    fail("数量必须为有效正数");
  return v;
};
const itemNumber = (value, label, zero = false) => {
  const n = Number(value);
  if (value === "" || !Number.isFinite(n) || (zero ? n < 0 : n <= 0))
    fail(label + (zero ? "必须为 0 或更大的数字" : "必须为大于 0 的有效数字"));
  return n;
};
const date = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail("日期格式无效");
  return v;
};
const day = (t) =>
  new Date(new Date(t).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const expiry = (b, c, item) => {
  const ds = [];
  if (item.expiryMode !== "none" && b.expiry) ds.push(b.expiry);
  if (c && item.expiryMode === "opened" && item.openDays)
    ds.push(
      new Date(new Date(c.openedAt).getTime() + item.openDays * DAY)
        .toISOString()
        .slice(0, 10),
    );
  if (
    !c &&
    item.mode === "quantity" &&
    item.expiryMode === "opened" &&
    b.openedAt &&
    item.openDays
  )
    ds.push(
      new Date(new Date(b.openedAt).getTime() + item.openDays * DAY)
        .toISOString()
        .slice(0, 10),
    );
  return ds.sort()[0] || "9999-12-31";
};
// A stocktake is a balance, purchases are increments. Business date wins;
// records within one day retain their persisted creation/order sequence.
function quantities(s, item, today, strict = true) {
  let conflict = false;
  const bs = s.batches.filter((b) => b.itemId === item.id);
  const records = s.records.map((r, index) => ({ ...r, sequence: index }))
    .filter((r) => r.itemId === item.id && !r.voided);
  const compare = (a, b) => a.date.localeCompare(b.date) ||
    (a.createdAt || "").localeCompare(b.createdAt || "") ||
    (a.order ?? a.sequence) - (b.order ?? b.sequence);
  const batchRecords = new Map(records.filter((r) => r.batchId &&
    ["initial", "purchase"].includes(r.type)).map((r) => [r.batchId, r]));
  const containerRecords = new Map(records.filter((r) => r.type === "open")
    .map((r) => [r.containerId, r]));
  const groups = new Map();
  for (const r of records.filter((r) => r.type === "initial" && r.date <= today)) {
    // Legacy intake records already carry requestId and batchId, so existing
    // stored inventories are corrected on read without rewriting their history.
    const key = (r.requestId || r.id) + "/" + r.date;
    if (!groups.has(key)) groups.set(key, { anchor: r, batchIds: [] });
    const group = groups.get(key);
    group.batchIds.push(r.batchId);
    if (compare(r, group.anchor) > 0) group.anchor = r;
  }
  const baselines = [...groups.values(), ...records
    .filter((r) => r.type === "count" && r.date <= today)
    .map((r) => ({ anchor: r }))];
  const baseline = baselines.sort((a, b) => compare(a.anchor, b.anchor)).at(-1);
  const amounts = Object.fromEntries(bs.map((b) => [b.id, 0]));
  const batchEvent = (b) => batchRecords.get(b.id) || {
    date: b.date, createdAt: "", sequence: -1,
  };
  const allocated = (b, event) => item.mode === "container"
    ? s.containers.filter((c) => {
      if (c.batchId !== b.id) return false;
      const opened = containerRecords.get(c.id) || batchEvent(b);
      return !event || compare(opened, event) <= 0;
    }).length : 0;
  const sortBatches = (list) => list.sort((a, b) =>
    expiry(a, null, item).localeCompare(expiry(b, null, item)) ||
    a.id.localeCompare(b.id));

  for (const b of bs) {
    if (b.date > today) continue;
    if (!baseline || compare(batchEvent(b), baseline.anchor) > 0) {
      const embedded = item.mode === "container" ? s.containers.filter((c) =>
        c.batchId === b.id && !containerRecords.has(c.id)).length : 0;
      amounts[b.id] = Math.max(0, b.quantity - embedded);
      if (b.quantity < embedded) conflict = true;
    }
  }
  if (baseline && baseline.batchIds) {
    for (const b of bs.filter((b) => baseline.batchIds.includes(b.id))) {
      const reserved = allocated(b, baseline.anchor);
      amounts[b.id] = Math.max(0, b.quantity - reserved);
      if (b.quantity < reserved) conflict = true;
    }
  } else if (baseline) {
    let left = baseline.anchor.quantity;
    const precedingInitial = [...groups.values()]
      .filter((group) => compare(group.anchor, baseline.anchor) <= 0)
      .sort((a, b) => compare(a.anchor, b.anchor)).at(-1);
    const candidates = sortBatches(bs.filter((b) =>
      compare(batchEvent(b), baseline.anchor) <= 0 &&
      (!precedingInitial || precedingInitial.batchIds.includes(b.id) ||
        compare(batchEvent(b), precedingInitial.anchor) > 0)));
    for (const b of candidates) {
      const reserved = allocated(b, baseline.anchor);
      const take = Math.min(left, Math.max(0, b.quantity - reserved));
      amounts[b.id] = take;
      left -= take;
    }
    if (left && candidates[0]) amounts[candidates[0].id] += left;
    else if (left) fail("请先入库后盘点");
  }
  const events = records.filter((r) => ["use", "loss", ...(item.mode === "container" ? ["open"] : [])].includes(r.type) &&
    r.date <= today && (!baseline || compare(r, baseline.anchor) > 0)).sort(compare);
  for (const r of events) {
    if (r.containerId && r.type !== "open") continue;
    const candidates = sortBatches(bs.filter((b) =>
      compare(batchEvent(b), r) <= 0 &&
      (r.type === "open" || !r.batchId || b.id === r.batchId)));
    // Older additive versions may have opened an older batch after a newer
    // stocktake. Preserve the container's reference while consuming the current
    // unopened balance; never expose a negative obsolete batch.
    if (r.type === "open") candidates.sort((a, b) =>
      Number(b.id === r.batchId) - Number(a.id === r.batchId));
    let left = r.quantity;
    for (const b of candidates) {
      if (["use", "open"].includes(r.type) && expiry(b, null, item) < r.date) continue;
      const take = Math.min(left, Math.max(0, amounts[b.id]));
      amounts[b.id] -= take;
      left -= take;
    }
    if (left > 0) {
      if (strict) fail("库存不足：实点余量无法覆盖之后的使用／报损，请先核对日期和数量");
      conflict = true;
    }
  }
  // snapshot subtracts all allocated containers from remaining batch units.
  // Keep those references reserved independently of the unopened balance.
  if (item.mode === "container") {
    for (const b of bs) amounts[b.id] += allocated(b);
  }
  if (strict && conflict) fail("实点余量与已开封记录不一致，请先核对库存");
  return { bs, amounts, conflict };
}
function snapshot(s, today) {
  const alerts = [];
  const items = s.items.map((item) => {
    const { bs, amounts, conflict } = quantities(s, item, today, false);
    let available = 0,
      unopened = 0,
      using = 0;
    for (const b of bs) {
      let q = amounts[b.id];
      const cs = s.containers.filter((c) => c.batchId === b.id);
      q -= cs.length;
      if (expiry(b, null, item) >= today) {
        unopened += q;
        available += q;
      }
      if (!item.deleted && q > 0 && item.expiryMode !== "none") {
        const days = (new Date(expiry(b, null, item)) - new Date(today)) / DAY;
        if (days < 0)
          alerts.push({
            itemId: item.id,
            batchId: b.id,
            type: "expired",
            message: "批次已过期，待报损",
          });
        else if (days <= Number(item.expiryWarningDays ?? 30))
          alerts.push({
            itemId: item.id,
            batchId: b.id,
            type: "expiry",
            message: "批次即将到期",
          });
      }
      for (const c of cs.filter((c) => !c.endedAt)) {
        using++;
        const days = (new Date(expiry(b, c, item)) - new Date(today)) / DAY;
        if (!item.deleted && days <= Number(item.openWarningDays ?? 3))
          alerts.push({
            itemId: item.id,
            containerId: c.id,
            type: days < 0 ? "expired" : "opened",
            message: days < 0 ? "开封容器已过期" : "开封期限将至",
          });
      }
    }
    const recent = s.records.filter(
      (r) =>
        !r.voided &&
        r.itemId === item.id &&
        r.type === "use" &&
        r.date >=
          new Date(new Date(today) - 6 * DAY).toISOString().slice(0, 10),
    );
    const covered = new Set();
    let used = 0;
    for (const r of recent) {
      used += r.quantity;
      let t = new Date(r.date);
      while (t <= new Date(r.endDate || r.date)) {
        covered.add(t.toISOString().slice(0, 10));
        t = new Date(+t + DAY);
      }
    }
    let daily = covered.size >= 3 ? used / covered.size : null;
    let days = daily ? available / daily : null;
    if (item.mode === "container") {
      const samples = s.containers
        .filter((c) => c.itemId === item.id && c.endType === "finish")
        .map((c) => (new Date(c.endedAt) - new Date(c.openedAt)) / DAY)
        .filter((n) => n > 0);
      daily = null;
      days = null;
      if (samples.length >= 2) {
        const avg = samples.reduce((a, b) => a + b) / samples.length;
        days =
          unopened * avg +
          s.containers
            .filter(
              (c) =>
                c.itemId === item.id &&
                !c.endedAt &&
                expiry(
                  bs.find((b) => b.id === c.batchId),
                  c,
                  item,
                ) >= today,
            )
            .reduce(
              (n, c) =>
                n +
                Math.max(
                  0,
                  avg - (new Date(today) - new Date(c.openedAt)) / DAY,
                ),
              0,
            );
      }
    }
    if (!item.deleted && available < Number(item.lowStock || 0))
      alerts.push({ itemId: item.id, type: "low", message: "低于库存阈值" });
    if (!item.deleted && days !== null && days < Number(item.runoutDays ?? 7))
      alerts.push({
        itemId: item.id,
        type: "runningOut",
        message: "预计不足7天",
      });
    return {
      ...item,
      available,
      inventoryConflict: conflict,
      inventoryWarning: conflict ? "历史实点余量不足以覆盖后续记录，请核对并按今天实际剩余数量重新盘点" : "",
      unopened,
      using,
      estimate: {
        days,
        daily,
        expectedDate:
          days === null
            ? null
            : new Date(new Date(today).getTime() + Math.ceil(days) * DAY)
                .toISOString()
                .slice(0, 10),
        warning:
          conflict ? "历史库存记录存在冲突，请核对并重新盘点" :
          days === null ? "数据不足，暂无法估算" : "账面估算，漏记可能造成偏差",
      },
      batches: bs.map((b) => ({
        ...b,
        remaining: amounts[b.id],
        expired: expiry(b, null, item) < today,
      })),
    };
  });
  return { ...s, requests: undefined, items, alerts };
}
function execute(s, actor, action, p = {}, ctx = {}) {
  const now = ctx.now || new Date().toISOString(),
    today = day(now),
    id = ctx.id || (() => require("node:crypto").randomUUID());
  const member = s.members.find((m) => m.id === actor);
  const admin = () => {
    if (!member || member.role !== "admin") fail("需要管理员权限");
  };
  const add = (type, data) => {
    const r = {
      id: id(),
      type,
      actor,
      date: today,
      createdAt: now,
      order: s.records.length,
      ...data,
    };
    s.records.push(r);
    return r;
  };
  const itemFor = () =>
    s.items.find((i) => i.id === p.itemId && !i.deleted) || fail("物品不存在");
  if (action === "createFamily") {
    if (s.family) fail("家庭已存在");
    s.family = {
      id: id(),
      name: String(p.name || "我的家庭"),
      babyName: String(p.babyName || "宝宝"),
    };
    s.members.push({ id: actor, role: "admin", subscribed: false });
    return s.family;
  }
  if (action === "join") {
    const inv = s.invites.find(
      (i) => i.token === p.token && !i.revoked && i.expiresAt > now,
    );
    if (!inv) fail("邀请已失效");
    if (!member)
      s.members.push({ id: actor, role: "member", subscribed: false });
    return s.family;
  }
  if (!member) {
    if (action === "snapshot" && !s.family) return { ...empty(), alerts: [] };
    fail("无家庭访问权限");
  }
  if (action === "snapshot") {
    const v = snapshot(s, today);
    if (member.role !== "admin") v.invites = [];
    v.currentMemberId = actor;
    return v;
  }
  if (action === "updateItem") {
    const item = itemFor();
    for (const k of ["name", "category", "spec"])
      if (p[k] !== undefined) {
        if (k === "name" && !String(p[k]).trim()) fail("名称必填");
        item[k] = String(p[k]);
      }
    for (const k of [
      "lowStock",
      "expiryWarningDays",
      "openWarningDays",
      "runoutDays",
    ])
      if (p[k] !== undefined) item[k] = num(p[k], true);
    return item;
  }
  if (action === "createItem") {
    if (!String(p.name || "").trim() || !p.unit) fail("名称和基本单位必填");
    if (
      !["quantity", "container"].includes(p.mode) ||
      !["none", "package", "opened"].includes(p.expiryMode)
    )
      fail("管理方式无效");
    const item = {
      ...p,
      id: id(),
      packSize: itemNumber(p.packSize === undefined ? 1 : p.packSize, "每包包含的数量"),
      lowStock: itemNumber(p.lowStock === undefined ? 0 : p.lowStock, "低库存提醒数量", true),
    };
    if (item.expiryMode === "opened")
      item.openDays = itemNumber(p.openDays, "开封后可使用天数");
    s.items.push(item);
    return item;
  }
  if (action === "invite") {
    admin();
    const inv = {
      id: id(),
      token: id(),
      createdAt: now,
      expiresAt: new Date(new Date(now).getTime() + 7 * DAY).toISOString(),
    };
    s.invites.push(inv);
    return inv;
  }
  if (action === "revokeInvite") {
    admin();
    const i = s.invites.find((i) => i.id === p.inviteId) || fail("邀请不存在");
    i.revoked = true;
    return i;
  }
  if (["setRole", "removeMember", "leave"].includes(action)) {
    if (action !== "leave") admin();
    const target =
      s.members.find(
        (m) => m.id === (action === "leave" ? actor : p.memberId),
      ) || fail("成员不存在");
    if (
      target.role === "admin" &&
      s.members.filter((m) => m.role === "admin").length === 1 &&
      (action !== "setRole" || p.role !== "admin")
    )
      fail("至少保留一位管理员");
    if (action === "setRole") {
      if (!["admin", "member"].includes(p.role)) fail("角色无效");
      target.role = p.role;
    } else s.members.splice(s.members.indexOf(target), 1);
    return true;
  }
  if (action === "subscribe") {
    member.subscribed = p.accepted === true;
    return member;
  }
  if (["deleteItems", "restoreItems"].includes(action)) {
    admin();
    for (const i of s.items.filter((i) => (p.ids || []).includes(i.id))) {
      i.deleted = action === "deleteItems";
      add(i.deleted ? "delete" : "restore", { itemId: i.id });
    }
    return true;
  }
  if (action === "preview") {
    return String(p.text || "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((raw) => {
        const q = raw.match(/(\d+(?:\.\d+)?)\s*(包|盒|罐|瓶|片|粒|个)/);
        const pack = raw.match(/每(?:包|盒)(\d+)(片|粒|个)/);
        const exp = raw.match(/有效期\s*(\d{4}-\d{2}-\d{2})/);
        const name = q ? raw.slice(0, q.index).trim() : raw;
        const matches = s.items.filter((i) => i.name === name && !i.deleted);
        return {
          raw,
          name,
          quantity: q ? Number(q[1]) : null,
          unit: q ? q[2] : "",
          packSize: pack ? Number(pack[1]) : null,
          expiry: exp ? exp[1] : "",
          itemId: matches.length === 1 ? matches[0].id : null,
          needsConfirmation: true,
        };
      });
  }
  if (action === "intake") {
    if (!p.requestId) fail("缺少请求标识");
    if (s.requests[p.requestId]) return s.requests[p.requestId];
    if (
      !["initial", "purchase"].includes(p.source) ||
      !Array.isArray(p.rows) ||
      !p.rows.length
    )
      fail("入库参数无效");
    const out = [];
    for (const row of p.rows) {
      const item =
        s.items.find((i) => i.id === row.itemId && !i.deleted) ||
        fail("物品不存在");
      const quantity = num(row.quantity) * num(row.packSize || 1);
      if (item.mode === "container" && !Number.isInteger(quantity))
        fail("容器数量必须为整数");
      const b = {
        id: id(),
        itemId: item.id,
        quantity,
        packSize: Number(row.packSize || 1),
        openedAt: row.openedAt ? date(row.openedAt) : null,
        expiry: row.expiry ? date(row.expiry) : null,
        date: row.date ? date(row.date) : today,
        source: p.source,
      };
      if (b.date > today || (b.openedAt && b.openedAt > today))
        fail("不能记录未来日期");
      s.batches.push(b);
      add(p.source, {
        itemId: item.id,
        batchId: b.id,
        quantity,
        date: b.date,
        requestId: p.requestId,
      });
      if (row.openedAt && item.mode === "container") {
        s.containers.push({
          id: id(),
          itemId: item.id,
          batchId: b.id,
          openedAt: date(row.openedAt),
        });
      }
      out.push(b);
    }
    // Validate the complete list together: same-item rows form one stocktake.
    for (const itemId of new Set(p.rows.map((row) => row.itemId)))
      quantities(s, s.items.find((i) => i.id === itemId), today);
    s.requests[p.requestId] = out;
    return out;
  }
  if (action === "trends")
    return s.records.filter(
      (r) =>
        (!p.itemId || r.itemId === p.itemId) &&
        (!p.from || r.date >= p.from) &&
        (!p.to || r.date <= p.to),
    );
  if (action === "undo") {
    const r = s.records.find((r) => r.id === p.recordId) || fail("记录不存在");
    if (member.role !== "admin" && r.actor !== actor)
      fail("只能修改自己的记录");
    if (!["use", "finish"].includes(r.type) || r.voided) fail("该记录不可撤销");
    r.voided = true;
    if (r.type === "finish") {
      const c = s.containers.find((c) => c.id === r.containerId);
      delete c.endedAt;
      delete c.endType;
    }
    add("undo", { itemId: r.itemId, relatedId: r.id });
    quantities(
      s,
      s.items.find((i) => i.id === r.itemId),
      today,
    );
    return true;
  }
  if (action === "edit" || action === "editUse") {
    const r = s.records.find((r) => r.id === p.recordId) || fail("记录不存在");
    if (member.role !== "admin" && r.actor !== actor)
      fail("只能修改自己的记录");
    if (!["use", "finish"].includes(r.type) || r.voided) fail("记录不可修改");
    r.voided = true;
    if (r.type === "finish") {
      const c = s.containers.find((c) => c.id === r.containerId);
      delete c.endedAt;
      delete c.endType;
    }
    const result = execute(
      s,
      actor,
      r.type,
      { ...p, itemId: r.itemId, containerId: r.containerId },
      { ...ctx },
    );
    result.relatedId = r.id;
    return result;
  }
  if (["use", "count", "loss", "open", "finish"].includes(action)) {
    if (action === "finish") {
      const c =
        s.containers.find((c) => c.id === p.containerId && !c.endedAt) ||
        fail("容器不存在或已结束");
      const end = date(p.date || today);
      if (end < c.openedAt || end > today) fail("结束日期无效");
      c.endedAt = end;
      c.endType = "finish";
      return add("finish", {
        itemId: c.itemId,
        containerId: c.id,
        date: end,
        quantity: 1,
      });
    }
    const item = itemFor(),
      d = date(p.date || today);
    if (d > today) fail("不能记录未来日期");
    if (action === "open") {
      if (item.mode !== "container") fail("不是容器管理物品");
      const view = snapshot(s, d).items.find((i) => i.id === item.id);
      const b =
        view.batches
          .sort((a, b) =>
            expiry(a, null, item).localeCompare(expiry(b, null, item)),
          )
          .find(
            (b) =>
              (!p.batchId || p.batchId === b.id) &&
              !b.expired &&
              b.remaining -
                s.containers.filter((c) => c.batchId === b.id).length >=
                1,
          ) || fail("没有可开封的库存");
      const c = { id: id(), itemId: item.id, batchId: b.id, openedAt: d };
      s.containers.push(c);
      add("open", { itemId: item.id, batchId:b.id,containerId: c.id, date: d,quantity:1 });
      return c;
    }
    if (action === "use" && item.mode !== "quantity")
      fail("容器用品请记录开封或用完");
    if (["count", "loss"].includes(action) && !String(p.reason || "").trim())
      fail("必须填写原因");
    if (
      p.endDate &&
      s.records.some(
        (r) =>
          r.itemId === item.id &&
          ["count", "initial"].includes(r.type) &&
          !r.voided &&
          r.date >= d &&
          r.date < p.endDate,
      )
    )
      fail("区间跨越盘点，请分开记录盘点前后用量");
    if (p.endDate && (date(p.endDate) < d || p.endDate > today))
      fail("区间日期无效");
    if (p.containerId) {
      const c =
        s.containers.find(
          (c) => c.id === p.containerId && c.itemId === item.id && !c.endedAt,
        ) || fail("容器不可报损");
      if (action !== "loss") fail("操作无效");
      c.endedAt = d;
      c.endType = "loss";
      return add("loss", {
        itemId: item.id,
        containerId: c.id,
        quantity: 1,
        date: d,
        reason: p.reason,
      });
    }
    if (item.mode === "container" && !Number.isInteger(Number(p.quantity)))
      fail("容器盘点要求先处理使用中容器，并输入整数");
    if (action === "loss" && item.mode === "container") {
      const v = snapshot(s, today).items.find((i) => i.id === item.id);
      if (
        Number(p.quantity) >
        v.batches.reduce(
          (n, b) =>
            n +
            b.remaining -
            s.containers.filter((c) => c.batchId === b.id).length,
          0,
        )
      )
        fail("未开封库存不足");
    }
    const before = snapshot(s, today).items.find(
      (i) => i.id === item.id,
    ).available;
    const r = add(action, {
      itemId: item.id,
      batchId: p.batchId,
      quantity: num(p.quantity, action === "count"),
      date: d,
      endDate: p.endDate,
      reason: p.reason,
    });
    quantities(s, item, today);
    if (action === "count") {
      r.before = before;
      r.after = Number(p.quantity);
      r.adjustment = r.after - before;
    }
    return r;
  }
  fail("未知操作");
}
const rawExecute = execute;
function atomic(state, actor, action, p = {}, ctx = {}) {
  const copy = JSON.parse(JSON.stringify(state));
  const requestKey = p.requestId && actor + ":" + action + ":" + p.requestId;
  if (requestKey && copy.requests[requestKey]) return copy.requests[requestKey];
  const result = rawExecute(copy, actor, action, p, ctx);
  if (requestKey) copy.requests[requestKey] = result;
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, copy);
  return result;
}
module.exports = { empty, execute: atomic, snapshot, day };
