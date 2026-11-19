const { api } = require("../../utils/api");
Page({
  data: { loading: true, alerts: [], supplies: [] },
  onShow() {
    this.load();
  },
  async load() {
    try {
      this.setData({ loading: true, error: "" });
      const snapshot = await api("snapshot");
      const groups = [
        ["low", "库存偏低", "lavender"],
        ["runningOut", "快用完", "sun"],
        ["expiry", "即将到期", "peach"],
        ["expired", "过期待处理", "rose"],
      ];
      const names = Object.fromEntries(
        snapshot.items.map((i) => [i.id, i.name]),
      );
      this.setData({
        ...snapshot,
        supplies: snapshot.items.filter((item) => !item.deleted).map((item) => {
          const days = item.estimate && item.estimate.days;
          const estimate = !Number.isFinite(days)
            ? "数据不足"
            : days === 0
              ? "0 天"
              : days < 1
                ? "不足 1 天"
                : "约 " + Math.round(days * 10) / 10 + " 天";
          return {
            id: item.id,
            name: item.name,
            spec: item.spec,
            unit: item.unit,
            available: item.available,
            estimate,
            inventoryWarning: item.inventoryWarning,
          };
        }),
        summary: groups.map(([type, label, tone]) => ({
          type,
          label,
          tone,
          count: snapshot.alerts.filter((a) =>
            type === "expiry"
              ? a.type === "expiry" || a.type === "opened"
              : a.type === type,
          ).length,
        })),
        alerts: snapshot.alerts.map((a) => ({
          ...a,
          itemName: names[a.itemId] || "用品提醒",
          tone:
            a.type === "expired"
              ? "rose"
              : a.type === "low"
                ? "lavender"
                : a.type === "runningOut"
                  ? "sun"
                  : "peach",
        })),
      });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  intake() {
    wx.navigateTo({ url: "/pages/intake/intake?source=purchase" });
  },
  recordUse(e) {
    const id = e && e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/editor/editor?kind=use" + (id ? "&itemId=" + id : "") });
  },
  items() {
    wx.switchTab({ url: "/pages/items/items" });
  },
  family() {
    wx.switchTab({ url: "/pages/family/family" });
  },
  trends() {
    wx.navigateTo({ url: "/pages/trends/trends" });
  },
  records() {
    wx.navigateTo({ url: "/pages/records/records" });
  },
  historicalCount() {
    wx.navigateTo({ url: "/pages/editor/editor?kind=count&history=1" });
  },
  detail(e) {
    wx.navigateTo({ url: "/pages/item/item?id=" + e.currentTarget.dataset.id });
  },
});
