#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, HashSet}, fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::Mutex, time::UNIX_EPOCH};
use tauri::Manager;
use winreg::{enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE}, RegKey};

const MAX_SAVE: u64 = 25 * 1024 * 1024;

#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Settings { game_root: Option<PathBuf>, player_name: Option<String>, auto_load: Option<bool> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveInfo { name: String, path: String, size: u64, modified: u64, sha256: String, bytes: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveCandidate { name: String, size: u64, modified: u64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Startup { game_root: Option<String>, candidates: Vec<SaveCandidate>, selected: Option<String>, auto_load: bool, discovered: Vec<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupEntry { id: String, label: String, file_name: String, modified: u64, sha256: String, bytes: String }

#[derive(Default)]
struct Inner { settings: Settings, settings_path: PathBuf, backups: HashMap<String, PathBuf>, external: HashMap<String, PathBuf>, dropped: HashSet<PathBuf> }
struct AppState(Mutex<Inner>);

fn err<T: ToString>(error: T) -> String { error.to_string() }
fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn display_path(path: &Path) -> String {
    let value = path.display().to_string();
    if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") { format!("\\\\{unc}") }
    else if let Some(local) = value.strip_prefix("\\\\?\\") { local.to_string() }
    else { value }
}
#[cfg(windows)]
fn game_running() -> bool {
    use windows_sys::Win32::{Foundation::{CloseHandle, INVALID_HANDLE_VALUE}, System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS}};
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE { return false }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
                if name.eq_ignore_ascii_case("FSD-Win64-Shipping.exe") || name.eq_ignore_ascii_case("FSD.exe") { found = true; break }
                if Process32NextW(snapshot, &mut entry) == 0 { break }
            }
        }
        CloseHandle(snapshot);
        found
    }
}
fn is_player(name: &str) -> bool {
    let Some(id) = name.strip_suffix("_Player.sav").or_else(|| name.strip_suffix("_player.sav")) else { return false };
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())
}
fn time_ms(path: &Path) -> u64 {
    fs::metadata(path).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}
