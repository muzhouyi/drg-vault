const port = Number(process.argv[2] || 9231);
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((res) => res.json());
const page = targets.find((item) => item.type === 'page' && item.url.startsWith('http://tauri.localhost'));
if (!page) throw new Error('未找到桌面版 WebView2 页面');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
function evaluate(expression) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener('message', onMessage);
      if (message.error) return reject(new Error(message.error.message));
      const exception = message.result?.exceptionDetails;
      if (exception) return reject(new Error(exception.text + ': ' + (exception.exception?.description || '')));
      resolve(message.result?.result?.value);
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

try {
  if (process.argv.includes('--close-dirty')) {
    const result = await evaluate(`(async () => {
      document.querySelector('[data-view="resources"]').click();
      const credits = document.querySelector('[data-number="Credits"]');
      credits.value = String(Number(credits.value) + 1);
      credits.dispatchEvent(new Event('change', { bubbles: true }));
      const pending = Number(document.querySelector('#change-count').textContent);
      window.confirm = () => false;
      await window.__TAURI__.window.getCurrentWindow().close();
      await new Promise((resolve) => setTimeout(resolve, 200));
      setTimeout(() => { window.confirm = () => true; window.__TAURI__.window.getCurrentWindow().close(); }, 100);
      return { pending, rejectedCloseKeptPageAlive: !!document.querySelector('#file-chip') };
    })()`);
    if (!result.pending || !result.rejectedCloseKeptPageAlive) throw new Error('未保存改动的退出确认失败');
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
  } else if (process.argv.includes('--close')) {
    const result = await evaluate(`(async () => {
      const appWindow = window.__TAURI__?.window?.getCurrentWindow();
      if (!appWindow) throw new Error('找不到桌面窗口接口');
      setTimeout(() => appWindow.close(), 100);
      return { title: document.title, status: document.querySelector('#native-status')?.textContent };
    })()`);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
  } else
  if (process.argv.includes('--readonly')) {
    const view = await evaluate(`({ title: document.title, pageLoaded: document.querySelector('#file-chip')?.classList.contains('loaded'), chooseEnabled: !document.querySelector('#choose-button')?.disabled, version: document.querySelector('.project-link')?.textContent.trim(), status: document.querySelector('#native-status')?.textContent })`);
    if (!view?.pageLoaded || !view?.chooseEnabled || !view?.version?.includes('v0.8.0')) throw new Error(`Release 页面未正常载入：${JSON.stringify(view)}`);
    console.log(JSON.stringify(view, null, 2));
    process.exitCode = 0;
  } else {
  const result = await evaluate(`(async () => {
    const call = window.__TAURI__?.core?.invoke;
    if (!call) throw new Error('Tauri 原生调用接口未注入');
    const startup = await call('startup');
    if (!startup.gameRoot?.endsWith('drg-vault\\\\build\\\\smoke-game')) throw new Error('不是隔离测试游戏目录，禁止写入：' + startup.gameRoot);
    const loaded = document.querySelector('#file-chip')?.classList.contains('loaded');
    const current = await call('read_current');
    if (!current.path.includes('smoke-game')) throw new Error('测试目标越界');
    const backupPath = await call('create_backup');
    const backups = await call('list_backups');
    const item = backups.find((entry) => entry.fileName === current.name && entry.sha256 === current.sha256);
    if (!item) throw new Error('无法找到刚创建的备份');
    const replacedBackup = await call('replace_save', { expectedHash: current.sha256, bytes: current.bytes });
    const replaced = await call('read_current');
    if (replaced.sha256 !== current.sha256) throw new Error('替换后的存档哈希不一致');
    const target = await call('prepare_restore', { id: item.id });
    const restoreBackup = await call('restore_save', { id: item.id, expectedHash: target.sha256, sourceHash: item.sha256 });
    const restored = await call('read_current');
    if (restored.sha256 !== current.sha256) throw new Error('还原后的存档哈希不一致');
    await call('set_auto_load', { enabled: false });
    const toggleOff = !(await call('startup')).autoLoad;
    await call('set_auto_load', { enabled: true });
    document.querySelector('[data-view="resources"]').click();
    const credits = document.querySelector('[data-number="Credits"]');
    if (!credits) throw new Error('信用点输入框未渲染');
    credits.value = String(Number(credits.value) + 1);
    credits.dispatchEvent(new Event('change', { bubbles: true }));
    const mutationTracked = Number(document.querySelector('#change-count').textContent) > 0;
    document.querySelector('#reset-button').click();
    const undoWorks = Number(document.querySelector('#change-count').textContent) === 0;
    document.querySelector('[data-view="classes"]').click();
    document.querySelector('[data-close-loadout-tool]')?.click();
    const before = document.querySelector('.weapon-switcher')?.getBoundingClientRect().top;
    document.querySelector('.loadout-tool-tab')?.click();
    const panel = document.querySelector('#loadout-tool-panel');
    const after = document.querySelector('.weapon-switcher')?.getBoundingClientRect().top;
    const overlayStable = !!panel && getComputedStyle(panel).position === 'absolute' && Math.abs(before - after) < 1;
    return { title: document.title, pageLoaded: loaded, catalogVisible: document.querySelector('.catalog-strip') !== null, status: document.querySelector('#native-status')?.textContent, saveBytes: current.size, backups: backups.length, backupPath, replacedBackup, restoreBackup, checksumPreserved: restored.sha256 === current.sha256, toggleOff, mutationTracked, undoWorks, overlayStable };
  })()`);
  if (!result?.pageLoaded || !result?.catalogVisible || !result?.checksumPreserved || !result?.toggleOff || !result?.mutationTracked || !result?.undoWorks || !result?.overlayStable) throw new Error(`桌面检查未通过：${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
  }
} finally {
  socket.close();
}
