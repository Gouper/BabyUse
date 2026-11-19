const pendingRequests = new Map();
const config = require("../config");
async function api(action, payload = {}) {
  if (!config.envId)
    throw new Error("尚未连接云环境，请完成 config.js 配置后重试");
  const mutable = !["snapshot", "preview", "trends"].includes(action);
  const clean = { ...payload };
  delete clean.requestId;
  const key = action + JSON.stringify(clean);
  if (mutable) {
    if (!pendingRequests.has(key))
      pendingRequests.set(key, payload.requestId || requestId());
    payload = { ...payload, requestId: pendingRequests.get(key) };
  }
  const response = await wx.cloud.callFunction({
    name: "api",
    data: { action, payload },
  });
  const r = response.result;
  if (!r || !r.ok)
    throw new Error(
      (r && r.error && (r.error.message || r.error)) || "操作失败，请重试",
    );
  if (mutable) pendingRequests.delete(key);
  return r.data;
}
function error(e) {
  wx.showModal({
    title: "未完成操作",
    content: String(e.message || e),
    showCancel: false,
  });
}
function today() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
function requestId() {
  return Date.now() + "-" + Math.random().toString(36).slice(2);
}
module.exports = { api, error, today, requestId };