fn read_save(path: &Path) -> Result<SaveInfo, String> {
    let meta = fs::metadata(path).map_err(err)?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_SAVE { return Err(format!("存档大小无效：{}", path.display())) }
    let bytes = fs::read(path).map_err(err)?;
    Ok(SaveInfo { name: path.file_name().unwrap().to_string_lossy().into_owned(), path: display_path(path), size: bytes.len() as u64, modified: time_ms(path), sha256: hash(&bytes), bytes: STANDARD.encode(bytes) })
}
fn save_dir(root: &Path) -> Result<PathBuf, String> {
    let canonical = root.canonicalize().map_err(err)?;
    let dir = canonical.join("FSD").join("Saved").join("SaveGames");
    let real = dir.canonicalize().map_err(|_| format!("请选择包含 FSD\\Saved\\SaveGames 的 Deep Rock Galactic 游戏目录：{}", canonical.display()))?;
    if !real.starts_with(&canonical) || !real.is_dir() { return Err("游戏存档目录指向了游戏目录之外".into()) }
    Ok(real)
}
fn current_path(settings: &Settings) -> Result<PathBuf, String> {
    let root = settings.game_root.as_ref().ok_or("请先设置游戏目录")?;
    let name = settings.player_name.as_ref().ok_or("请选择玩家存档")?;
    if !is_player(name) { return Err("玩家存档文件名无效".into()) }
    let dir = save_dir(root)?;
    let path = dir.join(name).canonicalize().map_err(err)?;
    if !path.starts_with(&dir) || !path.is_file() { return Err("目标存档不在游戏存档目录内".into()) }
    Ok(path)
}
fn candidates(root: &Path) -> Result<Vec<SaveCandidate>, String> {
    let dir = save_dir(root)?;
    let mut result = vec![];
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_player(&name) && entry.file_type().map_err(err)?.is_file() {
            let meta = entry.metadata().map_err(err)?;
            if meta.len() <= MAX_SAVE { result.push(SaveCandidate { name, size: meta.len(), modified: time_ms(&entry.path()) }); }
        }
    }
    result.sort_by(|a,b| b.modified.cmp(&a.modified));
    Ok(result)
}
fn persist(inner: &Inner) -> Result<(), String> {
    if let Some(parent) = inner.settings_path.parent() { fs::create_dir_all(parent).map_err(err)?; }
    let bytes = serde_json::to_vec_pretty(&inner.settings).map_err(err)?;
    let temp = inner.settings_path.with_extension("tmp");
    fs::write(&temp, bytes).map_err(err)?;
    fs::rename(temp, &inner.settings_path).map_err(err)
}
fn quoted(line: &str) -> Vec<String> {
    let mut result = Vec::new(); let mut inside = false; let mut current = String::new();
    for ch in line.chars() { if ch == '"' { if inside { result.push(std::mem::take(&mut current)); } inside = !inside; } else if inside { current.push(ch); } }
    result
}
fn vdf_value(contents: &str, key: &str) -> Option<String> {
    contents.lines().map(quoted).find_map(|values| {
        (values.len() >= 2 && values[0].eq_ignore_ascii_case(key)).then(|| values[1].replace("\\\\", "\\"))
    })
}
fn steam_locations() -> Vec<PathBuf> {
    let mut locations = Vec::new();
    for (hive, key_name, value_name) in [
        (HKEY_CURRENT_USER, "Software\\Valve\\Steam", "SteamPath"),
        (HKEY_CURRENT_USER, "Software\\Valve\\Steam", "SteamExe"),
        (HKEY_LOCAL_MACHINE, "Software\\WOW6432Node\\Valve\\Steam", "InstallPath"),
        (HKEY_LOCAL_MACHINE, "Software\\Valve\\Steam", "InstallPath"),
    ] {
        if let Ok(key) = RegKey::predef(hive).open_subkey(key_name) {
            if let Ok(value) = key.get_value::<String, _>(value_name) {
                let path = PathBuf::from(value.replace('/', "\\"));
                locations.push(if path.is_file() { path.parent().unwrap_or(&path).to_path_buf() } else { path });
            }
        }
    }
    locations.sort(); locations.dedup();
    locations
}
fn discover_roots() -> Vec<PathBuf> {
    let mut libraries = Vec::new();
    for main in steam_locations() {
        libraries.push(main.clone());
        if let Ok(vdf) = fs::read_to_string(main.join("steamapps").join("libraryfolders.vdf")) {
            for line in vdf.lines() {
                let values = quoted(line);
                if values.len() >= 2 && values[0].eq_ignore_ascii_case("path") {
                    libraries.push(PathBuf::from(values[1].replace("\\\\", "\\")));
                }
            }
        }
    }
    libraries.sort(); libraries.dedup();
    libraries.into_iter().filter_map(|lib| {
        let apps = lib.join("steamapps");
        let manifest = fs::read_to_string(apps.join("appmanifest_548430.acf")).ok()?;
        let install_dir = vdf_value(&manifest, "installdir")?;
        if !matches!(Path::new(&install_dir).components().next(), Some(std::path::Component::Normal(_)))
            || Path::new(&install_dir).components().count() != 1 { return None }
        let root = apps.join("common").join(install_dir);
        if save_dir(&root).is_ok() { Some(root) } else { None }
    }).collect()
}

#[tauri::command]
fn startup(state: tauri::State<AppState>) -> Result<Startup, String> {
    let mut inner = state.0.lock().map_err(err)?;
    let discovered = discover_roots();
    if inner.settings.game_root.as_ref().is_some_and(|p| save_dir(p).is_err()) { inner.settings.game_root = None; inner.settings.player_name = None; }
    if inner.settings.game_root.is_none() {
        let with_saves: Vec<_> = discovered.iter().filter(|root| candidates(root).is_ok_and(|list| !list.is_empty())).collect();
        let selected = if discovered.len() == 1 { Some(&discovered[0]) } else if with_saves.len() == 1 { Some(with_saves[0]) } else { None };
        if let Some(root) = selected { inner.settings.game_root = Some(root.clone()); persist(&inner)?; }
    }
    let list = inner.settings.game_root.as_ref().map_or(Ok(vec![]), |root| candidates(root))?;
    if inner.settings.player_name.as_ref().is_some_and(|name| !list.iter().any(|item| &item.name == name)) { inner.settings.player_name = None; persist(&inner)?; }
    if inner.settings.player_name.is_none() && list.len() == 1 { inner.settings.player_name = Some(list[0].name.clone()); persist(&inner)?; }
    Ok(Startup { game_root: inner.settings.game_root.as_ref().map(|p| p.display().to_string()), candidates: list, selected: inner.settings.player_name.clone(), auto_load: inner.settings.auto_load.unwrap_or(true), discovered: discovered.iter().map(|p| p.display().to_string()).collect() })
}

