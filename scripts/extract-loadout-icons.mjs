// Extract the loadout icon textures from an installed Deep Rock Galactic PAK.
// The generated image list is used by the hosted, desktop, and standalone builds.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const pakPath = process.argv[2];
if (!pakPath) throw new Error('Usage: node scripts/extract-loadout-icons.mjs <FSD-WindowsNoEditor.pak>');
const names = [
  'Icon_Upgrade_Ammo', 'Icon_Upgrade_Aim', 'Icon_Upgrade_Bosco_Rocket_Upgrade',
  'Icon_Upgrade_Explosive', 'Icon_Upgrade_GroundFlames', 'Icon_Upgrade_Stun',
  'Icon_Upgrade_Cold', 'Icon_Upgrade_Grenade', 'Icons_Bosco',
  'Icon_Upgrade_ChargeUp', 'Icon_Upgrade_ClipSize', 'Icon_Shield',
  'MissionIcon_Type_Extraction_HD_Loadout', 'MissionIcon_Type_Elimination_HD_Loadout',
  'MissionIcon_Type_EggCollection_HD_Loadout', 'MissionIcon_Type_Escort_HD_Loadout',
  'MissionIcon_Type_Facility_HD_Loadout', 'MissionIcon_Type_MotherLode_HD_Loadout',
  'MissionIcon_Type_Salvage_HD_Loadout', 'MissionIcon_Type_Refinery_HD_Loadout',
  'MissionIcon_Type_HeavyExtraction_HD_Loadout',
];
const wanted = new Set(names.map((name) => `${name}.uexp`));
function gameAssetPath(name) {
  if (name.startsWith('MissionIcon_')) return `FSD/Content/UI/Menu_MissionSelectionMK3/Assets/MissionIcons_Loadout/${name}.uexp`;
  if (name === 'Icons_Bosco' || name === 'Icon_Shield') return `FSD/Content/UI/Art/Icons/Icons_Misc/${name}.uexp`;
  return `FSD/Content/UI/Art/Icons/Icons_Upgrades/${name}.uexp`;
}
const fd = fs.openSync(pakPath, 'r');
const footer = Buffer.alloc(204);
fs.readSync(fd, footer, 0, footer.length, fs.fstatSync(fd).size - footer.length);
if (footer.readUInt32LE(0) !== 0x5a6f12e1) throw new Error('Unrecognized PAK footer');
const indexOffset = Number(footer.readBigUInt64LE(8));
const header = Buffer.alloc(110);
fs.readSync(fd, header, 0, header.length, indexOffset);
const directoryOffset = Number(header.readBigUInt64LE(0x46));
const directorySize = Number(header.readBigUInt64LE(0x4e));
const directory = Buffer.alloc(directorySize);
fs.readSync(fd, directory, 0, directorySize, directoryOffset);
let pos = 0;
function readUint() { const value = directory.readUInt32LE(pos); pos += 4; return value; }
function readString() {
  const length = directory.readInt32LE(pos); pos += 4;
  if (length < 1 || length > 2000) throw new Error('Invalid PAK filename length');
  const value = directory.toString('utf8', pos, pos + length - 1); pos += length;
  return value;
}
const entries = new Map();
for (let i = readUint(); i > 0; i--) {
  const folder = readString();
  for (let j = readUint(); j > 0; j--) {
    const filename = readString();
    const location = readUint();
    if (wanted.has(filename)) entries.set(`${folder}${filename}`, { folder, location });
  }
}

function readPakFile({ location }) {
  const encoded = Buffer.alloc(32);
  fs.readSync(fd, encoded, 0, encoded.length, indexOffset + 110 + location);
  const flags = encoded.readUInt32LE(0);
  const candidates = [encoded.readUInt32LE(4), encoded.readUInt32LE(8)];
  const offset = candidates.find((value) => value > 100_000_000 && value < indexOffset);
  if (!offset) throw new Error(`Unable to find PAK entry offset for flags ${flags.toString(16)}`);
  const meta = Buffer.alloc(1024);
  fs.readSync(fd, meta, 0, meta.length, offset);
  const compressed = Number(meta.readBigUInt64LE(8));
  const uncompressed = Number(meta.readBigUInt64LE(16));
  const method = meta.readUInt32LE(24);
  if (uncompressed > 10_000_000) throw new Error(`Unexpected file size ${uncompressed}`);
  if (method === 0) {
    const bytes = Buffer.alloc(uncompressed);
    fs.readSync(fd, bytes, 0, bytes.length, offset + 53);
    return bytes;
  }
  if (method !== 1 || compressed > 10_000_000) throw new Error(`Unsupported PAK compression ${method}`);
  const blockCount = meta.readUInt32LE(48);
  if (blockCount < 1 || blockCount > 50) throw new Error(`Unexpected compression block count ${blockCount}`);
  const blocks = [];
  for (let i = 0; i < blockCount; i++) {
    const begin = Number(meta.readBigUInt64LE(52 + i * 16));
    const end = Number(meta.readBigUInt64LE(60 + i * 16));
    if (end <= begin || end - begin > compressed) throw new Error('Invalid compression block');
    const bytes = Buffer.alloc(end - begin);
    fs.readSync(fd, bytes, 0, bytes.length, offset + begin);
    blocks.push(zlib.inflateSync(bytes));
  }
  const inflated = Buffer.concat(blocks);
  if (inflated.length !== uncompressed) throw new Error('PAK decompressed size mismatch');
  return inflated;
}

