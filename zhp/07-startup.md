# 启动流程：从敲命令到端口监听

| | |
|---|---|
| 状态 | 学习中（主链路已走通；profile 物化已补） |
| 日期 | 2026-11-27 |
| 基线 | `zhp@9f310112ca` |
| 证据 | 源码 + 实测（本机 web profile 的启动日志） |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> 整仓交付物／独立程序／发布打包对照 [49](./49-deliverables-and-release.md)；仓库地图 [08](./08-repo-layout.md)。

## 一句话

**没有"main 函数注册一切"，只有一棵用补丁拼出来的插件树。** 启动 = 解析参数 →（必要时物化）profile → 把"空根 + 若干补丁层"交给 Cordis Loader → Loader 挂载插件 → webserver 绑定端口。

## 1. 入口

[`apps/cli/src/bin.ts`](../apps/cli/src/bin.ts)：

1. `parseDshArgs(argv)` 判定模式：`profile` / `plugin` / `dump-config` / `dump-config-schema`；
2. `profile` 模式动态 import [`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts) 并调 `runProfile()`；
3. `StartupError` → 写诊断日志、退出码 1。

`loadLayeredEnv('dsh')` 把 `.env` 各层冻成不可变快照，之后所有插件读同一份，而不是实时 `process.env`。

## 2. Profile 在哪、何时物化

**不在** `npm install` 时拷贝目录。安装包只带 **dsh 运行时 + bundle 包**；模板是代码常量 [`PROFILE_TEMPLATES`](../packages/util/official-bundles/src/bundles.ts#L10-L26)。

| 位置 | 内容 |
|---|---|
| **运行时** | `$DSH_HOME/profiles/<name>/`（默认 `~/.dsh/profiles/…`） |
| **模板** | `PROFILE_TEMPLATES`（`web`／`headless`／`sdk`／`sdk-minimal`／`acp`） |
| 仓库 `apps/cli/tests/profiles/` | **测试夹具**，非用户安装目标 |
| `desktop` | Electron 保留名；CLI 拒启动 |

物化时机（[`loadProfile`](../packages/boot/app-boot/src/profile.ts#L728-L745)／[`initProfile`](../packages/boot/app-boot/src/profile.ts#L198-L217)）：

| 时机 | 行为 |
|---|---|
| 首次 `dsh web`／`--profile <随附名>` | 无 `package.json` 且名在模板表 → 写目录（幂等，已有文件不动） |
| `dsh plugin --profile <name> …` | 不存在则 init：有模板用模板，否则默认只挂 `dsh-base` |
| `--from-default-profile <template>` | 用模板**整份替换**自定义名（不能盖随附名） |

## 3. Profile 是补丁栈（怎么生效）

物化后的 `~/.dsh/profiles/web/`：

| 文件 | 内容 | 说明 |
|---|---|---|
| `package.json` | `dsh.profile.bundles: [dsh-base, dsh-web-app]` | 选 bundle |
| `cordis.yml` | `[]` | 空根，每次启动重写 |
| `cordis.patch.yml` | 用户配置（如 provider/model） | 用户层 |
| `pnpm-workspace.yaml` | 树外插件依赖根 | |

每次启动叠层（空根之上，低→高）：

1. bundle 层（按 `dsh.profile.bundles` 顺序；**代码在 dsh 安装目录**，不拷进 profile）；
2. profile 的 `cordis.patch.yml`；
3. home 层 `$DSH_HOME/cordis.patch.yml`（机器级，**优先于** profile 层）；
4. `--patch` 叠加；
5. telemetry 等启动器派生层。

规则是**按 id 覆盖、最后写入者胜**；一个 patch 替换目标行的整个 `config`，不合并。开 HMR 时改 patch／bundles 会重组合；否则下次启动生效。`dsh --dump-config` 可预览合成树。

## 4. boot() 的五步

入口：[`packages/boot/app-boot/src/index.ts#L1200`](../packages/boot/app-boot/src/index.ts#L1200)（`boot`）。

1. `new Context()`，provide `dshHomePath`；
2. `plugin(Loader)`；
3. `prepare(hostCtx)`：provide `profileContext`、launch environment 快照、`PluginPackages`、`cmdline`（args / exit / ready）；
4. [`mountRootInclude()`](../packages/boot/app-boot/src/index.ts#L738)：注册 `cordis:include`，以 profile 的空 `cordis.yml` 为根，挂上补丁层；
5. `loader.await()` 等整棵树激活 → [`auditStartupEntries`](../packages/boot/app-boot/src/index.ts#L1153)：**必需插件未激活即** `StartupError`。

实测例子：本机 15:47 那次启动就是第 5 步失败的——`client-modules` 报 "64 client packages failed to compose: client bundles not found; run `pnpm run build` before launch"，并写出 1.3MB 的 `startup-*.log`。

## 5. 树的内容

- **[base bundle](../packages/bundle/base/cordis.patch.yml)**（`packages/bundle/base/cordis.patch.yml`）：timer、HMR、llm、session、tools、sandbox 等公共底座；
- **[web bundle](../packages/bundle/web-app/cordis.patch.yml)**（`packages/bundle/web-app/cordis.patch.yml`）：覆盖 `system-prompt` 的 persona、`session-query`、插入 `webserver`、`host-frontend-static`、`api/*-controller`、以及一长串 `client/`* 浏览器插件。

行字段：`id`、`name`、`config`、`disabled`。`disabled` 可以是 `!!js` 表达式，按 `ctx.get('profileContext')` 判断，因此同一份 bundle 同时服务 web 与 desktop。**行序不代表加载顺序**，激活由服务依赖驱动。

注意：base 里 `hmr` 的 `disabled` 是 `!ctx.get('profileContext')`，web 提供了 `profileContext`，所以 **web 进程的 HMR 默认是开着的**。

## 6. 参数到端口

1. `web-startup`（[`packages/bundle/web-app/src/startup.ts`](../packages/bundle/web-app/src/startup.ts)，`inject: ['cmdlineArgs']`）解析 `--host` / `--port` / `--no-open` / `--public-url` / TLS，provide 成 `webStartup` 服务；
2. `webserver`（[`packages/host/webserver/src/index.ts`](../packages/host/webserver/src/index.ts)）：`Service.init` [L528](../packages/host/webserver/src/index.ts#L528) 里 `createServer` [L566](../packages/host/webserver/src/index.ts#L566) → `listen` [L621](../packages/host/webserver/src/index.ts#L621) → 记录实际端口（`0` 由系统分配）；
3. `host-frontend-static`（[`packages/host/frontend-static/src/index.ts`](../packages/host/frontend-static/src/index.ts)）认领 SPA dist 回退；
4. `client-modules`（[`packages/client/modules/src/index.ts`](../packages/client/modules/src/index.ts)）扫描浏览器插件，生成 `window.__DSH_BOOT__`；
5. `boot()` 成功后 `appReady.commit()`，就绪信号才发出。

## 7. 失败与退出

- `StartupError` 携带启动期 warn/error 日志与 composition 快照；
- `installFailLoud` 把 `unhandledRejection` / `uncaughtException` 变成致命退出；
- `SIGTERM` → exit 0（supervisor 的普通停止）；`SIGINT` → 130（用户中断）；
- 关闭顺序：根 fiber dispose → 代理清理。

## 8. 为什么这样设计

- **组合即配置**：加能力 = 加一行。
- **profile 是数据不是代码**：换 profile 就是换一组补丁层；模板在安装包代码里，目录按需物化。
- **空根是刻意的**：`cordis.yml` 保持 `[]`，否则 Loader 的树回写会把合成行烘焙进文件，下次启动重复插入。
- **激活顺序由服务可用性驱动**，不是 YAML 顺序。

## 还没搞懂

1. **Loader 如何应用 patches**：`cordis-plugin-include` 的 insert / override / disable 具体语义。
2. `PluginPackages` **与 runtime resolution**：为什么不用普通 workspace 依赖解析？
3. Host `dsh-hmr` 改 Node 插件行 vs Client HMR 改浏览器 bundle 的对照实测（概念见 [39](./39-hmr.md)）。
4. bootstrap vs application combo 在 Network 面板的体积对照（加载模型见 [42](./42-client-modules.md)）。
5. Desktop 首次如何物化 `profiles/desktop`（不经 CLI `loadProfile`）。

## 相关

- Cordis 官方 CLI 的 Loader/Include 最小链：[zhp/10-cordis-boot-loader.md](./10-cordis-boot-loader.md)。
- HTTP 载体：[zhp/38-webserver.md](./38-webserver.md)；Typert / 同进程 Host：[zhp/26-typert.md](./26-typert.md)；仓库地图 [zhp/08-repo-layout.md](./08-repo-layout.md)。
- Client 开发热重载：[zhp/39-hmr.md](./39-hmr.md)；浏览器插件图 / `__DSH_BOOT__`：[zhp/42-client-modules.md](./42-client-modules.md)。
- 链接写法：[zhp/05-workspace-conventions.md](./05-workspace-conventions.md)（标签用仓库根相对路径，避免 `index.ts:738` 被误解析）。