#[tauri::command]
fn choose_game_root(state: tauri::State<AppState>) -> Result<Option<Startup>, String> {
    let Some(root) = rfd::FileDialog::new().set_title("选择 Deep Rock Galactic 游戏目录").pick_folder() else { return Ok(None) };
    save_dir(&root)?;
    { let mut inner = state.0.lock().map_err(err)?; inner.settings.game_root = Some(root); inner.settings.player_name = None; persist(&inner)?; }
    startup(state).map(Some)
}

#[tauri::command]
fn select_player(state: tauri::State<AppState>, name: String) -> Result<SaveInfo, String> {
    let mut inner = state.0.lock().map_err(err)?;
    let root = inner.settings.game_root.as_ref().ok_or("请先设置游戏目录")?;
    if !candidates(root)?.iter().any(|item| item.name == name) { return Err("所选玩家存档不在游戏目录中".into()) }
    inner.settings.player_name = Some(name); persist(&inner)?;
    read_save(&current_path(&inner.settings)?)
}

#[tauri::command]
fn read_current(state: tauri::State<AppState>) -> Result<SaveInfo, String> {
    let inner = state.0.lock().map_err(err)?;
    read_save(&current_path(&inner.settings)?)
}

#[tauri::command]
fn choose_save(state: tauri::State<AppState>) -> Result<Option<SaveInfo>, String> {
    let Some(path) = rfd::FileDialog::new().set_title("选择 DRG 玩家存档").add_filter("DRG 存档", &["sav"]).pick_file() else { return Ok(None) };
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("sav")) { return Err("请选择 .sav 文件".into()) }
    let info = read_save(&path)?;
    let mut inner = state.0.lock().map_err(err)?;
    if let Some(root) = &inner.settings.game_root {
        if is_player(&info.name) && save_dir(root).ok().is_some_and(|dir| path.canonicalize().ok().is_some_and(|real| real == dir.join(&info.name))) {
            inner.settings.player_name = Some(info.name.clone());
            persist(&inner)?;
        }
    }
    Ok(Some(info))
}

#[tauri::command]
fn read_dropped(state: tauri::State<AppState>, path: String) -> Result<SaveInfo, String> {
    let path = PathBuf::from(path).canonicalize().map_err(err)?;
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("sav")) { return Err("请拖入 .sav 文件".into()) }
    let mut inner = state.0.lock().map_err(err)?;
    if !inner.dropped.remove(&path) { return Err("文件未通过窗口拖入，请用“选择存档”打开".into()) }
    drop(inner);
    read_save(&path)
}

#[tauri::command]
fn open_project() -> Result<(), String> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let url: Vec<u16> = "https://github.com/muzhouyi/drg-vault".encode_utf16().chain(Some(0)).collect();
    let action: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), action.as_ptr(), url.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    if result as isize <= 32 { Err("系统浏览器无法打开项目链接".into()) } else { Ok(()) }
}

#[tauri::command]
fn set_auto_load(state: tauri::State<AppState>, enabled: bool) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(err)?;
    inner.settings.auto_load = Some(enabled); persist(&inner)
}

#[tauri::command]
fn export_save(name: String, bytes: String) -> Result<Option<String>, String> {
    let data = STANDARD.decode(bytes).map_err(err)?;
    if data.is_empty() || data.len() as u64 > MAX_SAVE { return Err("导出存档大小无效".into()) }
    let safe_name = Path::new(&name).file_name().ok_or("导出文件名无效")?.to_string_lossy();
    let Some(path) = rfd::FileDialog::new().set_title("导出修改版存档").set_file_name(safe_name.as_ref()).add_filter("DRG 存档", &["sav"]).save_file() else { return Ok(None) };
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("sav")) { return Err("导出文件必须是 .sav".into()) }
    fs::write(&path, &data).map_err(err)?;
    if fs::read(&path).map_err(err)? != data { return Err("导出后校验失败".into()) }
    Ok(Some(display_path(&path)))
}

