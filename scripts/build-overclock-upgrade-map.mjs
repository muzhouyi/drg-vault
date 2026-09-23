import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const catalogPath = path.join(projectRoot, 'dist', 'catalog.json');
const assetJsonDir = path.join(projectRoot, '.analysis', 'oc-json');
const stringTablePaths = [
  path.join(projectRoot, '.analysis', 'ST_GearUpgrades.json'),
  path.join(projectRoot, '.analysis', 'ST_OC_BonusAndDrawbackLines.json'),
];
const outputPath = path.join(projectRoot, 'data', 'overclock-upgrade-map.json');
const detailsPath = path.join(projectRoot, 'data', 'overclock-upgrade-details.json');

const weaponByFolder = {
  AssaultRifle: 'Deepcore GK2',
  Autocannon: "'Thunderhead' Heavy Autocannon",
  BoltActionRifle: 'M1000 Classic',
  BurstFirePistol: 'BRT7 Burst Fire Gun',
  ChargeBlaster: 'Experimental Plasma Charger',
  CombatShotgun: "'Warthog' Auto 210",
  Crossbow: 'Nishanka Boltshark X-80',
  Cryospray: 'Cryo Cannon',
  DualMachinePistols: 'Zhukov NUK17',
  FlameThrower: 'CRSPR Flamethrower',
  GatlingGun: "'Lead Storm' Powered Minigun",
  GooCannon: 'Corrosive Sludge Pump',
  GrenadeLauncher: 'Deepcore 40mm PGL',
  HeavyParticleCannon: 'Shard Diffractor',
  LineCutter: 'Breach Cutter',
  LockOnRifle: 'LOK-1 Smart Rifle',
  MicroMissileLauncher: "'Hurricane' Guided Rocket System",
  MicrowaveGun: 'Colette Wave Cooker',
  Pistol: 'Subata 120',
  PlasmaCarbine: 'DRAK-25 Plasma Carbine',
  Revolver: "'Bulldog' Heavy Revolver",
  SawedOffShotgun: 'Jury-Rigged Boomstick',
  SMG: "'Stubby' Voltaic SMG",
  CoilGun: 'Armskore Coil Gun',
};

const displayNameAliases = {
  T_RandomDamage: 'Homebrew Powder',
  T_OverheatAoE: 'Aggressive Venting',
};

const normalizeName = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const rawGuid = (value = '') => {
  const hex = value.replaceAll(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 32) return hex;
  return hex.match(/.{8}/g).map((chunk) => chunk.match(/../g).reverse().join('')).join('');
};

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const textByKey = new Map(stringTablePaths.flatMap((file) => {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).Exports?.find((entry) => entry.Table)?.Table?.Value || [];
}));
const weaponCores = catalog.coreItems.filter((item) => item.category === 'Weapons');
const assets = [];

for (const file of fs.readdirSync(assetJsonDir).filter((name) => name.endsWith('.json'))) {
  const folder = file.split('__')[0];
  const weapon = weaponByFolder[folder];
  if (!weapon) continue;
  const asset = JSON.parse(fs.readFileSync(path.join(assetJsonDir, file), 'utf8'));
  for (const exported of asset.Exports || []) {
    if (!Array.isArray(exported.Data)) continue;
    const nameProperty = exported.Data.find((item) => item.Name === 'Name');
    const saveIdProperty = exported.Data.find((item) => item.Name === 'SaveGameID');
    const descriptionProperty = exported.Data.find((item) => item.Name === 'Description');
    const assetName = nameProperty?.CultureInvariantString ?? nameProperty?.Value;
    const saveId = saveIdProperty?.Value?.[0]?.Value ?? saveIdProperty?.Value;
    if (!assetName || !saveId) continue;
    assets.push({
      file,
      weapon,
      name: displayNameAliases[assetName] || assetName,
      description: textByKey.get(descriptionProperty?.CultureInvariantString ?? descriptionProperty?.Value)
        || descriptionProperty?.CultureInvariantString || descriptionProperty?.Value || '',
      upgradeId: rawGuid(saveId),
    });
  }
}

const result = {};
const details = {};
const unmatched = [];
for (const core of weaponCores) {
  const matches = assets.filter((asset) => asset.weapon === core.weapon && normalizeName(asset.name) === normalizeName(core.name));
  if (matches.length !== 1) {
    unmatched.push({ core: `${core.weapon} / ${core.name}`, matches: matches.map((item) => item.file) });
    continue;
  }
  result[core.id] = matches[0].upgradeId;
  details[core.id] = { description: matches[0].description };
}

if (unmatched.length) {
  throw new Error(`Unable to create a unique upgrade mapping:\n${JSON.stringify(unmatched, null, 2)}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
fs.writeFileSync(detailsPath, `${JSON.stringify(details, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, mapped: Object.keys(result).length, discoveredAssets: assets.length }));
