# 矿工档案库

矿工档案库是一款面向《深岩银河》（Deep Rock Galactic）的存档管理工具，支持查看游戏进度、编辑武器配装，以及备份和还原存档。项目提供网页版和 Windows 桌面测试版。存档在本机读取和处理，无需上传到服务器。

- [打开在线网页版](https://drg-vault.pages.dev/)
- [下载网页版文件或 Windows 桌面测试版](https://github.com/muzhouyi/drg-vault/releases/latest)

## 主要功能

- **查看存档：**浏览职业、资源、游戏进度，以及武器、核心、超频和涂装的获得状态。
- **编辑配装：**调整武器、模块、超频、外观和配装图标；复制配装槽，管理模块的购买与装备状态。
- **管理改动：**编辑内容先进入待应用清单，可逐项撤销，也可导出修改后的 `.sav` 文件。
- **备份与还原：**创建备份、查看备份摘要并还原存档；直接替换当前存档前会自动备份，并检查文件是否已被其他程序改动。

## 使用网页版

可直接使用上方的在线网页版，或下载单文件 HTML，使用 Chrome 或 Edge 打开。网页版无需安装。

首次读取游戏存档时：

1. 在 Steam 游戏库中右键《深岩银河》，选择 **管理 → 浏览本地文件**。
2. 回到编辑器，点击 **设置游戏目录**，选择 Steam 打开的 **Deep Rock Galactic 文件夹本身**，不要选择其中的 `FSD` 或 `SaveGames` 文件夹。
3. 编辑器会从该目录下的 `FSD\Saved\SaveGames` 读取当前玩家存档。之后可点击 **读取游戏存档** 再次载入；自动载入可在页面右上角关闭。

也可以点击 **选择存档**，手动打开单个 `.sav` 文件。若浏览器不支持文件夹访问，仍可通过此方式编辑并导出新存档。

## 使用 Windows 桌面测试版

在上方下载页面选择 `DRGVault-v8-windows-x64-setup.exe` 安装版，或下载 `DRGVault.exe` 直接运行。桌面版会尝试自动查找 Steam 游戏目录；未找到时可手动选择游戏文件夹。

**两个可执行文件均为测试版，尚未经过充分的实际使用测试。使用前请备份存档。**

文件尚未进行代码签名，Windows 可能显示安全提示。更多说明见 [Windows 桌面版文档](WINDOWS-DESKTOP.md)。

## 存档安全

替换或还原存档前，请先退出游戏，并自行保留一份备份。工具创建的备份保存在游戏目录的 `FSD\Saved\back` 下。如果存档在编辑期间发生变化，工具会拒绝覆盖当前文件。

## 来源与许可

存档读写部分基于 [DRG Save Editor](https://github.com/AnthonyMichaelTDM/DRG-Save-Editor) 的代码。其 GPLv3 许可证文本保留在 [dist/licenses/DRG-Save-Editor-LICENSE.txt](dist/licenses/DRG-Save-Editor-LICENSE.txt)；其他组件说明见 [THIRD-PARTY.md](THIRD-PARTY.md)。