fn backup_root(root: &Path) -> Result<PathBuf, String> {
    let save = save_dir(root)?;
    let saved = save.parent().ok_or("游戏目录无效")?;
    Ok(saved.join("back"))
}
fn validated_backup_locations(root: &Path) -> Result<Vec<PathBuf>, String> {
    let save = save_dir(root)?;
    let saved = save.parent().ok_or("游戏目录无效")?.canonicalize().map_err(err)?;
    let mut result = Vec::new();
    for (candidate, allowed) in [(saved.join("back"), &saved), (save.join("back"), &save)] {
        if !candidate.exists() { continue }
        let real = candidate.canonicalize().map_err(err)?;
        if !real.starts_with(allowed) || !real.is_dir() { return Err("备份目录指向了游戏目录之外".into()) }
        result.push(real);
    }
    Ok(result)
}
fn create_backup_for(root: &Path, target: &Path, original: &[u8]) -> Result<PathBuf, String> {
    let back = backup_root(root)?;
    fs::create_dir_all(&back).map_err(err)?;
    let back = back.canonicalize().map_err(err)?;
    let saved = save_dir(root)?.parent().unwrap().canonicalize().map_err(err)?;
    if !back.starts_with(saved) { return Err("备份目录指向游戏目录之外".into()) }
    let stamp = Local::now().format("%Y-%m-%d_%H-%M-%S-%3f").to_string();
    let mut folder = None;
    for number in 0..1000 {
        let name = if number == 0 { stamp.clone() } else { format!("{stamp}_{number}") };
        let path = back.join(name);
        match fs::create_dir(&path) { Ok(()) => { folder = Some(path); break }, Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (), Err(e) => return Err(err(e)) }
    }
    let folder = folder.ok_or("无法创建唯一的备份目录")?;
    let path = folder.join(target.file_name().ok_or("目标文件名无效")?);
    let mut output = OpenOptions::new().write(true).create_new(true).open(&path).map_err(err)?;
    output.write_all(original).map_err(err)?; output.sync_all().map_err(err)?;
    if fs::read(&path).map_err(err)? != original { return Err("备份校验失败，原存档未修改".into()) }
    Ok(path)
}

#[tauri::command]
fn create_backup(state: tauri::State<AppState>) -> Result<String, String> {
    let inner = state.0.lock().map_err(err)?;
    let target = current_path(&inner.settings)?;
    let bytes = fs::read(&target).map_err(err)?;
    let root = inner.settings.game_root.as_ref().unwrap();
    Ok(display_path(&create_backup_for(root, &target, &bytes)?))
}

#[tauri::command]
fn list_backups(state: tauri::State<AppState>) -> Result<Vec<BackupEntry>, String> {
    let mut inner = state.0.lock().map_err(err)?;
    inner.backups.clear();
    let root = inner.settings.game_root.as_ref().ok_or("请先设置游戏目录")?;
    let mut paths = Vec::new();
    for location in validated_backup_locations(root)? {
        for entry in fs::read_dir(&location).map_err(err)? {
            let entry = entry.map_err(err)?;
            if entry.file_type().map_err(err)?.is_dir() {
                for file in fs::read_dir(entry.path()).map_err(err)? { paths.push(file.map_err(err)?.path()); }
            } else { paths.push(entry.path()); }
        }
    }
    let mut result = Vec::new();
    for path in paths {
        let Some(name) = path.file_name().and_then(|x| x.to_str()) else { continue };
        if !is_player(name) || !path.is_file() { continue }
        let id = format!("backup-{}", result.len());
        let Ok(info) = read_save(&path) else { continue };
        let label = path.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        inner.backups.insert(id.clone(), path);
        result.push(BackupEntry { id, label, file_name: info.name, modified: info.modified, sha256: info.sha256, bytes: info.bytes });
    }
    result.sort_by(|a,b| b.modified.cmp(&a.modified));
    Ok(result)
}

#[tauri::command]
fn choose_external_backup(state: tauri::State<AppState>) -> Result<Option<BackupEntry>, String> {
    let Some(path) = rfd::FileDialog::new().set_title("选择外部 .sav 备份").add_filter("DRG 存档", &["sav"]).pick_file() else { return Ok(None) };
    let info = read_save(&path)?;
    if !is_player(&info.name) { return Err("备份文件名需为 SteamID_Player.sav".into()) }
    let id = format!("external-{}", Local::now().timestamp_millis());
    let mut inner = state.0.lock().map_err(err)?;
    inner.external.insert(id.clone(), path);
    Ok(Some(BackupEntry { id, label: "外部备份".into(), file_name: info.name, modified: info.modified, sha256: info.sha256, bytes: info.bytes }))
}

