# 第三方来源

- 存档转换代码沿用 [DRG Save Editor](https://github.com/AnthonyMichaelTDM/DRG-Save-Editor)，其 GPLv3 许可证文本位于 [`dist/licenses/DRG-Save-Editor-LICENSE.txt`](dist/licenses/DRG-Save-Editor-LICENSE.txt)。
- Windows 桌面容器使用 [Tauri 2](https://github.com/tauri-apps/tauri) 和 Windows WebView2。Rust 依赖版本记录在 `src-tauri/Cargo.lock`，前端构建依赖记录在 `pnpm-lock.yaml`。
- 发布包不包含玩家存档。
