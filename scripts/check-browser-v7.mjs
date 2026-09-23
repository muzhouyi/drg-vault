import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { convertSavToJson } from '../dist/lib/converter/converter.js';

const [portText = '9333', htmlPath, savePath, outputPath] = process.argv.slice(2);
const port = Number(portText);
if (!htmlPath || !savePath || !outputPath) throw new Error('用法：node scripts/check-browser-v7.mjs <调试端口> <HTML> <只读存档> <输出文件夹>');
const outputDir = path.resolve(outputPath);
fs.mkdirSync(outputDir, { recursive: true });
const sourceBytes = fs.readFileSync(savePath);
const original = JSON.parse(convertSavToJson(new Uint8Array(sourceBytes)));
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const report = { htmlPath, savePath, screenshots: [], checks: {}, exceptions: [] };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let sequence = 0;
const pending = new Map();
let send;

function findProperty(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.name === name) return node;
  for (const value of Object.values(node)) {
    const found = findProperty(value, name);
    if (found) return found;
  }
  return null;
}

function directProperty(node, name) {
  return Array.isArray(node) ? node.find((item) => item?.name === name) : null;
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, description, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw new Error(`等待超时：${description}；${await evaluate("document.querySelector('#toast')?.textContent || ''")}`);
}

async function screenshot(name) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(outputDir, name);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  report.screenshots.push(file);
}

