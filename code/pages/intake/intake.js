const { api, error, requestId, today } = require("../../utils/api");
Page({
  data: {
    source: "initial",
    date: today(),
    today: today(),
    items: [],
    loading: true,
    loadError: "",
    pasteOpen: false,
    parsing: false,
    rows: [],
    text: "",
    preview: false,
    busy: false,
  },
  async onLoad(q) {
    this.pendingItemId = q.itemId || "";
    this.setData({ source: q.source === "purchase" ? "purchase" : "initial" });
    await this.loadItems();
  },
  onShow() {
    if (this.itemCreation) this.itemCreation.navigationPending = false;
  },
  async loadItems() {
    this.setData({ loading: true, loadError: "" });
    try {
      const s = await api("snapshot");
      const items = s.items.filter((i) => !i.deleted);
      const item = items.find((i) => i.id === this.pendingItemId);
      this.pendingItemId = "";
      this.setData({ items });
      if (item) this.selectSupply(item);
    } catch (e) {
      this.setData({ loadError: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  date(e) {
    this.confirmedFingerprint = "";
    this.setData({ date: e.detail.value, preview: false });
  },
  validDate() {
    const value = this.data.date;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value &&
      value <= today();
  },
  fingerprint() {
    return JSON.stringify({
      source: this.data.source,
      date: this.data.date,
      rows: this.data.rows.map((r) => ({
        itemId: r.itemId,
        quantity: Number(r.quantity),
        packSize: Number(r.packSize),
        expiry: r.expiry || "",
        openedAt: r.openedAt || "",
      })),
    });
  },
  text(e) {
    this.setData({ text: e.detail.value, preview: false });
  },
  rowFor(item, extra = {}, rowKey) {
    if (rowKey === undefined) {
      this.rowSequence = (this.rowSequence || 0) + 1;
      rowKey = this.rowSequence;
    }
    return {
      quantity: 1, expiry: "", openedAt: "", ...extra,
      rowKey,
      itemId: item ? item.id : "",
      displayName: item ? item.name : "",
      spec: item ? item.spec || "" : "",
      unit: item ? item.unit : "",
      itemMode: item ? item.mode : "",
      expiryMode: item ? item.expiryMode : "",
      packSize: extra.packSize || (item && item.packSize) || 1,
      showDetails: false,
    };
  },
  togglePaste() {
    this.setData({ pasteOpen: !this.data.pasteOpen });
  },
  add(e) {
    const item = this.data.items.find((i) => i.id === e.detail.id);
    this.selectSupply(item);
  },
  pick(e) {
    const item = this.data.items.find((i) => i.id === e.detail.id);
    this.selectSupply(item, Number(e.currentTarget.dataset.n));
  },
  selectSupply(item, index) {
    if (!item || this.data.busy || this.data.parsing || this.saved) return;
    const rows = this.data.rows.slice();
    if (index === undefined) {
      rows.push(this.rowFor(item));
    } else {
      const row = rows[index];
      if (!row || row.itemId === item.id) return;
      rows[index] = this.rowFor(item, { quantity: row.quantity, raw: row.raw, parsed: row.parsed }, row.rowKey);
    }
    this.setData({ rows, preview: false });
  },
  createSupply(e) {
    if (this.itemCreation?.navigationPending || this.data.busy || this.data.parsing || this.saved) return;
    const { n } = e.currentTarget.dataset;
    const index = n === undefined ? undefined : Number(n);
    const row = this.data.rows[index];
    if (index !== undefined && !row) return;
    const rowKey = row?.rowKey;
    const creation = { navigationPending: true };
    this.itemCreation = creation;

    wx.navigateTo({
      url: "/pages/editor/editor?kind=item&fromIntake=1",
      events: {
        itemCreated: (item) => {
          if (this.itemCreation !== creation) return;
          this.itemCreation = null;
          if (typeof item?.id !== "string" || !item.id) {
            error(new Error("未取得新用品，请重新选择用品"));
            return;
          }
          this.setData({ items: this.data.items.filter((i) => i.id !== item.id).concat(item) });
          const target = row ? this.data.rows.findIndex((r) => r.rowKey === rowKey) : undefined;
          if (target !== -1) this.selectSupply(item, target);
        },
      },
      fail: () => {
        if (this.itemCreation !== creation) return;
        this.itemCreation = null;
        error(new Error("无法打开添加用品，请重试"));
      },
    });
  },
  step(e) {
    if (this.data.busy) return;
    const n = Number(e.currentTarget.dataset.n);
    const rows = this.data.rows.slice();
    const quantity = Number(rows[n].quantity);
    rows[n] = { ...rows[n], quantity: Math.max(1, (Number.isFinite(quantity) ? quantity : 0) + Number(e.currentTarget.dataset.delta)) };
    this.setData({ rows, preview: false });
  },
  toggleDetails(e) {
    const n = Number(e.currentTarget.dataset.n);
    const rows = this.data.rows.slice();
    rows[n] = { ...rows[n], showDetails: !rows[n].showDetails };
    this.setData({ rows });
  },
  clearDate(e) {
    this.change({ currentTarget: e.currentTarget, detail: { value: "" } });
  },
  change(e) {
    if (this.data.busy) return;
    const d = e.currentTarget.dataset;
    this.setData({
      ["rows[" + d.n + "]." + d.key]: e.detail.value,
      preview: false,
    });
  },
  remove(e) {
    if (this.data.busy) return;
    this.setData({
      rows: this.data.rows.filter(
        (_, i) => i !== Number(e.currentTarget.dataset.n),
      ),
      preview: false,
    });
  },
  async parse() {
    if (this.data.busy || this.data.parsing) return;
    this.setData({ parsing: true });
    try {
      const rows = await api("preview", { text: this.data.text });
      this.setData({
        rows: this.data.rows.filter((r) => !r.parsed).concat(rows.map((r) => this.rowFor(
          this.data.items.find((i) => i.id === r.itemId), { ...r, parsed: true },
        ))),
        preview: false,
      });
    } catch (e) {
      error(e);
    } finally {
      this.setData({ parsing: false });
    }
  },
  preview() {
    if (this.data.parsing || this.data.busy) return;
    if (!this.validDate())
      return error(new Error("请选择今天或之前的实际入库日期"));
    if (!this.data.rows.length) return error(new Error("请先添加物品"));
    if (
      this.data.rows.some(
        (r) =>
          !r.itemId ||
          !Number.isFinite(Number(r.quantity)) || !(Number(r.quantity) > 0) ||
          !Number.isFinite(Number(r.packSize)) || !(Number(r.packSize) > 0),
      )
    )
      return error(new Error("请确认每行物品、数量和包装换算"));
    this.requestId = requestId();
    this.previewFingerprint = this.fingerprint();
    this.setData({ preview: true });
  },
  async save() {
    if (this.data.busy || this.data.parsing || this.saved) return;
    if (!this.data.preview || this.previewFingerprint !== this.fingerprint())
      return error(new Error("内容已变更，请重新核对并预览"));
    if (!this.validDate())
      return error(new Error("请选择今天或之前的实际入库日期"));
    try {
      this.setData({ busy: true });
      const fingerprint = this.fingerprint();
      const previous = wx.getStorageSync("lastIntake");
      if (previous === fingerprint && this.confirmedFingerprint !== fingerprint) {
        const r = await new Promise((resolve) =>
          wx.showModal({
            title: "可能重复入库",
            content: "上次已保存相同内容，确认这是另一笔真实入库吗？",
            success: resolve,
          }),
        );
        if (!r.confirm) return;
        this.confirmedFingerprint = fingerprint;
      }
      if (!this.data.preview || fingerprint !== this.fingerprint())
        throw new Error("内容已变更，请重新核对并预览");
      await api("intake", {
        source: this.data.source,
        requestId: this.requestId,
        rows: this.data.rows.map((r) => ({
          itemId: r.itemId,
          date: this.data.date,
          quantity: Number(r.quantity),
          packSize: Number(r.packSize),
          openedAt: r.openedAt || undefined,
          expiry: r.expiry || undefined,
        })),
      });
      this.saved = true;
      wx.setStorageSync("lastIntake", fingerprint);
      wx.showToast({ title: this.data.source === "purchase" ? "已入库" : "已保存清点" });
      wx.navigateBack();
    } catch (e) {
      error(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