function decodeDxt5(bytes) {
  const marker = bytes.indexOf('PF_DXT5\0');
  if (marker < 0) throw new Error('Expected DXT5 texture');
  let start = -1; let width = 0;
  for (let at = marker + 8; at < Math.min(marker + 160, bytes.length - 24); at++) {
    const size = bytes.readUInt32LE(at);
    const side = Math.sqrt(size);
    if (size < 1024 || size > bytes.length || side % 4 || (side & (side - 1)) || bytes.readUInt32LE(at + 4) !== size) continue;
    start = at + 16; width = side; break;
  }
  if (start < 0 || start + width * width > bytes.length) throw new Error('Could not find inline DXT5 mip');
  const rgba = Buffer.alloc(width * width * 4);
  const c565 = (v) => [Math.round(((v >>> 11) & 31) * 255 / 31), Math.round(((v >>> 5) & 63) * 255 / 63), Math.round((v & 31) * 255 / 31)];
  for (let by = 0; by < width / 4; by++) for (let bx = 0; bx < width / 4; bx++) {
    const at = start + (by * width / 4 + bx) * 16;
    const a0 = bytes[at], a1 = bytes[at + 1];
    const alpha = [a0, a1];
    if (a0 > a1) for (let i = 1; i <= 6; i++) alpha.push(Math.round(((7 - i) * a0 + i * a1) / 7));
    else { for (let i = 1; i <= 4; i++) alpha.push(Math.round(((5 - i) * a0 + i * a1) / 5)); alpha.push(0, 255); }
    let alphaBits = 0n;
    for (let i = 0; i < 6; i++) alphaBits |= BigInt(bytes[at + 2 + i]) << BigInt(i * 8);
    const c0 = bytes.readUInt16LE(at + 8), c1 = bytes.readUInt16LE(at + 10);
    const p0 = c565(c0), p1 = c565(c1);
    const colors = [p0, p1];
    if (c0 > c1) {
      colors.push(p0.map((v, i) => Math.round((2 * v + p1[i]) / 3)));
      colors.push(p0.map((v, i) => Math.round((v + 2 * p1[i]) / 3)));
    } else {
      colors.push(p0.map((v, i) => Math.round((v + p1[i]) / 2)));
      colors.push([0, 0, 0]);
    }
    const colorBits = bytes.readUInt32LE(at + 12);
    for (let p = 0; p < 16; p++) {
      const x = bx * 4 + (p % 4), y = by * 4 + Math.floor(p / 4);
      const out = (y * width + x) * 4;
      const color = colors[(colorBits >>> (p * 2)) & 3];
      rgba[out] = color[0]; rgba[out + 1] = color[1]; rgba[out + 2] = color[2];
      rgba[out + 3] = alpha[Number((alphaBits >> BigInt(p * 3)) & 7n)];
    }
  }
  return { width, rgba };
}

function decodeBgra8(bytes) {
  const marker = bytes.indexOf('PF_B8G8R8A8\0');
  if (marker < 0) throw new Error('Expected BGRA8 texture');
  for (let at = marker + 12; at < Math.min(marker + 160, bytes.length - 24); at++) {
    const size = bytes.readUInt32LE(at);
    const width = Math.sqrt(size / 4);
    const start = at + 16;
    if (size < 4096 || start + size > bytes.length || width % 4 || (width & (width - 1)) || bytes.readUInt32LE(at + 4) !== size) continue;
    const rgba = Buffer.alloc(size);
    for (let i = 0; i < size; i += 4) {
      rgba[i] = bytes[start + i + 2]; rgba[i + 1] = bytes[start + i + 1];
      rgba[i + 2] = bytes[start + i]; rgba[i + 3] = bytes[start + i + 3];
    }
    return { width, rgba };
  }
  throw new Error('Could not find inline BGRA8 mip');
}

function decodeTexture(bytes) {
  if (bytes.includes('PF_DXT5\0')) return decodeDxt5(bytes);
  if (bytes.includes('PF_B8G8R8A8\0')) return decodeBgra8(bytes);
  throw new Error(`Unsupported game icon texture: ${[...bytes.toString('latin1').matchAll(/PF_[A-Z0-9]+/g)].map((match) => match[0])}`);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, value) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(value.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, value])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, value, tail]);
}
function png({ width, rgba }) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(width, 4); ihdr[8] = 8; ihdr[9] = 6;
  const lines = Buffer.alloc(width * (width * 4 + 1));
  for (let y = 0; y < width; y++) rgba.copy(lines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(lines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir = path.join(project, '.analysis', 'loadout-icons');
fs.mkdirSync(outputDir, { recursive: true });
const images = [];
for (const name of names) {
  const entry = entries.get(gameAssetPath(name));
  if (!entry) throw new Error(`Game texture missing: ${name}`);
  const payload = readPakFile(entry);
  const texture = png(decodeTexture(payload));
  fs.writeFileSync(path.join(outputDir, `${name}.png`), texture);
  images.push(`data:image/png;base64,${texture.toString('base64')}`);
  console.log(`${images.length - 1}: ${name} (${texture.length} bytes)`);
}
fs.writeFileSync(path.join(outputDir, 'images.json'), JSON.stringify(images));
fs.writeFileSync(path.join(project, 'dist', 'loadout-icons.js'), `window.__DRG_LOADOUT_ICON_IMAGES__=${JSON.stringify(images)};\n`);
fs.closeSync(fd);