async function click(selector) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('找不到控件：' + ${JSON.stringify(selector)}); element.click(); })()`);
}

try {
  let target;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page');
      if (target) break;
    } catch {}
    await pause(100);
  }
  if (!target) throw new Error('浏览器调试端口没有可用页面');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails);
  });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: outputDir, eventsEnabled: true });
  await send('Page.navigate', { url: pathToFileURL(path.resolve(htmlPath)).href });
  await waitFor("document.querySelector('#choose-button') && !document.querySelector('#choose-button').disabled", '本地页面就绪');
  const documentNode = await send('DOM.getDocument');
  const inputNode = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#save-input' });
  await send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [path.resolve(savePath)] });
  await waitFor("document.querySelector('#file-chip')?.classList.contains('loaded')", '存档载入');
  await click('[data-view="classes"]');
  report.checks.compact = await evaluate(`(() => ({
    moduleSummaries: document.querySelectorAll('[data-loadout-tier]').length,
    expandedTiers: document.querySelectorAll('[data-loadout-tier][aria-expanded="true"]').length,
    moduleCandidates: document.querySelectorAll('[data-loadout-module]').length,
    openUtilities: document.querySelectorAll('[data-loadout-tool][open]').length,
    utilityCount: document.querySelectorAll('[data-loadout-tool]').length,
    weaponTabs: document.querySelectorAll('[data-loadout-weapon-tab]').length,
    activeWeapon: document.querySelector('[data-loadout-weapon-tab].active')?.dataset.loadoutWeaponTab,
    slotCount: document.querySelectorAll('[data-loadout-slot]').length,
    contentHeight: Math.round(document.querySelector('#view-root').getBoundingClientRect().height),
    viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth
  }))()`);
  assert.equal(report.checks.compact.moduleSummaries, 5, '默认应显示五层模块摘要');
  assert.equal(report.checks.compact.expandedTiers, 0, '默认不应展开模块层');
  assert.equal(report.checks.compact.moduleCandidates, 0, '默认不应占用空间展示候选模块');
  assert.equal(report.checks.compact.openUtilities, 0, '图标、复制和解锁工具默认应折叠');
  assert.equal(report.checks.compact.utilityCount, 3);
  assert.equal(report.checks.compact.weaponTabs, 2);
  assert.equal(report.checks.compact.slotCount, 7);
  assert.ok(report.checks.compact.documentWidth <= report.checks.compact.viewportWidth + 1, '桌面布局横向溢出');
  await screenshot('loadout-compact-desktop.png');

  await click('[data-loadout-tier="1"]');
  report.checks.expandedModule = await evaluate(`(() => {
    const choices = [...document.querySelectorAll('.effect-choice[data-loadout-module]')];
    const choice = choices.find(item => !item.classList.contains('active'));
    if (!choice) throw new Error('第一层没有可用于切换的模块');
    return {
      candidateCount: choices.length,
      descriptions: choices.map(item => item.querySelector('p')?.textContent.trim()),
      expandedCount: document.querySelectorAll('[data-loadout-tier][aria-expanded="true"]').length,
      dwarf: document.querySelector('[data-loadout-class].active')?.dataset.loadoutClass,
      classId: window.__DRG_CATALOG__.classIds[document.querySelector('[data-loadout-class].active').dataset.loadoutClass],
      slot: Number(document.querySelector('[data-loadout-slot].active').dataset.loadoutSlot),
      weaponId: choice.dataset.weaponId,
      moduleId: choice.dataset.moduleId,
      tier: Number(choice.dataset.loadoutModule),
      name: choice.querySelector('b')?.textContent
    };
  })()`);
  assert.ok(report.checks.expandedModule.candidateCount > 1);
  assert.equal(report.checks.expandedModule.expandedCount, 1);
  assert.ok(report.checks.expandedModule.descriptions.every((text) => text && text !== '暂无效果说明'), '候选模块缺少效果解释');
  await screenshot('loadout-module-expanded-desktop.png');
  await click(`[data-loadout-module][data-module-id="${report.checks.expandedModule.moduleId}"]`);
  assert.equal(await evaluate(`document.querySelector('[data-loadout-module][data-module-id="${report.checks.expandedModule.moduleId}"]')?.classList.contains('active')`), true, '模块点击后应装备');
  await click('[data-loadout-section="overclocks"]');
  report.checks.overclocks = await evaluate(`({ count: document.querySelectorAll('.effect-choice[data-loadout-oc]').length, descriptions: [...document.querySelectorAll('.effect-choice[data-loadout-oc] p')].every(item => item.textContent.trim()), moduleSummaries: document.querySelectorAll('[data-loadout-tier]').length })`);
  assert.ok(report.checks.overclocks.count > 0);
  assert.equal(report.checks.overclocks.descriptions, true);
  assert.equal(report.checks.overclocks.moduleSummaries, 0);
  await click('[data-loadout-section="skins"]');
  assert.equal(await evaluate("document.querySelectorAll('[data-loadout-skin]').length"), 2);
  await click('[data-loadout-weapon-tab="SecondaryWeapon"]');
  assert.equal(await evaluate("document.querySelector('[data-loadout-weapon]')?.dataset.loadoutWeapon"), 'SecondaryWeapon');
  await click('[data-loadout-section="modules"]');
  assert.equal(await evaluate("document.querySelectorAll('[data-loadout-tier]').length"), 5);
  assert.equal(await evaluate("document.querySelectorAll('[data-loadout-tier][aria-expanded=\"true\"]').length"), 0);
  await click('[data-loadout-weapon-tab="PrimaryWeapon"]');
  for (const tool of ['icons', 'copy', 'weapons']) {
    await click(`[data-loadout-tool="${tool}"] > summary`);
    assert.equal(await evaluate(`document.querySelector('[data-loadout-tool="${tool}"]').open`), true);
    await click(`[data-loadout-tool="${tool}"] > summary`);
  }
  report.checks.sectionsAndUtilities = 'primary/secondary, modules/overclocks/skins, icons/copy/weapons passed';

  await click('[data-view="resources"]');
  const numericBefore = await evaluate(`({ credits: Number(document.querySelector('[data-number="Credits"]').value), perks: Number(document.querySelector('[data-number="PerkPoints"]').value) })`);
  const numericAfter = { credits: numericBefore.credits + 17, perks: numericBefore.perks + 3 };
  for (const [id, value] of [['Credits', numericAfter.credits], ['PerkPoints', numericAfter.perks]]) {
    await evaluate(`(() => { const input = document.querySelector('[data-number="${id}"]'); input.value = ${value}; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  assert.equal(await evaluate("Boolean(document.querySelector('[data-undo-change=\"number:Credits\"]'))"), true);
  assert.equal(await evaluate("Boolean(document.querySelector('[data-undo-change=\"number:PerkPoints\"]'))"), true);
  await click('[data-undo-change="number:Credits"]');
  report.checks.singleUndo = await evaluate(`({
    credits: Number(document.querySelector('[data-number="Credits"]').value),
    perks: Number(document.querySelector('[data-number="PerkPoints"]').value),
    creditRowRemoved: !document.querySelector('[data-undo-change="number:Credits"]'),
    perkRowRetained: Boolean(document.querySelector('[data-undo-change="number:PerkPoints"]')),
    remainingRows: document.querySelectorAll('[data-undo-change]').length
  })`);
  assert.equal(report.checks.singleUndo.credits, numericBefore.credits, '单项撤销应恢复信用点');
  assert.equal(report.checks.singleUndo.perks, numericAfter.perks, '单项撤销应保留天赋点改动');
  assert.equal(report.checks.singleUndo.creditRowRemoved, true);
  assert.equal(report.checks.singleUndo.perkRowRetained, true);
  assert.equal(report.checks.singleUndo.remainingRows, 2, '模块及天赋点两项应保留');

  await click('[data-view="classes"]');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate('scrollTo(0, 0)');
  report.checks.narrow = await evaluate(`({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, overflowElements: [...document.querySelectorAll('body *')].filter(item => { const rect = item.getBoundingClientRect(); return rect.width && (rect.right > innerWidth + 1 || rect.left < -1); }).slice(0, 12).map(item => ({ tag: item.tagName, className: item.className, width: Math.round(item.getBoundingClientRect().width) })) })`);
  await screenshot('loadout-compact-narrow.png');
  assert.ok(report.checks.narrow.documentWidth <= report.checks.narrow.viewportWidth + 1, `窄屏横向溢出：${JSON.stringify(report.checks.narrow)}`);
  report.checks.narrow.undoAccess = await evaluate(`(() => {
    const button = document.querySelector('[data-undo-change="number:PerkPoints"]');
    button.scrollIntoView({ block: 'center' });
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth, unobscured: hit === button || button.contains(hit), label: button.getAttribute('aria-label') };
  })()`);
  assert.equal(report.checks.narrow.undoAccess.visible, true, '窄屏撤销按钮应可滚动至可见区域');
  assert.equal(report.checks.narrow.undoAccess.unobscured, true, '窄屏撤销按钮不应被遮挡');
  assert.ok(report.checks.narrow.undoAccess.label);
  await screenshot('pending-undo-narrow.png');

  const exportName = `${path.basename(savePath).replace(/\.sav$/i, '')}_edited.sav`;
  const exportFile = path.join(outputDir, exportName);
  if (fs.existsSync(exportFile)) throw new Error(`输出目录已有同名导出文件，请使用新的输出目录：${exportFile}`);
  await click('#export-button');
  const exportDeadline = Date.now() + 12000;
  while (!fs.existsSync(exportFile) && Date.now() < exportDeadline) await pause(100);
  assert.ok(fs.existsSync(exportFile), `未找到导出文件；${await evaluate("document.querySelector('#toast')?.textContent")}`);
  const reparsed = JSON.parse(convertSavToJson(new Uint8Array(fs.readFileSync(exportFile))));
  assert.equal(findProperty(reparsed, 'Credits')?.value, findProperty(original, 'Credits')?.value);
  assert.equal(findProperty(reparsed, 'PerkPoints')?.value, numericAfter.perks);
  const module = report.checks.expandedModule;
  const char = findProperty(reparsed, 'CharacterSaves')?.value.find((block) => directProperty(block, 'SavegameID')?.value === module.classId);
  const upgrades = directProperty(char, 'ItemUpgradeLoadouts')?.value[module.slot];
  const containsModule = (node) => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node) && node[0] === module.weaponId && Array.isArray(node[1])) return directProperty(node[1], 'EquippedUpgrades')?.value?.includes(module.moduleId) || false;
    return Object.values(node).some(containsModule);
  };
  assert.ok(containsModule(upgrades), '导出后选择的模块没有留在对应职业配装槽');
  assert.ok(findProperty(reparsed, 'PurchasedItemUpgrades')?.value.includes(module.moduleId));
  assert.equal(createHash('sha256').update(fs.readFileSync(savePath)).digest('hex'), sourceHash, '原始存档发生变化');
  assert.equal(report.exceptions.length, 0, '浏览器有未处理的异常');
  report.checks.export = { file: exportFile, bytes: fs.statSync(exportFile).size, creditsRestored: true, perksRetained: true, moduleRetained: true, originalSaveUnchanged: true };
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || String(error);
  if (send) {
    try { report.pageError = await evaluate("({ toast: document.querySelector('#toast')?.textContent, pending: document.querySelector('#changes-list')?.textContent })"); } catch {}
    try { await screenshot('failure.png'); } catch {}
  }
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(outputDir, 'browser-report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2));
  if (send) {
    try { await send('Browser.close'); } catch {}
  }
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
}
