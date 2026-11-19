const { api, error, today, requestId } = require("../../utils/api");
const { presets, optionsFor, quickOptionsFor } = require("./presets");
const modes = ["quantity", "container"],
  expiryModes = ["none", "package", "opened"];

function hasCustomPackSize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 && size !== 1;
}

Page({
  data: {
    kind: "item",
    modeIndex: 0,
    expiryIndex: 0,
    templateIndex: 0,
    templateNames: ['请选择用品类型', ...presets.map(item => item.name), '自定义用品'],
    choiceOptions: optionsFor(),
    quickOptions: {},
    manualFields: {},
    showReminders: false,
    packReview: false,
    openReview: false,
    modeNames: ["按数量消耗", "按开封／用完"],
    expiryNames: ["不管理有效期", "包装有效期", "包装和开封期限"],
    form: {
      name: "",
      category: "",
      spec: "",
      unit: "",
      packSize: 1,
      openDays: "",
      lowStock: 0,
      runoutDays: 7,
      expiryWarningDays: 30,
      openWarningDays: 3,
      date: today(),
      endDate: "",
      quantity: "",
      reason: "",
    },
    items: [],
    loadingItems: false,
    usageAction: 0,
    usageActions: ["开始用一罐／瓶", "用完一罐／瓶"],
    activeContainers: [],
    containerIndex: 0,
    moreUsage: false,
    busy: false,
    fieldErrors: {},
  },
  async onLoad(q) {
    this.requestId = requestId();
    this.editedFields = new Set();
    const historicalCount = q.kind === "count" && q.history === "1";
    this.setData({
      kind: q.kind || "item",
      fromIntake: q.fromIntake === '1',
      choiceOptions: optionsFor(null, '', q.kind),
      historicalCount,
      selectRecordItem: q.kind === "use" || historicalCount,
      latestDate: today(),
      recordType: q.recordType || "",
      itemId: q.itemId || "",
      containerId: q.containerId || "",
      batchId: q.batchId || "",
      recordId: q.recordId || "",
    });
    if (historicalCount) this.setData({ "form.date": "" });
    if (this.data.selectRecordItem) await this.loadUsageItems();
    if (q.kind === "item" && q.itemId)
      try {
        const s = await api("snapshot"),
          i = s.items.find((i) => i.id === q.itemId);
        this.setData({
          form: { ...this.data.form, ...i },
          choiceOptions: optionsFor(presets.find(item => item.name === i.name), i.unit),
          modeIndex: modes.indexOf(i.mode),
          expiryIndex: expiryModes.indexOf(i.expiryMode),
        });
      } catch (e) {
        error(e);
      }
  },
  async loadUsageItems() {
    this.setData({ loadingItems: true, loadError: "" });
    try {
      const snapshot = await api("snapshot");
      this.containers = snapshot.containers || [];
      const items = snapshot.items.filter((i) => !i.deleted);
      const index = items.findIndex(i => i.id === this.data.itemId);
      this.setData({ items });
      if (index >= 0) this.chooseItem(index);
    } catch (e) {
      this.setData({ loadError: e.message });
    } finally {
      this.setData({ loadingItems: false });
    }
  },
  chooseItem(index) {
    const selectedItem = this.data.items[index];
    if (!selectedItem) return;
    const activeContainers = (this.containers || [])
      .filter((c) => c.itemId === selectedItem.id && !c.endedAt)
      .map((c, n) => ({
        ...c,
        label: "第" + (n + 1) + "份 · " + c.openedAt + "开封",
      }));
    this.setData({
      itemId: selectedItem.id,
      selectedItem,
      activeContainers,
      containerIndex: 0,
      usageAction: 0,
      "form.quantity": "",
      "form.endDate": "",
      moreUsage: false,
    });
  },
  selectItem(e) {
    if (e.detail.id === this.data.selectedItem?.id) return;
    this.chooseItem(this.data.items.findIndex((item) => item.id === e.detail.id));
  },
  selectUsageAction(e) {
    this.setData({ usageAction: Number(e.detail.value) });
  },
  selectContainer(e) {
    this.setData({ containerIndex: Number(e.detail.value) });
  },
  toggleMoreUsage() {
    this.setData({ moreUsage: !this.data.moreUsage, "form.endDate": "" });
  },
  chooseTemplate(e) {
    const index = Number(e.detail.value);
    if (index > 0) this.preset({ currentTarget: { dataset: { index: index - 1 } } });
  },
  preset(e) {
    if (this.data.itemId || this.data.busy) return;
    const index = Number(e.currentTarget.dataset.index);
    const selected = presets[index] || {};
    const templateIndex = index + 1;
    if (templateIndex === this.data.templateIndex) return;
    const form = { ...this.data.form };
    const fieldErrors = { ...this.data.fieldErrors };
    for (const key of ['name', 'category', 'unit']) {
      if (this.editedFields.has(key)) continue;
      form[key] = selected[key] || '';
      fieldErrors[key] = '';
    }
    this.setData({
      templateIndex,
      form,
      fieldErrors,
      choiceOptions: optionsFor(selected, form.unit),
      quickOptions: quickOptionsFor(presets[index]),
      modeIndex: this.editedFields.has('mode') ? this.data.modeIndex : (selected.modeIndex || 0),
      expiryIndex: this.editedFields.has('expiry') ? this.data.expiryIndex : (selected.expiryIndex || 0),
      manualFields: index === presets.length ? { ...this.data.manualFields, name: true } : this.data.manualFields,
      packReview: this.data.packReview || hasCustomPackSize(form.packSize),
      openReview: this.data.openReview || Number(form.openDays) > 0,
    });
  },
  chooseField(e) {
    const key = e.currentTarget.dataset.key;
    const choice = this.data.choiceOptions[key]?.[Number(e.detail.value)];
    if (!choice || choice.prompt) return;
    this.setData({ ['manualFields.' + key]: !!choice.manual });
    if (!choice.manual) this.input({ currentTarget: e.currentTarget, detail: { value: choice.value } });
  },
  chooseQuickOption(e) {
    const { key, value } = e.currentTarget.dataset;
    this.setData({ ['manualFields.' + key]: false });
    this.input({ currentTarget: e.currentTarget, detail: { value } });
  },
  input(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    if (this.data.kind === 'item' && key === 'unit' && this.data.itemId) return;
    this.editedFields.add(key);
    const patch = {
      ['form.' + key]: value,
      fieldErrors: { ...this.data.fieldErrors, [key]: '' },
    };
    if (key === 'unit') {
      patch.choiceOptions = optionsFor(presets[this.data.templateIndex - 1], value);
      if (this.data.form.unit && this.data.form.unit !== value && hasCustomPackSize(this.data.form.packSize))
        patch.packReview = true;
    }
    if (key === 'packSize') patch.packReview = false;
    if (key === 'openDays') patch.openReview = false;
    this.setData(patch);
  },
  confirmValue(e) {
    const key = e.currentTarget.dataset.key;
    this.input({ currentTarget: e.currentTarget, detail: { value: this.data.form[key] } });
  },
  toggleReminders() {
    this.setData({ showReminders: !this.data.showReminders });
  },
  returnFromEditor() {
    wx.navigateBack();
  },
  continueToIntake(e) {
    if (this.openingIntake || !this.data.createdItem) return;
    const source = e.currentTarget.dataset.source === 'purchase' ? 'purchase' : 'initial';
    this.openingIntake = true;
    wx.redirectTo({
      url: '/pages/intake/intake?source=' + source + '&itemId=' + encodeURIComponent(this.data.createdItem.id),
      fail: () => {
        this.openingIntake = false;
        error(new Error('无法打开入库页，请重试'));
      },
    });
  },
  mode(e) {
    if (this.data.itemId) return;
    this.editedFields.add('mode');
    this.setData({
      modeIndex: Number(e.detail.value),
    });
  },
  expiry(e) {
    if (this.data.itemId) return;
    this.editedFields.add('expiry');
    this.setData({ expiryIndex: Number(e.detail.value) });
  },
  validateItem() {
    const f = this.data.form;
    const fieldErrors = {};
    if (!String(f.name || "").trim()) fieldErrors.name = "请填写用品名称";
    if (!String(f.unit || "").trim()) fieldErrors.unit = "请填写计数单位，如片、罐、瓶";
    if (!this.data.itemId) {
      if (!Number.isFinite(Number(f.packSize)) || Number(f.packSize) <= 0)
        fieldErrors.packSize = "每包包含的数量必须大于 0，如一包 52 片填 52";
      else if (this.data.packReview) fieldErrors.packSize = "请重新核对每包包含的数量";
      if (this.data.expiryIndex === 2 &&
          (!Number.isFinite(Number(f.openDays)) || Number(f.openDays) <= 0))
        fieldErrors.openDays = "请按包装说明填写开封后可使用天数，必须大于 0";
      else if (this.data.expiryIndex === 2 && this.data.openReview)
        fieldErrors.openDays = "请按新用品的包装说明核对开封天数";
    }
    const labels = {
      lowStock: "低库存提醒数量",
      runoutDays: "预计可用天数提醒",
      expiryWarningDays: "包装到期提醒天数",
      openWarningDays: "开封到期提醒天数",
    };
    if (this.data.expiryIndex === 0) delete labels.expiryWarningDays;
    if (this.data.expiryIndex !== 2) delete labels.openWarningDays;
    for (const [key, label] of Object.entries(labels)) {
      if (String(f[key]).trim() === "" || !Number.isFinite(Number(f[key])) || Number(f[key]) < 0)
        fieldErrors[key] = label + "请填写 0 或更大的数字";
    }
    const reminderError = Object.keys(labels).some(key => fieldErrors[key]);
    this.setData({ fieldErrors, showReminders: this.data.showReminders || reminderError });
    return Object.keys(fieldErrors).length === 0;
  },
  async save() {
    if (this.data.busy || this.saved) return;
    try {
      if (this.data.kind === "item" && !this.validateItem()) {
        wx.showToast({ title: "请检查标红的填写项", icon: "none" });
        return;
      }
      if (this.data.selectRecordItem) {
        if (this.data.loadingItems || this.data.loadError) throw new Error("请先加载用品后再保存");
        if (!this.data.selectedItem) throw new Error("请先选择用品");
      }
      if (this.data.historicalCount) {
        const { date, quantity } = this.data.form;
        if (!date || date > this.data.latestDate) throw new Error("请选择实际清点日期");
        if (String(quantity).trim() === "" || !Number.isFinite(Number(quantity)) || Number(quantity) < 0)
          throw new Error("请填写当时实点的剩余数量，已用完填 0");
      }
      if (this.data.kind === "use") {
        if (
          this.data.selectedItem.mode === "quantity" &&
          !(Number(this.data.form.quantity) > 0)
        ) throw new Error("请填写大于 0 的使用数量");
        if (
          this.data.selectedItem.mode === "container" &&
          this.data.usageAction === 1 &&
          !this.data.activeContainers.length
        ) throw new Error("没有正在使用的罐／瓶，请先记录开始使用");
      }
      this.setData({ busy: true });
      const f = { ...this.data.form };
      for (const k of [
        "quantity",
        "packSize",
        "openDays",
        "lowStock",
        "runoutDays",
        "expiryWarningDays",
        "openWarningDays",
      ])
        if (f[k] !== "") f[k] = Number(f[k]);
      const kind = this.data.kind;
      const p =
        kind === "item"
          ? {
              ...f,
              mode: modes[this.data.modeIndex],
              expiryMode: expiryModes[this.data.expiryIndex],
            }
          : {
              itemId: this.data.itemId,
              containerId: this.data.containerId,
              batchId: this.data.batchId || undefined,
              recordId: this.data.recordId || undefined,
              quantity: f.quantity,
              date: f.date,
              endDate: f.endDate || undefined,
              reason: f.reason || (this.data.historicalCount ? "补记历史实点库存" : ""),
            };
      let action = kind;
      if (kind === "use" && this.data.selectedItem.mode === "container") {
        action = this.data.usageAction === 0 ? "open" : "finish";
        p.containerId = action === "finish"
          ? this.data.activeContainers[this.data.containerIndex].id
          : undefined;
        p.quantity = undefined;
        p.endDate = undefined;
      }
      if (kind === 'item') {
        if (this.data.expiryIndex === 0) delete p.expiryWarningDays;
        if (this.data.expiryIndex !== 2) {
          delete p.openDays;
          delete p.openWarningDays;
        }
      }
      const savedItem = await api(
        kind === "item"
          ? this.data.itemId
            ? "updateItem"
            : "createItem"
          : kind === "edit"
            ? "editUse"
            : action,
        {
          ...p,
          itemId: this.data.itemId || p.itemId,
          requestId: this.requestId,
        },
      );
      this.saved = true;
      wx.showToast({ title: "已保存" });
      if (kind === 'item' && !this.data.itemId && savedItem?.id) {
        if (this.data.fromIntake) this.getOpenerEventChannel().emit('itemCreated', savedItem);
        else {
          this.setData({ createdItem: savedItem });
          return;
        }
      }
      this.returnFromEditor();
    } catch (e) {
      error(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
