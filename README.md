# 矿工档案库

矿工档案库是一款面向《深岩银河》（Deep Rock Galactic）的中文存档管理工具。它在本地浏览器中读取存档，提供内容查看、配装编辑、备份还原和修改结果导出等功能。存档文件无需上传到服务器。

[编辑器最新地址](https://drg-vault.pages.dev/)

[若打不开可下载最新版本](https://github.com/muzhouyi/drg-vault/releases/latest)

## 主要功能

- **存档查看：**浏览职业、资源与进度，以及武器、核心、超频和涂装的获得状态。
- **配装编辑：**调整武器、模块、超频、外观和配装图标；支持复制配装槽，并管理模块的购买与装备状态。
- **改动管理：**所有编辑先列入待应用清单，可逐项撤销，也可导出新的 `.sav` 文件。
- **目录读取：**授权游戏目录后，可直接读取当前玩家存档，并在浏览器允许时自动载入。
- **备份与还原：**创建和查看存档备份、浏览备份摘要、还原已有备份；直接替换当前存档前会自动备份原文件，并检查源文件是否已发生变化。

## 获取与使用

访问[编辑器最新地址](https://drg-vault.pages.dev/)或者在 [Releases](https://github.com/muzhouyi/drg-vault/releases) 页面下载最新版本的单文件 HTML，使用 Chrome 或 Edge 打开，无需安装其他程序。

首次使用时，按以下方法设置游戏目录：

1. 在 Steam 游戏库中右键《深岩银河》，选择 **管理 → 浏览本地文件**，并记下打开的文件夹路径。
2. 在编辑器顶部点击 **设置游戏目录**，选择 Steam 刚刚打开的 **Deep Rock Galactic 文件夹本身**，不要选择其中的 `FSD` 或 `SaveGames` 文件夹。
3. 编辑器会在该目录下定位 `FSD\Saved\SaveGames` 并读取当前玩家存档。此后可使用 **读取游戏存档** 再次载入；自动载入可在页面右上角关闭。

也可以点击 **选择存档**，手动打开单个 `.sav` 文件。若浏览器不支持文件夹访问，仍可通过此方式编辑并导出新存档。

## 存档安全

备份保存在游戏目录的 `FSD\Saved\back` 下。替换或还原存档前，请先退出游戏，并保留自己的备份。

## 来源与许可

存档读写部分基于 [DRG Save Editor](https://github.com/AnthonyMichaelTDM/DRG-Save-Editor) 的代码。其 GPLv3 许可证文本保留在 [`dist/licenses/DRG-Save-Editor-LICENSE.txt`](dist/licenses/DRG-Save-Editor-LICENSE.txt)。
