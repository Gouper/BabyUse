# 云函数 API

调用 `wx.cloud.callFunction({name:'api',data:{action,payload}})`，返回 `{ok:true,data}` 或 `{ok:false,error}`。身份仅来自云端 OPENID。所有写操作在数据库事务中执行；客户端应对每次用户意图生成唯一 `requestId`，重试沿用。家庭聚合文档有微信数据库单文档大小限制，适合首版家庭规模；达到限制前应拆分并迁移，不应无限积累。

## 快照

`snapshot {}` 返回 `family, currentMemberId, members, items, batches, containers, records, alerts, invites, notifications`。未加入家庭时 `family:null`。普通成员不返回邀请令牌。

- item：`id,name,category,spec,unit,mode(quantity/container),expiryMode(none/package/opened),packSize,openDays,lowStock,deleted,available,unopened,using,batches,estimate:{days,daily,warning}`。
- batch：`id,itemId,quantity,packSize,expiry,date,source,remaining,expired,openedAt`。
- record：`id,type,actor,itemId,batchId,containerId,quantity,date,endDate,createdAt,order,reason,voided,relatedId`。
- alerts：`[{itemId,batchId?,containerId?,type(low/runningOut/expiry/opened/expired),message}]`。

## 操作及 payload

- `createFamily {name,babyName}`、`join {token}`、`leave {familyId?}`。家庭仍有其他成员时，最后一位管理员须先移交管理员权限。
- `closeFamily {familyId,requestId?}` 仅家庭最后一位成员可执行，返回 `{familyId,recoverUntil}`。退出后旧邀请失效，库存和历史保留 72 小时。
- `listRecoverableFamilies {}` 返回当前微信账号可找回的家庭 `[{id,name,recoverUntil}]`。截止时间为 Unix 毫秒时间戳。
- `restoreFamily {familyId,requestId?}` 仅允许原微信账号在没有当前家庭且未到期时执行。恢复库存、历史和管理员身份，旧邀请保持失效。
- `createItem {name,category,spec,unit,mode,expiryMode,packSize,openDays,lowStock,expiryWarningDays?,openWarningDays?,runoutDays?}`。
- `preview {text}` 返回待确认行 `raw,name,quantity,unit,packSize,expiry,itemId,needsConfirmation`。解析不确认、不入库。
- `intake {requestId,source:initial/purchase,rows:[{itemId,quantity,packSize?,expiry?,date?,openedAt?}]}`，实际入库为quantity乘packSize。
- `use {itemId,quantity,date,endDate?,batchId?,requestId?}`。
- `open {itemId,batchId?,date,requestId?}`；`finish {containerId,date,requestId?}`。
- `count {itemId,quantity,date,reason,requestId?}`，数量为盘点结果；容器盘点填写未开封实数，保留使用中容器，避免将半罐等同整罐。
- `loss {itemId,quantity,batchId?,containerId?,reason,date,requestId?}`，指定containerId时结束该容器且排除时长样本。
- `undo {recordId,requestId?}`；`editUse {recordId,quantity,date,endDate?,requestId?}`，仅可更正正常数量使用记录。
- `deleteItems/restoreItems {ids,requestId?}`，仅管理员。
- `invite {}` 返回 `id,token,expiresAt`，7天有效；`revokeInvite {inviteId}`。
- `setRole {memberId,role:admin/member}`；`removeMember {memberId}`，仅管理员，最后管理员不可移除或降级。
- `subscribe {accepted:boolean}`：仅在真实wx.requestSubscribeMessage结果accept后调用，表示本次可尝试发送资格，不保证微信一定发送。
- `trends {itemId?,from?,to?}` 返回流水，按type分别汇总且区间记录保留endDate。

## 部署

创建 `baby_families,baby_routes,baby_invites` 集合，客户端权限均设为不可读写。上传api云函数并安装云端依赖。配置环境变量 `SUBSCRIBE_TEMPLATE_ID,SUBSCRIBE_THING_KEY,SUBSCRIBE_DATE_KEY`，后两者必须对应已申请模板字段（默认thing1/time2）。消息模板内容必须符合真实模板要求，需真机确认。api/config.json包含每日9点定时触发器及subscribeMessage.send权限；上线前核验云环境定时器北京时间配置。Timer入口拒绝客户端OPENID。

缺少云环境、模板、授权或者发送失败不能视为推送成功。notifications记录sending/sent/failed，已成功同一对象同一级别不再发送，紧急级别改变可再次发送。失败后用户可再次订阅并重试。缺失模板不会消耗本地资格。

部署时同步上传 `family-recovery-cleanup` 定时触发器，每小时清理到期家庭及其邀请索引，无需微信订阅模板。找回接口在满 72 小时时立即关闭，实际删除由下一次成功的清理任务处理。建议为 `baby_families` 添加 `recoverOwner, recoverUntil` 复合索引及 `recoverUntil` 单字段索引，并为 `baby_invites` 添加 `familyId` 索引。

## 计算

日用量近7日中至少3个有记录日期才估算；不按漏记零处理。容器至少2个正常用完正时长样本，不纳入报损。有效期当天仍可用，次日起过期。盘点按业务日期及同日录入顺序重放，盘点之前记录只保留历史、不再次扣当前库存。区间横跨盘点必须拆成盘点前后两条，避免对总量进行虚假每日分摊。

`updateItem {itemId,name?,category?,spec?,lowStock?,expiryWarningDays?,openWarningDays?,runoutDays?}` 可编辑描述和阈值。已有管理方式、单位及包装规格不提供原地迁移入口。

`estimate.expectedDate` 为当前日加预计天数向上取整，数据不足返回null。finish正常用完记录支持edit/undo，保留原记录与关联更正历史。

发送记录为sending时若云函数中断，投递结果未知，不自动重发以避免同一授权重复发送；需要管理员核实云日志及微信投递结果后再人工处理。当前没有自动判定外部系统投递结果的可靠机制，不能将sending视为sent。首次部署需要实际模板字段和真机联调。
