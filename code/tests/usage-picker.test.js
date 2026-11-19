const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const editorPath = path.resolve(__dirname, "../pages/editor/editor.js");

test("usage selection keeps same-name supplies distinct and ignores missing IDs", async () => {
  const items = [
    { id: "l", name: "纸尿裤", spec: "L", mode: "quantity", unit: "片" },
    { id: "xl", name: "纸尿裤", spec: "XL", mode: "quantity", unit: "片" },
  ];
  let page;
  const load = createRequire(editorPath);
  vm.runInNewContext(fs.readFileSync(editorPath, "utf8"), {
    Page(definition) { page = definition; },
    require(name) {
      if (name !== "../../utils/api") return load(name);
      return {
        today: () => "2026-11-19",
        requestId: () => "request",
        api: async () => ({ items }),
      };
    },
  });
  page.setData = (updates) => {
    for (const [key, value] of Object.entries(updates)) {
      const [group, field] = key.split(".");
      if (field) page.data[group][field] = value;
      else page.data[key] = value;
    }
  };
  await page.onLoad({ kind: "use" });
  page.selectItem({ detail: { id: "xl" } });
  assert.equal(page.data.selectedItem.spec, "XL");
  page.data.form.quantity = "2";
  page.selectItem({ detail: { id: "xl" } });
  assert.equal(page.data.form.quantity, "2");
  page.selectItem({ detail: { id: "missing" } });
  assert.equal(page.data.itemId, "xl");
});
