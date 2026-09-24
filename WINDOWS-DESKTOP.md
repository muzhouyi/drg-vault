# 矿工档案库 v8 · Windows 桌面版

版本为 0.8.0。桌面版使用 Tauri 2/WebView2；页面和存档转换器继续来自 `dist/`，桌面构建资源输出到 `build/desktop-ui/`。运行时不需要 Node、Rust、PowerShell 助手或本地 HTTP 服务。

## 构建

开发者安装 Rust stable MSVC、Microsoft C++ Build Tools/Windows SDK、Node.js 和 pnpm，执行：

```powershell
pnpm install
.\scripts\build-desktop-windows.ps1 -RunTests
.\scripts\build-desktop-windows.ps1
```

构建脚本也支持本项目 `.build-tools/` 中的便携 Rust、LLVM 和 MSVC sysroot（仅供本机临时构建，已加入 `.gitignore`）。普通开发机用微软官方 C++ Build Tools 即可，不需要便携缓存。`dist/` 是源码，不能清空；`build/` 和 `src-tauri/target/` 才是构建产物。

Release EXE 位于 `src-tauri/target/release/drg-vault.exe`，NSIS 安装包位于 `src-tauri/target/release/bundle/nsis/`。安装器使用当前用户安装模式，WebView2 采用嵌入引导程序：若系统未安装 WebView2，首次安装需联网获取运行时。已安装运行时后，存档编辑功能可离线使用。卸载不会清理游戏目录的存档和备份。

## 存档操作

通常无需手动设置目录：程序启动时读取 Steam 当前用户或系统级安装登记、Steam 库清单和 DRG 安装清单，自动找到游戏根目录，再补齐 `FSD\Saved\SaveGames`。只有未检测到游戏、存在多个无法判定的安装位置时，才需手动选择 `Deep Rock Galactic` 游戏根目录。备份写入 `FSD\Saved\back\日期时间\原存档名.sav`。发现多个玩家存档时会让用户选定，不会悄悄覆盖其他玩家。

点击窗口关闭按钮会退出程序；如果有待应用改动，先询问是否丢弃。点击“取消”会留在程序内。

桌面后端在替换和还原前比对目标 SHA-256，先写出并核对备份，再写入同目录临时文件并用 Windows `ReplaceFileW` 提交。若检测到游戏运行、目标变化或备份失败，就中止提交。外部 `.sav` 可供预览与导出；还原需先明确选择目标游戏目录。

不要在游戏运行中替换存档。第一次使用时建议先另行保留一份游戏存档。程序没有远程上传或遥测。

## 代码签名

当前没有受信任的 Windows 代码签名证书，因此本地 Release 为**未签名**。取得有效代码签名证书后，将 `src-tauri/tauri.signing.example.json` 复制为未入库的私有配置，填入证书指纹及颁发机构认可的时间戳 URL，然后以 `tauri build --config <私有配置路径>` 构建并验证 EXE/安装包签名。不要提交私钥、PFX 或口令。签名后不要再改动二进制。即使正式签名，新发布者仍可能遇到 SmartScreen 信誉提示；不能承诺零误报。

当前构建流程不使用 UPX、脚本转 EXE、后台服务、计划任务、游戏内存读取或反病毒规避手段。
