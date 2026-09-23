import { convertJsonToSav, convertSavToJson } from './lib/converter/converter.js';

const selectOne = (selector, root = document) => root.querySelector(selector);
const selectAll = (selector, root = document) => [...root.querySelectorAll(selector)];
const ZERO_GUID = '00000000000000000000000000000000';
const LOADOUT_SLOT_COUNT = 7;
const LOADOUT_SLOT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const LOADOUT_ICONS = [
  ['▤', '弹药'], ['◎', '瞄准'], ['➤', '博斯科火箭'], ['✹', '爆炸'], ['♨', '火焰'],
  ['✦', '眩晕'], ['❄', '冰冻'], ['◆', '手雷'], ['◇', '博斯科'], ['◉', '蓄力'],
  ['▣', '弹匣'], ['⬟', '护盾'], ['⛏', '定点提取'], ['☠', '歼灭'], ['◈', '虫蛋搜集'],
  ['▰', '护送'], ['⚙', '破坏行动'], ['✧', '采矿远征'], ['✚', '抢救行动'],
  ['◍', '液态莫凯石精炼'], ['⬡', '重型提取'],
];
const CLASS_ORDER = ['Driller', 'Engineer', 'Gunner', 'Scout'];
const CLASS_CN = { Driller: '钻机手', Engineer: '工程师', Gunner: '枪手', Scout: '侦察兵' };
const STATUS_CN = { forged: '已锻造', history: '仅锻造历史（不可装备）', owned: '待锻造', missing: '未获得' };
const TARGET_STATUS_CN = { forged: '已锻造', owned: '待锻造', missing: '未获得' };
const XP_TABLE = [0, 3000, 7000, 12000, 18000, 25000, 33000, 42000, 52000, 63000, 75000, 88000, 102000, 117000, 132500, 148500, 165000, 182000, 199500, 217500, 236000, 255000, 274500, 294500, 315000];

const state = {
  catalog: null,
  raw: null,
  originalJson: '',
  file: null,
  model: null,
  view: 'overview',
  changes: new Map(),
  changeActions: [],
  currentAction: null,
  replayingChanges: false,
  changeSequence: 0,
  coreQuery: '',
  coreStatus: 'all',
  coreClass: 'all',
  coreKind: 'weapons',
  coreWeapon: 'all',
  selectedWeapon: null,
  selectedCoreIds: new Set(),
  selectedSkinIds: new Set(),
  loadoutClass: 'Driller',
  loadoutSlots: {},
  loadoutUi: { weaponSlot: 'PrimaryWeapon', section: 'modules', tier: null, tools: {} },
};

// Keep each user action replayable so removing one row preserves later edits.
const changeHandlers = new Map();
setNumeric = recordMutation('setNumeric', setNumeric);
setCharacterValue = recordMutation('setCharacterValue', setCharacterValue);
setCharacterLevel = recordMutation('setCharacterLevel', setCharacterLevel);
grantWeapon = recordMutation('grantWeapon', grantWeapon);
setActiveLoadout = recordMutation('setActiveLoadout', setActiveLoadout);
setLoadoutIcon = recordMutation('setLoadoutIcon', setLoadoutIcon);
setLoadoutWeapon = recordMutation('setLoadoutWeapon', setLoadoutWeapon);
setLoadoutModule = recordMutation('setLoadoutModule', setLoadoutModule);
setLoadoutOverclock = recordMutation('setLoadoutOverclock', setLoadoutOverclock);
setLoadoutSkin = recordMutation('setLoadoutSkin', setLoadoutSkin);
copyLoadoutSlot = recordMutation('copyLoadoutSlot', copyLoadoutSlot);
setCoreState = recordMutation('setCoreState', setCoreState);
applyCoreBulk = recordMutation('applyCoreBulk', applyCoreBulk);
setSkinState = recordMutation('setSkinState', setSkinState);
applySkinBulk = recordMutation('applySkinBulk', applySkinBulk);
unlockAllWeaponSkins = recordMutation('unlockAllWeaponSkins', unlockAllWeaponSkins);

const input = selectOne('#save-input');
const chooseButton = selectOne('#choose-button');
const dropPanel = selectOne('#drop-panel');
const root = selectOne('#view-root');
const toast = selectOne('#toast');
const resetButton = selectOne('#reset-button');
const exportButton = selectOne('#export-button');

chooseButton.disabled = true;
init();

