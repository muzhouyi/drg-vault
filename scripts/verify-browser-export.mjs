import fs from 'node:fs';
import { convertSavToJson } from '../dist/lib/converter/converter.js';

const [savePath, grantedWeaponId, forgedCoreId, sourceRaw, targetRaw, moduleId, moduleWeaponId, equippedOcId, equippedSkinId, iconIndexRaw] = process.argv.slice(2);
if (!savePath || !grantedWeaponId || !forgedCoreId) throw new Error('缺少浏览器导出验证参数');
const source = Number(sourceRaw);
const target = Number(targetRaw);
const catalog = JSON.parse(fs.readFileSync(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const raw = JSON.parse(convertSavToJson(new Uint8Array(fs.readFileSync(savePath))));

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

const direct = (array, name) => Array.isArray(array) ? array.find((item) => item?.name === name) : null;
const unlocked = findProperty(raw, 'UnlockedItems')?.value || [];
const owned = findProperty(raw, 'OwnedItems')?.value || [];
if (!unlocked.includes(grantedWeaponId) || !owned.includes(grantedWeaponId)) throw new Error('浏览器导出的武器没有同时进入解锁与拥有清单');

const core = catalog.coreItems.find((item) => item.id === forgedCoreId);
const forged = findProperty(raw, 'ForgedSchematics')?.value || [];
const purchased = findProperty(raw, 'PurchasedItemUpgrades')?.value || [];
if (!core?.upgradeId || !forged.includes(core.id) || !purchased.includes(core.upgradeId)) throw new Error('浏览器导出的已锻造超频仍不可装备');

const skinPairs = findProperty(raw, 'UnlockedItemSkins')?.value || [];
const skinMap = new Map(skinPairs.map((pair) => [pair[0], direct(pair[1], 'Skins')?.value || []]));
let expectedSkins = 0;
for (const weapon of catalog.weapons) {
  const candidates = new Set([
    ...(weapon.frameworks || []).map((item) => item.id),
    ...(catalog.commonWeaponPaintJobs || []).map((item) => item.id),
    ...(catalog.uniqueWeaponPaintJobs || []).filter((item) => !item.dwarf || item.dwarf === weapon.dwarf).map((item) => item.id),
  ]);
  const actual = new Set(skinMap.get(weapon.id) || []);
  for (const id of candidates) if (!actual.has(id)) throw new Error(`武器 ${weapon.name} 缺少一键获得的外观 ${id}`);
  expectedSkins += candidates.size;
}

const characters = findProperty(raw, 'CharacterSaves')?.value || [];
const gunner = characters.find((block) => direct(block, 'SavegameID')?.value === catalog.classIds.Gunner);
if (!gunner) throw new Error('找不到枪手存档块');
const assertSlotCopy = (name, values) => {
  if (JSON.stringify(values?.[source]) !== JSON.stringify(values?.[target])) throw new Error(`${name} 没有完整复制`);
};
assertSlotCopy('武器选择', direct(gunner, 'Loadouts')?.value);
assertSlotCopy('模块、超频与武器外观', direct(gunner, 'ItemUpgradeLoadouts')?.value);
assertSlotCopy('角色外观', direct(direct(gunner, 'Vanity')?.value, 'Loadouts')?.value);
const poses = direct(direct(gunner, 'VictoryPose')?.value, 'EquippedVictoryPoses')?.value || [];
if ((poses[source] || '00000000000000000000000000000000') !== (poses[target] || '00000000000000000000000000000000')) throw new Error('胜利姿势没有复制');

const perkSlots = findProperty(raw, 'EquippedPerkLoadouts')?.value || [];
const characterId = catalog.classIds.Gunner;
const perkEntry = (slot) => (direct(perkSlots[slot], 'CharacterPerks')?.value || []).find((entry) => direct(entry, 'characterID')?.value === characterId);
if (JSON.stringify(perkEntry(source)) !== JSON.stringify(perkEntry(target))) throw new Error('天赋配装没有复制');

const grantedWeapon = catalog.weapons.find((item) => item.id === grantedWeaponId);
const copiedLoadout = direct(gunner, 'Loadouts')?.value?.[target];
if (direct(copiedLoadout, grantedWeapon?.slot)?.value !== grantedWeaponId) throw new Error('新获得的武器没有成功装入配装');
if (iconIndexRaw && direct(copiedLoadout, 'iconIndex')?.value !== Number(iconIndexRaw)) throw new Error('配装图标没有写入或复制');
const upgradeSlot = direct(gunner, 'ItemUpgradeLoadouts')?.value?.[target];
const grantedUpgrade = (direct(upgradeSlot, 'Loadout')?.value || []).find((pair) => pair[0] === grantedWeaponId);
if (moduleId) {
  const weaponUpgrade = (direct(upgradeSlot, 'Loadout')?.value || []).find((pair) => pair[0] === moduleWeaponId);
  if (!direct(weaponUpgrade?.[1], 'EquippedUpgrades')?.value?.includes(moduleId)) throw new Error('五层模块修改没有写入复制后的配装');
  if (!purchased.includes(moduleId)) throw new Error('未购买模块没有同步写入购买记录');
}
if (equippedOcId) {
  const equippedCore = catalog.coreItems.find((item) => item.upgradeId === equippedOcId);
  if (!equippedCore || !forged.includes(equippedCore.id) || !purchased.includes(equippedOcId)
      || direct(grantedUpgrade?.[1], 'EquippedOverclock')?.value !== equippedOcId) {
    throw new Error('未锻造超频没有同步获得并装备');
  }
}
if (equippedSkinId && !direct(grantedUpgrade?.[1], 'EquippedSkins')?.value?.includes(equippedSkinId)) throw new Error('未获得框架没有装备');

process.stdout.write(JSON.stringify({
  bytes: fs.statSync(savePath).size,
  grantedWeapon: grantedWeapon?.nameZh,
  equippedModule: catalog.weapons.flatMap((item) => item.modules || []).find((item) => item.id === moduleId)?.nameZh || null,
  iconIndex: iconIndexRaw ? Number(iconIndexRaw) : null,
  equippedOcId: equippedOcId || null,
  equippedSkinId: equippedSkinId || null,
  forgedCore: core.nameZh || core.name,
  allWeaponSkinsVerified: expectedSkins,
  copiedClass: '枪手',
  copiedSlot: `${source + 1} -> ${target + 1}`,
}, null, 2));
