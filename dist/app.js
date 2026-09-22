import { convertJsonToSav, convertSavToJson } from './lib/converter/converter.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ZERO_GUID = '00000000000000000000000000000000';
const CLASS_ORDER = ['Driller', 'Engineer', 'Gunner', 'Scout'];
const CLASS_CN = { Driller: '钻机手', Engineer: '工程师', Gunner: '枪手', Scout: '侦察兵' };
const STATUS_CN = { forged: '已锻造', owned: '待锻造', missing: '未获得' };

const state = {
  catalog: null,
  raw: null,
  originalJson: '',
  file: null,
  model: null,
  view: 'overview',
  changes: new Map(),
  coreQuery: '',
  coreStatus: 'all',
  coreClass: 'all',
  selectedWeapon: null,
};

const input = $('#save-input');
const chooseButton = $('#choose-button');
const dropPanel = $('#drop-panel');
const root = $('#view-root');
const toast = $('#toast');
const resetButton = $('#reset-button');
const exportButton = $('#export-button');

init();

async function init() {
  try {
    state.catalog = await fetch('./catalog.json').then((response) => {
      if (!response.ok) throw new Error('物品目录加载失败');
      return response.json();
    });
    updateCatalogStrip();
    registerWebMcpTools();
  } catch (error) {
    showToast(error.message, true);
  }
}

chooseButton.addEventListener('click', () => input.click());
input.addEventListener('change', () => input.files[0] && loadFile(input.files[0]));
['dragenter', 'dragover'].forEach((name) => dropPanel.addEventListener(name, (event) => {
  event.preventDefault();
  dropPanel.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((name) => dropPanel.addEventListener(name, (event) => {
  event.preventDefault();
  dropPanel.classList.remove('dragging');
}));
dropPanel.addEventListener('drop', (event) => {
  const file = event.dataTransfer.files[0];
  if (file) loadFile(file);
});

$$('.nav-item').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
  render();
}));

resetButton.addEventListener('click', resetAll);
exportButton.addEventListener('click', exportSave);

