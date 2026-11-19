const { api, error, requestId } = require("../../utils/api");
Page({
  data: { item: {}, batches: [], containers: [] },
  onLoad(q) {
    this.id = q.id;
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const s = await api("snapshot");
      this.setData({
        item: s.items.find((i) => i.id === this.id) || {},
        itemMode: (s.items.find((i) => i.id === this.id) || {}).mode,
        batches: (s.items.find((i) => i.id === this.id) || { batches: [] })
          .batches,
        containers: s.containers.filter((c) => c.itemId === this.id),
        alerts: s.alerts.filter((a) => a.itemId === this.id),
      });
    } catch (e) {
      error(e);
    }
  },
  record(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({
      url:
        "/pages/editor/editor?kind=" +
        d.kind +
        "&itemId=" +
        this.id +
        "&containerId=" +
        (d.container || "") +
        "&batchId=" +
        (d.batch || ""),
    });
  },
  toggleStock() {
    this.setData({ showStock: !this.data.showStock });
  },
  edit() {
    wx.navigateTo({ url: "/pages/editor/editor?kind=item&itemId=" + this.id });
  },
  async remove() {
    wx.showModal({
      title: this.data.item.deleted ? "恢复物品？" : "将物品移入回收站？",
      content: "历史流水会继续保留。",
      success: async (r) => {
        if (r.confirm)
          try {
            await api(this.data.item.deleted ? "restoreItems" : "deleteItems", {
              ids: [this.id],
              requestId: requestId(),
            });
            this.load();
          } catch (e) {
            error(e);
          }
      },
    });
  },
});
