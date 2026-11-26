# Plugin 与 Service：关系、设计哲学、使用场景

| | |
|---|---|
| 状态 | 学习中（Cordis primer / tutorial + jobs 对照） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@6ad34ffb60` |
| 证据 | [cordis-primer.zh.md](../docs/cordis-primer.zh.md)、[tutorial 01](../docs/cordis-tutorial/01-first-plugin.zh.md)、[tutorial 03](../docs/cordis-tutorial/03-services.zh.md)、[`service.ts`](../vendor/cordis/src/service.ts)；实例 [18](./18-jobs.md) |

> Seam 边界见 [19](./19-seam-and-service.md)。Boot / Loader 见 [10](./10-cordis-boot-loader.md)。Host/Client 同 Cordis 哲学、双树双面见 [44](./44-host-client-dual-face.md)。

## 一句话

**yml / `ctx.plugin` 加载的都是 plugin；plugin 有两种形状：`apply` 函数，或 `Service` 子类。Service 是「要成为 `ctx.<key>`」时用的那种 plugin（也可由别的 apply 再 `ctx.plugin(Class)` 挂上）。**

---

## 1. 关系

Cordis 教程原话（[01-first-plugin](../docs/cordis-tutorial/01-first-plugin.md)）：

> Use the function form until you need to expose a service.

| 形态 | 入口 | 加载后 |
|---|---|---|
| Function / object plugin | `export function apply` + 可选 `name` / `inject` / `Config` | 跑 `apply(ctx, config)`：注册工具、监听、prompt… |
| Class plugin | `export default class X extends Service` | `new X(ctx, config)` → `super(ctx, key)` → **`ctx.key` 出现** |

统一点：

- 都是 **plugin**（fiber、热替换、yml 可挂）。
- 依赖用 **`inject`** 等服务就绪（不靠 yml 文件顺序）。
- 注册用 **`ctx.effect` / `ctx.on`**，卸载可逆。

分化点：

- **要不要占用一个稳定的 `ctx.<key>` API 面。**

```text
yml 挂载
  ├─ jobs-local（Service 子类 plugin）→ 提供 ctx.jobs
  └─ tool-jobs（apply plugin）→ inject jobs/tools/systemPrompt，注册工具
```

---

## 2. 设计哲学（为啥两种，不收成一种）

**出发点：插件干的活有两类**——「我就是能力」vs「我接线/贡献」。

| 若只留 `apply` | 若只留 `Service` |
|---|---|
| 每个 Provider 手写 `provide` 或 `new Service(ctx)`，样板多 | 纯接线包也得占假 `ctx.toolJobs`，污染命名空间 |
| 生命周期/isolate 细节易散落 | 「上下文是服务的容器」被无关键淹没 |

因此：**一种组合通道，两种实现形状**——按是否暴露命名服务选，不是两套加载系统。

与 seam 角色对齐（见 [19](./19-seam-and-service.md)）：

| 角色 | 常见形态 |
|---|---|
| Provider | Service 类 plugin（`jobs-local`、`bash-sandbox`、`subprocess-local`） |
| Consumer | apply plugin（`tool-jobs`、`tool-bash`） |
| Definition | 常为抽象 `Service`；**产品路径挂 Provider**，不挂抽象（jobs 误挂会抛） |

实践规则（primer）：拦截/策略优先 **事件**；直接能力调用优先 **服务方法**。

---

## 3. 使用场景（怎么选）

| 场景 | 选 | 例 |
|---|---|---|
| 要对外提供稳定 API：`ctx.xxx.method()` | **Service 子类**（或 apply 里 `ctx.plugin(ServiceClass)`） | `LocalJobRegistry`、`LocalSubprocessRuntime` |
| 只注册工具 / prompt / 监听，不新占键 | **`apply`** | `tool-jobs`、多数 `tool-*` |
| 可替换后端 | Service 占固定键；yml 换 Provider 包 | `ctx.shell` ← bash-local / bash-sandbox |
| 框架内置、不经业务 yml | Context 构造直接 `new XxxService` | **`ctx.logger`**（[context.ts L81](../vendor/cordis/src/context.ts#L81)） |
| 依赖别的服务再启动 | `inject: ['jobs', 'tools', …]` | tool-jobs 等 jobs 就绪 |

`logger`：定义 [`vendor/cordis/src/logger.ts`](../vendor/cordis/src/logger.ts)；注册在根 Context，**不是** seam 式 yml Provider。控制台输出另挂 [`vendor/logger-console`](../vendor/logger-console/) plugin。

---

## 4. 与「service 语义 / plugin 语义」口语对照

对话里常说：

- **「走 service 语义」** ≈ 这个包加载后**成为** `ctx` 上的服务（class plugin）。
- **「走 plugin 语义」** ≈ 这个包是 **apply** 接线，消费已有服务。

二者 **yml 都能加载**；差别是形状与角色，不是「一个能挂、一个不能挂」。

---

## 还没搞懂

1. `ctx.plugin(ServiceClass)` 嵌在 apply 里 vs `export default ServiceClass` 直接挂，对 fiber 名 / 配置 schema 的细差异。
2. callable Service（`[Service.invoke]`，如 logger）与普通实例方法服务的选用边界。

## 读代码 / 文档最短路径

1. [primer 五个概念](../docs/cordis-primer.zh.md)
2. [tutorial 01 三种形态](../docs/cordis-tutorial/01-first-plugin.zh.md) → [03 Services](../docs/cordis-tutorial/03-services.zh.md)
3. [`Service` 构造 provide](../vendor/cordis/src/service.ts)
4. 样板：[18](./18-jobs.md)；seam 边界：[19](./19-seam-and-service.md)