async function loadFile(file) {
  if (!state.catalog) return showToast('物品目录还在加载，请稍等片刻', true);
  if (!file.name.toLowerCase().endsWith('.sav')) return showToast('请选择 .sav 存档文件', true);
  if (file.size > 25 * 1024 * 1024) return showToast('文件大于 25 MB，看起来不像 DRG 玩家存档', true);

  showToast(`正在本地解析 ${file.name}…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const json = convertSavToJson(bytes);
    const raw = JSON.parse(json);
    if (!findProperty(raw, 'CharacterSaves') || !findProperty(raw, 'Credits')) {
      throw new Error('没有识别到 DRG 玩家存档的关键字段');
    }
    state.file = file;
    state.originalJson = json;
    state.raw = raw;
    state.model = deriveModel(raw);
    state.changes.clear();
    state.selectedWeapon = state.catalog.weapons[0]?.id || null;
    $('#file-chip').classList.add('loaded');
    $('#file-chip').innerHTML = `<span>${escapeHtml(file.name)}</span><small>${formatBytes(file.size)} · 已在本地载入</small>`;
    dropPanel.classList.add('compact');
    dropPanel.querySelector('h2').textContent = '换一个存档';
    dropPanel.querySelector('p').textContent = '当前文件已解析；拖入另一个 .sav 可替换。';
    chooseButton.textContent = '重新选择';
    render();
    showToast('存档解析完成。所有改动只会写入新导出的文件。');
  } catch (error) {
    showToast(`读取失败：${error.message}`, true);
  }
}

function deriveModel(raw) {
  const props = {
    credits: findProperty(raw, 'Credits'),
    perkPoints: findProperty(raw, 'PerkPoints'),
    resources: findProperty(raw, 'OwnedResources'),
    forged: findProperty(raw, 'ForgedSchematics'),
    owned: findProperty(raw, 'OwnedSchematics'),
    characters: findProperty(raw, 'CharacterSaves'),
    skins: findProperty(raw, 'UnlockedItemSkins'),
    purchasedUpgrades: findProperty(raw, 'PurchasedItemUpgrades'),
    playTime: findProperty(raw, 'TotalPlayTimeSeconds'),
    games: findProperty(raw, 'NumberOfGamesPlayed'),
  };

  const characters = [];
  const classById = Object.fromEntries(Object.entries(state.catalog.classIds).map(([name, id]) => [id, name]));
  for (const block of props.characters?.value || []) {
    const id = directProperty(block, 'SavegameID')?.value;
    const dwarf = classById[id];
    if (!dwarf) continue;
    const selected = clamp(Number(directProperty(block, 'SelectedLoadout')?.value || 0), 0, 5);
    const loadouts = directProperty(block, 'Loadouts')?.value || [];
    const upgradeLoadouts = directProperty(block, 'ItemUpgradeLoadouts')?.value || [];
    characters.push({
      dwarf,
      block,
      xp: directProperty(block, 'XP'),
      promotions: directProperty(block, 'TimesRetired'),
      selected,
      loadout: loadouts[selected] || directProperty(block, 'Loadout')?.value || [],
      upgradeLoadout: upgradeLoadouts[selected] || [],
    });
  }

  const resourceMap = new Map((props.resources?.value || []).map((pair) => [pair[0], pair]));
  const skinMap = new Map();
  for (const pair of props.skins?.value || []) {
    const skinProp = directProperty(pair[1], 'Skins');
    if (skinProp) skinMap.set(pair[0], skinProp);
  }
  return { props, characters, resourceMap, skinMap };
}

function render() {
  if (!state.raw) return;
  state.model = deriveModel(state.raw);
  ({ overview: renderOverview, resources: renderResources, classes: renderClasses, cores: renderCores, skins: renderSkins }[state.view] || renderOverview)();
  renderChanges();
  resetButton.disabled = state.changes.size === 0;
  exportButton.disabled = false;
}

function renderOverview() {
  const counts = countCoreStates();
  const hours = Math.round((state.model.props.playTime?.value || 0) / 3600);
  const total = state.catalog.coreItems.length;
  const knownSkins = new Set([...state.model.skinMap.values()].flatMap((prop) => prop.value || [])).size;
  root.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">ARCHIVE SNAPSHOT</p><h2>档案总览</h2></div><span>识别到 ${formatNumber(total)} 项核心目录</span></div>
    <div class="metric-grid">
      ${metric('信用点', formatNumber(state.model.props.credits?.value || 0), '当前可用')}
      ${metric('游戏时长', `${formatNumber(hours)} h`, `${formatNumber(state.model.props.games?.value || 0)} 场任务`)}
      ${metric('已锻造核心', formatNumber(counts.forged), `${percent(counts.forged, total)}% 目录完成`)}
      ${metric('识别到的涂装', formatNumber(knownSkins), '跨全部武器去重')}
    </div>
    <div class="panel-grid">
      <section class="panel"><div class="panel-head"><h3>核心收藏进度</h3><button class="text-button" data-jump="cores">打开完整清单 →</button></div>
        ${progressRow('已锻造', counts.forged, total, 'green')}
        ${progressRow('待锻造', counts.owned, total, 'amber')}
        ${progressRow('未获得', counts.missing, total, 'muted')}
      </section>
      <section class="panel"><div class="panel-head"><h3>四职业</h3><span>经验 / 晋升</span></div><div class="class-list">
        ${CLASS_ORDER.map((name) => {
          const char = state.model.characters.find((item) => item.dwarf === name);
          return `<div><span class="class-emblem">${name[0]}</span><b>${CLASS_CN[name]}</b><small>${formatNumber(char?.xp?.value || 0)} XP · ${char?.promotions?.value || 0} 次晋升</small></div>`;
        }).join('')}
      </div></section>
    </div>
    <div class="callout"><b>你没有的东西也在这里。</b><span>“核心与超频”会把目录中的每一项标成已锻造、待锻造或未获得；“武器涂装”则按每把武器逐项对照。</span></div>`;
  $$('[data-jump]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.jump)));
}

function renderResources() {
  const cards = [
    { id: 'Credits', name: '信用点', pair: state.model.props.credits, integer: true },
    { id: 'PerkPoints', name: '天赋点', pair: state.model.props.perkPoints, integer: true },
    ...state.catalog.resources.filter((item) => item.type === 'resource').map((item) => ({
      id: item.id,
      name: item.name,
      pair: state.model.resourceMap.get(item.id),
      integer: false,
    })),
  ];
  root.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">WALLET & PROGRESSION</p><h2>资源与进度</h2></div><span>直接输入数值，变更会进入右侧清单</span></div>
    <div class="value-grid">${cards.map((card) => valueCard(card.id, card.name, card.pair ? (Array.isArray(card.pair) ? card.pair[1] : card.pair.value) : 0, 'resource')).join('')}</div>
    <div class="section-title compact-title"><div><h2>职业进度</h2></div><span>经验值与晋升次数</span></div>
    <div class="class-edit-grid">${CLASS_ORDER.map((name) => {
      const char = state.model.characters.find((item) => item.dwarf === name);
      return `<section class="panel"><div class="class-card-head"><span class="class-emblem">${name[0]}</span><div><h3>${CLASS_CN[name]}</h3><small>${name}</small></div></div>
        <label>经验值<input type="number" min="0" step="1" data-character="${name}" data-field="xp" value="${char?.xp?.value || 0}"></label>
        <label>晋升次数<input type="number" min="0" step="1" data-character="${name}" data-field="promotions" value="${char?.promotions?.value || 0}"></label></section>`;
    }).join('')}</div>`;
  $$('[data-number]').forEach((el) => el.addEventListener('change', () => setNumeric(el.dataset.number, el.value)));
  $$('[data-character]').forEach((el) => el.addEventListener('change', () => setCharacterValue(el.dataset.character, el.dataset.field, el.value)));
}

function renderClasses() {
  const ocById = new Map(state.catalog.coreItems.filter((item) => item.category === 'Weapons').map((item) => [item.id, item]));
  root.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">LOADOUT INSPECTION</p><h2>职业配装</h2></div><span>当前启用槽位、模块、超频与外观</span></div>
    <div class="callout"><b>模块名称目前不能可靠反查。</b><span>存档只保存模块 GUID；这里会准确显示每件装备装了几个普通模块，并识别目录中可匹配的超频和皮肤。不会冒险写入未知模块。</span></div>
    <div class="class-card-grid">${CLASS_ORDER.map((name) => {
      const char = state.model.characters.find((item) => item.dwarf === name);
      const equipment = (char?.loadout || []).filter((item) => ['PrimaryWeapon', 'SecondaryWeapon'].includes(item.name));
      const upgradeMap = new Map((directProperty(char?.upgradeLoadout, 'Loadout')?.value || []).map((pair) => [pair[0], pair[1]]));
      const availableWeapons = state.catalog.weapons.filter((weapon) => weapon.dwarf === name);
      return `<section class="class-card"><div class="class-card-head"><span class="class-emblem">${name[0]}</span><div><h3>${CLASS_CN[name]}</h3><small>当前配装槽 ${Number(char?.selected || 0) + 1} / 6</small></div></div>
        <div class="weapon-tags">${availableWeapons.map((weapon) => `<span class="tag">${escapeHtml(weapon.name)}</span>`).join('')}</div>
        ${equipment.map((item) => {
          const data = upgradeMap.get(item.value) || [];
          const mods = directProperty(data, 'EquippedUpgrades')?.value || [];
          const ocId = directProperty(data, 'EquippedOverclock')?.value;
          const skins = directProperty(data, 'EquippedSkins')?.value || [];
          const oc = ocById.get(ocId);
          return `<div class="weapon-row"><div><small>${item.name === 'PrimaryWeapon' ? '主武器' : '副武器'} · ${shortGuid(item.value)}</small><b>${oc ? escapeHtml(oc.weapon) : '存档装备'}</b></div><div class="mini-metrics"><span>${mods.length}<small>模块</small></span><span>${oc ? escapeHtml(oc.name) : '—'}<small>超频</small></span><span>${skins.length}<small>外观</small></span></div></div>`;
        }).join('') || '<p class="empty-inline">此职业没有可读取的当前配装。</p>'}
      </section>`;
    }).join('')}</div>`;
}

function renderCores() {
  const counts = countCoreStates();
  const items = state.catalog.coreItems.filter((item) => {
    const status = coreStatus(item.id);
    const text = `${item.name} ${item.weapon || ''} ${item.dwarf || ''} ${item.category}`.toLowerCase();
    return (state.coreStatus === 'all' || status === state.coreStatus)
      && (state.coreClass === 'all' || item.dwarf === state.coreClass)
      && (!state.coreQuery || text.includes(state.coreQuery.toLowerCase()));
  });
  root.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">MATRIX CORE INDEX</p><h2>核心与超频</h2></div><span>${counts.forged} 已锻造 · ${counts.owned} 待锻造 · ${counts.missing} 未获得</span></div>
    <div class="filters">
      <input id="core-search" type="search" placeholder="搜索名称、武器或职业…" value="${escapeHtml(state.coreQuery)}">
      <select id="core-status"><option value="all">全部状态</option>${Object.entries(STATUS_CN).map(([value, label]) => `<option value="${value}" ${state.coreStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <select id="core-class"><option value="all">全部职业</option>${CLASS_ORDER.map((name) => `<option value="${name}" ${state.coreClass === name ? 'selected' : ''}>${CLASS_CN[name]}</option>`).join('')}</select>
    </div>
    <div class="collection-list">${items.map((item) => {
      const status = coreStatus(item.id);
      return `<article class="collection-row"><span class="state-dot ${status}"></span><div class="collection-name"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.weapon || item.category)}${item.dwarf ? ` · ${CLASS_CN[item.dwarf] || item.dwarf}` : ''}</small></div><span class="type-chip">${escapeHtml(item.category)}</span>
        <select class="status-select ${status}" data-core="${item.id}" aria-label="${escapeHtml(item.name)}状态">${Object.entries(STATUS_CN).map(([value, label]) => `<option value="${value}" ${status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></article>`;
    }).join('') || '<div class="empty-state small"><h2>没有匹配项</h2><p>换一个筛选条件试试。</p></div>'}</div>`;
  $('#core-search').addEventListener('input', debounce((event) => { state.coreQuery = event.target.value; renderCores(); }, 120));
  $('#core-status').addEventListener('change', (event) => { state.coreStatus = event.target.value; renderCores(); });
  $('#core-class').addEventListener('change', (event) => { state.coreClass = event.target.value; renderCores(); });
  $$('[data-core]').forEach((el) => el.addEventListener('change', () => setCoreState(el.dataset.core, el.value)));
}

function renderSkins() {
  const weapon = state.catalog.weapons.find((item) => item.id === state.selectedWeapon) || state.catalog.weapons[0];
  if (!weapon) return;
  state.selectedWeapon = weapon.id;
  const owned = new Set(state.model.skinMap.get(weapon.id)?.value || []);
  const unique = state.catalog.uniqueWeaponPaintJobs.filter((item) => !item.dwarf || item.dwarf === weapon.dwarf);
  const groups = [
    ['武器框架', weapon.frameworks || []],
    ['通用涂装', state.catalog.commonWeaponPaintJobs || []],
    ['职业涂装', unique],
  ];
  root.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">WEAPON COSMETICS</p><h2>武器涂装</h2></div><span>逐项切换拥有 / 未拥有</span></div>
    <div class="weapon-picker"><select id="weapon-select">${CLASS_ORDER.map((name) => `<optgroup label="${CLASS_CN[name]}">${state.catalog.weapons.filter((item) => item.dwarf === name).map((item) => `<option value="${item.id}" ${item.id === weapon.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</optgroup>`).join('')}</select><div><b>${escapeHtml(weapon.name)}</b><small>${CLASS_CN[weapon.dwarf]} · 当前识别 ${owned.size} 项外观</small></div></div>
    ${groups.map(([title, entries]) => `<section class="panel skin-section"><div class="panel-head"><h3>${title}</h3><span>${entries.filter((item) => owned.has(item.id)).length} / ${entries.length}</span></div><div class="toggle-grid">${entries.map((item) => `<label class="toggle-card ${owned.has(item.id) ? 'owned' : ''}"><input type="checkbox" data-skin="${item.id}" ${owned.has(item.id) ? 'checked' : ''}><span></span><div><b>${escapeHtml(item.name)}</b><small>${owned.has(item.id) ? '已拥有' : '未拥有'}${item.season ? ` · 第 ${item.season} 赛季` : ''}</small></div></label>`).join('')}</div></section>`).join('')}`;
  $('#weapon-select').addEventListener('change', (event) => { state.selectedWeapon = event.target.value; renderSkins(); });
  $$('[data-skin]').forEach((el) => el.addEventListener('change', () => setSkinState(weapon.id, el.dataset.skin, el.checked)));
}

function setNumeric(id, rawValue) {
  const value = Math.max(0, Number(rawValue) || 0);
  if (id === 'Credits' || id === 'PerkPoints') {
    const prop = id === 'Credits' ? state.model.props.credits : state.model.props.perkPoints;
    if (!prop) return showToast(`存档中没有 ${id} 字段`, true);
    prop.value = Math.round(value);
  } else {
    const pair = state.model.resourceMap.get(id);
    if (!pair) return showToast('这个资源在当前存档中没有可编辑条目', true);
    pair[1] = value;
  }
  const label = state.catalog.resources.find((item) => item.id === id)?.name || id;
  track(`number:${id}`, `${label} → ${formatNumber(value)}`);
  render();
}

function setCharacterValue(dwarf, field, rawValue) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  const prop = field === 'xp' ? char?.xp : char?.promotions;
  if (!prop) return showToast('当前存档里没有这个职业字段', true);
  const value = Math.max(0, Math.round(Number(rawValue) || 0));
  prop.value = value;
  track(`class:${dwarf}:${field}`, `${CLASS_CN[dwarf]}${field === 'xp' ? '经验' : '晋升'} → ${formatNumber(value)}`);
  render();
}

function setCoreState(id, status) {
  const forged = state.model.props.forged?.value;
  const owned = state.model.props.owned?.value;
  if (!forged || !owned) return showToast('存档中没有核心列表', true);
  removeFrom(forged, id);
  removeFrom(owned, id);
  if (status === 'forged') forged.push(id);
  if (status === 'owned') owned.push(id);
  const item = state.catalog.coreItems.find((entry) => entry.id === id);
  track(`core:${id}`, `${item?.name || shortGuid(id)} → ${STATUS_CN[status]}`);
  render();
}

function setSkinState(weaponId, skinId, enabled) {
  const skinsProp = ensureWeaponSkinProperty(weaponId);
  if (!skinsProp) return showToast('无法为这把武器创建涂装条目', true);
  removeFrom(skinsProp.value, skinId);
  if (enabled) skinsProp.value.push(skinId);
  const weapon = state.catalog.weapons.find((item) => item.id === weaponId);
  const candidates = [...(weapon?.frameworks || []), ...(state.catalog.commonWeaponPaintJobs || []), ...(state.catalog.uniqueWeaponPaintJobs || [])];
  const skin = candidates.find((item) => item.id === skinId);
  track(`skin:${weaponId}:${skinId}`, `${weapon?.name || '武器'} · ${skin?.name || shortGuid(skinId)} → ${enabled ? '已拥有' : '未拥有'}`);
  render();
}

function ensureWeaponSkinProperty(weaponId) {
  const existing = state.model.skinMap.get(weaponId);
  if (existing) return existing;
  const map = state.model.props.skins;
  const template = map?.value?.[0];
  if (!map || !template) return null;
  const newPair = structuredClone(template);
  newPair[0] = weaponId;
  const skinProp = directProperty(newPair[1], 'Skins');
  skinProp.value = [];
  map.value.push(newPair);
  state.model.skinMap.set(weaponId, skinProp);
  return skinProp;
}

function resetAll() {
  if (!state.originalJson) return;
  state.raw = JSON.parse(state.originalJson);
  state.model = deriveModel(state.raw);
  state.changes.clear();
  render();
  showToast('已撤销全部调整');
}

function exportSave() {
  try {
    const bytes = convertJsonToSav(JSON.stringify(state.raw));
    const check = JSON.parse(convertSavToJson(bytes));
    if (!findProperty(check, 'CharacterSaves') || !findProperty(check, 'Credits')) throw new Error('导出后的结构校验失败');
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    const base = state.file.name.replace(/\.sav$/i, '');
    link.href = URL.createObjectURL(blob);
    link.download = `${base}_edited.sav`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast(`已生成 ${link.download}；原存档没有被修改`);
  } catch (error) {
    showToast(`导出失败：${error.message}`, true);
  }
}

function renderChanges() {
  const list = $('#changes-list');
  $('#change-count').textContent = state.changes.size;
  if (!state.changes.size) {
    list.className = 'changes-empty';
    list.innerHTML = '<span>✓</span><p>还没有调整任何内容</p>';
    return;
  }
  list.className = 'changes-list';
  list.innerHTML = [...state.changes.values()].map((message) => `<div><span>↳</span><p>${escapeHtml(message)}</p></div>`).join('');
}

function track(key, message) {
  state.changes.set(key, message);
}

function navigate(view) {
  state.view = view;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  render();
}

function countCoreStates() {
  return state.catalog.coreItems.reduce((acc, item) => {
    acc[coreStatus(item.id)] += 1;
    return acc;
  }, { forged: 0, owned: 0, missing: 0 });
}

function coreStatus(id) {
  if (state.model.props.forged?.value?.includes(id)) return 'forged';
  if (state.model.props.owned?.value?.includes(id)) return 'owned';
  return 'missing';
}

function findProperty(node, name) {
  if (Array.isArray(node)) {
    for (const value of node) {
      const found = findProperty(value, name);
      if (found) return found;
    }
  } else if (node && typeof node === 'object') {
    if (node.name === name) return node;
    for (const value of Object.values(node)) {
      const found = findProperty(value, name);
      if (found) return found;
    }
  }
  return null;
}

function directProperty(node, name) {
  return Array.isArray(node) ? node.find((item) => item?.name === name) : null;
}

function valueCard(id, name, value) {
  return `<label class="value-card"><span>${escapeHtml(name)}</span><input type="number" min="0" step="1" data-number="${id}" value="${Number(value) || 0}"><small>${shortGuid(id)}</small></label>`;
}

function metric(label, value, detail) {
  return `<article><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function progressRow(label, value, total, color) {
  const width = percent(value, total);
  return `<div class="progress-row"><div><span>${label}</span><b>${value} / ${total}</b></div><i><em class="${color}" style="width:${width}%"></em></i></div>`;
}

function updateCatalogStrip() {
  const articles = $$('.catalog-strip article span');
  const frameworkCount = new Set(state.catalog.weapons.flatMap((weapon) => (weapon.frameworks || []).map((item) => item.name))).size;
  [state.catalog.weapons.length, `${state.catalog.coreItems.length}`, frameworkCount, 6].forEach((value, index) => { if (articles[index]) articles[index].textContent = value; });
}

function registerWebMcpTools() {
  const context = window.modelContext || navigator.modelContext;
  if (!context?.registerTool) return;
  context.registerTool({
    name: 'read_save_summary',
    description: '读取当前在网页中打开的深岩银河存档摘要，不会修改数据。',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => state.raw ? {
      credits: state.model.props.credits?.value || 0,
      perkPoints: state.model.props.perkPoints?.value || 0,
      coreStates: countCoreStates(),
      characters: state.model.characters.map((item) => ({ class: item.dwarf, xp: item.xp?.value || 0, promotions: item.promotions?.value || 0 })),
      pendingChanges: [...state.changes.values()],
    } : { error: '尚未载入存档' },
  });
  context.registerTool({
    name: 'stage_numeric_change',
    description: '在网页里暂存信用点、天赋点或资源数量的调整。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'number', minimum: 0 } }, required: ['id', 'value'] },
    execute: async ({ id, value }) => { setNumeric(id, value); return { staged: true, id, value }; },
  });
  context.registerTool({
    name: 'stage_core_state',
    description: '把一个核心项目设为已锻造、待锻造或未获得。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['forged', 'owned', 'missing'] } }, required: ['id', 'status'] },
    execute: async ({ id, status }) => { setCoreState(id, status); return { staged: true, id, status }; },
  });
}

function showToast(message, error = false) {
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3400);
}

function removeFrom(array, value) {
  let index;
  while ((index = array.indexOf(value)) !== -1) array.splice(index, 1);
}

function formatNumber(value) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value); }
function formatBytes(value) { return `${(value / 1024).toFixed(0)} KB`; }
function percent(value, total) { return total ? Math.round((value / total) * 100) : 0; }
function shortGuid(value) { return value?.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