fn backup_path(inner: &Inner, id: &str) -> Result<PathBuf, String> {
    let path = inner.backups.get(id).or_else(|| inner.external.get(id)).ok_or("备份记录已失效，请刷新列表")?;
    let canonical = path.canonicalize().map_err(err)?;
    if inner.backups.contains_key(id) {
        let root = inner.settings.game_root.as_ref().ok_or("请先设置游戏目录")?;
        let valid = validated_backup_locations(root)?.iter().any(|base| canonical.starts_with(base));
        if !valid { return Err("备份文件已移出允许的目录".into()) }
    }
    Ok(canonical)
}

#[tauri::command]
fn prepare_restore(state: tauri::State<AppState>, id: String) -> Result<SaveInfo, String> {
    let inner = state.0.lock().map_err(err)?;
    let source = backup_path(&inner, &id)?;
    let name = source.file_name().unwrap().to_string_lossy().into_owned();
    if !is_player(&name) { return Err("备份文件名不能确定玩家身份".into()) }
    let root = inner.settings.game_root.as_ref().ok_or("请先选择目标游戏目录")?;
    let dir = save_dir(root)?;
    let target = dir.join(name).canonicalize().map_err(err)?;
    if !target.starts_with(dir) { return Err("还原目标不在游戏目录中".into()) }
    read_save(&target)
}

fn replace_transaction(root: &Path, target: &Path, expected: &str, new_bytes: &[u8]) -> Result<(String, String), String> {
    if game_running() { return Err("检测到深岩银河仍在运行。请先退出游戏，再替换或还原存档".into()) }
    if new_bytes.is_empty() || new_bytes.len() as u64 > MAX_SAVE { return Err("新存档大小无效".into()) }
    let original = fs::read(target).map_err(err)?;
    if hash(&original) != expected { return Err("游戏存档已在载入后变化，请重新读取再操作".into()) }
    let backup = create_backup_for(root, target, &original)?;
    let parent = target.parent().ok_or("目标目录无效")?;
    let temp = parent.join(format!(".drg-vault-{}.tmp", Local::now().timestamp_nanos_opt().unwrap_or_default()));
    let write_result = (|| -> Result<(), String> {
        let mut out = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(err)?;
        out.write_all(new_bytes).map_err(err)?; out.sync_all().map_err(err)?;
        drop(out);
        if fs::read(&temp).map_err(err)? != new_bytes { return Err("临时文件校验失败".into()) }
        if game_running() { return Err("检测到游戏重新启动，已中止写入".into()) }
        if hash(&fs::read(target).map_err(err)?) != expected { return Err("提交前发现目标存档变化，已中止".into()) }
        #[cfg(windows)] {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
            let dst: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
            let src: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let ok = unsafe { ReplaceFileW(dst.as_ptr(), src.as_ptr(), std::ptr::null(), 0, std::ptr::null(), std::ptr::null()) };
            if ok == 0 { return Err(format!("Windows 原子替换失败：{}", std::io::Error::last_os_error())) }
        }
        if fs::read(target).map_err(err)? != new_bytes { return Err("替换后校验失败；请从备份恢复".into()) }
        Ok(())
    })();
    if temp.exists() { let _ = fs::remove_file(&temp); }
    write_result.map_err(|e| format!("{e}。旧存档备份：{}", display_path(&backup)))?;
    Ok((display_path(&backup), hash(new_bytes)))
}

#[tauri::command]
fn replace_save(state: tauri::State<AppState>, expected_hash: String, bytes: String) -> Result<String, String> {
    let data = STANDARD.decode(bytes).map_err(err)?;
    let inner = state.0.lock().map_err(err)?;
    let root = inner.settings.game_root.as_ref().ok_or("请先设置游戏目录")?;
    let target = current_path(&inner.settings)?;
    replace_transaction(root, &target, &expected_hash, &data).map(|x| x.0)
}

