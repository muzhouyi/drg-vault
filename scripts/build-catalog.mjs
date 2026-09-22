import fs from 'node:fs';
import path from 'node:path';

const root = 'D:/下载暂存/work/za';
const editorData = path.join(root, '.tools/drg-save-editor/guids.json');
const completionist = path.join(root, '.tools/drg-completionist/data');
const output = path.join(root, 'drg-vault/dist/catalog.json');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const rawGuid = (value = '') => {
  const hex = value.replaceAll('-', '').toLowerCase();
  if (hex.length !== 32) return hex;
  const reverseBytes = (chunk) => chunk.match(/../g).reverse().join('');
  return hex.match(/.{8}/g).map(reverseBytes).join('');
};

const classIds = {
  Driller: '9edd56f1eebcc5488d5b5e5b80b62db4',
  Engineer: '85ef626c65f1024a8dfeb5d0f3909d2e',
  Gunner: 'ae56e180fec0c44d96fa29c28366b97b',
  Scout: '30d8ea17d8fbba4c95306de9655c2f8c',
};

const coreSource = read(editorData);
const coreItems = Object.entries(coreSource).flatMap(([category, records]) =>
  Object.entries(records).map(([id, record]) => ({
    id: id.toLowerCase(),
    category,
    dwarf: record.dwarf,
    weapon: record.weapon ?? '',
    name: record.name,
    cost: record.cost ?? null,
  })),
);

const minerFiles = ['driller', 'engineer', 'gunner', 'scout'];
const miners = minerFiles.map((name) => read(path.join(completionist, `miners/${name}.json`)));
const minerByWeapon = new Map(miners.flatMap((miner) => miner.weapons.map((weapon) => [weapon, miner.name])));
const weapons = fs.readdirSync(path.join(completionist, 'weapons'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => read(path.join(completionist, 'weapons', file)))
  .map((weapon) => ({
    id: rawGuid(weapon.saveId),
    name: weapon.name,
    dwarf: minerByWeapon.get(weapon.name) ?? 'Unknown',
    frameworks: (weapon.frameworks ?? []).map((item) => ({ name: item.framework, id: rawGuid(item.saveId) })),
  }));

const commonWeaponPaintJobs = read(path.join(completionist, 'common-weapon-paint-jobs.json'))
  .map((item) => ({ id: rawGuid(item.saveId), name: item.name, source: item.source ?? '', season: item.season ?? null }));

const armorPaintJobs = miners.flatMap((miner) => (miner.armorPaintJobs ?? []).map((item) => ({
  id: rawGuid(item.saveId), name: item.name, dwarf: miner.name, source: item.source ?? '', season: item.season ?? null,
})));

const uniqueWeaponPaintJobs = miners.flatMap((miner) => (miner.uniqueWeaponPaintJobs ?? []).map((item) => ({
  id: rawGuid(item.saveId), name: item.name, dwarf: miner.name, source: item.source ?? '', season: item.season ?? null,
})));

const catalog = {
  generatedAt: new Date().toISOString(),
  classIds,
  coreItems,
  weapons,
  commonWeaponPaintJobs,
  uniqueWeaponPaintJobs,
  armorPaintJobs,
  resources: [
    ['Credits', '信用点', 'credits'],
    ['PerkPoints', '天赋点', 'perk'],
    ['af0dc4fe8361bb48b32c92cc97e21de7', 'Bismor', 'resource'],
    ['488d05146f5f754ba3d4610d08c0603e', 'Enor Pearl', 'resource'],
    ['22bc4f7d07d13e43bfca81bd9c14b1af', 'Jadiz', 'resource'],
    ['8aa7fb43293a0b49b8be42ffe068a44c', 'Croppa', 'resource'],
    ['aaded8766c227d408032afd18d63561e', 'Magnite', 'resource'],
    ['5f2bcf8347760a42a23b6edc07c0941d', 'Umanite', 'resource'],
    ['078548b93232c04085f892e084a74100', 'Yeast Cone', 'resource'],
    ['41ea550c1d46c54bbe2e9ca5a7accb06', 'Malt Star', 'resource'],
    ['72312204e287bc41815540a0cf881280', 'Starch Nut', 'resource'],
    ['22daa757ad7a8049891b17edcc2fe098', 'Barley Bulb', 'resource'],
    ['5828652c9a5de845a9e2e1b8b463c516', 'Error Cube', 'resource'],
    ['a10cb2853871fb499ac854a1cde2202c', 'Blank Matrix Core', 'resource'],
    ['99fa526ad87748459498905a278693f6', 'Data Cell', 'resource'],
    ['67668aae828fdb48a9111e1b912dbfa4', 'Phazyonite', 'resource'],
  ].map(([id, name, type]) => ({ id, name, type })),
};

fs.writeFileSync(output, JSON.stringify(catalog));
console.log(JSON.stringify({ output, coreItems: coreItems.length, weapons: weapons.length, frameworks: weapons.reduce((n, w) => n + w.frameworks.length, 0) }));
