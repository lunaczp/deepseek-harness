# 源码 web + Computer Use helper（Dev.app）

| | |
|---|---|
| 状态 | 学习中（机制已对照源码；本机 web 拉起 CUA 未在本文单独复测） |
| 日期 | 2026-11-27 |
| 基线 | `zhp@4d3562b5b3` |
| 证据 | **源码** [`native-build.ts`](../packages/experimental/cua-macos/src/native-build.ts)、[`cua-macos/native/README.zh.md`](../packages/experimental/cua-macos/native/README.zh.md)；**对照** [desktop-dmg-unsigned.md](./desktop-dmg-unsigned.md) §1b |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**测 CUA 不必靠 unsigned Desktop DMG：用源码 `dsh web` 当 Host，本机 `build:native` 编出 Dev helper；不必把 `.app` 拷进 `/Applications`。**（源码）

---

## 1. 和 DMG 模式差在哪

| | unsigned Desktop DMG | 源码 web（本文） |
|---|---|---|
| Host | Electron 装包内的 dsh | 仓库里 `pnpm dsh web`（或等价源码启动） |
| UI | Desktop 窗口 | 浏览器打开 Host 给出的本地 URL（如 `127.0.0.1:3080`） |
| helper 从哪来 | 只认包内已 stage 的 `native/bin/...`；unsigned **没有** | 认定源码包 → **现场／预编** `build:native` |
| helper 名字 | 正式：`DSH Computer Use` | 开发：`DSH Computer Use Dev` |
| 要不要 `/Applications` | 主程序可拷到测试目录或 Applications；**helper 仍不靠那里** | helper **不**装进 `/Applications` |

装包逻辑（缺文件就报错）与源码分支（改去编译）在同一函数 [`native-build.ts`](../packages/experimental/cua-macos/src/native-build.ts)：源码包 → `buildNativeExecutable`；已安装包 → 只读 `native/bin/darwin-<arch>/`。

unsigned DMG 卡在装包路径 → 见 [desktop-dmg-unsigned.md §1b](./desktop-dmg-unsigned.md#1b-cua-helper-missing-in-unsigned-dmg)。

---

## 2. helper 应用在哪

| 形态 | 路径 |
|---|---|
| Swift 源码 | `packages/experimental/cua-macos/native/Sources/CuaNative/` |
| 本机构建产物 | `packages/experimental/cua-macos/native/bin/darwin-<arch>/` → `DSH Computer Use Dev.app` + `current.json` |
| 正式装包内（对照） | `…/app.asar.unpacked/…/native/bin/darwin-<arch>/`（需 `cua-helper/stage.ts`） |
| 嵌套主 App 时的运行缓存 | `~/Library/Application Support/DeepSeek Harness/Computer Use/<runtime-key>/`（正式／嵌套场景；**不是** `/Applications`） |

**不要**理解为「再打一个 CUA 安装包、双击装进 `/Applications`」。源码路径就是仓库目录里的 Dev.app，由 Host 经 LaunchServices 拉起。

---

## 3. 手动步骤（概要）

在仓库根、**Node ≥ 24.9**：

```sh
# 1)（可选但建议）先编 helper，避免首次激活才编、失败难查
pnpm --dir packages/experimental/cua-macos run build:native
# Intel → native/bin/darwin-x64/
# Apple 芯片 → native/bin/darwin-arm64/

# 2) 源码启动 web Host（需已 pnpm install / 按你惯用方式 build）
pnpm dsh web
# 或：pnpm run start:web / make web 等，以你环境为准

# 3) 浏览器打开终端打印的本地地址
```

还需要：

1. **profile／插件**实际加载 Computer Use 与 `@deepseek-ai/dsh-experimental-cua-macos`（Desktop 默认组合与纯 `web` 模板未必相同——以当前 profile／patch 为准；缺插件时谈不上 helper）。
2. 系统设置 → 隐私与安全性：给 **`DSH Computer Use Dev`** 开**辅助功能**和**屏幕录制**（以系统提示名为准）。
3. 默认 **ad-hoc** 签名：源码一变、重编或换 worktree，可能再次要授权。想少重复授权 → 个人固定开发证书，见 [`.agents/skills/dsh-cua-macos-signing/SKILL.md`](../.agents/skills/dsh-cua-macos-signing/SKILL.md)。

---

## 4. 「web + 编 CUA.app」心智（避免说偏）

| 说法 | 是否准确 |
|---|---|
| web 模式 + 本机编出 CUA Dev.app | ✅ |
| web 模式 + 把 CUA 打成 DMG／装进 `/Applications` | ❌ 不是这条路径 |
| unsigned Desktop DMG + 手动塞 Dev.app 进包 | ❌ 装包校验／路径不为此设计；且正式校验拒 ad-hoc `build:native` 产物 |
| 官网正式 Desktop | ✅ helper 已公证并 stage 进包；与本文无关 |

正式发布侧（有公司证书时）才是：

```sh
node --import tsx/esm scripts/cua-helper/package.ts --out dist/cua-helper
node --import tsx/esm scripts/cua-helper/stage.ts --from dist/cua-helper/extracted
# 再打签名 Desktop（非 :unsigned）
```

权威：[`packages/experimental/cua-macos/native/README.zh.md`](../packages/experimental/cua-macos/native/README.zh.md)、[`apps/desktop/packaging/README.zh.md`](../apps/desktop/packaging/README.zh.md)。

---

## 还没搞懂

1. 当前默认 `web` profile 是否已挂 CUA bundle，还是必须 overlay／plugin add（需对照本机 cordis 与 [zhp/07](../zhp/07-startup.md)）。
2. 本机从 `build:native` 到 web 会话里第一次成功 `getCapabilities` 的完整实测清单。
3. Application Support 缓存目录在**纯源码 web**（非嵌套 Electron）下是否仍会用到。

## 读文档最短路径

1. 本文（源码测 CUA）
2. [desktop-dmg-unsigned.md](./desktop-dmg-unsigned.md)（为何 unsigned DMG 没有 helper）
3. [`packages/experimental/cua-macos/native/README.zh.md`](../packages/experimental/cua-macos/native/README.zh.md)
4. [dsh-cua-macos-signing](../.agents/skills/dsh-cua-macos-signing/SKILL.md)（开发签名）
