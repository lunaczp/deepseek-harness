# Seam 与 Service：关系与边界

| | |
|---|---|
| 状态 | 学习中（源码 + 官方 glossary / architecture） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@6ad34ffb60` |
| 证据 | 源码；[glossary · capability-seam](../docs/glossary.md)、[architecture](../docs/architecture.md)、[capability-seams.zh.md](../docs/capability-seams.zh.md)、[cordis-primer.zh.md](../docs/cordis-primer.zh.md) |

> **跳转**见 [05](./05-workspace-conventions.md)。Plugin 形态见 [20](./20-plugin-and-service.md)；jobs 实例见 [18](./18-jobs.md)；storage 能力 seam 例见 [45](./45-storage.md)。

## 一句话

**Service 是 Cordis 机制（`ctx.<key>` 上的命名能力对象）；seam 是产品约定（可替换能力 = Definition + Provider(s) + Consumer(s)）。seam 的 Definition 一定是 Service；不是每个 Service 都叫 seam。**

---

## 1. 各自是什么

| | Service | Seam（能力缝） |
|---|---|---|
| 层 | Cordis 运行时（插件总线；用语见 [52](./52-runtime.md)） | dsh 架构用语 |
| 定义 | `Service` 子类 `super(ctx, name)` → `ctx.reflect.provide` | *swappable capability* 三角色齐全 |
| 别人怎么用 | `ctx.jobs` / `ctx.shell` … | 换 Provider、挂 Consumer，组合出完整能力 |
| 单独一个角色？ | 可以只有一个 Service | **单角色 ≠ seam**（architecture 原文） |

权威：

- Seam：[docs/glossary.md](../docs/glossary.md) `capability-seam`；[architecture.md](../docs/architecture.md)「one role alone is not a seam」。
- Service：[vendor/cordis/src/service.ts](../vendor/cordis/src/service.ts)；[cordis-primer.zh.md](../docs/cordis-primer.zh.md)。

---

## 2. 关系（包含，不是相等）

```text
                    ┌─────────────────────────┐
                    │  seam（完整能力）         │
                    │  Definition + Provider(s) │
                    │  + Consumer(s)           │
                    └───────────┬─────────────┘
                                │
              Definition 一定是 │ Service（占 ctx.<key>）
                                ▼
              ┌─────────────────────────────────┐
              │  ctx 上所有 Service               │
              │  （含框架内置、非 seam 的胶水服务） │
              └─────────────────────────────────┘
```

- **凡 seam → 其 Definition 是 Service**（抽象类如 `ShellExecutor` / `JobRegistry`，或具体 registry 如 glossary 举的 `WebRuntime`）。
- **有 Service ≠ 是 seam**：还要有意设计成可替换三角色能力。

Definition 与 Provider 可同包（如部分 approval）；也可 Definition 抽象、Provider 另包（jobs、shell）。判定看「是否按 seam 设计」，不看「是否 abstract」。

---

## 3. 例子对照

| `ctx` 键 | 是 Service？ | 是 seam？ | 说明 |
|---|---|---|---|
| `jobs` | ✅ | ✅ jobs | Definition=`dsh-jobs`，Provider=`jobs-local`，Consumer=`tool-jobs` / bash… |
| `shell` | ✅ | ✅ shell | 同上三角色 |
| `sandbox` / `subprocess` | ✅ | ✅ | 见 [17c](./17c-sandbox-local.md)、[17d](./17d-subprocess.md) |
| `logger` | ✅ | ❌（一般不叫 dsh seam） | Cordis **内置**：[`context.ts` L81](../vendor/cordis/src/context.ts#L81) `new LoggerService`；定义 [`logger.ts`](../vendor/cordis/src/logger.ts)；**不是** yml 挂的业务能力缝 |
| （仅 apply 的 tool-jobs） | 不新占自己的服务键 | Consumer 角色 | 用的是别人的 Service |

`logger` 文件锚点：

- 定义：[`vendor/cordis/src/logger.ts`](../vendor/cordis/src/logger.ts)
- 挂上 ctx：[`vendor/cordis/src/context.ts`](../vendor/cordis/src/context.ts) 根构造
- 控制台导出（可选 plugin）：[`vendor/logger-console/`](../vendor/logger-console/)

---

## 4. 怎么挂才能「有 seam」

yml **不挂「seam」这个词**；挂的是 Provider（+ 通常 Consumer）：

```yaml
- name: '@deepseek-ai/dsh-jobs-local'   # → ctx.jobs
- name: '@deepseek-ai/dsh-tool-jobs'    # Consumer + controller
```

只挂 Definition、或只挂 Consumer，构不成可用能力（jobs 上甚至 `start()` 被拒）。

---

## 还没搞懂

1. `capability-seams.zh.md` 图里每一条边是否都严格三角色（部分 registry 是否「弱 seam」）。
2. 一体包（Definition+Provider）在归档文档里如何标注 Consumer。

## 读代码 / 文档最短路径

1. [glossary · seam](../docs/glossary.md)
2. [architecture · Plugins and seams](../docs/architecture.md)
3. 样板：[18](./18-jobs.md)；机制对照：[20](./20-plugin-and-service.md)
