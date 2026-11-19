const { api, error, requestId } = require("../../utils/api");
const config = require("../../config");
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingDeadline(timestamp) {
  return new Date(timestamp + BEIJING_OFFSET_MS)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

Page({
  data: {
    family: null,
    members: [],
    invites: [],
    recoverableFamilies: [],
    form: {},
    token: "",
    shareToken: "",
    busy: false,
  },
  onLoad(q) {
    if (q.token) this.setData({ token: q.token });
  },
  onShow() {
    this.load();
  },
  async load() {
    const version = (this.loadVersion || 0) + 1;
    this.loadVersion = version;
    try {
      const snapshot = await api("snapshot");
      if (version !== this.loadVersion) return;
      const isAdmin = snapshot.members.some(
        (m) => m.id === snapshot.currentMemberId && m.role === "admin",
      );
      const shareToken = this.data.shareToken;
      const canShare =
        isAdmin &&
        snapshot.family?.id === this.data.family?.id &&
        shareToken &&
        snapshot.invites.some(
          (invite) => invite.token === shareToken && !invite.revoked,
        );
      this.setData({
        ...snapshot,
        isAdmin,
        shareToken: canShare ? shareToken : "",
        recoverableFamilies: [],
        error: "",
      });
      if (snapshot.family) return;
      const families = await api("listRecoverableFamilies");
      if (version !== this.loadVersion) return;
      this.setData({
        recoverableFamilies: families.map((family) => ({
          ...family,
          deadline: beijingDeadline(family.recoverUntil),
        })),
      });
    } catch (e) {
      if (version === this.loadVersion) this.setData({ error: e.message });
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
      const result = await api(action, { ...p, requestId: requestId() });
      if (action === "invite") this.setData({ shareToken: result.token });
      await this.load();
    } catch (e) {
      if (["closeFamily", "restoreFamily", "leave"].includes(action))
        await this.load();
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
  invite() {
    return this.act("invite");
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
    const { family, members, currentMemberId, isAdmin, busy } = this.data;
    if (!family || busy) return;
    const close = members.length === 1 && members[0].id === currentMemberId;
    const needsTransfer =
      !close && isAdmin && members.filter((m) => m.role === "admin").length === 1;
    wx.showModal({
      title: close ? "退出并关闭家庭？" : "退出家庭？",
      content: close
        ? "库存和历史记录保留 72 小时，期间可用原微信账号找回。旧邀请会立即失效。"
        : needsTransfer
          ? "请先将其他成员设为管理员，再退出家庭。"
          : "退出后将无法访问此家庭的库存，历史记录仍保留。",
      showCancel: !needsTransfer,
      success: (r) =>
        r.confirm &&
        !needsTransfer &&
        this.act(close ? "closeFamily" : "leave", { familyId: family.id }),
    });
  },
  restore(e) {
    if (this.data.family || this.data.busy) return;
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: "找回家庭？",
      content: "找回后，你将重新成为管理员，可以继续查看库存和历史记录。",
      success: (r) => r.confirm && this.act("restoreFamily", { familyId: id }),
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
