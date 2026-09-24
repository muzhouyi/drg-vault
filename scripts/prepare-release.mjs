import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const project = path.resolve(import.meta.dirname, '..');
const release = path.join(project, 'release', 'v8');
fs.mkdirSync(release, { recursive: true });
const files = [
  [path.join(project, 'src-tauri', 'target', 'release', 'drg-vault.exe'), 'DRGVault.exe'],
  [path.join(project, 'src-tauri', 'target', 'release', 'bundle', 'nsis', 'DRG Vault_0.8.0_x64-setup.exe'), 'DRGVault-v8-windows-x64-setup.exe'],
  [path.join(project, 'dist', 'licenses', 'DRG-Save-Editor-LICENSE.txt'), 'DRG-Save-Editor-LICENSE.txt'],
];
const checksums = [];
for (const [source, name] of files) {
  fs.copyFileSync(source, path.join(release, name));
  if (name.endsWith('.exe')) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(release, name))).digest('hex');
    checksums.push(`${digest}  ${name}`);
  }
}
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
console.log(release);
