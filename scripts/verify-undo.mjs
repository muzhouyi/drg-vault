import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { convertSavToJson, convertJsonToSav } from '../dist/lib/converter/converter.js';

const savePath = process.argv[2];
if (!savePath) throw new Error('请传入只读测试存档的路径');
const project = new URL('../', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL('dist/catalog.json', project), 'utf8'));
const originalJson = convertSavToJson(new Uint8Array(fs.readFileSync(savePath)));
const element = {
  addEventListener() {}, querySelector() { return element; }, querySelectorAll() { return []; },
  classList: { add() {}, remove() {}, toggle() {} }, textContent: '', innerHTML: '', dataset: {},
};
const context = vm.createContext({
  console, structuredClone, convertSavToJson, convertJsonToSav, setTimeout, clearTimeout,
  window: { __DRG_CATALOG__: catalog, setTimeout: () => 0 }, navigator: {},
  document: { querySelector: () => element, querySelectorAll: () => [], body: element },
});
const source = fs.readFileSync(new URL('dist/app.js', project), 'utf8').replace(/^import .*\r?\n/, '');
vm.runInContext(`${source}\nrender = () => { if (state.raw) state.model = deriveModel(state.raw); };`, context);
context.testOriginalJson = originalJson;
vm.runInContext(`state.originalJson = testOriginalJson; resetAll();`, context);
const run = (source) => vm.runInContext(source, context);
const asJson = (source) => JSON.parse(run(`JSON.stringify(${source})`));
const check = (name, fn) => { run('state.originalJson = testOriginalJson; resetAll()'); fn(); console.log(`✓ ${name}`); };
const original = JSON.parse(originalJson);

check('重复修改同字段一起撤销，保留其他数字调整', () => {
  const credits = run('state.model.props.credits.value');
  const perks = run('state.model.props.perkPoints.value');
  run(`setNumeric('Credits', ${credits + 100}); setNumeric('PerkPoints', ${perks + 3}); setNumeric('Credits', ${credits + 200}); undoChange('number:Credits')`);
  assert.equal(run('state.model.props.credits.value'), credits);
  assert.equal(run('state.model.props.perkPoints.value'), perks + 3);
  assert.equal(run('state.changes.size'), 1);
  run(`undoChange('number:PerkPoints')`);
  assert.deepEqual(asJson('state.raw'), original);
});

check('等级和经验共用撤销项', () => {
  run(`setCharacterLevel('Gunner', 12); setCharacterValue('Gunner', 'xp', 18000)`);
  assert.equal(run('state.changes.size'), 1);
  run(`undoChange('class:Gunner:xp')`);
  assert.deepEqual(asJson('state.raw'), original);
});

check('撤销重建失败时完整保留现有调整', () => {
  run(`setNumeric('Credits', state.model.props.credits.value + 10); setNumeric('PerkPoints', state.model.props.perkPoints.value + 1)`);
  const before = asJson('state.raw');
  run(`state.changeActions[1].args[0] = 'missing-resource-for-error-test'; undoChange('number:Credits')`);
  assert.deepEqual(asJson('state.raw'), before);
  assert.equal(run('state.changes.size'), 2);
  assert.equal(run('state.changeActions.length'), 2);
});

run(`globalThis.testOc = state.catalog.coreItems.find(item => item.category === 'Weapons' && item.upgradeId && coreStatus(item.id) !== 'forged');
globalThis.testWeapon = state.catalog.weapons.find(item => item.name === testOc.weapon);
globalThis.testChar = state.model.characters.find(item => item.dwarf === testWeapon.dwarf);
globalThis.testDwarf = testChar.dwarf;
globalThis.testSlot = testChar.selected;
globalThis.testOcKey = 'loadout:' + testDwarf + ':' + testSlot + ':' + testWeapon.id + ':oc';`);

check('获得并装备超频作为单项撤销', () => {
  run(`setLoadoutOverclock(testDwarf, testSlot, testWeapon.id, testOc.upgradeId)`);
  assert.equal(run('state.changes.size'), 1);
  assert.equal(run('coreStatus(testOc.id)'), 'forged');
  run('undoChange(testOcKey)');
  assert.deepEqual(asJson('state.raw'), original);
});

check('撤销超频获取后仍保留另一项装备需要的获取记录', () => {
  run(`setCoreState(testOc.id, 'forged'); setLoadoutOverclock(testDwarf, testSlot, testWeapon.id, testOc.upgradeId); undoChange('core:' + testOc.id)`);
  assert.equal(run('coreStatus(testOc.id)'), 'forged');
  assert.equal(run(`directProperty(findWeaponUpgradeEntry(state.model.characters.find(item => item.dwarf === testDwarf), testSlot, testWeapon.id)[1], 'EquippedOverclock').value`), run('testOc.upgradeId'));
  run('undoChange(testOcKey)');
  assert.deepEqual(asJson('state.raw'), original);
});

