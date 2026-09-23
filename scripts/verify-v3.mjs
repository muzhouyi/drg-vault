import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertJsonToSav, convertSavToJson } from '../dist/lib/converter/converter.js';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(scripts);
const workspace = path.dirname(project);
const htmlPath = path.join(workspace, 'DRG存档编辑器_中文版_v6.html');
const savePath = process.argv[2];

if (!savePath) throw new Error('请把只读测试存档路径作为第一个参数传入');

const html = fs.readFileSync(htmlPath, 'utf8');
const appSource = fs.readFileSync(path.join(project, 'dist/app.js'), 'utf8');
const interfaceSource = `${html}\n${appSource}`;
const requiredText = [
  '护肝修改器',
  '全选当前结果',
  '批量设为已锻造',
  '批量设为待锻造',
  '全选当前武器',
  '批量设为已拥有',
  '精确等级',
  '315000',
  '网页会同时写入锻造历史和真正可装备的武器升级',
  '获得武器',
  '一键获得全部武器外观',
  '复制整个配装槽',
  '第 ${tier} 层',
  '7 个配装槽',
  '配装图标',
  '未购买 · 点击获得',
  '未锻造 · 点击获得',
];
for (const text of requiredText) {
  if (!interfaceSource.includes(text)) throw new Error(`界面源码缺少：${text}`);
}
if (html.includes('href="./styles.css"') || html.includes('src="./app.js"')) {
  throw new Error('单文件仍引用了外部 CSS 或 JavaScript');
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

const catalog = JSON.parse(fs.readFileSync(path.join(project, 'dist/catalog.json'), 'utf8'));
const original = JSON.parse(convertSavToJson(new Uint8Array(fs.readFileSync(savePath))));
const forged = findProperty(original, 'ForgedSchematics')?.value;
const owned = findProperty(original, 'OwnedSchematics')?.value;
const purchased = findProperty(original, 'PurchasedItemUpgrades')?.value;
const characters = findProperty(original, 'CharacterSaves')?.value;
const unlockedItems = findProperty(original, 'UnlockedItems')?.value;
const ownedItems = findProperty(original, 'OwnedItems')?.value;
if (!forged || !owned || !purchased || !characters?.length || !unlockedItems || !ownedItems) throw new Error('测试存档缺少关键结构');

const missingWeaponCore = catalog.coreItems.find((item) => item.category === 'Weapons' && item.upgradeId && !forged.includes(item.id) && !owned.includes(item.id) && !purchased.includes(item.upgradeId));
if (!missingWeaponCore) throw new Error('测试存档中没有可用于验证的未获得武器超频');
forged.push(missingWeaponCore.id);
purchased.push(missingWeaponCore.upgradeId);
const xp = characters.flatMap((block) => block).find((item) => item?.name === 'XP');
if (!xp) throw new Error('测试存档中没有职业经验字段');
xp.value = 63000;

const missingWeapon = catalog.weapons.find((item) => !item.starter);
if (!missingWeapon) throw new Error('目录中没有可用于验证的非初始武器');
for (const list of [unlockedItems, ownedItems]) {
  const index = list.indexOf(missingWeapon.id);
  if (index !== -1) list.splice(index, 1);
}
if (!unlockedItems.includes(missingWeapon.id)) unlockedItems.push(missingWeapon.id);
if (!ownedItems.includes(missingWeapon.id)) ownedItems.push(missingWeapon.id);

const bytes = convertJsonToSav(JSON.stringify(original));
const reparsed = JSON.parse(convertSavToJson(bytes));
const forgedAfter = findProperty(reparsed, 'ForgedSchematics')?.value || [];
const ownedAfter = findProperty(reparsed, 'OwnedSchematics')?.value || [];
const purchasedAfter = findProperty(reparsed, 'PurchasedItemUpgrades')?.value || [];
const xpAfter = findProperty(reparsed, 'CharacterSaves')?.value?.flatMap((block) => block).find((item) => item?.name === 'XP')?.value;
const unlockedItemsAfter = findProperty(reparsed, 'UnlockedItems')?.value || [];
const ownedItemsAfter = findProperty(reparsed, 'OwnedItems')?.value || [];

if (!forgedAfter.includes(missingWeaponCore.id) || ownedAfter.includes(missingWeaponCore.id) || !purchasedAfter.includes(missingWeaponCore.upgradeId)) {
  throw new Error('可装备的已锻造武器超频没有通过 SAV 往返校验');
}
if (xpAfter !== 63000) throw new Error('职业等级对应经验没有通过 SAV 往返校验');
if (!unlockedItemsAfter.includes(missingWeapon.id) || !ownedItemsAfter.includes(missingWeapon.id)) {
  throw new Error('武器获得状态没有同时写入解锁与拥有清单');
}

process.stdout.write(JSON.stringify({
  standaloneBytes: fs.statSync(htmlPath).size,
  testedCore: missingWeaponCore.nameZh || missingWeaponCore.name,
  coreState: 'forged-and-purchased',
  testedUpgradeId: missingWeaponCore.upgradeId,
  testedLevel: 10,
  testedXp: xpAfter,
  testedWeapon: missingWeapon.nameZh || missingWeapon.name,
  weaponState: 'unlocked-and-owned',
  moduleCount: catalog.weapons.reduce((sum, weapon) => sum + (weapon.modules?.length || 0), 0),
  roundTripBytes: bytes.length,
}, null, 2));