#[tauri::command]
fn restore_save(state: tauri::State<AppState>, id: String, expected_hash: String, source_hash: String) -> Result<String, String> {
    let inner = state.0.lock().map_err(err)?;
    let source = backup_path(&inner, &id)?;
    let name = source.file_name().unwrap().to_string_lossy().into_owned();
    if !is_player(&name) { return Err("备份文件名无效".into()) }
    let data = fs::read(&source).map_err(err)?;
    if hash(&data) != source_hash { return Err("备份文件在预览后发生变化，请刷新备份列表".into()) }
    let root = inner.settings.game_root.as_ref().ok_or("请先设置游戏目录")?;
    let dir = save_dir(root)?;
    let target = dir.join(name).canonicalize().map_err(err)?;
    if !target.starts_with(&dir) { return Err("还原目标不在游戏目录中".into()) }
    replace_transaction(root, &target, &expected_hash, &data).map(|x| x.0)
}

fn main() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let Ok(mut inner) = window.state::<AppState>().0.lock() {
                    inner.dropped.clear();
                    for path in paths {
                        if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("sav")) {
                            if let Ok(real) = path.canonicalize() { inner.dropped.insert(real); }
                        }
                    }
                }
            }
        })
        .setup(|app| {
            let mut path = app.path().app_data_dir()?.join("settings.json");
            let mut settings = fs::read(&path).ok().and_then(|data| serde_json::from_slice(&data).ok()).unwrap_or_default();
            #[cfg(debug_assertions)]
            if let Ok(test_root) = std::env::var("DRG_VAULT_TEST_ROOT") {
                let root = PathBuf::from(test_root);
                save_dir(&root).map_err(std::io::Error::other)?;
                let list = candidates(&root).map_err(std::io::Error::other)?;
                settings = Settings { game_root: Some(root.clone()), player_name: list.first().map(|item| item.name.clone()), auto_load: Some(true) };
                path = root.join("smoke-settings.json");
            }
            app.manage(AppState(Mutex::new(Inner { settings, settings_path: path, ..Default::default() })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![startup, choose_game_root, select_player, read_current, choose_save, read_dropped, open_project, set_auto_load, export_save, create_backup, list_backups, choose_external_backup, prepare_restore, replace_save, restore_save])
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steam_manifest_parsing_accepts_custom_install_folder() {
        let manifest = "\"AppState\"\n{\n\t\"installdir\"\t\"Deep Rock Galactic\"\n}";
        assert_eq!(vdf_value(manifest, "installdir").as_deref(), Some("Deep Rock Galactic"));
        assert_eq!(vdf_value("\"path\" \"D:\\\\SteamLibrary\"", "path").as_deref(), Some("D:\\SteamLibrary"));
    }

    #[test]
    fn installed_game_is_discovered_when_present() {
        let roots = discover_roots();
        for steam in steam_locations() {
            let Ok(vdf) = fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf")) else { continue };
            for library in vdf.lines().filter_map(|line| vdf_value(line, "path")) {
                let apps = PathBuf::from(library).join("steamapps");
                let Ok(manifest) = fs::read_to_string(apps.join("appmanifest_548430.acf")) else { continue };
                let Some(name) = vdf_value(&manifest, "installdir") else { continue };
                let game = apps.join("common").join(name);
                if save_dir(&game).is_ok() { assert!(roots.contains(&game), "未找到已安装的游戏：{}", game.display()); }
            }
        }
    }

    fn fixture() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("drg-vault-test-{}-{}", std::process::id(), Local::now().timestamp_nanos_opt().unwrap_or_default()));
        let dir = root.join("FSD").join("Saved").join("SaveGames");
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("123456_Player.sav");
        fs::write(&target, b"old-save").unwrap();
        (root, target)
    }

    #[test]
    fn replace_creates_verified_backup() {
        let (root, target) = fixture();
        let expected = hash(b"old-save");
        let (backup, _) = replace_transaction(&root, &target, &expected, b"new-save").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new-save");
        assert_eq!(fs::read(backup).unwrap(), b"old-save");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn conflict_never_writes_target_or_backup() {
        let (root, target) = fixture();
        let bad = hash(b"other-save");
        assert!(replace_transaction(&root, &target, &bad, b"new-save").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old-save");
        assert!(!root.join("FSD").join("Saved").join("back").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn backup_failure_does_not_change_target() {
        let (root, target) = fixture();
        fs::write(root.join("FSD").join("Saved").join("back"), b"blocking-file").unwrap();
        assert!(replace_transaction(&root, &target, &hash(b"old-save"), b"new-save").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old-save");
        fs::remove_dir_all(root).unwrap();
    }
}
