const { api, error, requestId } = require("../../utils/api");
const config = require("../../config");
Page({
  data: {
    family: null,
    members: [],
    invites: [],
    form: {},
    token: "",
    busy: false,
  },
  onLoad(q) {
    if (q.token) this.setData({ token: q.token });
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const snapshot = await api("snapshot");
      this.setData({
        ...snapshot,
        isAdmin: snapshot.members.some(
          (m) => m.id === snapshot.currentMemberId && m.role === "admin",
        ),
        error: "",
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  input(e) {
    this.setData({ ["form." + e.currentTarget.dataset.key]: e.detail.value });
  },
  token(e) {
    this.setData({ token: e.detail.value });
  },
  async act(action, p = {}) {
    if (this.data.busy) return;
    try {
      this.setData({ busy: true });
      await api(action, { ...p, requestId: requestId() });
      await this.load();
    } catch (e) {
      error(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  create() {
    this.act("createFamily", this.data.form);
  },
  join() {
    this.act("join", { token: this.data.token.trim() });
  },
  async invite() {
    try {
      const inv = await api("invite", { requestId: requestId() });
      this.setData({ shareToken: inv.token });
      await this.load();
    } catch (e) {
      error(e);
    }
  },
  onShareAppMessage() {
    return {
      title: "一起照顾宝宝的日常用品",
      path:
        "/pages/family/family?token=" +
        encodeURIComponent(this.data.shareToken || ""),
    };
  },
  revoke(e) {
    this.act("revokeInvite", { inviteId: e.currentTarget.dataset.id });
  },
  role(e) {
    this.act("setRole", {
      memberId: e.currentTarget.dataset.id,
      role: e.currentTarget.dataset.role,
    });
  },
  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "移除这位成员？",
      content: "对方将无法访问家庭库存，历史记录仍保留。",
      success: (r) => {
        if (r.confirm) this.act("removeMember", { memberId: id });
      },
    });
  },
  leave() {
    wx.showModal({
      title: "退出家庭？",
      content: "最后一位管理员需要先将其他成员设为管理员。",
      success: (r) => {
        if (r.confirm) this.act("leave");
      },
    });
  },
  subscribe() {
    if (!config.reminderTemplateId)
      return error(new Error("尚未配置可用的微信订阅模板"));
    wx.requestSubscribeMessage({
      tmplIds: [config.reminderTemplateId],
      success: (r) =>
        this.act("subscribe", {
          accepted: r[config.reminderTemplateId] === "accept",
        }),
      fail: error,
    });
  },
});
