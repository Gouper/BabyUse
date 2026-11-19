const config = require("./config");
App({
  onLaunch() {
    if (wx.cloud && config.envId)
      wx.cloud.init({ env: config.envId, traceUser: true });
  },
});
