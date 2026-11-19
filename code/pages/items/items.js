const { api, error, requestId } = require("../../utils/api");
Page({
  data: { items: [], visible: [], query: "", trash: false, selected: [] },
  onShow() {
    this.load();
  },
  async load() {
    try {
      this.setData({ error: "" });
      const snapshot = await api("snapshot");
      this.setData({
        ...snapshot,
        isAdmin: snapshot.members.some(
          (m) => m.id === snapshot.currentMemberId && m.role === "admin",
        ),
      });
      this.filter();
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  search(e) {
    this.setData({ query: e.detail.value });
    this.filter();
  },
  filter() {
    this.setData({
      visible: this.data.items.filter(
        (i) =>
          Boolean(i.deleted) === this.data.trash &&
          (i.name + " " + i.category + " " + i.spec).includes(this.data.query),
      ),
    });
  },
  select(e) {
    this.setData({ selected: e.detail.value });
  },
  bulk() {
    if (!this.data.selected.length) return;
    wx.showModal({
      title: this.data.trash ? "恢复所选物品？" : "将所选物品移入回收站？",
      content: "保留全部历史流水。",
      success: async (r) => {
        if (r.confirm)
          try {
            await api(this.data.trash ? "restoreItems" : "deleteItems", {
              ids: this.data.selected,
              requestId: requestId(),
            });
            this.setData({ selected: [] });
            this.load();
          } catch (e) {
            error(e);
          }
      },
    });
  },
  toggle() {
    this.setData({ trash: !this.data.trash });
    this.filter();
  },
  detail(e) {
    wx.navigateTo({ url: "/pages/item/item?id=" + e.currentTarget.dataset.id });
  },
  recordUse(e) {
    const id = e && e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/editor/editor?kind=use" + (id ? "&itemId=" + id : "") });
  },
  add() {
    wx.navigateTo({ url: "/pages/editor/editor?kind=item" });
  },
  intake(e) {
    wx.navigateTo({
      url: "/pages/intake/intake?source=" + e.currentTarget.dataset.source,
    });
  },
});
