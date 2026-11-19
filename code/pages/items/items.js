const { api, error, requestId } = require("../../utils/api");
Page({
  data: {
    family: null,
    loading: true,
    error: "",
    items: [],
    visible: [],
    query: "",
    trash: false,
    selected: [],
  },
  onShow() {
    return this.load();
  },
  canUseItems() {
    const { family, loading, error } = this.data;
    return Boolean(family && !loading && !error);
  },
  openFamily() {
    wx.switchTab({ url: "/pages/family/family" });
  },
  async load() {
    const version = (this.loadVersion || 0) + 1;
    this.loadVersion = version;
    this.setData({ loading: true, error: "", selected: [] });
    try {
      const { family, items, members, currentMemberId } = await api("snapshot");
      if (version !== this.loadVersion) return;
      const changed = family?.id !== this.data.family?.id;
      this.setData({
        family,
        items: family ? items : [],
        isAdmin: Boolean(family) && members.some(
          (m) => m.id === currentMemberId && m.role === "admin",
        ),
        ...(changed && { query: "", trash: false }),
      });
      this.filter();
      this.setData({ loading: false });
    } catch (e) {
      if (version === this.loadVersion)
        this.setData({
          loading: false,
          error: String(e?.message || e?.errMsg || "暂时无法加载用品"),
        });
    }
  },
  search(e) {
    if (!this.canUseItems()) return;
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
    if (!this.canUseItems() || !this.data.isAdmin) return;
    this.setData({ selected: e.detail.value });
  },
  bulk() {
    const { isAdmin, selected, trash } = this.data;
    if (!this.canUseItems() || !isAdmin || !selected.length) return;
    const version = this.loadVersion;
    wx.showModal({
      title: trash ? "恢复所选物品？" : "将所选物品移入回收站？",
      content: "保留全部历史流水。",
      success: async (r) => {
        if (!r.confirm || version !== this.loadVersion || !this.canUseItems())
          return;
        try {
          await api(trash ? "restoreItems" : "deleteItems", {
            ids: selected,
            requestId: requestId(),
          });
          if (version === this.loadVersion) await this.load();
        } catch (e) {
          error(e);
        }
      },
    });
  },
  toggle() {
    if (!this.canUseItems()) return;
    this.setData({ trash: !this.data.trash, selected: [] });
    this.filter();
  },
  detail(e) {
    if (!this.canUseItems()) return;
    wx.navigateTo({ url: "/pages/item/item?id=" + e.currentTarget.dataset.id });
  },
  recordUse(e) {
    if (!this.canUseItems()) return;
    const id = e && e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/editor/editor?kind=use" + (id ? "&itemId=" + id : "") });
  },
  add() {
    if (!this.canUseItems()) return;
    wx.navigateTo({ url: "/pages/editor/editor?kind=item" });
  },
  intake(e) {
    if (!this.canUseItems()) return;
    wx.navigateTo({
      url: "/pages/intake/intake?source=" + e.currentTarget.dataset.source,
    });
  },
});
