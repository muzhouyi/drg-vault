import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(scripts);
const dist = path.join(project, 'dist');
const entry = path.join(dist, '.standalone-entry.mjs');
const bundle = path.join(dist, '.standalone-bundle.js');
const output = path.resolve(project, '..', 'DRG存档编辑器_中文版.html');
const versionedOutput = path.resolve(project, '..', 'DRG存档编辑器_中文版_v8.html');
const localHtmlOutput = path.resolve(project, '..', 'DRG-save-editor.html');
const helperOutput = path.resolve(project, '..', 'DRG-local-helper.ps1');
const launcherOutput = path.resolve(project, '..', '启动DRG存档编辑器.cmd');

if (process.argv.includes('--prepare')) {
  fs.writeFileSync(entry, `import './app.js';\n`);
  process.stdout.write(entry);
  process.exit(0);
}

if (!fs.existsSync(bundle)) throw new Error('请先生成单文件脚本包');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dist, 'styles.css'), 'utf8');
const catalog = fs.readFileSync(path.join(dist, 'catalog.json'), 'utf8');
const js = (`window.__DRG_CATALOG__=${catalog};\n` + fs.readFileSync(bundle, 'utf8')).replaceAll('</script', '<\\/script');
html = html
  .replace('<link rel="stylesheet" href="./styles.css" />', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./app.js"></script>', `<script>\n${js}\n</script>`);
fs.writeFileSync(output, html);
fs.writeFileSync(versionedOutput, html);
fs.writeFileSync(localHtmlOutput, html);
fs.writeFileSync(helperOutput, '\uFEFF' + fs.readFileSync(path.join(scripts, 'local-bridge.ps1'), 'utf8'), 'utf8');
fs.copyFileSync(path.join(scripts, 'launch-local.cmd'), launcherOutput);
fs.rmSync(entry, { force: true });
fs.rmSync(bundle, { force: true });
process.stdout.write(JSON.stringify({ output, versionedOutput, launcherOutput, bytes: fs.statSync(output).size }));
