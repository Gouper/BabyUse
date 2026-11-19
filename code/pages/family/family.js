const { api, error, requestId } = require("../../utils/api");
const config = require("../../config");
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingDeadline(timestamp) {
  return new Date(timestamp + BEIJING_OFFSET_MS)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function inviteAvailable(invite, now = Date.now()) {
  return Boolean(
    invite.token && !invite.revoked && Date.parse(invite.expiresAt) > now,
  );
}

function invitationView(invite) {
  const expiresAt = Date.parse(invite.expiresAt);
  return {
    ...invite,
    available: inviteAvailable(invite),
    deadline: Number.isFinite(expiresAt) ? beijingDeadline(expiresAt) : "",
  };
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
      const invites = isAdmin ? snapshot.invites.map(invitationView) : [];
      const shareInvite = invites
        .slice()
        .reverse()
        .find((invite) => invite.available);
      this.setData({
        ...snapshot,
        isAdmin,
        invites,
        shareToken: shareInvite?.token || "",
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
    const familyId = this.data.family?.id;
    try {
      this.setData({ busy: true });
      const result = await api(action, { ...p, requestId: requestId() });
      if (
        action === "invite" &&
        familyId === this.data.family?.id &&
        this.data.isAdmin
      ) {
        const invite = invitationView(result);
        this.setData({
          invites: [
            ...this.data.invites.filter((item) => item.id !== invite.id),
            invite,
          ],
          shareToken: invite.available ? invite.token : "",
        });
      }
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
  copyInvite(e) {
    if (!this.data.family || !this.data.isAdmin) return;
    const { id } = e.currentTarget.dataset;
    const invite = this.data.invites.find((invite) => invite.id === id);
    if (invite && inviteAvailable(invite))
      wx.setClipboardData({ data: invite.token, fail: error });
  },
  onShareAppMessage() {
    const path = "/pages/family/family";
    const { family, isAdmin, invites, shareToken } = this.data;
    const invite = family && isAdmin && invites.find((item) => item.token === shareToken);
    return {
      title: "一起照顾宝宝的日常用品",
      path: invite && inviteAvailable(invite)
        ? path + "?token=" + encodeURIComponent(invite.token)
        : path,
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
