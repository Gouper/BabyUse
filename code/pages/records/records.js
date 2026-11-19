const { api, error, requestId } = require("../../utils/api");
Page({
  data: {
    records: [],
    typeNames: {
      initial: "整理现有物品",
      purchase: "采购入库",
      use: "正常消耗",
      open: "记录开封",
      finish: "正常用完",
      loss: "报损",
      count: "盘点校准",
      undo: "撤销记录",
      delete: "移入回收站",
      restore: "恢复物品",
    },
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const s = await api("snapshot");
      const names = Object.fromEntries(
        s.items.map((i) => [i.id, i.name + " " + i.spec]),
      );
      this.setData({
        records: s.records
          .map((r) => ({ ...r, itemName: names[r.itemId] || "家庭操作", actorName: r.actor === s.currentMemberId ? "我" : s.members.some(m => m.id === r.actor) ? "家庭成员 " + (s.members.findIndex(m => m.id === r.actor) + 1) : "已退出成员 " + String(r.actor || "").slice(-4) }))
          .reverse(),
        error: "",
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async undo(e) {
    wx.showModal({
      title: "撤销这条记录？",
      content: "原始流水仍会保留，更正会关联原记录。",
      success: async (r) => {
        if (r.confirm)
          try {
            await api("undo", {
              recordId: e.currentTarget.dataset.id,
              requestId: requestId(),
            });
            this.load();
          } catch (e) {
            error(e);
          }
      },
    });
  },
  edit(e) {
    wx.navigateTo({
      url:
        "/pages/editor/editor?kind=edit&recordId=" +
        e.currentTarget.dataset.id +
        "&itemId=" +
        e.currentTarget.dataset.item +
        "&recordType=" +
        e.currentTarget.dataset.type,
    });
  },
  recordUse(e) {
    const id = e && e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/editor/editor?kind=use" + (id ? "&itemId=" + id : "") });
  },
  items() {
    wx.switchTab({ url: "/pages/items/items" });
  },
});
