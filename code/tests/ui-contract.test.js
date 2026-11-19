const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
test("native window and tab bar resolve theme colors and icons in both modes", () => {
  assert.equal(app.darkmode, true);
  const themes = JSON.parse(fs.readFileSync(path.join(root, app.themeLocation), "utf8"));
  const resolve = (value, theme) => {
    assert.match(value, /^@/);
    const resolved = themes[theme][value.slice(1)];
    assert.equal(typeof resolved, "string", `${theme} theme is missing ${value}`);
    return resolved;
  };
  for (const value of [
    app.window.navigationBarBackgroundColor,
    app.window.backgroundColor,
    app.tabBar.backgroundColor,
    app.tabBar.color,
    app.tabBar.selectedColor,
  ]) {
    assert.match(resolve(value, "light"), /^#[0-9a-f]{6}$/i);
    assert.match(resolve(value, "dark"), /^#[0-9a-f]{6}$/i);
    assert.notEqual(resolve(value, "light"), resolve(value, "dark"));
  }
  assert.equal(resolve(app.window.navigationBarTextStyle, "light"), "black");
  assert.equal(resolve(app.window.navigationBarTextStyle, "dark"), "white");
  for (const tab of app.tabBar.list) {
    for (const value of [tab.iconPath, tab.selectedIconPath]) {
      const lightIcon = fs.readFileSync(path.join(root, resolve(value, "light")));
      const darkIcon = fs.readFileSync(path.join(root, resolve(value, "dark")));
      assert.notDeepEqual(lightIcon, darkIcon, `${tab.pagePath} must have a dark icon`);
    }
  }
});
for (const page of app.pages) {
  test(`page routes and bound handlers: ${page}`, () => {
    const base = path.join(root, page);
    for (const suffix of [".js", ".json", ".wxml", ".wxss"])
      assert.ok(fs.existsSync(base + suffix), base + suffix);
    JSON.parse(fs.readFileSync(base + ".json", "utf8"));
    let definition;
    vm.runInNewContext(
      fs.readFileSync(base + ".js", "utf8"),
      {
        Page(value) {
          definition = value;
        },
        require(name) {
          if (name.includes("config")) return {};
          if (!name.endsWith('/api')) return require('node:module').createRequire(base + '.js')(name);
          return {
            today: () => "2026-11-19",
            requestId: () => "test-request",
            api: async () => ({}),
            error() {},
          };
        },
        wx: {},
        console,
        Date,
        getApp: () => ({}),
      },
      { filename: base + ".js" },
    );
    assert.ok(definition, "Page must register");
    const template = fs.readFileSync(base + ".wxml", "utf8");
    for (const match of template.matchAll(
      /(?:bind|catch):?[a-z]+\s*=\s*["']([\w]+)["']/g,
    )) {
      assert.equal(
        typeof definition[match[1]],
        "function",
        `missing handler ${match[1]}`,
      );
    }
  });
}
