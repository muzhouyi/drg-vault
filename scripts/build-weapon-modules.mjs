import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const moduleJsonDir = path.join(projectRoot, '.analysis', 'module-json');
const stringTablePath = path.join(projectRoot, '.analysis', 'ST_GearUpgrades.json');
const bonusTablePath = path.join(projectRoot, '.analysis', 'ST_OC_BonusAndDrawbackLines.json');
const outputPath = path.join(projectRoot, 'data', 'weapon-modules.json');

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

const rawGuid = (value = '') => {
  const hex = value.replaceAll(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 32) return hex;
  return hex.match(/.{8}/g).map((chunk) => chunk.match(/../g).reverse().join('')).join('');
};

const stringTable = JSON.parse(fs.readFileSync(stringTablePath, 'utf8'))
  .Exports?.find((entry) => entry.Table)?.Table?.Value || [];
const textByKey = new Map(stringTable);
if (fs.existsSync(bonusTablePath)) {
  const bonusRows = JSON.parse(fs.readFileSync(bonusTablePath, 'utf8'))
    .Exports?.find((entry) => entry.Table)?.Table?.Value || [];
  for (const [key, value] of bonusRows) textByKey.set(key, value);
}
const modules = [];

for (const file of fs.readdirSync(moduleJsonDir).filter((name) => name.endsWith('.json'))) {
  const folder = file.split('__')[0];
  const weapon = weaponByFolder[folder];
  if (!weapon) continue;
  const asset = JSON.parse(fs.readFileSync(path.join(moduleJsonDir, file), 'utf8'));
  for (const exported of asset.Exports || []) {
    if (!Array.isArray(exported.Data)) continue;
    const get = (name) => exported.Data.find((item) => item.Name === name);
    const nameProperty = get('Name');
    const descriptionProperty = get('Description');
    const saveIdProperty = get('SaveGameID');
    const tierProperty = get('UpgradeTier');
    const rawName = nameProperty?.CultureInvariantString ?? nameProperty?.Value;
    const rawDescription = descriptionProperty?.CultureInvariantString ?? descriptionProperty?.Value;
    const saveId = saveIdProperty?.Value?.[0]?.Value ?? saveIdProperty?.Value;
    if (!rawName || !rawDescription || !saveId) continue;
    const tierMatch = String(tierProperty?.Value || 'EUpgradeTiers::Tier_1').match(/Tier_(\d+)/);
    modules.push({
      id: rawGuid(saveId),
      weapon,
      name: textByKey.get(rawName) || rawName,
      description: textByKey.get(rawDescription) || rawDescription || '',
      tier: Number(tierMatch?.[1] || 1),
    });
  }
}

const unique = [...new Map(modules.map((item) => [item.id, item])).values()]
  .sort((a, b) => a.weapon.localeCompare(b.weapon) || a.tier - b.tier || a.name.localeCompare(b.name));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(unique, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, modules: unique.length }));