async function init() {
  try {
    state.catalog = window.__DRG_CATALOG__ || await fetch('./catalog.json').then((response) => {
        if (!response.ok) throw new Error('物品目录加载失败');
        return response.json();
      });
    updateCatalogStrip();
    registerWebMcpTools();
    chooseButton.disabled = false;
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

selectAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  selectAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
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
    state.changeActions = [];
    state.changeSequence = 0;
    state.selectedCoreIds.clear();
    state.selectedSkinIds.clear();
    state.selectedWeapon = state.catalog.weapons[0]?.id || null;
    state.loadoutSlots = Object.fromEntries(state.model.characters.map((item) => [item.dwarf, item.selected]));
    selectOne('#file-chip').classList.add('loaded');
    selectOne('#file-chip').innerHTML = `<span>${escapeHtml(file.name)}</span><small>${formatBytes(file.size)} · 已在本地载入</small>`;
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
    unlockedItems: findProperty(raw, 'UnlockedItems'),
    ownedItems: findProperty(raw, 'OwnedItems'),
    purchasedUpgrades: findProperty(raw, 'PurchasedItemUpgrades'),
    equippedPerkLoadouts: findProperty(raw, 'EquippedPerkLoadouts'),
    playTime: findProperty(raw, 'TotalPlayTimeSeconds'),
    games: findProperty(raw, 'NumberOfGamesPlayed'),
  };

  const characters = [];
  const classById = Object.fromEntries(Object.entries(state.catalog.classIds).map(([name, id]) => [id, name]));
  for (const block of props.characters?.value || []) {
    const id = directProperty(block, 'SavegameID')?.value;
    const dwarf = classById[id];
    if (!dwarf) continue;
    const selectedProp = directProperty(block, 'SelectedLoadout');
    const selected = clamp(Number(selectedProp?.value || 0), 0, LOADOUT_SLOT_COUNT - 1);
    const loadoutsProp = directProperty(block, 'Loadouts');
    const upgradeLoadoutsProp = directProperty(block, 'ItemUpgradeLoadouts');
    const vanityProp = directProperty(block, 'Vanity');
    const vanityLoadoutsProp = directProperty(vanityProp?.value, 'Loadouts');
    const victoryPoseProp = directProperty(block, 'VictoryPose');
    const victoryPosesProp = directProperty(victoryPoseProp?.value, 'EquippedVictoryPoses');
    const loadouts = loadoutsProp?.value || [];
    const upgradeLoadouts = upgradeLoadoutsProp?.value || [];
    characters.push({
      dwarf,
      block,
      xp: directProperty(block, 'XP'),
      promotions: directProperty(block, 'TimesRetired'),
      selectedProp,
      selected,
      loadoutsProp,
      upgradeLoadoutsProp,
      vanityLoadoutsProp,
      victoryPosesProp,
      legacyLoadoutProp: directProperty(block, 'Loadout'),
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
  if (state.currentAction || state.replayingChanges) return;
  document.body.classList.toggle('loadout-view', state.view === 'classes' && Boolean(state.raw));
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
        ${counts.history ? progressRow('仅锻造历史', counts.history, total, 'red') : ''}
        ${progressRow('待锻造', counts.owned, total, 'amber')}
        ${progressRow('未获得', counts.missing, total, 'muted')}
      </section>
      <section class="panel"><div class="panel-head"><h3>四职业</h3><span>经验 / 晋升</span></div><div class="class-list">
        ${CLASS_ORDER.map((name) => {
          const char = state.model.characters.find((item) => item.dwarf === name);
          const xp = char?.xp?.value || 0;
          return `<div><span class="class-emblem">${name[0]}</span><b>${CLASS_CN[name]} · ${xpToLevel(xp)} 级</b><small>${formatNumber(xp)} XP · ${char?.promotions?.value || 0} 次晋升</small></div>`;
        }).join('')}
      </div></section>
    </div>
    <div class="callout"><b>你没有的东西也在这里。</b><span>“核心与超频”会把目录中的每一项标成已锻造、待锻造或未获得；“武器涂装”则按每把武器逐项对照。</span></div>`;
  selectAll('[data-jump]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.jump)));
}

function renderResources() {
  const cards = [
    { id: 'Credits', name: '信用点', pair: state.model.props.credits, integer: true },
    { id: 'PerkPoints', name: '天赋点', pair: state.model.props.perkPoints, integer: true },
    ...state.catalog.resources.filter((item) => item.type === 'resource').map((item) => ({
      id: item.id,
      name: item.nameZh || item.name,
      english: item.nameZh ? item.name : '',
      pair: state.model.resourceMap.get(item.id),
      integer: false,
    })),
  ];
  root.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">WALLET & PROGRESSION</p><h2>资源与进度</h2></div><span>直接输入数值，变更会进入右侧清单</span></div>
    <div class="value-grid">${cards.map((card) => valueCard(card.id, card.name, card.pair ? (Array.isArray(card.pair) ? card.pair[1] : card.pair.value) : 0, card.english)).join('')}</div>
    <div class="section-title compact-title"><div><h2>职业进度</h2></div><span>等级、累计经验值与晋升次数</span></div>
    <div class="class-edit-grid">${CLASS_ORDER.map((name) => {
      const char = state.model.characters.find((item) => item.dwarf === name);
      const xp = clamp(Number(char?.xp?.value || 0), 0, XP_TABLE.at(-1));
      const level = xpToLevel(xp);
      const progress = levelProgress(xp);
      return `<section class="panel"><div class="class-card-head"><span class="class-emblem">${name[0]}</span><div><h3>${CLASS_CN[name]}</h3><small>${name}</small></div></div>
        <label>精确等级<select data-character-level="${name}">${XP_TABLE.map((value, index) => `<option value="${index + 1}" ${level === index + 1 ? 'selected' : ''}>${index + 1} 级 · ${formatNumber(value)} XP</option>`).join('')}</select></label>
        <label>累计经验值<input type="number" min="0" max="${XP_TABLE.at(-1)}" step="1" data-character="${name}" data-field="xp" value="${xp}"></label>
        <p class="level-progress">${level === 25 ? '已到 25 级上限' : `本级进度 ${formatNumber(progress.current)} / ${formatNumber(progress.required)} XP`}</p>
        <label>晋升次数<input type="number" min="0" step="1" data-character="${name}" data-field="promotions" value="${char?.promotions?.value || 0}"></label></section>`;
    }).join('')}</div>`;
  selectAll('[data-number]').forEach((el) => el.addEventListener('change', () => setNumeric(el.dataset.number, el.value)));
  selectAll('[data-character]').forEach((el) => el.addEventListener('change', () => setCharacterValue(el.dataset.character, el.dataset.field, el.value)));
  selectAll('[data-character-level]').forEach((el) => el.addEventListener('change', () => setCharacterLevel(el.dataset.characterLevel, el.value)));
}

function renderClasses() {
  const dwarf = CLASS_ORDER.includes(state.loadoutClass) ? state.loadoutClass : CLASS_ORDER[0];
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  if (!char) return;
  const ui = state.loadoutUi;
  const slot = clamp(Number(state.loadoutSlots[dwarf] ?? char.selected), 0, LOADOUT_SLOT_COUNT - 1);
  state.loadoutSlots[dwarf] = slot;
  const classWeapons = state.catalog.weapons.filter((weapon) => weapon.dwarf === dwarf);
  const acquiredCount = classWeapons.filter(weaponOwned).length;
  const defaultCopyTarget = slot === 0 ? 1 : 0;
  const iconIndex = Number(directProperty(char.loadoutsProp?.value?.[slot], 'iconIndex')?.value ?? 0);
  const icon = LOADOUT_ICONS[iconIndex];
  root.innerHTML = `
    <div class="section-title loadout-title"><div><p class="eyebrow">LOADOUT WORKBENCH</p><h2>武器与职业配装</h2></div><span>先选配装，再调整需要的部分</span></div>
    <div class="class-filter loadout-class-filter" aria-label="选择职业">${CLASS_ORDER.map((name) => `<button data-loadout-class="${name}" class="${dwarf === name ? 'active' : ''}" aria-pressed="${dwarf === name}">${CLASS_CN[name]}</button>`).join('')}</div>
    <section class="panel loadout-toolbar"><div><h3>配装槽 ${LOADOUT_SLOT_LABELS[slot]}</h3><small>当前图标 · ${icon?.[1] || `编号 ${iconIndex}`}</small></div><div class="loadout-slot-tabs" aria-label="选择配装槽">${LOADOUT_SLOT_LABELS.map((label, index) => `<button data-loadout-slot="${index}" class="${slot === index ? 'active' : ''} ${char.selected === index ? 'current' : ''}" aria-pressed="${slot === index}" title="${char.selected === index ? '游戏当前使用' : '编辑配装槽'} ${label}">${label}${char.selected === index ? '<small>当前</small>' : ''}</button>`).join('')}</div><button class="button mini" id="set-active-loadout" ${slot === char.selected ? 'disabled' : ''}>${slot === char.selected ? '游戏当前槽' : '设为游戏当前槽'}</button></section>
    <div class="loadout-utilities">
      <details class="loadout-disclosure" data-loadout-tool="icons" ${ui.tools.icons ? 'open' : ''}><summary><span><b>${icon?.[0] || '◇'} 配装图标</b><small>${icon?.[1] || iconIndex}</small></span></summary><div class="disclosure-body"><p class="loadout-hint">选择后只修改这个配装槽的图标；符号为网页示意。</p><div class="loadout-icon-grid">${LOADOUT_ICONS.map(([symbol, label], index) => `<button type="button" data-loadout-icon="${index}" class="${iconIndex === index ? 'active' : ''}" aria-pressed="${iconIndex === index}" aria-label="选择${label}图标"><b>${symbol}</b><span>${label}</span></button>`).join('')}</div></div></details>
      <details class="loadout-disclosure" data-loadout-tool="copy" ${ui.tools.copy ? 'open' : ''}><summary><span><b>复制配装槽</b><small>包含图标、外观与天赋</small></span></summary><div class="disclosure-body copy-loadout-controls"><p>复制整个配装槽：武器、模块、超频、武器与角色外观、天赋、胜利姿势及图标。</p><div><label for="copy-loadout-target">槽 ${LOADOUT_SLOT_LABELS[slot]} 复制到</label><select id="copy-loadout-target">${LOADOUT_SLOT_LABELS.map((label, index) => `<option value="${index}" ${index === slot ? 'disabled' : ''} ${index === defaultCopyTarget ? 'selected' : ''}>槽 ${label}${index === char.selected ? '（游戏当前）' : ''}</option>`).join('')}</select><button class="button mini primary" id="copy-loadout">复制配装</button></div></div></details>
      <details class="loadout-disclosure" data-loadout-tool="weapons" ${ui.tools.weapons ? 'open' : ''}><summary><span><b>武器解锁</b><small>${acquiredCount} / ${classWeapons.length} 已获得</small></span></summary><div class="disclosure-body"><div class="weapon-unlock-grid">${classWeapons.map((weapon) => {
        const acquired = weaponOwned(weapon);
        return `<article class="weapon-unlock-card ${acquired ? 'owned' : 'missing'}"><div><small>${weapon.slot === 'PrimaryWeapon' ? '主武器' : '副武器'}${weapon.starter ? ' · 初始武器' : ''}</small><b>${escapeHtml(displayName(weapon))}</b></div><button class="button mini ${acquired ? 'ghost' : 'primary'}" data-grant-weapon="${weapon.id}" ${acquired ? 'disabled' : ''}>${acquired ? '已获得' : '获得武器'}</button></article>`;
      }).join('')}</div></div></details>
    </div>
    <div class="weapon-switcher" aria-label="选择要编辑的武器">${['PrimaryWeapon', 'SecondaryWeapon'].map((slotName) => {
      const id = directProperty(char.loadoutsProp?.value?.[slot], slotName)?.value;
      const weapon = classWeapons.find((item) => item.id === id);
      const entry = findWeaponUpgradeEntry(char, slot, id)?.[1] || [];
      const oc = state.catalog.coreItems.find((item) => item.upgradeId === directProperty(entry, 'EquippedOverclock')?.value);
      const count = directProperty(entry, 'EquippedUpgrades')?.value?.length || 0;
      return `<button data-loadout-weapon-tab="${slotName}" class="${ui.weaponSlot === slotName ? 'active' : ''}" aria-pressed="${ui.weaponSlot === slotName}"><small>${slotName === 'PrimaryWeapon' ? '主武器' : '副武器'}</small><b>${weapon ? escapeHtml(displayName(weapon)) : '尚未配置'}</b><span>${count} 个模块 · ${oc ? escapeHtml(displayName(oc)) : '未装备超频'}</span></button>`;
    }).join('')}</div>
    ${renderWeaponBuildPanel(char, slot, ui.weaponSlot)}`;
  selectAll('[data-loadout-class]').forEach((el) => el.addEventListener('click', () => { state.loadoutClass = el.dataset.loadoutClass; ui.tier = null; renderClasses(); }));
  selectAll('[data-grant-weapon]').forEach((el) => el.addEventListener('click', () => grantWeapon(el.dataset.grantWeapon)));
  selectAll('[data-loadout-slot]').forEach((el) => el.addEventListener('click', () => { state.loadoutSlots[dwarf] = Number(el.dataset.loadoutSlot); ui.tier = null; renderClasses(); }));
  selectAll('[data-loadout-weapon-tab]').forEach((el) => el.addEventListener('click', () => { ui.weaponSlot = el.dataset.loadoutWeaponTab; ui.tier = null; renderClasses(); }));
  selectAll('[data-loadout-section]').forEach((el) => el.addEventListener('click', () => { ui.section = el.dataset.loadoutSection; renderClasses(); }));
  selectAll('[data-loadout-tier]').forEach((el) => el.addEventListener('click', () => { const tier = Number(el.dataset.loadoutTier); ui.tier = ui.tier === tier ? null : tier; renderClasses(); }));
  selectAll('[data-loadout-tool]').forEach((el) => el.addEventListener('toggle', () => { ui.tools[el.dataset.loadoutTool] = el.open; }));
  selectOne('#set-active-loadout').addEventListener('click', () => setActiveLoadout(dwarf, slot));
  selectAll('[data-loadout-icon]').forEach((el) => el.addEventListener('click', () => setLoadoutIcon(dwarf, slot, Number(el.dataset.loadoutIcon))));
  selectAll('[data-loadout-weapon]').forEach((el) => el.addEventListener('change', () => { ui.tier = null; setLoadoutWeapon(dwarf, slot, el.dataset.loadoutWeapon, el.value); }));
  selectAll('[data-loadout-module]').forEach((el) => el.addEventListener('click', () => setLoadoutModule(dwarf, slot, el.dataset.weaponId, Number(el.dataset.loadoutModule), el.dataset.moduleId)));
  selectAll('[data-loadout-oc]').forEach((el) => el.addEventListener('click', () => setLoadoutOverclock(dwarf, slot, el.dataset.weaponId, el.dataset.upgradeId)));
  selectAll('[data-loadout-skin]').forEach((el) => el.addEventListener('change', () => setLoadoutSkin(dwarf, slot, el.dataset.weaponId, el.dataset.loadoutSkin, el.value)));
  selectOne('#copy-loadout').addEventListener('click', () => copyLoadoutSlot(dwarf, slot, Number(selectOne('#copy-loadout-target').value)));
}

function renderWeaponBuildPanel(char, slot, slotName) {
  const ui = state.loadoutUi;
  const selectedId = directProperty(char.loadoutsProp?.value?.[slot], slotName)?.value;
  const weapons = state.catalog.weapons.filter((weapon) => weapon.dwarf === char.dwarf && weapon.slot === slotName);
  const weapon = weapons.find((item) => item.id === selectedId);
  const weaponSelect = `<label class="build-weapon-select">更换${slotName === 'PrimaryWeapon' ? '主武器' : '副武器'}<select data-loadout-weapon="${slotName}"><option value="" ${weapon ? '' : 'selected'} disabled>请选择武器</option>${weapons.map((item) => `<option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(displayName(item))}${weaponOwned(item) ? '' : ' · 未获得（选择后解锁）'}</option>`).join('')}</select></label>`;
  if (!weapon) return `<section class="panel weapon-build-panel">${weaponSelect}<p class="empty-inline">选择武器后即可调整模块、超频和外观。</p></section>`;
  const entry = findWeaponUpgradeEntry(char, slot, weapon.id)?.[1] || [];
  const equippedModules = directProperty(entry, 'EquippedUpgrades')?.value || [];
  const purchased = new Set(state.model.props.purchasedUpgrades?.value || []);
  const overclockId = directProperty(entry, 'EquippedOverclock')?.value || ZERO_GUID;
  const overclocks = state.catalog.coreItems.filter((item) => item.category === 'Weapons' && item.weapon === weapon.name && item.upgradeId);
  const equippedSkins = directProperty(entry, 'EquippedSkins')?.value || [];
  const ownedSkins = new Set(state.model.skinMap.get(weapon.id)?.value || []);
  const frameworks = weapon.frameworks || [];
  const paints = weaponPaintCandidates(weapon);
  const sections = [['modules', '五层模块'], ['overclocks', '武器超频'], ['skins', '武器外观']];
  let content = '';
  if (ui.section === 'modules') {
    content = `<div class="compact-module-list">${[1, 2, 3, 4, 5].map((tier) => {
      const choices = (weapon.modules || []).filter((item) => item.tier === tier);
      const current = choices.find((item) => equippedModules.includes(item.id));
      const expanded = ui.tier === tier;
      return `<section class="compact-module ${expanded ? 'expanded' : ''}"><button class="module-summary" data-loadout-tier="${tier}" aria-expanded="${expanded}"><span class="tier-number">${tier}</span><span class="module-summary-text"><b>${current ? escapeHtml(displayName(current)) : '未装备模块'}</b><small>${current ? escapeHtml(current.descriptionZh || current.description || '') : `查看本层 ${choices.length} 个可选模块及效果`}</small></span><span class="disclosure-arrow">${expanded ? '收起' : '更换'} <i>${expanded ? '−' : '+'}</i></span></button>${expanded ? `<div class="module-options"><div class="module-options-head"><span>第 ${tier} 层 · ${choices.filter((item) => purchased.has(item.id)).length} / ${choices.length} 已购买</span><button class="text-button" data-loadout-module="${tier}" data-module-id="" data-weapon-id="${weapon.id}">卸下本层模块</button></div><div class="effect-choices">${choices.map((item) => `<button type="button" class="effect-choice ${item.id === current?.id ? 'active' : ''} ${purchased.has(item.id) ? 'owned' : 'missing'}" data-loadout-module="${tier}" data-module-id="${item.id}" data-weapon-id="${weapon.id}" aria-pressed="${item.id === current?.id}"><span class="effect-choice-head"><b>${escapeHtml(displayName(item))}</b><small>${item.id === current?.id ? '已装备' : purchased.has(item.id) ? '已购买' : '未购买 · 点击获得'}</small></span><p>${escapeHtml(item.descriptionZh || item.description || '暂无效果说明')}</p></button>`).join('')}</div></div>` : ''}</section>`;
    }).join('')}</div>`;
  } else if (ui.section === 'overclocks') {
    content = `<div class="module-options-head"><span>${overclocks.filter((item) => purchased.has(item.upgradeId)).length} / ${overclocks.length} 已锻造 · 点击卡片装备</span><button class="text-button" data-loadout-oc data-upgrade-id="" data-weapon-id="${weapon.id}">卸下超频</button></div><div class="effect-choices overclock-choices">${overclocks.map((item) => `<button type="button" class="effect-choice ${item.upgradeId === overclockId ? 'active' : ''} ${purchased.has(item.upgradeId) ? 'owned' : 'missing'}" data-loadout-oc data-upgrade-id="${item.upgradeId}" data-weapon-id="${weapon.id}" aria-pressed="${item.upgradeId === overclockId}"><span class="effect-choice-head"><b>${escapeHtml(displayName(item))}</b><small>${item.upgradeId === overclockId ? '已装备' : purchased.has(item.upgradeId) ? '已锻造' : '未锻造 · 点击获得'}</small></span><p>${escapeHtml(item.descriptionZh || item.description || '暂无效果说明')}</p></button>`).join('')}</div>`;
  } else {
    content = `<div class="skin-pair">${[['framework', '武器框架', frameworks], ['paint', '武器涂装', paints]].map(([kind, label, items]) => {
      const selected = items.find((item) => equippedSkins.includes(item.id));
      return `<label>${label}<select data-loadout-skin="${kind}" data-weapon-id="${weapon.id}"><option value="">默认${kind === 'framework' ? '框架' : '涂装'}</option>${items.map((item) => `<option value="${item.id}" ${item.id === selected?.id ? 'selected' : ''}>${escapeHtml(displayName(item))}${ownedSkins.has(item.id) ? '' : ' · 未获得（选择后解锁）'}</option>`).join('')}</select><small>${items.filter((item) => ownedSkins.has(item.id)).length} / ${items.length} 已拥有</small></label>`;
    }).join('')}</div>`;
  }
  return `<section class="panel weapon-build-panel"><div class="build-panel-top">${weaponSelect}<p class="loadout-hint">未获得项仍可选择，会同时获得并装备。</p></div><div class="build-section-tabs" aria-label="配装编辑分类">${sections.map(([id, label]) => `<button data-loadout-section="${id}" class="${ui.section === id ? 'active' : ''}" aria-pressed="${ui.section === id}">${label}</button>`).join('')}</div><div class="build-section-content">${content}</div></section>`;
}

function renderCores() {
  const counts = countCoreStates();
  const isWeaponCore = (item) => item.category === 'Weapons';
  const availableWeapons = [...new Set(state.catalog.coreItems
    .filter((item) => isWeaponCore(item) && (state.coreClass === 'all' || item.dwarf === state.coreClass))
    .map((item) => item.weapon))].sort((a, b) => localizedWeapon(a).localeCompare(localizedWeapon(b), 'zh-CN'));
  if (state.coreWeapon !== 'all' && !availableWeapons.includes(state.coreWeapon)) state.coreWeapon = 'all';
  const items = state.catalog.coreItems.filter((item) => {
    const status = coreStatus(item.id);
    const text = `${item.nameZh || ''} ${item.name} ${item.weaponZh || ''} ${item.weapon || ''} ${CLASS_CN[item.dwarf] || ''} ${item.dwarf || ''} ${item.category}`.toLowerCase();
    return (state.coreStatus === 'all' || status === state.coreStatus)
      && (state.coreClass === 'all' || item.dwarf === state.coreClass)
      && (state.coreKind === 'weapons' ? isWeaponCore(item) : !isWeaponCore(item))
      && (state.coreWeapon === 'all' || item.weapon === state.coreWeapon)
      && (!state.coreQuery || text.includes(state.coreQuery.toLowerCase()));
  }).sort((a, b) => {
    const classDelta = CLASS_ORDER.indexOf(a.dwarf) - CLASS_ORDER.indexOf(b.dwarf);
    if (classDelta) return classDelta;
    const weaponDelta = localizedWeapon(a.weapon).localeCompare(localizedWeapon(b.weapon), 'zh-CN');
    return weaponDelta || displayName(a).localeCompare(displayName(b), 'zh-CN');
  });
  const allVisibleSelected = items.length > 0 && items.every((item) => state.selectedCoreIds.has(item.id));
  let lastGroup = '';
  const rows = items.map((item) => {
    const status = coreStatus(item.id);
    const group = state.coreKind === 'weapons' ? `${item.dwarf}|${item.weapon}` : item.category;
    const heading = group !== lastGroup ? `<div class="collection-group"><span>${state.coreKind === 'weapons' ? `${CLASS_CN[item.dwarf] || item.dwarf} · ${escapeHtml(item.weaponZh || localizedWeapon(item.weapon))}` : escapeHtml(categoryName(item.category))}</span><small>${state.coreKind === 'weapons' ? escapeHtml(item.weapon) : ''}</small></div>` : '';
    lastGroup = group;
    const selected = state.selectedCoreIds.has(item.id);
    return `${heading}<article class="collection-row ${selected ? 'selected' : ''}"><label class="row-select" title="加入批量选择"><input type="checkbox" data-core-select="${item.id}" ${selected ? 'checked' : ''}><span></span></label><span class="state-dot ${status}"></span><div class="collection-name"><b>${escapeHtml(displayName(item))}</b><small>${escapeHtml(item.nameZh ? item.name : '')}</small></div><span class="core-context">${state.coreKind === 'weapons' ? escapeHtml(CLASS_CN[item.dwarf] || item.dwarf) : escapeHtml(categoryName(item.category))}</span>
      <select class="status-select ${status}" data-core="${item.id}" aria-label="${escapeHtml(displayName(item))}状态">${status === 'history' ? `<option value="history" selected disabled>${STATUS_CN.history}</option>` : ''}${Object.entries(TARGET_STATUS_CN).map(([value, label]) => {
        const disabled = value === 'forged' && status !== 'forged' && !canDirectForge(item);
        return `<option value="${value}" ${status === value ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${label}${disabled ? '（需游戏内锻造）' : ''}</option>`;
      }).join('')}</select></article>`;
  }).join('');
  root.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">MATRIX CORE INDEX</p><h2>核心与超频</h2></div><span>${counts.forged} 已锻造 · ${counts.history} 仅历史 · ${counts.owned} 待锻造 · ${counts.missing} 未获得</span></div>
    <div class="callout core-warning"><b>${state.coreKind === 'weapons' ? '武器超频可直接设为已锻造。' : '装饰核心仍建议在游戏内锻造。'}</b><span>${state.coreKind === 'weapons' ? '网页会同时写入锻造历史和真正可装备的武器升级；“仅锻造历史”项目重新选择“已锻造”即可修复。改回待锻造或未获得时，会自动卸下正在使用的该超频。' : '装饰核心还涉及对应外观的解锁记录，当前只安全支持设为待锻造或未获得。'}</span></div>
    <div class="core-kind-tabs"><button data-kind="weapons" class="${state.coreKind === 'weapons' ? 'active' : ''}">武器超频 <b>${state.catalog.coreItems.filter(isWeaponCore).length}</b></button><button data-kind="cosmetics" class="${state.coreKind === 'cosmetics' ? 'active' : ''}">装饰核心 <b>${state.catalog.coreItems.filter((item) => !isWeaponCore(item)).length}</b></button></div>
    <div class="class-filter"><button data-class="all" class="${state.coreClass === 'all' ? 'active' : ''}">全部职业</button>${CLASS_ORDER.map((name) => `<button data-class="${name}" class="${state.coreClass === name ? 'active' : ''}">${CLASS_CN[name]}</button>`).join('')}</div>
    <div class="filters">
      <input id="core-search" type="search" placeholder="可搜索中文或英文名称…" value="${escapeHtml(state.coreQuery)}">
      <select id="core-status"><option value="all">全部状态</option>${Object.entries(STATUS_CN).map(([value, label]) => `<option value="${value}" ${state.coreStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <select id="core-weapon" ${state.coreKind !== 'weapons' ? 'disabled' : ''}><option value="all">全部武器</option>${availableWeapons.map((name) => `<option value="${escapeHtml(name)}" ${state.coreWeapon === name ? 'selected' : ''}>${escapeHtml(localizedWeapon(name))}</option>`).join('')}</select>
    </div>
    <div class="bulk-bar"><div><button class="button mini" id="core-select-visible">${allVisibleSelected ? '取消选择当前结果' : '全选当前结果'}</button><button class="button mini ghost" id="core-clear-selection" ${state.selectedCoreIds.size ? '' : 'disabled'}>清空选择</button><span>已选 <b id="core-selected-count">${state.selectedCoreIds.size}</b> 项</span></div><div>${state.coreKind === 'weapons' ? `<button class="button mini primary" data-core-bulk="forged" ${state.selectedCoreIds.size ? '' : 'disabled'}>批量设为已锻造</button>` : ''}<button class="button mini" data-core-bulk="owned" ${state.selectedCoreIds.size ? '' : 'disabled'}>批量设为待锻造</button><button class="button mini" data-core-bulk="missing" ${state.selectedCoreIds.size ? '' : 'disabled'}>批量设为未获得</button></div></div>
    <p class="filter-result">当前显示 ${items.length} 项。可逐项修改，也可多选后批量处理。</p>
    <div class="collection-list">${rows || '<div class="empty-state small"><h2>没有匹配项</h2><p>换一个筛选条件试试。</p></div>'}</div>`;
  selectAll('[data-kind]').forEach((el) => el.addEventListener('click', () => { state.coreKind = el.dataset.kind; state.coreWeapon = 'all'; renderCores(); }));
  selectAll('[data-class]').forEach((el) => el.addEventListener('click', () => { state.coreClass = el.dataset.class; state.coreWeapon = 'all'; renderCores(); }));
  selectOne('#core-search').addEventListener('input', debounce((event) => { state.coreQuery = event.target.value; renderCores(); }, 120));
  selectOne('#core-status').addEventListener('change', (event) => { state.coreStatus = event.target.value; renderCores(); });
  selectOne('#core-weapon').addEventListener('change', (event) => { state.coreWeapon = event.target.value; renderCores(); });
  selectAll('[data-core]').forEach((el) => el.addEventListener('change', () => setCoreState(el.dataset.core, el.value)));
  selectAll('[data-core-select]').forEach((el) => el.addEventListener('change', () => {
    if (el.checked) state.selectedCoreIds.add(el.dataset.coreSelect);
    else state.selectedCoreIds.delete(el.dataset.coreSelect);
    el.closest('.collection-row')?.classList.toggle('selected', el.checked);
    selectOne('#core-selected-count').textContent = state.selectedCoreIds.size;
    renderCores();
  }));
  selectOne('#core-select-visible').addEventListener('click', () => {
    items.forEach((item) => allVisibleSelected ? state.selectedCoreIds.delete(item.id) : state.selectedCoreIds.add(item.id));
    renderCores();
  });
  selectOne('#core-clear-selection').addEventListener('click', () => { state.selectedCoreIds.clear(); renderCores(); });
  selectAll('[data-core-bulk]').forEach((el) => el.addEventListener('click', () => applyCoreBulk(el.dataset.coreBulk)));
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
  const visibleEntries = [...new Map(groups.flatMap(([, entries]) => entries).map((item) => [item.id, item])).values()];
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((item) => state.selectedSkinIds.has(item.id));
  root.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">WEAPON COSMETICS</p><h2>武器涂装</h2></div><div class="section-actions"><span>逐项或批量切换拥有 / 未拥有</span><button class="button mini primary" id="unlock-all-weapon-skins">一键获得全部武器外观</button></div></div>
    <div class="weapon-picker"><select id="weapon-select">${CLASS_ORDER.map((name) => `<optgroup label="${CLASS_CN[name]}">${state.catalog.weapons.filter((item) => item.dwarf === name).map((item) => `<option value="${item.id}" ${item.id === weapon.id ? 'selected' : ''}>${escapeHtml(displayName(item))}</option>`).join('')}</optgroup>`).join('')}</select><div><b>${escapeHtml(displayName(weapon))}</b><small>${escapeHtml(weapon.name)} · ${CLASS_CN[weapon.dwarf]} · 当前识别 ${owned.size} 项外观</small></div></div>
    <div class="bulk-bar"><div><button class="button mini" id="skin-select-visible">${allVisibleSelected ? '取消选择当前武器' : '全选当前武器'}</button><button class="button mini ghost" id="skin-clear-selection" ${state.selectedSkinIds.size ? '' : 'disabled'}>清空选择</button><span>已选 <b>${state.selectedSkinIds.size}</b> 项</span></div><div><button class="button mini primary" data-skin-bulk="owned" ${state.selectedSkinIds.size ? '' : 'disabled'}>批量设为已拥有</button><button class="button mini" data-skin-bulk="missing" ${state.selectedSkinIds.size ? '' : 'disabled'}>批量设为未拥有</button></div></div>
    ${groups.map(([title, entries]) => `<section class="panel skin-section"><div class="panel-head"><h3>${title}</h3><span>${entries.filter((item) => owned.has(item.id)).length} / ${entries.length}</span></div><div class="toggle-grid">${entries.map((item) => {
      const hasSkin = owned.has(item.id);
      const selected = state.selectedSkinIds.has(item.id);
      return `<article class="toggle-card ${hasSkin ? 'owned' : ''} ${selected ? 'selected' : ''}"><label class="skin-select" title="加入批量选择"><input type="checkbox" data-skin-select="${item.id}" ${selected ? 'checked' : ''}><span></span><small>选择</small></label><div><b>${escapeHtml(displayName(item))}</b><small>${item.nameZh ? `${escapeHtml(item.name)} · ` : ''}${hasSkin ? '已拥有' : '未拥有'}${item.season ? ` · 第 ${item.season} 赛季` : ''}</small></div><button class="ownership-toggle ${hasSkin ? 'owned' : ''}" data-skin-toggle="${item.id}" data-owned="${hasSkin}">${hasSkin ? '已拥有' : '未拥有'}</button></article>`;
    }).join('')}</div></section>`).join('')}`;
  selectOne('#weapon-select').addEventListener('change', (event) => { state.selectedWeapon = event.target.value; state.selectedSkinIds.clear(); renderSkins(); });
  selectOne('#unlock-all-weapon-skins').addEventListener('click', unlockAllWeaponSkins);
  selectAll('[data-skin-select]').forEach((el) => el.addEventListener('change', () => {
    if (el.checked) state.selectedSkinIds.add(el.dataset.skinSelect);
    else state.selectedSkinIds.delete(el.dataset.skinSelect);
    renderSkins();
  }));
  selectAll('[data-skin-toggle]').forEach((el) => el.addEventListener('click', () => setSkinState(weapon.id, el.dataset.skinToggle, el.dataset.owned !== 'true')));
  selectOne('#skin-select-visible').addEventListener('click', () => {
    visibleEntries.forEach((item) => allVisibleSelected ? state.selectedSkinIds.delete(item.id) : state.selectedSkinIds.add(item.id));
    renderSkins();
  });
  selectOne('#skin-clear-selection').addEventListener('click', () => { state.selectedSkinIds.clear(); renderSkins(); });
  selectAll('[data-skin-bulk]').forEach((el) => el.addEventListener('click', () => applySkinBulk(weapon.id, el.dataset.skinBulk === 'owned')));
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
  const resource = state.catalog.resources.find((item) => item.id === id);
  const label = resource?.nameZh || resource?.name || id;
  track(`number:${id}`, `${label} → ${formatNumber(value)}`);
  render();
}

function setCharacterValue(dwarf, field, rawValue) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  const prop = field === 'xp' ? char?.xp : char?.promotions;
  if (!prop) return showToast('当前存档里没有这个职业字段', true);
  const maximum = field === 'xp' ? XP_TABLE.at(-1) : Number.MAX_SAFE_INTEGER;
  const value = clamp(Math.round(Number(rawValue) || 0), 0, maximum);
  prop.value = value;
  track(`class:${dwarf}:${field}`, `${CLASS_CN[dwarf]}${field === 'xp' ? `经验 → ${formatNumber(value)}（${xpToLevel(value)} 级）` : `晋升 → ${formatNumber(value)}`}`);
  render();
}

function setCharacterLevel(dwarf, rawLevel) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  if (!char?.xp) return showToast('当前存档里没有这个职业的经验字段', true);
  const level = clamp(Math.round(Number(rawLevel) || 1), 1, 25);
  const xp = XP_TABLE[level - 1];
  char.xp.value = xp;
  track(`class:${dwarf}:xp`, `${CLASS_CN[dwarf]}等级 → ${level} 级（${formatNumber(xp)} XP）`);
  render();
}

function weaponOwned(weapon) {
  return Boolean(weapon?.starter || state.model.props.ownedItems?.value?.includes(weapon?.id));
}

function grantWeapon(weaponId) {
  const weapon = state.catalog.weapons.find((item) => item.id === weaponId);
  const unlocked = state.model.props.unlockedItems?.value;
  const owned = state.model.props.ownedItems?.value;
  if (!weapon || !unlocked || !owned) return showToast('存档中没有完整的武器解锁清单', true);
  pushUnique(unlocked, weaponId);
  pushUnique(owned, weaponId);
  track(`weapon:${weaponId}`, `${displayName(weapon)} → 已获得`);
  render();
  showToast(`已暂存：获得 ${displayName(weapon)}`);
}

function setActiveLoadout(dwarf, slot) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  if (!char?.selectedProp) return showToast('找不到这个职业的当前配装槽字段', true);
  char.selectedProp.value = slot;
  char.selected = slot;
  syncLegacyLoadout(char, slot);
  track(`loadout:${dwarf}:active`, `${CLASS_CN[dwarf]}游戏当前配装 → 槽 ${LOADOUT_SLOT_LABELS[slot]}`);
  render();
}

function setLoadoutIcon(dwarf, slot, iconIndex) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  if (!char || !Number.isInteger(iconIndex) || !LOADOUT_ICONS[iconIndex]) return showToast('配装图标编号无效', true);
  const loadout = ensureCharacterLoadoutSlot(char, slot);
  const property = directProperty(loadout, 'iconIndex');
  if (!property) return showToast('该配装槽缺少图标字段', true);
  property.value = iconIndex;
  syncLegacyLoadout(char, slot);
  track(`loadout:${dwarf}:${slot}:icon`, `${CLASS_CN[dwarf]}槽 ${LOADOUT_SLOT_LABELS[slot]}图标 → ${LOADOUT_ICONS[iconIndex][1]}`);
  render();
}

function setLoadoutWeapon(dwarf, slot, slotName, weaponId) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  const weapon = state.catalog.weapons.find((item) => item.id === weaponId && item.dwarf === dwarf && item.slot === slotName);
  if (!char || !weapon) return showToast('无法识别这把武器', true);
  if (!weaponOwned(weapon)) {
    const unlocked = state.model.props.unlockedItems?.value;
    const owned = state.model.props.ownedItems?.value;
    if (!unlocked || !owned) return showToast('存档中没有完整的武器解锁清单', true);
    pushUnique(unlocked, weaponId);
    pushUnique(owned, weaponId);
  }
  const loadout = ensureCharacterLoadoutSlot(char, slot);
  const property = directProperty(loadout, slotName);
  if (!property) return showToast('该配装槽缺少武器字段', true);
  property.value = weaponId;
  ensureWeaponUpgradeEntry(char, slot, weaponId);
  syncLegacyLoadout(char, slot);
  track(`loadout:${dwarf}:${slot}:${slotName}`, `${CLASS_CN[dwarf]}槽 ${LOADOUT_SLOT_LABELS[slot]}${slotName === 'PrimaryWeapon' ? '主武器' : '副武器'} → ${displayName(weapon)}`);
  render();
}

function setLoadoutModule(dwarf, slot, weaponId, tier, moduleId) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  const weapon = state.catalog.weapons.find((item) => item.id === weaponId);
  const selected = weapon?.modules?.find((item) => item.id === moduleId);
  const purchased = state.model.props.purchasedUpgrades?.value;
  if (!char || !weapon || !purchased || (moduleId && (selected?.tier !== tier))) return showToast('无法识别这个模块', true);
  ensureWeaponOwnership(weapon);
  const pair = ensureWeaponUpgradeEntry(char, slot, weaponId);
  const equipped = directProperty(pair?.[1], 'EquippedUpgrades')?.value;
  if (!equipped) return showToast('无法读取这把武器的模块配置', true);
  const moduleById = new Map((weapon.modules || []).map((item) => [item.id, item]));
  for (const id of [...equipped]) if (moduleById.get(id)?.tier === tier) removeFrom(equipped, id);
  if (moduleId) {
    pushUnique(purchased, moduleId);
    pushUnique(equipped, moduleId);
  }
  track(`loadout:${dwarf}:${slot}:${weaponId}:tier${tier}`, `${displayName(weapon)}第 ${tier} 层模块 → ${selected ? `${displayName(selected)}（已购买）` : '不装备'}`);
  render();
}

function setLoadoutOverclock(dwarf, slot, weaponId, upgradeId) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  const weapon = state.catalog.weapons.find((item) => item.id === weaponId);
  const oc = upgradeId ? state.catalog.coreItems.find((item) => item.category === 'Weapons' && item.weapon === weapon?.name && item.upgradeId === upgradeId) : null;
  if (!char || !weapon || (upgradeId && !oc)) return showToast('无法识别这个武器超频', true);
  ensureWeaponOwnership(weapon);
  const pair = ensureWeaponUpgradeEntry(char, slot, weaponId);
  const property = directProperty(pair?.[1], 'EquippedOverclock');
  if (!property) return showToast('无法读取这把武器的超频配置', true);
  if (upgradeId && !state.model.props.purchasedUpgrades?.value?.includes(upgradeId)) {
    if (!mutateCoreState(oc.id, 'forged')) return;
    track(`core:${oc.id}`, `${displayName(oc)} → 已锻造并可装备`);
  }
  property.value = upgradeId || ZERO_GUID;
  const unlocked = directProperty(pair[1], 'OverclockingUnlocked');
  if (unlocked && upgradeId) unlocked.value = true;
  track(`loadout:${dwarf}:${slot}:${weaponId}:oc`, `${displayName(weapon)}超频 → ${oc ? displayName(oc) : '不装备'}`);
  render();
}

function setLoadoutSkin(dwarf, slot, weaponId, kind, skinId) {
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  const weapon = state.catalog.weapons.find((item) => item.id === weaponId);
  if (!char || !weapon || !['framework', 'paint'].includes(kind)) return showToast('无法识别这个武器外观', true);
  const candidates = kind === 'framework' ? (weapon.frameworks || []) : weaponPaintCandidates(weapon);
  const skin = candidates.find((item) => item.id === skinId);
  if (skinId && !skin) return showToast('无法识别这个武器外观', true);
  ensureWeaponOwnership(weapon);
  const pair = ensureWeaponUpgradeEntry(char, slot, weaponId);
  const equipped = directProperty(pair?.[1], 'EquippedSkins')?.value;
  if (!equipped) return showToast('无法读取这把武器的外观配置', true);
  if (skinId && !state.model.skinMap.get(weaponId)?.value?.includes(skinId)) {
    if (!mutateSkinState(weaponId, skinId, true)) return;
  }
  candidates.forEach((item) => removeFrom(equipped, item.id));
  if (skinId) pushUnique(equipped, skinId);
  track(`loadout:${dwarf}:${slot}:${weaponId}:${kind}`, `${displayName(weapon)}${kind === 'framework' ? '框架' : '涂装'} → ${skin ? displayName(skin) : '默认'}`);
  render();
}

function copyLoadoutSlot(dwarf, source, target, copiedContents = null) {
  if (source === target) return showToast('来源槽和目标槽不能相同', true);
  const char = state.model.characters.find((item) => item.dwarf === dwarf);
  if (!char) return;
  const contents = copiedContents || captureLoadoutCopy(char, source);
  restoreCopiedSlot(char.loadoutsProp?.value, target, contents.loadout, blankGuidStructure, char.legacyLoadoutProp?.value);
  restoreCopiedSlot(char.upgradeLoadoutsProp?.value, target, contents.upgrades, blankUpgradeLoadout);
  restoreCopiedSlot(char.vanityLoadoutsProp?.value, target, contents.vanity, blankGuidStructure);
  if (char.victoryPosesProp?.value) {
    while (char.victoryPosesProp.value.length <= target) char.victoryPosesProp.value.push(ZERO_GUID);
    char.victoryPosesProp.value[target] = contents.victoryPose;
  }
  restoreCopiedPerks(char, target, contents.perks);
  ensureCopiedOwnership(contents);
  syncLegacyLoadout(char, target);
  track(`loadout:${dwarf}:copy:${target}`, `${CLASS_CN[dwarf]}槽 ${LOADOUT_SLOT_LABELS[source]} → 完整复制到槽 ${LOADOUT_SLOT_LABELS[target]}`);
  state.loadoutSlots[dwarf] = target;
  render();
  showToast(`已把槽 ${LOADOUT_SLOT_LABELS[source]} 完整复制到槽 ${LOADOUT_SLOT_LABELS[target]}`);
}

function ensureCharacterLoadoutSlot(char, slot) {
  const array = char.loadoutsProp?.value;
  if (!array) return null;
  const base = array[0] || char.legacyLoadoutProp?.value;
  if (!base) return null;
  while (array.length < slot) array.push(blankGuidStructure(base));
  if (array.length === slot) array.push(structuredClone(base));
  return array[slot];
}

function findWeaponUpgradeEntry(char, slot, weaponId) {
  const loadout = char?.upgradeLoadoutsProp?.value?.[slot];
  return (directProperty(loadout, 'Loadout')?.value || []).find((pair) => pair[0] === weaponId);
}

function ensureWeaponUpgradeEntry(char, slot, weaponId) {
  if (!char?.upgradeLoadoutsProp?.value) return null;
  const slots = char.upgradeLoadoutsProp.value;
  const base = slots[0];
  if (!base) return null;
  while (slots.length < slot) slots.push(blankUpgradeLoadout(base));
  if (slots.length === slot) slots.push(structuredClone(base));
  const map = directProperty(slots[slot], 'Loadout');
  if (!map) return null;
  let pair = map.value.find((item) => item[0] === weaponId);
  if (pair) return pair;
  for (const candidateSlot of slots) {
    const candidate = (directProperty(candidateSlot, 'Loadout')?.value || []).find((item) => item[0] === weaponId);
    if (candidate) {
      pair = structuredClone(candidate);
      break;
    }
  }
  if (!pair && map.value[0]) {
    pair = structuredClone(map.value[0]);
    pair[0] = weaponId;
    resetWeaponUpgradeData(pair[1], weaponId);
  }
  if (pair) map.value.push(pair);
  return pair;
}

function syncLegacyLoadout(char, slot) {
  if (slot === char.selected && char.legacyLoadoutProp && char.loadoutsProp?.value?.[slot]) {
    char.legacyLoadoutProp.value = structuredClone(char.loadoutsProp.value[slot]);
  }
}

function ensureWeaponOwnership(weapon) {
  if (!weapon || weapon.starter) return;
  for (const property of [state.model.props.unlockedItems, state.model.props.ownedItems]) {
    if (property?.value) pushUnique(property.value, weapon.id);
  }
}

function captureLoadoutCopy(char, source) {
  const characterId = directProperty(char.block, 'SavegameID')?.value;
  const perks = directProperty(state.model.props.equippedPerkLoadouts?.value?.[source], 'CharacterPerks')?.value || [];
  const sourceValue = (array, blankFactory, fallback) => {
    const base = array?.[0] || fallback;
    return array?.[source] || (base ? blankFactory(base) : null);
  };
  return structuredClone({
    loadout: sourceValue(char.loadoutsProp?.value, blankGuidStructure, char.legacyLoadoutProp?.value),
    upgrades: sourceValue(char.upgradeLoadoutsProp?.value, blankUpgradeLoadout),
    vanity: sourceValue(char.vanityLoadoutsProp?.value, blankGuidStructure),
    victoryPose: char.victoryPosesProp?.value?.[source] || ZERO_GUID,
    perks: perks.find((entry) => directProperty(entry, 'characterID')?.value === characterId) || null,
  });
}

function restoreCopiedSlot(array, target, value, blankFactory, fallback) {
  if (!array || !value) return;
  const base = array[0] || fallback || value;
  while (array.length <= target) array.push(blankFactory(base));
  array[target] = structuredClone(value);
}

function restoreCopiedPerks(char, target, value) {
  const slots = state.model.props.equippedPerkLoadouts?.value;
  if (!slots?.length) return;
  while (slots.length <= target) {
    const blank = structuredClone(slots[0]);
    const entries = directProperty(blank, 'CharacterPerks');
    if (entries) entries.value = [];
    slots.push(blank);
  }
  const entries = directProperty(slots[target], 'CharacterPerks')?.value;
  if (!entries) return;
  const characterId = directProperty(char.block, 'SavegameID')?.value;
  for (const entry of [...entries]) {
    if (directProperty(entry, 'characterID')?.value === characterId) removeFrom(entries, entry);
  }
  if (value) entries.push(structuredClone(value));
}

function ensureCopiedOwnership(contents) {
  for (const slotName of ['PrimaryWeapon', 'SecondaryWeapon']) {
    const weaponId = directProperty(contents.loadout, slotName)?.value;
    ensureWeaponOwnership(state.catalog.weapons.find((item) => item.id === weaponId));
  }
  const purchased = state.model.props.purchasedUpgrades?.value;
  for (const [weaponId, config] of directProperty(contents.upgrades, 'Loadout')?.value || []) {
    if (purchased) {
      for (const name of ['EquippedUpgrades', 'PermanentUpgrades']) {
        for (const id of directProperty(config, name)?.value || []) if (id !== ZERO_GUID) pushUnique(purchased, id);
      }
    }
    const overclockId = directProperty(config, 'EquippedOverclock')?.value;
    const core = state.catalog.coreItems.find((item) => item.upgradeId === overclockId);
    if (core && coreStatus(core.id) !== 'forged') mutateCoreState(core.id, 'forged');
    for (const id of directProperty(config, 'EquippedSkins')?.value || []) {
      if (id !== ZERO_GUID && !state.model.skinMap.get(weaponId)?.value?.includes(id)) mutateSkinState(weaponId, id, true);
    }
  }
}

function blankGuidStructure(template) {
  const result = structuredClone(template);
  walkProperties(result, (property) => {
    if (property.subtype === 'Guid' && typeof property.value === 'string') property.value = ZERO_GUID;
    if (property.name === 'iconIndex') property.value = 0;
  });
  return result;
}

function blankUpgradeLoadout(template) {
  const result = structuredClone(template);
  const map = directProperty(result, 'Loadout');
  for (const pair of map?.value || []) resetWeaponUpgradeData(pair[1], pair[0]);
  return result;
}

function resetWeaponUpgradeData(data, weaponId) {
  const weapon = directProperty(data, 'WeaponID');
  if (weapon) weapon.value = weaponId;
  for (const name of ['EquippedUpgrades', 'PermanentUpgrades', 'EquippedSkins']) {
    const property = directProperty(data, name);
    if (property) property.value = [];
  }
  const overclock = directProperty(data, 'EquippedOverclock');
  if (overclock) overclock.value = ZERO_GUID;
  const overclockingUnlocked = directProperty(data, 'OverclockingUnlocked');
  if (overclockingUnlocked) overclockingUnlocked.value = false;
  for (const name of ['EquippedSkinColor', 'EquippedSkinMesh']) {
    const property = directProperty(data, name);
    if (property) property.value = ZERO_GUID;
  }
}

function setCoreState(id, status) {
  const item = state.catalog.coreItems.find((entry) => entry.id === id);
  if (status === 'forged' && coreStatus(id) !== 'forged' && !canDirectForge(item)) {
    status = 'owned';
    showToast('这个装饰核心还不能安全地直接锻造，已改为待锻造。');
  }
  if (!mutateCoreState(id, status)) return;
  track(`core:${id}`, `${displayName(item) || shortGuid(id)} → ${STATUS_CN[status]}`);
  render();
}

function mutateCoreState(id, status) {
  const item = state.catalog.coreItems.find((entry) => entry.id === id);
  const forged = state.model.props.forged?.value;
  const owned = state.model.props.owned?.value;
  if (!forged || !owned) {
    showToast('存档中没有核心列表', true);
    return false;
  }
  const purchased = item?.upgradeId ? state.model.props.purchasedUpgrades?.value : null;
  if (item?.upgradeId && !purchased) {
    showToast('存档中没有可装备升级清单，无法安全修改武器超频', true);
    return false;
  }
  if (status === 'forged' && !canDirectForge(item) && coreStatus(id) !== 'forged') {
    showToast('这个核心缺少可安全写入的游戏内升级 ID', true);
    return false;
  }
  removeFrom(forged, id);
  removeFrom(owned, id);
  if (status === 'forged') forged.push(id);
  if (status === 'owned') owned.push(id);
  if (item?.upgradeId) {
    removeFrom(purchased, item.upgradeId);
    if (status === 'forged') purchased.push(item.upgradeId);
    else clearEquippedOverclock(item.upgradeId);
  }
  return true;
}

function applyCoreBulk(status, ids = [...state.selectedCoreIds]) {
  if (!ids.length) return;
  let changed = 0;
  ids.forEach((id) => { if (mutateCoreState(id, status)) changed += 1; });
  track(`core:bulk:${Date.now()}`, `批量修改 ${changed} 个核心 → ${STATUS_CN[status]}`);
  state.selectedCoreIds.clear();
  render();
  showToast(`已批量修改 ${changed} 个核心`);
}

function canDirectForge(item) {
  return item?.category === 'Weapons' && Boolean(item.upgradeId);
}

function clearEquippedOverclock(upgradeId) {
  let cleared = 0;
  walkProperties(state.raw, (property) => {
    if (property.name === 'EquippedOverclock' && property.value === upgradeId) {
      property.value = ZERO_GUID;
      cleared += 1;
    }
  });
  return cleared;
}

function setSkinState(weaponId, skinId, enabled) {
  if (!mutateSkinState(weaponId, skinId, enabled)) return;
  const weapon = state.catalog.weapons.find((item) => item.id === weaponId);
  const skin = skinCandidates(weapon).find((item) => item.id === skinId);
  track(`skin:${weaponId}:${skinId}`, `${displayName(weapon)} · ${displayName(skin) || shortGuid(skinId)} → ${enabled ? '已拥有' : '未拥有'}`);
  render();
}

function mutateSkinState(weaponId, skinId, enabled) {
  const skinsProp = ensureWeaponSkinProperty(weaponId);
  if (!skinsProp) {
    showToast('无法为这把武器创建涂装条目', true);
    return false;
  }
  removeFrom(skinsProp.value, skinId);
  if (enabled) skinsProp.value.push(skinId);
  return true;
}

function applySkinBulk(weaponId, enabled, ids = [...state.selectedSkinIds]) {
  if (!ids.length) return;
  let changed = 0;
  ids.forEach((id) => { if (mutateSkinState(weaponId, id, enabled)) changed += 1; });
  const weapon = state.catalog.weapons.find((item) => item.id === weaponId);
  track(`skin:bulk:${weaponId}:${Date.now()}`, `${displayName(weapon)} · 批量修改 ${changed} 项 → ${enabled ? '已拥有' : '未拥有'}`);
  state.selectedSkinIds.clear();
  render();
  showToast(`已批量修改 ${changed} 项武器外观`);
}

function unlockAllWeaponSkins() {
  let changed = 0;
  for (const weapon of state.catalog.weapons) {
    const skinsProp = ensureWeaponSkinProperty(weapon.id);
    if (!skinsProp) continue;
    for (const skin of skinCandidates(weapon)) {
      if (!skinsProp.value.includes(skin.id)) {
        skinsProp.value.push(skin.id);
        changed += 1;
      }
    }
  }
  track('skin:all-weapons', `全部武器外观 → 已拥有（新增 ${changed} 项）`);
  state.selectedSkinIds.clear();
  render();
  showToast(changed ? `已暂存全部武器外观，共新增 ${changed} 项` : '全部武器外观已经拥有');
}

function weaponPaintCandidates(weapon) {
  const paints = [
    ...(state.catalog.commonWeaponPaintJobs || []),
    ...(state.catalog.uniqueWeaponPaintJobs || []).filter((item) => !item.dwarf || item.dwarf === weapon?.dwarf),
  ];
  return [...new Map(paints.map((item) => [item.id, item])).values()];
}

function skinCandidates(weapon) {
  return [...new Map([...(weapon?.frameworks || []), ...weaponPaintCandidates(weapon)].map((item) => [item.id, item])).values()];
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
  state.changeActions = [];
  state.changeSequence = 0;
  state.selectedCoreIds.clear();
  state.selectedSkinIds.clear();
  state.loadoutSlots = Object.fromEntries(state.model.characters.map((item) => [item.dwarf, item.selected]));
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
  const list = selectOne('#changes-list');
  selectOne('#change-count').textContent = state.changes.size;
  if (!state.changes.size) {
    list.className = 'changes-empty';
    list.innerHTML = '<span>✓</span><p>还没有调整任何内容</p>';
    return;
  }
  list.className = 'changes-list';
  list.innerHTML = [...state.changes.entries()].map(([key, message]) => `<div class="change-item"><span aria-hidden="true">↳</span><p>${escapeHtml(message)}</p><button type="button" class="undo-change" data-undo-change="${escapeHtml(key)}" title="撤销这项调整，保留其他调整" aria-label="撤销：${escapeHtml(message)}">撤销</button></div>`).join('');
  selectAll('[data-undo-change]', list).forEach((button) => button.addEventListener('click', () => undoChange(button.dataset.undoChange)));
}

function track(key, message) {
  if (state.replayingChanges) return;
  if (state.currentAction) {
    state.currentAction.key = key;
    state.currentAction.message = message;
  }
}

function recordMutation(name, handler) {
  changeHandlers.set(name, handler);
  return (...providedArgs) => {
    if (state.replayingChanges || state.currentAction) return handler(...providedArgs);
    if (!state.raw) return;
    const args = structuredClone(providedArgs);
    if (name === 'applyCoreBulk') args[1] = [...state.selectedCoreIds];
    if (name === 'applySkinBulk') args[2] = [...state.selectedSkinIds];
    if (name === 'copyLoadoutSlot') {
      const char = state.model.characters.find((item) => item.dwarf === args[0]);
      if (char) args[3] = captureLoadoutCopy(char, args[1]);
    }
    const before = JSON.stringify(state.raw);
    const action = { name, args, key: '', message: '' };
    state.currentAction = action;
    try {
      const result = handler(...args);
      if (action.key && before !== JSON.stringify(state.raw)) {
        if (name === 'applyCoreBulk' || name === 'applySkinBulk') action.key = `${name}:${++state.changeSequence}`;
        state.changeActions.push(action);
        state.changes.delete(action.key);
        state.changes.set(action.key, action.message);
      } else if (!action.key) {
        // A failed action must not leave a partially created slot or ownership entry.
        state.raw = JSON.parse(before);
        state.model = deriveModel(state.raw);
      }
      return result;
    } catch (error) {
      state.raw = JSON.parse(before);
      state.model = deriveModel(state.raw);
      showToast(`调整失败：${error.message}`, true);
    } finally {
      state.currentAction = null;
      render();
    }
  };
}

function undoChange(key) {
  if (!state.originalJson || !state.changes.has(key)) return;
  const remaining = state.changeActions.filter((action) => action.key !== key);
  const previousRaw = state.raw;
  const selectedCoreIds = new Set(state.selectedCoreIds);
  const selectedSkinIds = new Set(state.selectedSkinIds);
  const loadoutSlots = { ...state.loadoutSlots };
  state.replayingChanges = true;
  try {
    state.raw = JSON.parse(state.originalJson);
    state.model = deriveModel(state.raw);
    for (const action of remaining) {
      changeHandlers.get(action.name)(...structuredClone(action.args));
      state.model = deriveModel(state.raw);
    }
    state.changeActions = remaining;
    state.changes = new Map();
    for (const action of remaining) {
      state.changes.delete(action.key);
      state.changes.set(action.key, action.message);
    }
  } catch (error) {
    state.raw = previousRaw;
    state.model = deriveModel(state.raw);
    state.replayingChanges = false;
    showToast(`撤销失败，已保留现有调整：${error.message}`, true);
    return;
  } finally {
    state.replayingChanges = false;
    state.selectedCoreIds = selectedCoreIds;
    state.selectedSkinIds = selectedSkinIds;
    state.loadoutSlots = loadoutSlots;
    render();
  }
  showToast('已撤销这项调整，其他调整已保留');
}

function navigate(view) {
  state.view = view;
  selectAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  render();
}

function countCoreStates() {
  return state.catalog.coreItems.reduce((acc, item) => {
    acc[coreStatus(item.id)] += 1;
    return acc;
  }, { forged: 0, history: 0, owned: 0, missing: 0 });
}

function coreStatus(id) {
  const item = state.catalog.coreItems.find((entry) => entry.id === id);
  if (state.model.props.forged?.value?.includes(id)) {
    if (item?.upgradeId && !state.model.props.purchasedUpgrades?.value?.includes(item.upgradeId)) return 'history';
    return 'forged';
  }
  if (state.model.props.owned?.value?.includes(id)) return 'owned';
  return 'missing';
}

function walkProperties(node, visitor) {
  if (Array.isArray(node)) {
    node.forEach((value) => walkProperties(value, visitor));
    return;
  }
  if (!node || typeof node !== 'object') return;
  visitor(node);
  Object.values(node).forEach((value) => walkProperties(value, visitor));
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

function valueCard(id, name, value, english = '') {
  return `<label class="value-card"><span>${escapeHtml(name)}</span><input type="number" min="0" step="1" data-number="${id}" value="${Number(value) || 0}"><small>${escapeHtml(english || shortGuid(id))}</small></label>`;
}

function metric(label, value, detail) {
  return `<article><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function progressRow(label, value, total, color) {
  const width = percent(value, total);
  return `<div class="progress-row"><div><span>${label}</span><b>${value} / ${total}</b></div><i><em class="${color}" style="width:${width}%"></em></i></div>`;
}

function updateCatalogStrip() {
  const articles = selectAll('.catalog-strip article span');
  const frameworkCount = new Set(state.catalog.weapons.flatMap((weapon) => (weapon.frameworks || []).map((item) => item.name))).size;
  [state.catalog.weapons.length, `${state.catalog.coreItems.length}`, frameworkCount, 6].forEach((value, index) => { if (articles[index]) articles[index].textContent = value; });
}

function displayName(item) {
  return item?.nameZh || item?.name || '未知项目';
}

function localizedWeapon(name) {
  if (!name) return '';
  const weapon = state.catalog.weapons.find((item) => item.name.replaceAll("'", '"').toLowerCase() === name.replaceAll("'", '"').toLowerCase());
  if (weapon?.nameZh) return weapon.nameZh;
  const core = state.catalog.coreItems.find((item) => item.weapon === name && item.weaponZh);
  return core?.weaponZh || name;
}

function categoryName(category) {
  return ({ Weapons: '武器超频', Beards: '胡须', Helmets: '头盔', Moustaches: '八字胡', Sideburns: '鬓角', WeaponSkins: '武器涂装', 'Weapon Skins': '武器涂装' })[category] || category;
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
      characters: state.model.characters.map((item) => ({ class: item.dwarf, level: xpToLevel(item.xp?.value || 0), xp: item.xp?.value || 0, promotions: item.promotions?.value || 0 })),
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
  if (state.replayingChanges) {
    if (error) throw new Error(message);
    return;
  }
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

function pushUnique(array, value) {
  if (!array.includes(value)) array.push(value);
}

function xpToLevel(xp) {
  const value = clamp(Number(xp) || 0, 0, XP_TABLE.at(-1));
  for (let index = XP_TABLE.length - 1; index >= 0; index -= 1) {
    if (value >= XP_TABLE[index]) return index + 1;
  }
  return 1;
}

function levelProgress(xp) {
  const level = xpToLevel(xp);
  if (level >= 25) return { current: 0, required: 0 };
  const start = XP_TABLE[level - 1];
  return { current: Math.max(0, xp - start), required: XP_TABLE[level] - start };
}

function formatNumber(value) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value); }
function formatBytes(value) { return `${(value / 1024).toFixed(0)} KB`; }
function percent(value, total) { return total ? Math.round((value / total) * 100) : 0; }
function shortGuid(value) { return value?.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
