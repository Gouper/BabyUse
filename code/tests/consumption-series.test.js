const test = require("node:test");
const assert = require("node:assert/strict");
const { series, isConsumption } = require("../pages/trends/chart");

test("quantity consumption sums each recorded day and preserves interval totals", () => {
  const records = [
    { id: "a", date: "2026-11-01", type: "use", quantity: 2 },
    { id: "b", date: "2026-11-01", type: "use", quantity: "3" },
    { id: "p", date: "2026-11-01", type: "purchase", quantity: 40 },
    { id: "k", date: "2026-11-01", type: "count", quantity: 30 },
    { id: "l", date: "2026-11-01", type: "loss", quantity: 1 },
    { id: "c", date: "2026-11-03", endDate: "2026-11-05", type: "use", quantity: 8 },
    { id: "d", date: "2026-11-03", endDate: "2026-11-03", type: "use", quantity: 1 },
    { id: "v", date: "2026-11-03", type: "use", quantity: 20, voided: true },
    { id: "i", date: "2026-11-04", type: "use", quantity: "invalid" },
    { id: "n", date: "2026-11-04", type: "use", quantity: -1 },
    { id: "z", date: "2026-11-05", type: "use", quantity: 0 },
  ];
  const points = [
    { id: "a", date: "2026-11-01", endDate: "", value: 5, inferred: false },
    { id: "c", date: "2026-11-03", endDate: "2026-11-05", value: 8, inferred: false },
    { id: "d", date: "2026-11-03", endDate: "", value: 1, inferred: false },
  ];
  assert.deepEqual(series(records, 1, false, ""), points);
  assert.deepEqual(series(records, 1, false, "2026-11-03"), points.slice(1));
  assert.deepEqual(records.filter(record => isConsumption(record, false)).map(record => record.id),
    ["a", "b", "c", "d"]);
});

test("container consumption counts only completed containers and groups same-day finishes", () => {
  const records = [
    { id: "o", date: "2026-11-01", type: "open", quantity: 1 },
    { id: "u", date: "2026-11-03", type: "use", quantity: 3 },
    { id: "a", date: "2026-11-03", type: "finish", quantity: 1 },
    { id: "b", date: "2026-11-03", type: "finish", quantity: 1 },
    { id: "d", date: "2026-11-04", type: "loss", quantity: 1 },
  ];
  assert.deepEqual(series(records, 1, true, ""), [
    { id: "a", date: "2026-11-03", endDate: "", value: 2, inferred: false },
  ]);
  assert.deepEqual(records.filter(record => isConsumption(record, true)).map(record => record.id),
    ["a", "b"]);
});
