const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup(properties = {}) {
  let definition;
  const source = fs.readFileSync(
    path.join(__dirname, "../components/supply-picker/supply-picker.js"),
    "utf8",
  );
  vm.runInNewContext(source, { Component: (value) => { definition = value; } });
  const events = [];
  const picker = {
    ...definition.methods,
    data: {
      ...definition.data,
      items: [
        { id: "small", name: "纸尿裤", spec: "M 码" },
        { id: "large", name: "纸尿裤", spec: "XL 码" },
        { id: "milk", name: "奶粉", spec: "900 g" },
      ],
      ...properties,
    },
    setData(update) { Object.assign(this.data, update); },
    triggerEvent(name, detail) { events.push({ name, detail }); },
  };
  definition.observers["items, selectedId"].call(picker);
  return { picker, events };
}

const ids = (picker) => Array.from(picker.data.results, (item) => item.id);
const type = (picker, value) => picker.search({ detail: { value } });
const tap = (picker, id) => picker.select({ currentTarget: { dataset: { id } } });

test("search finds the same named supply by specification and accepts case or spacing differences", () => {
  const { picker, events } = setup({ selectedId: "small" });
  assert.equal(picker.data.selectedLabel, "纸尿裤 · M 码");
  picker.toggle();
  type(picker, " 纸尿裤 xl码 ");
  assert.deepEqual(ids(picker), ["large"]);
  type(picker, "奶粉900G");
  assert.deepEqual(ids(picker), ["milk"]);
  type(picker, "纸尿裤 XL");
  tap(picker, "large");
  assert.equal(events[0].name, "select");
  assert.equal(events[0].detail.id, "large");
  assert.equal(picker.data.open, false);
  assert.equal(picker.data.query, "");
});

test("create is available for empty results only when enabled", () => {
  const enabled = setup({ allowCreate: true });
  enabled.picker.toggle();
  type(enabled.picker, "吸奶器");
  assert.deepEqual(ids(enabled.picker), []);
  enabled.picker.create();
  assert.equal(enabled.events[0].name, "create");
  assert.equal(enabled.picker.data.open, false);
  assert.equal(enabled.picker.data.query, "");

  const disabled = setup({ allowCreate: true, disabled: true });
  disabled.picker.toggle();
  disabled.picker.create();
  tap(disabled.picker, "small");
  assert.equal(disabled.picker.data.open, false);
  assert.deepEqual(disabled.events, []);

  const readOnly = setup({ allowCreate: false });
  readOnly.picker.toggle();
  readOnly.picker.create();
  assert.equal(readOnly.picker.data.open, true);
  assert.deepEqual(readOnly.events, []);
});
