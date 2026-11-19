const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, "../pages");
for (const page of fs.readdirSync(root)) {
  test(page + " template uses live bindings", () => {
    const s = fs.readFileSync(path.join(root, page, page + ".wxml"), "utf8");
    for (const binding of s.matchAll(/{{([\s\S]*?)}}/g))
      assert.doesNotMatch(
        binding[1],
        /&(?:[a-zA-Z][a-zA-Z0-9]*|#(?:[0-9]+|x[0-9a-fA-F]+));/,
        "WXML expressions must use operators directly, not HTML entities: " + binding[0],
      );
    for (const m of s.matchAll(/wx:(?:if|elif|for)="([^"]*)"/g))
      assert.ok(m[1].startsWith("{{") && m[1].endsWith("}}"), m[0]);
    const stack = [];
    for (const m of s.matchAll(/<([/]?)([\w-]+)([^>]*?)>/g)) {
      if (m[3].endsWith("/")) continue;
      if (m[1]) assert.equal(stack.pop(), m[2]);
      else stack.push(m[2]);
    }
    assert.equal(stack.length, 0);
  });
}
