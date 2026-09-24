import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const project = path.resolve(import.meta.dirname, '..');
const source = path.join(project, 'dist');
const target = path.join(project, 'build', 'desktop-ui');
fs.mkdirSync(target, { recursive: true });
let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
html = html.replace('<script type="module" src="./app.js"></script>', '<script>window.__DRG_DESKTOP__=true;</script><script type="module" src="./app.js"></script>');
fs.writeFileSync(path.join(target, 'index.html'), html);
fs.copyFileSync(path.join(source, 'styles.css'), path.join(target, 'styles.css'));
fs.copyFileSync(path.join(source, 'catalog.json'), path.join(target, 'catalog.json'));
await build({ entryPoints: [path.join(source, 'app.js')], outfile: path.join(target, 'app.js'), bundle: true, format: 'esm', target: 'chrome110', minify: true, sourcemap: false });
console.log(`Desktop UI built: ${target}`);
