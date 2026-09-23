import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [portText, htmlPath, bridgeUrl, fixturePath, outputDir] = process.argv.slice(2);
if (!outputDir) throw new Error('用法：node scripts/check-browser-v8.mjs <CDP端口> <HTML> <本地助手URL> <测试副本> <输出目录>');
fs.mkdirSync(outputDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let target;
for (let i = 0; i < 60; i += 1) {
  try {
    target = (await fetch(`http://127.0.0.1:${portText}/json`).then((result) => result.json())).find((item) => item.type === 'page');
    if (target) break;
  } catch {}
  await sleep(100);
}
if (!target) throw new Error('浏览器调试页面不可用');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  clearTimeout(item.timer);
  message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
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
  for (let i = 0; i < 100; i += 1) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`等待失败：${label}`);
};
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const screenshot = async (name) => {
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`${outputDir}/${name}`, Buffer.from(image.data, 'base64'));
};
const report = {};
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
  await until("!document.querySelector('#choose-button').disabled", '单文件网页载入');
  assert.equal(await evaluate("document.querySelector('#auto-load-toggle').checked"), true);
  assert.equal(await evaluate("document.querySelector('.project-link').href"), 'https://github.com/muzhouyi/drg-vault');
  assert.match(await evaluate("document.querySelector('.project-link').textContent"), /v0\.8\.0/);
  for (const view of ['overview', 'resources', 'classes', 'cores', 'skins']) {
    await click(`[data-view="${view}"]`);
    const cards = await evaluate("document.querySelectorAll('.preview-card').length");
    assert.ok(cards >= 3, `${view} 缺少预览内容`);
    report[`preview_${view}`] = cards;
  }
  assert.equal(await evaluate("document.querySelector('#replace-button').disabled"), true);
  await screenshot('preview-without-save.png');

  await send('Page.navigate', { url: bridgeUrl });
  await until("document.querySelector('#file-chip')?.classList.contains('loaded')", '本地模式自动载入');
  report.autoLoaded = await evaluate("({ file: document.querySelector('#file-chip span')?.textContent, status: document.querySelector('#native-status')?.textContent, replaceDisabled: document.querySelector('#replace-button').disabled })");
  assert.equal(report.autoLoaded.file, path.basename(fixturePath));
  assert.equal(report.autoLoaded.replaceDisabled, true);
  const originalBytes = fs.readFileSync(fixturePath);
  await click('[data-view="resources"]');
  const credits = await evaluate("Number(document.querySelector('[data-number=Credits]').value)");
  await evaluate(`(() => { const input = document.querySelector('[data-number=Credits]'); input.value = ${credits + 19}; input.dispatchEvent(new Event('change', { bubbles:true })); })()`);
  assert.equal(await evaluate("document.querySelector('#replace-button').disabled"), false);
  await click('#replace-button');
  assert.equal(await evaluate("document.querySelector('#replace-dialog').open"), true);
  assert.match(await evaluate("document.querySelector('#replace-target').textContent"), /SaveGames.*_Player\.sav/);
  await screenshot('replace-confirmation.png');
  await click('#replace-cancel');
  assert.equal(await evaluate("document.querySelector('#replace-dialog').open"), false);
  assert.deepEqual(fs.readFileSync(fixturePath), originalBytes, '取消后不应更改文件');
  await click('#replace-button');
  await click('#replace-confirm');
  await until("!document.querySelector('#replace-dialog').open && document.querySelector('#change-count').textContent === '0'", '替换完成并重新载入');
  const backDir = new URL('./back/', pathToFileURL(fixturePath));
  const backups = fs.readdirSync(backDir).filter((name) => /_Player_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\.sav$/.test(name));
  assert.equal(backups.length, 1);
  assert.deepEqual(fs.readFileSync(new URL(backups[0], backDir)), originalBytes);
  assert.notDeepEqual(fs.readFileSync(fixturePath), originalBytes);
  assert.equal(await evaluate("Number(document.querySelector('[data-number=Credits]').value)"), credits + 19);
  report.replace = { backup: backups[0], reloadWorked: true };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  report.narrow = await evaluate('({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })');
  assert.ok(report.narrow.documentWidth <= report.narrow.viewport + 1, '窄屏出现横向溢出');
  await screenshot('local-mode-narrow.png');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || String(error);
  try { report.ui = await evaluate("({ toast: document.querySelector('#toast')?.textContent, status: document.querySelector('#native-status')?.textContent })"); } catch {}
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2));
  try { await send('Browser.close'); } catch {}
  socket.close();
}
