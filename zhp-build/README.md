# zhp-build/

本机**构建／打包**操作笔记（实测步骤）。与 [zhp/](../zhp/)（源码学习主线）、[zhp-codex/](../zhp-codex/)、[zhp-claude/](../zhp-claude/) 分开，不占用 `zhp/` 编号。

| 文件 | 内容 |
|---|---|
| [desktop-dmg-unsigned.md](./desktop-dmg-unsigned.md) | 本地打未签名 Desktop DMG；含 CUA helper **未打进包** 的限制说明 |
| [web-cua-helper.md](./web-cua-helper.md) | 源码 `dsh web` + `build:native` Dev helper；不必拷 `/Applications` |

权威打包文档仍以仓库为准：[`apps/desktop/packaging/README.zh.md`](../apps/desktop/packaging/README.zh.md)。CUA native：[cua-macos/native](../packages/experimental/cua-macos/native/README.zh.md)。交付物总览见 [zhp/49](../zhp/49-deliverables-and-release.md)。
