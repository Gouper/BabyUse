# 家庭退出与找回实施计划

> 使用 superpowers:subagent-driven-development 分工实现，并独立验证。

**目标** 允许独自退出家庭并在 72 小时内用原微信账号找回。

**实现** 云函数在事务内变更家庭文档和用户路由，家庭页面通过现有 API 展示状态。

**技术** 微信小程序原生页面、wx-server-sdk、Node.js 测试。

**设计** [家庭退出与找回](../specs/2026-11-19-family-recovery-design.md)

## 云函数

- [x] 在云函数适配测试中覆盖关闭、原账号找回、旧邀请、多家庭限制、期限和到期清理。先运行并确认新增用例失败。
- [x] 实现 `closeFamily {familyId}`、`listRecoverableFamilies {}` 和 `restoreFamily {familyId}`。列表返回 `{id,name,recoverUntil}` 数组，时间为毫秒时间戳。
- [x] 新增每小时清理触发器，独立于现有提醒。更新接口和部署说明。
- [x] 验证退出与加入发生竞争时只有一个路径可以成功。

## 家庭页面

- [x] 唯一成员需确认关闭家庭。无家庭时显示可找回的家庭。点击确认后恢复并重新加载。
- [x] 验证页面操作和按钮绑定。运行完整测试、JS 语法检查及可用的小程序编译检查。