check('批量核心撤销保留后来单项的目标状态', () => {
  run(`globalThis.bulkIds = state.catalog.coreItems.filter(item => item.upgradeId && coreStatus(item.id) !== 'forged').slice(0, 3).map(item => item.id);
state.selectedCoreIds = new Set(bulkIds); applyCoreBulk('forged');
globalThis.bulkKey = [...state.changes.keys()][0]; setCoreState(bulkIds[0], 'owned'); undoChange(bulkKey);`);
  assert.equal(run('coreStatus(bulkIds[0])'), 'owned');
  assert.equal(run('state.changes.size'), 1);
  run(`undoChange('core:' + bulkIds[0])`);
  assert.deepEqual(asJson('state.raw'), original);
});

check('全部外观撤销保留之后选中的单个框架', () => {
  run(`globalThis.skinWeapon = state.catalog.weapons.find(weapon => weapon.frameworks?.length);
globalThis.testSkin = skinWeapon.frameworks[0];
globalThis.skinSlot = state.model.characters.find(item => item.dwarf === skinWeapon.dwarf).selected;
removeFrom(state.model.skinMap.get(skinWeapon.id).value, testSkin.id);
state.originalJson = JSON.stringify(state.raw);
unlockAllWeaponSkins(); setLoadoutSkin(skinWeapon.dwarf, skinSlot, skinWeapon.id, 'framework', testSkin.id); undoChange('skin:all-weapons');`);
  assert.equal(run('state.model.skinMap.get(skinWeapon.id).value.includes(testSkin.id)'), true);
  assert.equal(run('state.changes.size'), 1);
  run(`undoChange('loadout:' + skinWeapon.dwarf + ':' + skinSlot + ':' + skinWeapon.id + ':framework')`);
  assert.deepEqual(asJson('state.raw'), asJson('JSON.parse(state.originalJson)'));
});

check('复制槽保留点击时内容，撤销复制仍保留目标槽的后续修改', () => {
  run(`globalThis.sourceSlot = testSlot; globalThis.targetSlot = testSlot === 6 ? 5 : 6;
setLoadoutIcon(testDwarf, sourceSlot, 19); copyLoadoutSlot(testDwarf, sourceSlot, targetSlot);
setLoadoutIcon(testDwarf, targetSlot, 20); undoChange('loadout:' + testDwarf + ':' + sourceSlot + ':icon');`);
  assert.equal(run(`directProperty(state.model.characters.find(item => item.dwarf === testDwarf).loadoutsProp.value[targetSlot], 'iconIndex').value`), 20);
  run(`undoChange('loadout:' + testDwarf + ':' + targetSlot + ':icon')`);
  assert.equal(run(`directProperty(state.model.characters.find(item => item.dwarf === testDwarf).loadoutsProp.value[targetSlot], 'iconIndex').value`), 19);
  run(`setLoadoutIcon(testDwarf, targetSlot, 20); undoChange('loadout:' + testDwarf + ':copy:' + targetSlot)`);
  assert.equal(run(`directProperty(state.model.characters.find(item => item.dwarf === testDwarf).loadoutsProp.value[targetSlot], 'iconIndex').value`), 20);
  run(`undoChange('loadout:' + testDwarf + ':' + targetSlot + ':icon')`);
  assert.deepEqual(asJson('state.raw'), original);
});

check('撤销来源超频修改，复制槽仍有可用的超频', () => {
  run(`setLoadoutOverclock(testDwarf, testSlot, testWeapon.id, testOc.upgradeId); copyLoadoutSlot(testDwarf, testSlot, targetSlot); undoChange(testOcKey)`);
  assert.equal(run('coreStatus(testOc.id)'), 'forged');
  assert.equal(run(`directProperty(findWeaponUpgradeEntry(state.model.characters.find(item => item.dwarf === testDwarf), targetSlot, testWeapon.id)[1], 'EquippedOverclock').value`), run('testOc.upgradeId'));
  run(`globalThis.roundTrip = JSON.parse(convertSavToJson(convertJsonToSav(JSON.stringify(state.raw))))`);
  assert.deepEqual(asJson('roundTrip'), asJson('state.raw'));
  run(`undoChange('loadout:' + testDwarf + ':copy:' + targetSlot)`);
  assert.deepEqual(asJson('state.raw'), original);
});

console.log(`全部撤销回归通过；原存档仅读取：${fileURLToPath(new URL(`file:///${savePath.replaceAll('\\', '/')}`))}`);
