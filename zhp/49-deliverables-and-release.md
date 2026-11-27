# 项目交付物、独立面与发布打包

| | |
|---|---|
| 状态 | 学习中（文档／架构／release 脚本） |
| 日期 | 2026-11-27 |
| 基线 | `zhp@6ecba3f662` |
| 证据 | 文档与源码；权威见 [`docs/architecture.md`](../docs/architecture.md)、[`apps/cli`](../apps/cli/README.zh.md)、[`packages/bundle`](../packages/bundle/README.zh.md)、[npm 三序列 Note](../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.zh.md)、[`apps/desktop/packaging`](../apps/desktop/packaging/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。仓库地图 [08](./08-repo-layout.md)；启动／profile [07](./07-startup.md)；「运行时」用语 [52](./52-runtime.md)；Web／Desktop 壳 [38](./38-webserver.md)／[44](./44-host-client-dual-face.md)。

## 一句话

**用户向交付 = npm `dsh` + Desktop 安装包 + TS／Python SDK + 文档／市场索引；Node 应用只经 `dsh --profile`；npm 发布分 dsh／vendor／native 三条独立序列，Desktop 走 COS 安装包，互不绑死。**（文档／源码）

---

## 1. 用户向交付物

| 交付物 | 是什么 | 入口 |
|---|---|---|
| npm CLI `@deepseek-ai/dsh` | `dsh` + 随附 bundles | 全局／本地安装后 `dsh web` 等 |
| Desktop 安装包 | Electron + 内嵌 dsh 运行时 + Web 资源 | macOS DMG／Windows 安装器；可选系统 `dsh` |
| TypeScript SDK | JSON-RPC 客户端，拉起同版本 `dsh --profile sdk` | `packages/sdk/*` |
| Python SDK + runtime wheel | 客户端 + 带 `dsh` 的 runtime | `python/sdk`、`python/sdk-runtime` |
| 文档站 | VitePress（`website/`） | `pnpm run website:build` |
| 插件市场索引 | 发现页 `index.json` | `apps/plugin-market-generator` |

随发行版 profile **模板名**：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`（代码常量 [`PROFILE_TEMPLATES`](../packages/util/official-bundles/src/bundles.ts)）；`desktop` 保留给 Electron，CLI 拒启动。

**Profile 不是 npm 安装产物：** 用户目录 `$DSH_HOME/profiles/<name>` 在首次 `dsh <名>` 或 `dsh plugin` 时物化；安装包只带运行时与 bundle 包。叠层生效见 [07](./07-startup.md#2-profile-在哪何时物化)。

---

## 2. 可独立运行的程序

### 产品级（必须经 `dsh`）

| Profile | 行为 |
|---|---|
| `web` | Host HTTP + 浏览器 GUI |
| `headless` | 一次性任务，打印答案退出 |
| `sdk`／`sdk-minimal` | JSON-RPC stdio（完整 base vs 极简独立树） |
| `acp` | ACP stdio 自动化 |

包 bin、demo、`start:web` 等经 `verify-application-entrypoints` 归类；**禁止**当正式应用入口绕过 `dsh`（[architecture § Application launch](../docs/architecture.md)）。

### 壳／旁路（不是第二套 harness 入口）

| 程序 | 说明 |
|---|---|
| Desktop Electron | 私有 Host + 打包 Web；内置 CLI 管 `profiles/desktop` |
| plugin-market-generator | 独立 Node，只生成市场索引 |

开发：`pnpm run build` 后 `pnpm dsh …`；`make web|desktop|dev-*`。

---

## 3. 可独立使用的模块

「独立」= 可单独装／引用；多数仍要叠进 profile 才成产品。

### 组合层（bundle）

| Bundle | 作用 |
|---|---|
| `dsh-base` | 共享核心 |
| `dsh-web-app`／`headless`／`sdk-app`／`acp-app` | base 上的应用面 |
| `dsh-sdk-minimal` | **不经 base** 的完整极简树 |
| 树外插件 | `dsh plugin --profile <name> add <pkg>` |

### 库／SDK

| 面 | 位置 |
|---|---|
| TS SDK | `packages/sdk/{protocol,client,server}` |
| Python | `python/sdk` + `sdk-runtime` |
| Cordis（rescoped） | `vendor/*` → `@deepseek-ai/cordis` 等 |
| Native addon | `native/system` |
| 能力包 | `packages/*/*` 的 `@deepseek-ai/dsh-*`（seam 可替换，默认随 profile） |

### 不像独立产品

`experimental/*`（无产品承诺）；Host-only 实体；Client 插件（须挂 Web／Desktop Client 树）。API 预稳定（[`packages/README`](../packages/README.zh.md#release-expectations)）。

---

## 4. 发布打包（四条线）

```text
┌─ dsh 族 ── packages/*/* + apps/* ── 统一版本 ── tag dsh-v*
│              bump → pack → CI publish → npm
├─ vendor ── vendor/* ── 各包自有版本 ── tag vendor-<pkg>-v*
├─ native ── native/system ── 自有版本／架构 ── tag node-addon-system-v*
└─ Desktop ── 安装包 + feed ── COS／CDN（≠ npm）
               package → 签名 → upload；Python wheel 另建
```

| 序列 | 本地 | CI／命令 | 产物 |
|---|---|---|---|
| dsh | `pnpm run release:dsh` | `release.yml` → `release-publish.yml` | npm；`alpha`/`canary` 对应 dist-tag，`rc`→`next` |
| vendor | `pnpm run release:vendor` | `release-vendor*.yml` | 9 个框架包 |
| native | 自有 workflow | `node-addon-system-release.yml` | 平台原生包 |
| Desktop | `pnpm run package:desktop:mac:arm64` 等 | 自托管 Actions + `upload:*` | DMG／Win + 更新 feed |
| Python | `scripts/build-python-release.py` 等 | 见 `python/development` | wheel／runtime |

要点（[Note](../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.zh.md)）：

1. 三条 npm 序列**互不绑定**——发 dsh 不重发 vendor。
2. **版本先落仓再 tag**；CI 对照 registry：缺则发、同 integrity 则 skip、内容变未 bump 则 fail。
3. Desktop production 版本对齐 dsh；test 可加 `.YYYYMMDD.index`；更新渠道与 COS 环境独立。

---

## 5. 心智图

```text
用户
 ├─ Desktop 安装包 ──── Electron + 内嵌 dsh(desktop)
 ├─ npm: dsh CLI ──────┬─ web / headless / sdk / acp
 ├─ TS / Python SDK ───┴─ 拉起 dsh --profile sdk*
 └─ 文档站 / 插件市场索引

扩展
 ├─ Cordis 插件 + bundle／patch → dsh plugin add
 └─ 依赖公开 @deepseek-ai/dsh-*／vendor（预稳定）

发布
 ├─ npm: dsh | vendor | native
 └─ Desktop COS + Python wheels
```

---

## 还没搞懂

1. dsh publish set 与 `private`／experimental 例外的完整名单一次对照。
2. Desktop CI 审批／attempt 恢复与手工 upload 的并发约束实测。
3. Python runtime wheel 与 npm `dsh` 版本对齐策略细读。

## 读文档最短路径

1. [architecture.md](../docs/architecture.md)（profiles + launch + Desktop）
2. [apps/cli](../apps/cli/README.zh.md)、[bundle](../packages/bundle/README.zh.md)
3. [npm 三序列 Note](../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.zh.md)
4. [desktop/packaging](../apps/desktop/packaging/README.zh.md) + [publishing](../apps/desktop/publishing/README.zh.md)
5. [python/README](../python/README.zh.md)
