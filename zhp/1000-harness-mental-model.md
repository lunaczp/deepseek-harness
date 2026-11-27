# 1000 · 我的总结：DSH 设计心智（骨／肉／人）

| | |
|---|---|
| 状态 | 学习中（个人理解归纳；已与源码地图对过） |
| 日期 | 2026-11-27 |
| 基线 | `zhp@5a15e7bea8` |
| 编号 | **`1000`**（总览号，不插入 `00`–`52` 流水） |
| 证据 | 推断（心智模型）+ 源码／既有 zhp 校验；权威契约仍以 `docs/` 为准 |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。七层图 [01](./01-architecture.md)；包→bundle→profile [08](./08-repo-layout.md)；运行时用语 [52](./52-runtime.md)；seam [19](./19-seam-and-service.md)；effect [51](./51-cordis-effect.md)。早期要点摘要仍见 [00](./00-conclusions.md)（另一轮问答，不替代本篇）。

## 一句话

**骨是 Cordis 组合律；肉是按能力长出来的插件图（中间有一根不宜乱拆的脊）；人是面向场景的 profile／bundle 交付。另有血（Session 账本）和缝（seam）把肉接稳。**（推断 + 源码校验）

---

## 1. 三分法（我的原理解）

### （骨）骨架 — Cordis 内核

组合式 Cordis 内核。在此之上组合／插入各类插件，形成特定形态。

- **属骨：** `ctx`、Fiber、`effect`／`on`、事件分发（`emit`／`bail`／`serial`／waterfall）、Loader 挂树。
- **不属骨：** 某个工具叫什么、turn 怎么记日志——那是肉的业务语义。
- **骨提供的是组合律与可逆注册**（[10](./10-cordis-boot-loader.md)、[50](./50-cordis-events.md)、[51](./51-cordis-effect.md)），不是产品功能清单。

### （肉）插件层 — 长出来的系统

各类服务、模块以插件入驻，相互依赖，形成生态：agent-loop、会话、工具、权限、LLM、日志相关能力等。各自可独立成包，又能按需求互依，长成一张**插件图**。

- **目录有包 ≠ 已入肉**：要有 `cordis.patch.yml` 一行引用才挂进树（[08](./08-repo-layout.md)）。
- **不是随意长**：新行为优先挂文档化扩展点／seam，而不是改死 loop（AGENTS：plugins, not loop changes）。
- **脊（肉里的硬梁）：** `agent-loop`（及 Session 投影约定）——能换肢，不宜轻改脊（[02](./02-request-lifecycle.md)、[12](./12-session-implementation.md)）。

### （人）交付层 — 场景化产品形态

Web、CLI／headless、ACP、SDK、Desktop 等：在插件层之上，按场景打包交付。

- 手段：**profile + bundle**（必要时再叠 home／`--patch`）（[07](./07-startup.md)、[49](./49-deliverables-and-release.md)）。
- **人 = 同一套肉的不同穿法**，不是另一套内核。
- Web 的 Host／Client 双面，是「人」怎么站姿／怎么对话，仍共用 Cordis 心智（[44](./44-host-client-dual-face.md)）。

---

## 2. 补两块，否则骨肉虚

### 血 — Session 账本

模型看得见的输入须可从会话日志重建（model-visible ⟺ logged）。权威多在 `~/.dsh` 的 Session JSONL，不在 checkout（[12](./12-session-implementation.md)、[06](./06-session-and-resume.md)）。肉可换，**对话真相**靠血续上。

### 缝 — Seam

肉与肉之间不是乱 `import` 成一团：完整能力 = Definition + Provider(s) + Consumer(s)（[19](./19-seam-and-service.md)）。换沙箱／fs Provider，是换肉块，不是改骨。

---

## 3. 收束图

```text
        ┌─ 人：web / headless / sdk / acp / desktop
        │     profile + bundle（怎么交付、怎么启动）
        │
骨 ─────┼─ Cordis：ctx / effect / 事件 / Loader
        │
        └─ 肉：插件图（loop 为脊；tools / llm / session / 权限为肢）
              ↑ 血：Session 日志（+ storage／settings 等旁路状态）
              ↔ 缝：seam 把肢接上、可替换
```

与仓库三层对齐：

| 心智 | 仓库用语 |
|---|---|
| 骨 | Cordis + Loader（`vendor/`、boot） |
| 肉 | `packages/*` 经 patch 挂载的能力 |
| 人 | bundle 捆簇 + profile 选定／物化 |
| 血 | `~/.dsh/sessions/…`（及少量非会话存储） |
| 缝 | capability-seam／`ctx.*` Service |

口语「本项目运行时」≈ **骨 + 已挂上的肉** 那一整棵常驻进程（[52](./52-runtime.md) §2.1）。

---

## 4. 和七层图的关系

[01](./01-architecture.md) 的纵轴是**依赖方向**（入口→装配→内核→能力→模型→底座→状态）。本篇是**组合／交付隐喻**：

- 装配层＋内核机制感 ≈ 骨如何把肉钉住
- 能力／模型／底座 ≈ 肉（与缝）
- 入口层 ≈ 人
- 状态层 ≈ 血

两套图一起用：读依赖用 01，讲设计故事用本篇。

---

## 还没搞懂

1. 「脊」是否还应明确纳入 system-prompt／tools 注册表，还是只留 agent-loop。
2. settings／credentials 算血的旁支，还是单独「腺体」——与 [47](./47-settings.md)／[48](./48-credentials.md) 的归类话术。
3. 用本隐喻写一页给外人的「五分钟 DSH」，与 [00](./00-conclusions.md) 如何分工不重复。
