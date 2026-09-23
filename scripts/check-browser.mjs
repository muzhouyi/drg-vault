import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const port = Number(process.argv[2] || 9333);
const htmlPath = process.argv[3];
const savePath = process.argv[4];
const downloadPath = process.argv[5];
if (!htmlPath) throw new Error('缺少 HTML 路径');

let targets;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
if (!targets) throw new Error('浏览器调试端口没有启动');
const target = targets.find((item) => item.type === 'page');
if (!target) throw new Error('没有找到浏览器页面');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const exceptions = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params.exceptionDetails);
  }
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('DOM.enable');
if (downloadPath) {
  fs.mkdirSync(downloadPath, { recursive: true });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, eventsEnabled: true });
}
await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
await new Promise((resolve) => setTimeout(resolve, 1500));
const interactionCheck = await send('Runtime.evaluate', {
  expression: `(() => {
    const input = document.querySelector('#save-input');
    const choose = document.querySelector('#choose-button');
    const drop = document.querySelector('#drop-panel');
    let inputClickCalled = false;
    input.click = () => { inputClickCalled = true; };
    choose.click();
    delete input.click;
    const drag = new DragEvent('dragover', { bubbles: true, cancelable: true });
    drop.dispatchEvent(drag);
    const dragHandled = drag.defaultPrevented && drop.classList.contains('dragging');
    drop.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
    return { inputClickCalled, dragHandled };
  })()`,
  returnByValue: true,
});

