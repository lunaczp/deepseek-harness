# DSH vs Cordis：启动相关文件与行数

| | |
|---|---|
| 状态 | 学习中（对照表已核实行数） |
| 日期 | 2026-11-18 |
| 基线 | `zhp@680aff4786` |
| 证据 | 源码；行数为该基线 `wc -l`（整文件） |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**Cordis CLI 入口约 16 行完成 Context→Loader→Include；DSH 在同一套 vendor 上多了 profile/补丁/诊断，仅 `bin + profile-boot + app-boot/index` 就约 1700 行，真正对齐那四步的是 `boot` + `mountRootInclude`（百行级）。**（源码 + `wc -l`）

流程语义见 [10-cordis-boot-loader.md](./10-cordis-boot-loader.md)、[07-startup.md](./07-startup.md)；本文只做**文件地图与体量**。

## A. 入口层

| 角色 | Cordis | 行数 | DSH | 行数 |
|---|---|---:|---|---:|
| CLI 入口 | [`vendor/cordis/bin.js`](../vendor/cordis/bin.js) | 16 | [`apps/cli/src/bin.ts`](../apps/cli/src/bin.ts) | 78 |
| 参数 / profile 编排 | （无，硬编码 Include） | — | [`apps/cli/src/args.ts`](../apps/cli/src/args.ts) | 216 |
| | | | [`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts) | 353 |
| | | | ├ `composeProfile` ~L224 | |
| | | | └ `runProfile` ~L271（内调 `boot`） | |

## B. 「new Context → plugin(Loader) → create(Include)」等价层

| 角色 | Cordis | 行数 | DSH | 行数 |
|---|---|---:|---|---:|
| 启动编排 | 就是 `bin.js` 那几步 | 16 | [`packages/boot/app-boot/src/index.ts`](../packages/boot/app-boot/src/index.ts) | 1266 |
| | | | ├ `mountRootInclude` **L738–785**（~48 行） | |
| | | | └ `boot` **L1200–**（`new Context` / `plugin(Loader)` / `prepare` / `mountRootInclude` / `loader.await` / `auditStartupEntries`） | |
| 根 Include | `bin.js`：`loader.create({ name: '@deepseek-ai/cordis-plugin-include', … })` | | 同文件：`builtins.include = Include`，`create({ id:'include', name:'cordis:include', … })` | |

DSH 相对 Cordis CLI **多出来的、进树之前**的准备：

| 文件 | 行数 | 干什么 |
|---|---:|---|
| [`packages/boot/app-boot/src/profile.ts`](../packages/boot/app-boot/src/profile.ts) | 762 | profile 目录、空根 `cordis.yml`、层 |
| [`packages/boot/app-boot/src/profile-context.ts`](../packages/boot/app-boot/src/profile-context.ts) | 85 | `profileContext` 服务形状 |
| [`packages/boot/app-boot/src/profile-plugins.ts`](../packages/boot/app-boot/src/profile-plugins.ts) | 133 | 插件包相关 |
| [`packages/util/official-bundles/src/bundles.ts`](../packages/util/official-bundles/src/bundles.ts) | 78 | profile → bundle 列表 |
| [`packages/boot/app-boot/src/startup-diagnostics.ts`](../packages/boot/app-boot/src/startup-diagnostics.ts) | 104 | 启动诊断 |

`boot` 的 `prepare`（在 `profile-boot.ts`）：`provide profileContext` / launch env、`plugin(PluginPackages)`、`provideCmdline`——Cordis `bin.js` 无对应物。

量级：`bin.ts` + `profile-boot.ts` + `app-boot/index.ts` ≈ **78 + 353 + 1266 = 1697** 行。

## C. 共享的 Cordis 运行时（两边同一套）

| 文件 | 行数 | 作用 |
|---|---:|---|
| [`vendor/cordis/src/context.ts`](../vendor/cordis/src/context.ts) | 146 | `Context` + Proxy |
| [`vendor/cordis/src/registry.ts`](../vendor/cordis/src/registry.ts) | 337 | `plugin` / `inject` |
| [`vendor/cordis/src/reflect.ts`](../vendor/cordis/src/reflect.ts) | 436 | Proxy handler / mixin / provide |
| [`vendor/cordis/src/fiber.ts`](../vendor/cordis/src/fiber.ts) | 820 | Fiber 生命周期 |
| [`vendor/loader/src/index.ts`](../vendor/loader/src/index.ts) | 219 | Loader 服务 |
| [`vendor/loader/src/config/tree.ts`](../vendor/loader/src/config/tree.ts) | 205 | `create` / `import` |
| [`vendor/loader/src/config/entry.ts`](../vendor/loader/src/config/entry.ts) | 239 | Entry → `registry.plugin` |
| [`vendor/loader/src/config/group.ts`](../vendor/loader/src/config/group.ts) | 89 | EntryGroup |
| [`vendor/include/src/index.ts`](../vendor/include/src/index.ts) | 465 | Include 读 yaml + 树 |
| [`vendor/include/src/patch.ts`](../vendor/include/src/patch.ts) | 261 | patch 语义（DSH 多层补丁主要吃这里） |

小计（上表）：**约 3217** 行。

## D. 配置数据（DSH 多出来的「树内容」）

| 文件 | 行数 | 说明 |
|---|---:|---|
| [`packages/bundle/base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml) | 548 | 公共底座插件行 |
| [`packages/bundle/web-app/cordis.patch.yml`](../packages/bundle/web-app/cordis.patch.yml) | 601 | web 层 |
| [`packages/bundle/headless/cordis.patch.yml`](../packages/bundle/headless/cordis.patch.yml) | 46 | headless 层 |
| profile 空根 `cordis.yml` | 通常 `[]` | 对应 Cordis CLI 的工作区 `./cordis.yml` |

## E. 最该对照读的步骤

| 步骤 | Cordis | DSH |
|---|---|---|
| 1. 入口 | `vendor/cordis/bin.js` 全文 | `apps/cli/src/bin.ts` → `profile-boot.runProfile` |
| 2. 组树 / 补丁 | （无 / 单文件） | `composeProfile` + `readProfilePatches` |
| 3. `new Context` + `Loader` | `bin.js` | `app-boot` `boot` ~L1207–1224 |
| 4. 挂根 Include | `bin.js` `loader.create` | `mountRootInclude` L738–785 |
| 5. 等树 / 审计 | （CLI 无显式 await/audit） | `boot` ~L1233–1235 |
| 6. 每行 plugin | `Entry._init`（共享） | 同左 |

## 还没搞懂

1. `readProfilePatches` / `prepareProfilePatches` 与 Include `patches` 字段的完整层序，是否应单独开一篇只画数据流（不重复本表文件列表）。
2. `PluginPackages` 实现文件体量未列入 B 表——若算「Cordis 初始化相关」，下次补 `wc -l`。
3. 行数会随重构漂移；重核时对基线再跑一遍 `wc -l`，不要只改叙述。
