import fs from 'node:fs';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
export const version = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')).version;

export function syncVersion() {
  const file = path.join(project, 'dist', 'index.html');
  const original = fs.readFileSync(file, 'utf8');
  let replacements = 0;
  const updated = original
    .replace(/(aria-label="打开 GitHub 项目，版本 )v?\d+\.\d+\.\d+(")/, (_, before, after) => {
      replacements += 1;
      return `${before}${version}${after}`;
    })
    .replace(/(<span>GitHub · )v?\d+\.\d+\.\d+(<\/span>)/, (_, before, after) => {
      replacements += 1;
      return `${before}${version}${after}`;
    });
  if (replacements !== 2) throw new Error('找不到页面左下角的版本标记');
  if (updated !== original) fs.writeFileSync(file, updated);
}