let saveLoad;
if (savePath) {
  const documentNode = await send('DOM.getDocument');
  const inputNode = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#save-input' });
  await send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [savePath] });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  saveLoad = await send('Runtime.evaluate', {
    expression: `(() => {
      document.querySelector('[data-view="resources"]')?.click();
      const resourcesVisible = document.querySelector('#view-root')?.textContent.includes('资源与进度');
      const levelEditorVisible = document.querySelector('#view-root')?.textContent.includes('精确等级');

      document.querySelector('[data-view="classes"]')?.click();
      document.querySelector('[data-loadout-class="Gunner"]')?.click();
      const grantButton = [...document.querySelectorAll('[data-grant-weapon]')].find((button) => !button.disabled);
      const fallbackWeapon = window.__DRG_CATALOG__?.weapons?.find((item) => item.name === 'BRT7 Burst Fire Gun');
      const grantedWeaponId = grantButton?.dataset.grantWeapon || fallbackWeapon?.id;
      grantButton?.click();
      const grantedWeapon = window.__DRG_CATALOG__?.weapons?.find((item) => item.id === grantedWeaponId);
      const weaponSelect = grantedWeapon ? document.querySelector('[data-loadout-weapon="' + grantedWeapon.slot + '"]') : null;
      if (weaponSelect && grantedWeaponId) {
        weaponSelect.value = grantedWeaponId;
        weaponSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const equippedWeaponApplied = grantedWeapon ? document.querySelector('[data-loadout-weapon="' + grantedWeapon.slot + '"]')?.value === grantedWeaponId : false;
      const missingModule = [...document.querySelectorAll('[data-loadout-module].missing')].find((button) =>
        button.dataset.weaponId === grantedWeaponId
      );
      const moduleWeaponId = missingModule?.dataset.weaponId;
      const moduleId = missingModule?.dataset.moduleId;
      const moduleEffectVisible = Boolean(missingModule?.querySelector('p')?.textContent.trim());
      missingModule?.click();
      const missingOc = [...document.querySelectorAll('[data-loadout-oc].missing')].find((button) =>
        button.dataset.weaponId === grantedWeaponId
      );
      const equippedOcId = missingOc?.dataset.upgradeId;
      const ocEffectVisible = Boolean(missingOc?.querySelector('p')?.textContent.trim());
      missingOc?.click();
      const frameworkSelect = document.querySelector('[data-loadout-skin="framework"][data-weapon-id="' + grantedWeaponId + '"]');
      const equippedSkinId = frameworkSelect?.options?.[1]?.value;
      if (frameworkSelect && equippedSkinId) {
        frameworkSelect.value = equippedSkinId;
        frameworkSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const iconButton = document.querySelector('[data-loadout-icon="20"]');
      const loadoutIconCount = document.querySelectorAll('[data-loadout-icon]').length;
      iconButton?.click();
      const iconApplied = Boolean(document.querySelector('[data-loadout-icon="20"].active'));
      const loadoutSlotCount = document.querySelectorAll('[data-loadout-slot]').length;
      const currentSlotButton = document.querySelector('[data-loadout-slot].current');
      const copiedSource = Number(currentSlotButton?.dataset.loadoutSlot ?? 0);
      const copiedTarget = copiedSource === 6 ? 5 : 6;
      const copyTarget = document.querySelector('#copy-loadout-target');
      if (copyTarget) copyTarget.value = String(copiedTarget);
      document.querySelector('#copy-loadout')?.click();
      const loadoutEditorVisible = document.querySelector('#view-root')?.textContent.includes('复制整个配装槽');

      document.querySelector('[data-view="skins"]')?.click();
      const unlockAllButtonVisible = Boolean(document.querySelector('#unlock-all-weapon-skins'));
      document.querySelector('#unlock-all-weapon-skins')?.click();

      document.querySelector('[data-view="cores"]')?.click();
      const directForgeTarget = [...document.querySelectorAll('[data-core]')].find((select) =>
        select.value === 'missing' && !select.querySelector('option[value="forged"]')?.disabled
      );
      const directForgeId = directForgeTarget?.dataset.core;
      if (directForgeTarget) {
        directForgeTarget.value = 'forged';
        directForgeTarget.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const forgedSelect = directForgeId ? document.querySelector('[data-core="' + directForgeId + '"]') : null;
      return {
        fileChip: document.querySelector('#file-chip')?.textContent,
        chooseText: document.querySelector('#choose-button')?.textContent,
        exportDisabled: document.querySelector('#export-button')?.disabled,
        dropCompact: document.querySelector('#drop-panel')?.classList.contains('compact'),
        resourcesVisible,
        levelEditorVisible,
        grantedWeaponId,
        equippedWeaponApplied,
        moduleId,
        moduleWeaponId,
        moduleEffectVisible,
        equippedOcId,
        ocEffectVisible,
        equippedSkinId,
        loadoutIconCount,
        iconApplied,
        loadoutSlotCount,
        loadoutEditorVisible,
        copiedSource,
        copiedTarget,
        unlockAllButtonVisible,
        directForgeAvailable: Boolean(directForgeTarget),
        directForgeApplied: forgedSelect?.value === 'forged',
        directForgeId,
        forgedBulkButtonVisible: Boolean(document.querySelector('[data-core-bulk="forged"]')),
        toastText: document.querySelector('#toast')?.textContent,
      };
    })()`,
    returnByValue: true,
  });
  if (downloadPath) {
    await send('Runtime.evaluate', { expression: `document.querySelector('#export-button')?.click()` });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
const evaluation = await send('Runtime.evaluate', {
  expression: `({
    readyState: document.readyState,
    title: document.title,
    chooseDisabled: document.querySelector('#choose-button')?.disabled,
    chooseText: document.querySelector('#choose-button')?.textContent,
    toastText: document.querySelector('#toast')?.textContent,
    toastError: document.querySelector('#toast')?.classList.contains('error'),
    catalogItems: window.__DRG_CATALOG__?.coreItems?.length,
    hasFileInput: Boolean(document.querySelector('#save-input')),
    scriptCount: document.scripts.length
  })`,
  returnByValue: true,
});

await send('Browser.close');
socket.close();
process.stdout.write(JSON.stringify({
  page: evaluation.result.value,
  interactions: interactionCheck.result.value,
  saveLoad: saveLoad?.result.value,
  exceptions: exceptions.map((item) => ({
    text: item.text,
    line: item.lineNumber,
    column: item.columnNumber,
    description: item.exception?.description,
  })),
}, null, 2));
