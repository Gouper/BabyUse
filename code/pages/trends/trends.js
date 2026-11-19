const { api, error, today } = require("../../utils/api");
const { series, layout, isConsumption } = require("./chart");

const STOCK = 0;
const CONSUMPTION = 1;
const PURCHASE = 2;
const isInterval = (point) => point.endDate > point.date;

const chartColors = {
  light: {
    grid: "#eeeaf5",
    label: "#80768f",
    axis: "#b9b0c8",
    line: "#8064bd",
    panel: "#ffffff",
  },
  dark: {
    grid: "#3b3449",
    label: "#b8afc8",
    axis: "#756a89",
    line: "#bba8ff",
    panel: "#262231",
  },
};

Page({
  data: {
    items: [],
    names: [],
    index: 0,
    from: "",
    to: today(),
    rows: [],
    mode: CONSUMPTION,
    modes: ["库存变化", "消耗趋势", "采购入库"],
    modeChoices: [CONSUMPTION, STOCK, PURCHASE],
    points: [],
    inferredPoints: [],
    loading: false,
  },
  async onLoad() {
    try {
      const s = await api("snapshot");
      const items = s.items.filter(i => !i.deleted);
      this.setData({ items, names: items.map(i => i.name + " " + (i.spec || "")) });
      await this.load();
    } catch (e) {
      error(e);
    }
  },
  onReady() {
    if (wx.onThemeChange && wx.offThemeChange) {
      this.themeListener = ({ theme }) => {
        this.chartTheme = theme;
        this.drawChart();
      };
      wx.onThemeChange(this.themeListener);
    }
    this.drawChart();
  },
  onUnload() {
    this.unloaded = true;
    this.loadVersion = (this.loadVersion || 0) + 1;
    if (this.themeListener) wx.offThemeChange(this.themeListener);
  },
  onResize() {
    this.drawChart();
  },
  pick(e) {
    this.setData({ index: Number(e.detail.value) });
    this.load();
  },
  mode(e) {
    this.setData({ mode: Number(e.currentTarget.dataset.mode) });
    this.chart();
  },
  date(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
    this.load();
  },
  async load() {
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    const item = this.data.items[this.data.index];
    this.all = [];
    this.setData({
      rows: [],
      points: [],
      inferredPoints: [],
      lastPoint: null,
      chartError: "",
      loading: !!item,
    });
    this.drawChart();
    if (!item) return;
    const from = this.data.from;
    const to = this.data.to;
    if (from && from > to) {
      this.setData({ loading: false, chartError: "起始日期不能晚于结束日期" });
      return;
    }
    try {
      // A later count may anchor the opening balance inside the selected range.
      const all = await api("trends", { itemId: item.id, to: today() });
      if (this.unloaded || version !== this.loadVersion) return;
      const openedBatches = new Set(
        (item.batches || []).filter((batch) => batch.openedAt).map((batch) => batch.id),
      );
      this.all = all
        .filter((r) => !r.voided)
        .map((r) => ({
          ...r,
          openedWithCount: r.type === "initial" && openedBatches.has(r.batchId),
        }))
        .sort((a, b) =>
          a.date.localeCompare(b.date) ||
          (a.createdAt || "").localeCompare(b.createdAt || "") ||
          (a.order || 0) - (b.order || 0),
        );
      this.setData({
        unit: item.unit,
        containerMode: item.mode === "container",
        loading: false,
      });
      this.chart();
    } catch (e) {
      if (this.unloaded || version !== this.loadVersion) return;
      this.setData({ loading: false, chartError: e.message });
    }
  },
  chart() {
    const { mode, containerMode, from, to } = this.data;
    const records = this.all || [];
    const points = series(records, mode, containerMode, from)
      .filter((point) => point.date <= to);
    const rows = records.filter((record) => {
      if ((from && record.date < from) || record.date > to) return false;
      if (mode === CONSUMPTION) return isConsumption(record, containerMode);
      if (mode === PURCHASE) return record.type === "purchase";
      return true;
    });
    this.setData({
      rows,
      points,
      inferredPoints: points.filter((point) => point.inferred),
      hasIntervals: mode === CONSUMPTION && points.some(isInterval),
      lastPoint: points.length ? points[points.length - 1] : null,
    }, () => this.drawChart());
  },
  drawChart() {
    if (this.unloaded || !wx.createSelectorQuery) return;
    const version = this.drawVersion = (this.drawVersion || 0) + 1;
    wx.createSelectorQuery().in(this)
      .select("#trendChart")
      .fields({ node: true, size: true })
      .exec((results) => {
      if (this.unloaded || version !== this.drawVersion) return;
      const result = results && results[0];
      if (!result || !result.node || !result.width || !result.height) return;
      const canvas = result.node;
      const ctx = canvas.getContext("2d");
      const ratio = wx.getWindowInfo
        ? wx.getWindowInfo().pixelRatio
        : wx.getSystemInfoSync().pixelRatio;
      canvas.width = result.width * ratio;
      canvas.height = result.height * ratio;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, result.width, result.height);
      const graph = layout(this.data.points, result.width, result.height);
      const theme = this.chartTheme || (wx.getAppBaseInfo
        ? wx.getAppBaseInfo().theme
        : wx.getSystemInfoSync && wx.getSystemInfoSync().theme);
      const colors = theme === "dark" ? chartColors.dark : chartColors.light;
      ctx.font = "11px sans-serif";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const value = graph.min + (graph.max - graph.min) * i / 4;
        const y = graph.bottom - (graph.bottom - graph.top) * i / 4;
        ctx.strokeStyle = colors.grid;
        ctx.beginPath();
        ctx.moveTo(graph.left, y);
        ctx.lineTo(graph.right, y);
        ctx.stroke();
        ctx.fillStyle = colors.label;
        ctx.textAlign = "right";
        ctx.fillText(String(Number(value.toFixed(2))), graph.left - 8, y + 4);
      }
      ctx.textAlign = "left";
      ctx.fillText(this.data.unit || "数量", 8, 14);
      ctx.strokeStyle = colors.axis;
      ctx.beginPath();
      ctx.moveTo(graph.left, graph.top);
      ctx.lineTo(graph.left, graph.bottom);
      ctx.lineTo(graph.right, graph.bottom);
      ctx.stroke();
      for (const tick of graph.ticks) {
        ctx.textAlign = tick.x === graph.left ? "left" : tick.x === graph.right ? "right" : "center";
        ctx.fillText(tick.label, tick.x, graph.bottom + 22);
      }
      if (!graph.points.length) return;
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const linePoints = this.data.mode === CONSUMPTION
        ? graph.points.filter((point) => !isInterval(point))
        : graph.points;
      linePoints.forEach((p, i) => {
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      for (const p of graph.points) {
        const interval = this.data.mode === CONSUMPTION && isInterval(p);
        ctx.beginPath();
        ctx.arc(p.x, p.y, interval ? 5 : 3, 0, Math.PI * 2);
        if (!interval) {
          ctx.fillStyle = p.inferred ? colors.panel : colors.line;
          ctx.fill();
        }
        if (p.inferred || interval) ctx.stroke();
      }
    });
  },
});
