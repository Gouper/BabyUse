const DAY = 86400000;
const dateTime = (date) => Date.parse(date + "T00:00:00Z");
const countKey = (record) =>
  record && record.type === "initial" && record.requestId &&
  record.date + ":" + record.requestId;
// These are display-only balances before the recorded event. No daily rows
// are invented and no inferred quantity is sent back to the stock ledger.
function inferredPrefix(records, anchorIndex, containerMode) {
  const inferred = new Map();
  if (containerMode || anchorIndex <= 0) return inferred;
  const anchor = records[anchorIndex];
  const prefix = records.slice(0, anchorIndex);
  if (prefix.some((r) => r.endDate && r.endDate > r.date && r.endDate >= anchor.date))
    return inferred;
  let balance = Number(anchor.quantity);
  const group = countKey(anchor);
  if (group) {
    for (let i = anchorIndex + 1; i < records.length && countKey(records[i]) === group; i++)
      balance += Number(records[i].quantity);
  }
  if (!Number.isFinite(balance) || balance < 0) return inferred;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const record = prefix[i];
    if (!["use", "loss", "purchase"].includes(record.type)) continue;
    const quantity = Number(record.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) break;
    balance += record.type === "purchase" ? -quantity : quantity;
    if (!Number.isFinite(balance) || balance < 0) break;
    inferred.set(i, {
      id: record.id,
      date: record.date,
      endDate: record.endDate || "",
      value: balance,
      inferred: true,
    });
  }
  return inferred;
}

function isConsumption(record, containerMode) {
  const quantity = Number(record.quantity);
  return !record.voided && record.type === (containerMode ? "finish" : "use") &&
    Number.isFinite(quantity) && quantity > 0;
}

function consumptionSeries(records, containerMode, from) {
  const points = [];
  const daily = new Map();
  for (const record of records) {
    if ((from && record.date < from) || !isConsumption(record, containerMode)) continue;
    const point = { id: record.id, date: record.date, endDate: "", value: Number(record.quantity), inferred: false };
    if (record.endDate > record.date) {
      point.endDate = record.endDate;
      points.push(point);
      continue;
    }
    const existing = daily.get(record.date);
    if (existing) {
      existing.value += point.value;
    } else {
      daily.set(record.date, point);
      points.push(point);
    }
  }
  return points;
}

function series(records, mode, containerMode, from) {
  if (mode === 1) return consumptionSeries(records, containerMode, from);
  let stock = 0;
  let previousCount;
  const points = [];
  const anchorIndex = records.findIndex((r) => ["initial", "count"].includes(r.type));
  const inferred = mode === 0 ? inferredPrefix(records, anchorIndex, containerMode) : new Map();
  for (const [index, r] of records.entries()) {
    if (mode === 0 && !containerMode && anchorIndex >= 0 && index < anchorIndex) {
      const point = inferred.get(index);
      if (point && (!from || point.date >= from)) points.push(point);
      continue;
    }
    if (r.type === "initial") {
      const count = countKey(r);
      if (!count || count !== previousCount) stock = 0;
      stock += (r.quantity || 0) - (containerMode && r.openedWithCount ? 1 : 0);
      previousCount = count;
      if (count && count === countKey(records[index + 1])) continue;
    } else if (r.type === "purchase") stock += r.quantity || 0;
    else if (r.type === "count") stock = r.quantity;
    else if (containerMode) {
      if (r.type === "open" || (r.type === "loss" && !r.containerId))
        stock -= r.quantity || 1;
    } else if (["use", "loss"].includes(r.type)) stock -= r.quantity || 0;
    if (from && r.date < from) continue;
    if (mode === 2 && r.type !== "purchase") continue;
    if (!["initial", "purchase", "use", "loss", "finish", "count", "open"].includes(r.type)) continue;
    const value = mode === 0 ? stock : Number(r.quantity);
    if (!Number.isFinite(value) || (mode === 0 && value < 0)) continue;
    points.push({ id: r.id, date: r.date, endDate: r.endDate || "", value, inferred: false });
  }
  return points;
}
function layout(points, width, height) {
  const left = 52, right = width - 20, top = 26, bottom = height - 42;
  const min = Math.min(0, ...points.map(p => p.value));
  const max = Math.max(1, ...points.map(p => p.value));
  const start = points.length ? dateTime(points[0].date) : 0;
  const end = points.length ? dateTime(points[points.length - 1].date) : start;
  const span = Math.max(DAY, end - start);
  const plotted = points.map(p => ({ ...p,
    x: end === start ? (left + right) / 2 : left + (dateTime(p.date) - start) / span * (right - left),
    y: bottom - (p.value - min) / (max - min) * (bottom - top),
  }));
  const ticks = [];
  if (points.length) {
    const count = Math.min(3, Math.round((end - start) / DAY) + 1);
    for (let i = 0; i < count; i++) {
      const time = start + Math.round((end - start) / DAY * i / Math.max(1, count - 1)) * DAY;
      ticks.push({ label: new Date(time).toISOString().slice(0, 10),
        x: end === start ? (left + right) / 2 : left + (time - start) / span * (right - left) });
    }
  }
  return { points: plotted, ticks, min, max, left, right, top, bottom };
}
module.exports = { series, layout, isConsumption };
