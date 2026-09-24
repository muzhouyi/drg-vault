export async function desktop(command, args = {}) {
  if (!window.__DRG_DESKTOP__ || !window.__TAURI__?.core?.invoke) throw new Error('桌面文件接口不可用');
  return window.__TAURI__.core.invoke(command, args);
}

export function desktopFile(info) {
  const binary = atob(info.bytes);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new File([bytes], info.name, { type: 'application/octet-stream', lastModified: info.modified });
}

export function desktopBytes(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 32768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  }
  return btoa(binary);
}
