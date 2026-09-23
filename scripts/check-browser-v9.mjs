import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [port, htmlPath, savePath, outputDir] = process.argv.slice(2);
if (!outputDir) throw new Error('用法：node scripts/check-browser-v9.mjs <CDP端口> <HTML> <只读存档> <输出目录>');
fs.mkdirSync(outputDir, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let target;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { target = (await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())).find((item) => item.type === 'page'); } catch {}
  if (target) break;
  await pause(100);
}
if (!target) throw new Error('浏览器页面不可用');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const packet = JSON.parse(event.data);
  const item = pending.get(packet.id);
  if (!item) return;
  pending.delete(packet.id);
  clearTimeout(item.timer);
  packet.error ? item.reject(new Error(packet.error.message)) : item.resolve(packet.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const until = async (expression, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw new Error(`等待超时：${label}，提示：${await evaluate("document.querySelector('#toast')?.textContent")}`);
};
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const capture = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`${outputDir}/${name}`, Buffer.from(result.data, 'base64'));
};

const saveBase64 = fs.readFileSync(savePath).toString('base64');
const saveFileName = path.basename(savePath);
const mockFileSystem = `(() => {
  const original = Uint8Array.from(atob(${JSON.stringify(saveBase64)}), char => char.charCodeAt(0));
  let current = original.slice();
  const backups = new Map();
  const fileName = ${JSON.stringify(saveFileName)};
  const fileHandle = {
    kind:'file', name:fileName,
    async getFile() { return new File([current], fileName, {lastModified:Date.now()}); },
    async createWritable() { let next; return { async write(bytes) { next = new Uint8Array(bytes); }, async close() { current = next; }, async abort() {} }; }
  };
  const backDirectory = {
    kind:'directory', name:'back',
    async getDirectoryHandle(folderName, options = {}) {
      if (!options.create && ![...backups.keys()].some((key) => key.startsWith(folderName + '/'))) throw new DOMException('Missing','NotFoundError');
      return {
        kind:'directory', name:folderName,
        async getFileHandle(name, fileOptions = {}) {
          const key = folderName + '/' + name;
          if (!backups.has(key)) {
            if (!fileOptions.create) throw new DOMException('Missing','NotFoundError');
            backups.set(key, new Uint8Array());
          }
          return {name,kind:'file',async getFile(){return new File([backups.get(key)],name,{lastModified:Date.now()});},async createWritable(){let next;return {async write(bytes){next=new Uint8Array(bytes);},async close(){backups.set(key,next);},async abort(){}};}};
        },
        async *entries(){for(const key of backups.keys()) if(key.startsWith(folderName+'/')){const name=key.slice(folderName.length+1);yield [name,await this.getFileHandle(name)];}}
      };
    },
    async *entries(){for(const folderName of new Set([...backups.keys()].map((key)=>key.split('/')[0]))) yield [folderName,await this.getDirectoryHandle(folderName)];}
  };
  const directory = {
    kind:'directory', name:'SaveGames',
    async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
    async *entries() { yield [fileName, fileHandle]; },
    async getFileHandle(name) { if (name !== fileName) throw new DOMException('Missing','NotFoundError'); return fileHandle; },
    async getDirectoryHandle(name) { throw new DOMException('Missing','NotFoundError'); }
  };
  const traversed = [];
  const savedDirectory = {kind:'directory', name:'Saved', async getDirectoryHandle(name, options = {}) { traversed.push(name); if(name === 'SaveGames') return directory; if(name === 'back' && (options.create || backups.size)) return backDirectory; throw new DOMException('Missing','NotFoundError'); }};
  const fsdDirectory = {kind:'directory', name:'FSD', async getDirectoryHandle(name) { traversed.push(name); if(name !== 'Saved') throw new DOMException('Missing','NotFoundError'); return savedDirectory; }};
  const gameRoot = {kind:'directory', name:'Deep Rock Galactic', async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; }, async getDirectoryHandle(name) { traversed.push(name); if(name !== 'FSD') throw new DOMException('Missing','NotFoundError'); return fsdDirectory; }};
  Object.defineProperty(window, 'showDirectoryPicker', {configurable:true, value:async()=>gameRoot});
  window.__fakeFS = { fileName, traversed, get original() { return original; }, get current() { return current; }, get backups() { return backups; }, tamper() { current[0] ^= 1; }, restore() { current = original.slice(); } };
})()`;
const report = {};
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mockFileSystem });
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
  await until("Boolean(document.querySelector('#choose-button') && !document.querySelector('#choose-button').disabled)", '页面加载');
  assert.equal(await evaluate("document.querySelector('#auto-load-toggle').checked"), true);
  assert.equal(await evaluate("document.querySelector('#reset-button').previousElementSibling.id"), 'backup-button');
  assert.equal(await evaluate("document.querySelector('#backup-button').previousElementSibling.id"), 'set-game-directory-button');
  assert.equal(await evaluate("document.querySelector('#set-game-directory-button').textContent"), '设置游戏目录');
  assert.equal(await evaluate("document.querySelector('#drop-panel h2').textContent"), '选择存档');
  assert.equal(await evaluate("document.querySelector('#choose-button').textContent"), '选择存档');
  assert.equal(await evaluate("document.querySelector('#connect-folder-button').textContent"), '读取游戏存档');
  assert.match(await evaluate("document.querySelector('#native-status').textContent"), /设置游戏目录/);
  await click('#set-game-directory-button');
  await until("document.querySelector('#file-chip').classList.contains('loaded')", '设置游戏目录后自动载入');
  assert.equal(await evaluate("document.querySelector('#file-chip span').textContent"), saveFileName);
  assert.deepEqual(await evaluate("window.__fakeFS.traversed"), ['FSD','Saved','SaveGames']);
  assert.match(await evaluate("document.querySelector('#native-status').textContent"), /Deep Rock Galactic.*FSD\\Saved\\SaveGames/);
  await click('#connect-folder-button');
  await until("document.querySelector('#file-chip').classList.contains('loaded')", '重新读取游戏存档');
  report.folderConnected = true;
  await click('[data-view="resources"]');
  const before = await evaluate("Number(document.querySelector('[data-number=Credits]').value)");
  await evaluate(`(() => { const input = document.querySelector('[data-number=Credits]'); input.value = ${before + 21}; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  assert.equal(await evaluate("document.querySelector('#replace-button').disabled"), false);
  await click('#replace-button');
  assert.equal(await evaluate("document.querySelector('#replace-dialog').open"), true);
  await capture('single-html-confirmation.png');
  await click('#replace-cancel');
  assert.equal(await evaluate("window.__fakeFS.backups.size"), 0);
  await click('#replace-button');
  await evaluate('window.__fakeFS.tamper()');
  await click('#replace-confirm');
  await until("document.querySelector('#toast').textContent.includes('游戏存档已在载入后变化')", '检测外部修改');
  assert.equal(await evaluate("window.__fakeFS.backups.size"), 0);
  await evaluate('window.__fakeFS.restore()');
  await click('#replace-confirm');
  await until("!document.querySelector('#replace-dialog').open && document.querySelector('#change-count').textContent === '0'", '备份替换完成');
  const result = await evaluate(`(() => { const fs = window.__fakeFS; const [name, backup] = [...fs.backups][0]; let identical = backup.length === fs.original.length; for(let i=0;i<backup.length&&identical;i++) if(backup[i]!==fs.original[i]) identical=false; return {name, backupBytes:backup.length, backupMatches:identical, currentBytes:fs.current.length}; })()`);
  assert.match(result.name, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\//);
  assert.ok(result.name.endsWith(`/${saveFileName}`));
  assert.equal(result.backupMatches, true);
  assert.equal(await evaluate("Number(document.querySelector('[data-number=Credits]').value)"), before + 21);
  report.replacement = result;
  await click('#backup-button');
  await until("document.querySelectorAll('.backup-entry').length === 1", '备份列表载入');
  await capture('backup-panel.png');
  assert.match(await evaluate("document.querySelector('#backup-detail').textContent"), /已购买武器模块/);
  assert.equal(await evaluate("document.querySelectorAll('.backup-class-grid > div').length"), 4);
  await click('#backup-restore');
  await until("document.querySelector('#restore-dialog').open", '还原确认');
  assert.equal(await evaluate("document.querySelector('#restore-dialog').open"), true);
  await click('#restore-confirm');
  await until("!document.querySelector('#restore-dialog').open && !document.querySelector('#backup-dialog').open", '还原完成');
  assert.equal(await evaluate("Number(document.querySelector('[data-number=Credits]').value)"), before);
  assert.equal(await evaluate("window.__fakeFS.backups.size"), 2);
  await click('#backup-button');
  await until("document.querySelectorAll('.backup-entry').length === 2", '还原前备份可见');
  await click('#backup-create');
  await until("document.querySelectorAll('.backup-entry').length === 3", '手动备份可见');
  report.backupAndRestore = { entries: await evaluate("document.querySelectorAll('.backup-entry').length"), restoredCredits: before };
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href + '?external=1' });
  await until("location.search.includes('external=1') && Boolean(document.querySelector('#choose-button') && !document.querySelector('#choose-button').disabled)", '外部备份测试页面');
  await click('#backup-button');
  assert.match(await evaluate("document.querySelector('#backup-location').textContent"), /未设置游戏目录/);
  await evaluate(`(() => { const bytes=Uint8Array.from(atob(${JSON.stringify(saveBase64)}), c=>c.charCodeAt(0)); const input=document.querySelector('#backup-input'); const transfer=new DataTransfer(); transfer.items.add(new File([bytes], ${JSON.stringify(saveFileName)}, {lastModified:Date.now()})); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until("document.querySelectorAll('.backup-entry').length === 1", '外部备份已导入');
  await click('#backup-restore');
  await until("document.querySelector('#restore-dialog').open", '未设置目录时临时选择还原目标');
  assert.match(await evaluate("document.querySelector('#restore-target').textContent"), /Deep Rock Galactic.*SaveGames/);
  await click('#restore-confirm');
  await until("!document.querySelector('#restore-dialog').open && !document.querySelector('#backup-dialog').open", '外部备份还原完成');
  assert.equal(await evaluate("window.__fakeFS.backups.size"), 1);
  report.externalRestoreWithoutSavedDirectory = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || String(error);
  try { report.ui = await evaluate("({status:document.querySelector('#native-status')?.textContent,toast:document.querySelector('#toast')?.textContent})"); } catch {}
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2));
  try { await send('Browser.close'); } catch {}
  socket.close();
}
