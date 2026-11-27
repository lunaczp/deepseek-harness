# 本地打未签名 Desktop DMG

| | |
|---|---|
| 状态 | 已核实（本机跑通一次） |
| 日期 | 2026-11-27 |
| 基线 | `zhp@72a31476e0`（产品版本 `0.2.2-rc.1`） |
| 证据 | **实测** Intel Mac 全量 `mac-x64:unsigned`；**源码** [`apps/desktop/packaging/README.zh.md`](../apps/desktop/packaging/README.zh.md)；**二手** 官网下载页与 COS latest |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部页面／CDN；**推断** = 尚未验证。

## 一句话

**不需要 Apple 证书也能打出本地 DMG；本机是 Intel 用** `mac-x64:unsigned`**，Apple 芯片用** `mac-arm64:unsigned`**。**（实测／源码）

---

## 1. 和官网包的关系

| 项 | 官网 | 本地 unsigned |
|---|---|---|
| 是什么 | `apps/desktop` Electron 壳 + 内嵌 dsh（同一产品线） | 同左 |
| 下载例 | `https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg` → `deepseek-harness-0.2.2-rc.5-mac-arm64.dmg`（**二手**，2026-11-27） | `deepseek-harness-<仓库版本>-mac-<arch>-unsigned.dmg` |
| 签名／公证 | Developer ID + 公证 | Electron ad-hoc；**无公证** |
| 自动更新 | 有 feed | 无；上传命令不会发这类产物 |
| Computer Use helper | 正式签名包可带 | unsigned **不放入** |
| 官网菜单 | 主推 **macOS（Apple 芯片）** + Windows；Intel 不在面板里 | 本仓仍保留 `mac-x64` 全套打包／上传目标 |

**不是**「代码不兼容」或「electron-builder 打不出 x64」：`mac-x64` 与 `mac-arm64`、`win-x64` 同为一等目标（源码：`package-target.ts`、`primary-runtime/lock.json`、`macos-intel-package.yml`）。官网不列 Intel 更像分发选择；COS 上 `dsh-latest-macos-x64.dmg` 曾存在但停更更早（**二手**，last-modified 约 2026-10-17）。

权威说明：`apps/desktop/packaging/README.zh.md` [§ 无发布签名的本地 macOS DMG](../apps/desktop/packaging/README.zh.md#local-macos-dmg-without-release-signing)。

---

## 2. 前置条件

1. **macOS**；Linux 不是 Desktop 发布目标。
2. **Node ≥ 24.9**（`package.json` `engines`）。本机若默认 Node 20，pnpm 11 会因缺 `node:sqlite` 直接挂掉——先 `nvm use 24`（或等价）。
3. 仓库根已能 `pnpm install`（需网络：npm、Electron、nodejs.org 等）。
4. 磁盘留足空间（完整产物与中间目录常到数 GB；单份 DMG 约 280MB 级）。

### 选目标（按本机芯片）

```sh
uname -m
# x86_64  → mac-x64   （Intel；本笔记实测机）
# arm64   → mac-arm64 （Apple 芯片）
```

| 目标 | 构建机要求（源码） |
|---|---|
| `mac-arm64` | 必须 Apple Silicon |
| `mac-x64` | Intel Mac，**或** Apple Silicon + Rosetta |

---

## 3. 手动步骤（复制即可）

在仓库根目录：

```sh
cd /path/to/deepseek-harness

# 1) Node 24+
nvm use 24.22.2   # 或本机已装的 ≥24.9
node -v

# 2) 依赖（已有 node_modules 且未大改时可跳过）
pnpm install

# 3) 可选：只校验工具链，不打包
pnpm run package:desktop:mac:x64:unsigned -- --check
# Apple 芯片：
# pnpm run package:desktop:mac:arm64:unsigned -- --check

# 4) 正式打包（Intel 示例）
pnpm run package:desktop:mac:x64:unsigned
# Apple 芯片：
# pnpm run package:desktop:mac:arm64:unsigned
```

成功时终端打印：

```text
DMG: <绝对路径>/.../deepseek-harness-<version>-mac-<arch>-unsigned.dmg
```

### 产物路径模板

```text
apps/desktop/.desktop-build/targets/<target>/unsigned-artifacts/deepseek-harness-<version>-mac-<arch>-unsigned.dmg
```

本机一次实测：

```text
apps/desktop/.desktop-build/targets/mac-x64/unsigned-artifacts/deepseek-harness-0.2.2-rc.1-mac-x64-unsigned.dmg
# 约 283MB；全流程约 24 分钟（Intel i7，含构建／runtime／冒烟／DMG）
```

打开：

```sh
open "apps/desktop/.desktop-build/targets/mac-x64/unsigned-artifacts/deepseek-harness-0.2.2-rc.1-mac-x64-unsigned.dmg"
```

未公证应用可能被 Gatekeeper 拦：系统设置 → 隐私与安全性 → 仍要打开。安装时把 App 拷到**本地测试目录**即可（不必进 `/Applications`）。

---

## 4. 命令实际阶段（心里有数）

| 阶段 | 大致做什么 |
|---|---|
| 构建 | 编译 Host／Client，打 Desktop bundle |
| 准备 runtime | Electron、内嵌 Node／Python／pnpm、按 arch 裁原生依赖 |
| 冒烟 | 离线装插件、Office 往返、拉起 web 等 |
| electron-builder | 组装 `.app`，ad-hoc 签名，`dmg.format: ULMO`（LZMA）打 DMG |

不需要：`.env.macos`、Apple 账号、Developer ID、公证凭据、更新服务配置。
`unsigned` 会忽略继承的发布配置，应用 ID 用 `com.deepseek.harness`。

根脚本对应关系（源码 `package.json`）：

```text
package:desktop:mac:x64:unsigned
  → pnpm --filter @deepseek-ai/dsh-desktop run package:mac:x64:unsigned
  → tsx apps/desktop/scripts/package-target.ts mac-x64 --unsigned
```

---

## 5. 本机实测记录（2026-11-27）

| 项 | 值 |
|---|---|
| CPU | Intel Core i7-1068NG7（`uname -m` = `x86_64`） |
| Node | `nvm use 24.22.2` |
| 命令 | `pnpm run package:desktop:mac:x64:unsigned` |
| 预检 | `... -- --check` → `would publish 0.2.2-rc.1; ... valid` |
| 结果 | `exit 0`；打印 `DMG:` 如上路径 |
| 日志备份 | `/tmp/dsh-mac-x64-unsigned-package.log`（可选，非仓库文件） |

---

## 还没搞懂

1. 官网是否会重新发布／展示 mac-x64 latest（渠道策略，非打包能力）。
2. Apple 芯片本机跑 `mac-arm64:unsigned` 的耗时与冒烟差异（本笔记未测）。
3. 本地 unsigned 与正式签名包在 Gatekeeper／辅助功能权限上的长期行为差异。

## 读文档最短路径

1. 本文（操作）
2. [`apps/desktop/packaging/README.zh.md`](../apps/desktop/packaging/README.zh.md)（权威）
3. [zhp/49-deliverables-and-release.md](../zhp/49-deliverables-and-release.md)（交付物总览）
4. [`apps/desktop/README.zh.md`](../apps/desktop/README.zh.md)（Desktop 行为）
