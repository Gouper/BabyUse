# 用品选择与模板实施计划

> 使用子代理分工执行，通过回归测试和微信开发者工具编译核对结果。

依据 [用品选择与模板设计](../specs/2026-11-19-supply-form-design.md)。沿用原生小程序和现有云函数接口。

- [x] 在 `pages/editor` 实现类型、推荐、常用项和手写。覆盖模板切换保留用户值、规格与包装换算独立、开封期限待填、存量编辑约束及保存后跳转。
- [x] 在 `components/supply-picker` 实现选择列表。接收 `items`、`selected-id`、`allow-create`、`disabled` 和 `placeholder`，发送 `select` 事件，数据为 `{id}`，允许新增时发送 `create`。覆盖同名不同规格匹配、搜索无结果和禁用状态。
- [x] 在 `pages/intake` 接入搜索和新增。编辑页新增时以 `itemCreated` 回传已保存用品，独立跳转时使用 `itemId`。覆盖新增、替换、取消与加载重试，核对日期和其他行的保留。
- [x] 在 `pages/editor` 使用同一组件接入记使用及历史库存选择。按真实用品 ID 选择，验证同名规格与选中后原有记录逻辑。
- [x] 执行 `npm test` 和改动 JavaScript 的 `node --check`，用微信开发者工具附带的编译器编译修改过的页面与组件。
