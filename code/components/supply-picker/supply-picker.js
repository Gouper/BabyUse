function labelFor(item) {
  return item.name + (item.spec ? " · " + item.spec : "");
}

function matches(item, words) {
  const nameAndSpec = (item.name + (item.spec || ""))
    .toLowerCase()
    .replace(/\s+/g, "");
  return words.every((word) => nameAndSpec.includes(word));
}

Component({
  properties: {
    items: { type: Array, value: [] },
    selectedId: { type: String, value: "" },
    allowCreate: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    placeholder: { type: String, value: "选择用品" },
  },
  data: {
    open: false,
    query: "",
    results: [],
    selectedLabel: "",
  },
  observers: {
    "items, selectedId"() {
      const selected = this.data.items.find((item) => item.id === this.data.selectedId);
      this.setData({ selectedLabel: selected ? labelFor(selected) : "" });
      if (this.data.open) this.updateResults(this.data.query);
    },
    disabled(disabled) {
      if (disabled && this.data.open) this.close();
    },
  },
  methods: {
    toggle() {
      if (this.data.disabled) return;
      if (this.data.open) {
        this.close();
        return;
      }
      this.setData({ open: true });
      this.updateResults("");
    },
    close() {
      this.setData({ open: false, query: "", results: [] });
    },
    updateResults(query) {
      const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const results = this.data.items
        .filter((item) => matches(item, words))
        .map((item) => ({ id: item.id, label: labelFor(item) }));
      this.setData({ query, results });
    },
    search(e) {
      this.updateResults(e.detail.value);
    },
    select(e) {
      if (this.data.disabled || !this.data.open) return;
      const id = e.currentTarget.dataset.id;
      if (!this.data.results.some((item) => item.id === id)) return;
      this.close();
      this.triggerEvent("select", { id });
    },
    create() {
      if (this.data.disabled || !this.data.open || !this.data.allowCreate) return;
      this.close();
      this.triggerEvent("create");
    },
  },
});
