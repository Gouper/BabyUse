const presets = [
  { name: '纸尿裤', category: '日常护理', unit: '片', specs: ['NB', 'S 码', 'M 码', 'L 码', 'XL 码', 'XXL 码'] },
  { name: '奶粉', category: '喂养', unit: '罐', specs: ['400 g', '800 g', '900 g'], modeIndex: 1, expiryIndex: 2 },
  { name: 'AD', category: '日常用品', unit: '粒', expiryIndex: 1 },
  { name: '抚触油', category: '洗护', unit: '瓶', specs: ['50 mL', '100 mL', '200 mL'], modeIndex: 1, expiryIndex: 2 },
  { name: '拉拉裤', category: '日常护理', unit: '片', specs: ['M 码', 'L 码', 'XL 码', 'XXL 码', 'XXXL 码'] },
  { name: '湿巾', category: '日常护理', unit: '抽', units: ['包', '片'] },
  { name: '棉柔巾', category: '日常护理', unit: '抽', units: ['包', '张'] },
  { name: '婴儿润肤乳', category: '洗护', unit: '瓶', units: ['支'], specs: ['50 mL', '100 mL', '200 mL', '250 mL'], modeIndex: 1, expiryIndex: 1 },
  { name: '辅食', category: '喂养', unit: '袋', units: ['盒', '罐'], specs: ['50 g', '100 g', '150 g', '200 g'], expiryIndex: 1 },
];

const sizes = {
  '片': ['1', '10', '24', '40', '52', '60'],
  '抽': ['1', '20', '60', '80', '100'],
  '张': ['1', '20', '60', '80', '100'],
  '粒': ['1', '10', '30', '60'],
};

function options(recommended, all = [], optional = false) {
  const values = [...new Set([...recommended, ...all])];
  const entries = values.map(value => ({ label: value, value }));
  if (optional) entries.push({ label: '不填', value: '' });
  return [{ label: '请选择', prompt: true }, ...entries, { label: '其他，自己填写', manual: true }];
}

function optionsFor(preset, unit, kind) {
  const selected = preset || {};
  const consumableUnits = ['片', '抽', '张', '粒'];
  const pieceCount = consumableUnits.includes(unit);
  return {
    name: options(selected.name ? [selected.name] : [], presets.map(item => item.name)),
    category: options(selected.category ? [selected.category] : [], presets.map(item => item.category), true),
    spec: options(selected.specs || [], presets.flatMap(item => item.specs || []), true),
    unit: options(selected.unit ? [selected.unit, ...(selected.units || [])] : [], ['片', '抽', '张', '粒', '罐', '瓶', '包', '袋', '盒', '支', '个']),
    packSize: options(sizes[unit] || ['1', '2', '4', '6', '12']),
    runoutDays: options(['7', '3', '14', '30', '0']),
    expiryWarningDays: options(['30', '7', '14', '60', '0']),
    openWarningDays: options(['3', '1', '7', '0']),
    lowStock: options(pieceCount ? ['0', '10', '20', '30'] : ['0', '1', '2', '3', '5']),
    reason: options(kind === 'loss' ? ['已过期', '包装破损', '剩余丢弃', '遗失'] : ['实际数量有差异', '发现漏记', '更正整理数量']),
  };
}

function quickOptionsFor(preset) {
  if (!preset) return {};
  return {
    spec: (preset.specs || []).slice(0, 4),
    unit: preset.units ? [preset.unit, ...preset.units] : [],
  };
}

module.exports = { presets, optionsFor, quickOptionsFor };
