# 启动流程：从敲命令到端口监听

| | |
|---|---|
| 状态 | 学习中（主链路已走通） |
| 日期 | 2026-11-06 |
| 基线 | `zhp@3fdf527f73` |
| 证据 | 源码 + 实测（本机 web profile 的启动日志） |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**没有"main 函数注册一切"，只有一棵用补丁拼出来的插件树。** 启动 = 解析参数 → 找到 profile → 把"空根 + 若干补丁层"交给 Cordis Loader → Loader 挂载插件 → webserver 绑定端口。

## 1. 入口

[`bin.ts`](../apps/cli/src/bin.ts)：

1. `parseDshArgs(argv)` 判定模式：`profile` / `plugin` / `dump-config` / `dump-config-schema`；
2. `profile` 模式动态 import [`profile-boot.ts`](../apps/cli/src/profile-boot.ts) 并调 `runProfile()`；
3. `StartupError` → 写诊断日志、退出码 1。

`loadLayeredEnv('dsh')` 把 `.env` 各层冻成不可变快照，之后所有插件读同一份，而不是实时 `process.env`。

## 2. Profile 是补丁栈

`~/.dsh/profiles/web/`：

| 文件 | 内容 | 说明 |
|---|---|---|
| `package.json` | `dsh.profile.bundles: [dsh-base, dsh-web-app]` | 选 bundle |
| `cordis.yml` | `[]` | 空根，每次启动重写 |
| `cordis.patch.yml` | 用户配置（如 provider/model） | 用户层 |
| `pnpm-workspace.yaml` | 依赖根 | |

补丁层从低到高：

1. bundle 层（按 `dsh.profile.bundles` 顺序）；
2. profile 的 `cordis.patch.yml`；
3. home 层 `~/.dsh/cordis.patch.yml`（机器级偏好，**优先于** profile 层）；
4. `--patch` 叠加；
5. telemetry 开关。

规则是**按 id 覆盖、最后写入者胜**；一个 patch 替换目标行的整个 `config`，不合并。

## 3. boot() 的五步

1. `new Context()`，provide `dshHomePath`；
2. `plugin(Loader)`；
3. `prepare(hostCtx)`：provide `profileContext`、launch environment 快照、`PluginPackages`、`cmdline`（args / exit / ready）；
4. `mountRootInclude()`（[app-boot/index.ts:738](../packages/boot/app-boot/src/index.ts#L738)）：注册 `cordis:include`，以 profile 的空 `cordis.yml` 为根，挂上补丁层；
5. `loader.await()` 等整棵树激活 → `auditStartupEntries`：**必需插件未激活即 `StartupError`**。

实测例子：本机 15:47 那次启动就是第 5 步失败的——`client-modules` 报 "64 client packages failed to compose: client bundles not found; run `pnpm run build` before launch"，并写出 1.3MB 的 `startup-*.log`。

## 4. 树的内容

- **[base bundle](../packages/bundle/base/cordis.patch.yml)**：timer、HMR、llm、session、tools、sandbox 等公共底座；
- **[web bundle](../packages/bundle/web-app/cordis.patch.yml)**：覆盖 `system-prompt` 的 persona、`session-query`、插入 `webserver`、`host-frontend-static`、`api/*-controller`、以及一长串 `client/*` 浏览器插件。

行字段：`id`、`name`、`config`、`disabled`。`disabled` 可以是 `!!js` 表达式，按 `ctx.get('profileContext')` 判断，因此同一份 bundle 同时服务 web 与 desktop。**行序不代表加载顺序**，激活由服务依赖驱动。

注意：base 里 `hmr` 的 `disabled` 是 `!ctx.get('profileContext')`，web 提供了 `profileContext`，所以 **web 进程的 HMR 默认是开着的**。

## 5. 参数到端口

1. `web-startup` 插件（`inject: ['cmdlineArgs']`）解析 `--host` / `--port` / `--no-open` / `--public-url` / TLS，provide 成 `webStartup` 服务；
2. `webserver` 插件（[webserver/index.ts:566](../packages/host/webserver/src/index.ts#L566)）注入它，`createServer(listener)` → `server.listen(port, host)` → 记录实际端口（`0` 由系统分配）；
3. `host-frontend-static` 提供前端 dist；
4. `client-modules` 扫描浏览器插件，生成 `window.__DSH_BOOT__`；
5. `boot()` 成功后 `appReady.commit()`，就绪信号才发出。

## 6. 失败与退出

- `StartupError` 携带启动期 warn/error 日志与 composition 快照；
- `installFailLoud` 把 `unhandledRejection` / `uncaughtException` 变成致命退出；
- `SIGTERM` → exit 0（supervisor 的普通停止）；`SIGINT` → 130（用户中断）；
- 关闭顺序：根 fiber dispose → 代理清理。

## 7. 为什么这样设计

- **组合即配置**：加能力 = 加一行。
- **profile 是数据不是代码**：换 profile 就是换一组补丁层。
- **空根是刻意的**：`cordis.yml` 保持 `[]`，否则 Loader 的树回写会把合成行烘焙进文件，下次启动重复插入。
- **激活顺序由服务可用性驱动**，不是 YAML 顺序。

## 还没搞懂

1. **Loader 如何应用 patches**：`cordis-plugin-include` 的 insert / override / disable 具体语义。
2. **`PluginPackages` 与 runtime resolution**：为什么不用普通 workspace 依赖解析？
3. **HMR 在启动时的边界**：哪些行能热替换、哪些必须重启。
4. **`window.__DSH_BOOT__`**：client-modules 如何扫描与注入。
