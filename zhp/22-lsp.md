# LSP：只读语义导航的设计、组合与边界

| | |
|---|---|
| 状态 | 学习中（源码走读；本机未挂 LSP 实测） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@471680d551` |
| 证据 | 源码；权威见 [`lsp` 组](../packages/lsp/README.zh.md)、[`dsh-lsp`](../packages/lsp/lsp/README.zh.md)、[`lsp-stdio`](../packages/lsp/lsp-stdio/README.zh.md)、[`tool-lsp`](../packages/lsp/tool-lsp/README.zh.md)、[`docs/subsystems/lsp.zh.md`](../docs/subsystems/lsp.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Seam 用语 [19](./19-seam-and-service.md)；执行世界依赖 fs / subprocess → [21](./21-fs.md)、[17d](./17d-subprocess.md)。后续主题：[23](./23-scope.md)、[24](./24-ptc.md)。

## 一句话

**LSP 是可选能力：harness 提供稳定门面（`ctx.lsp` + 工具 `lsp`），真正语义分析在部署自备的独立 language server 里。** base **默认不挂**；需显式组合并配置 `command`。（源码）

---

## 0. 分层：谁做什么

| 层 | 包 / 进程 | 职责 |
|---|---|---|
| 独立 language server | `typescript-language-server` 等（**不随机附**） | **真正语义能力**（定义、引用、类型…） |
| Provider | [`dsh-lsp-stdio`](../packages/lsp/lsp-stdio/) | 起进程、stdio JSON-RPC、按次 didOpen / 查询 / didClose |
| Seam / 注册表 | [`dsh-lsp`](../packages/lsp/lsp/) → `ctx.lsp` | 按扩展名选提供方；统一请求、结果、`LspError` |
| Consumer | [`dsh-tool-lsp`](../packages/lsp/tool-lsp/) | 模型工具名 `lsp`；1-based↔0-based；渲染上限 |

**不是「又写一套语言智能」**：交付面是 seam/工具；脑力在外部 server。
**也不只是工具**：换 server/提供方时，模型仍调同一个 `lsp`。

与 jobs/shell 略有不同：`dsh-lsp` 是**可直接 yml 挂载的具体** `Lsp` Service（注册表），不是只能挂 abstract；stdio 调 `registerProvider`，**不**自己注册工具。

---

## 1. 四种操作（封闭联合）

| 操作 | 含义 |
|---|---|
| `goToDefinition` | 定义位置 |
| `findReferences` | 引用（**始终含声明**） |
| `goToImplementation` | 实现位置 |
| `hover` | 规范化文档；可无 |

刻意不做：重命名、格式化、诊断、符号列表、通用 JSON-RPC 逃生口。新增操作须同步改 seam / 提供方 / 工具（编译期封闭）。

坐标：seam 内 **0-based UTF-16**；模型 **1-based**，由 tool 转换。

---

## 2. 调用链

```text
模型 lsp(operation, file_path, line, character)
  → tool-lsp（校验、坐标、timeout / 上限）
  → ctx.lsp.query({ workspaceRoot, filePath, position, operation })
       [lsp/src/index.ts L143]
  → 按「最终扩展名」选 route（与注册顺序无关）
  → lsp-stdio：
       ctx.fs 读当前文件
       →（按工作区池化）ctx.subprocess 起配置的 server
       → didOpen → 协议请求 → didClose
  → 规范化 locations / hover → 工具渲染
```

无扩展名路由 → `LSP_UNAVAILABLE`（schema 仍在；换提供方不改模型请求面）。

关键锚点：[`Lsp` L82+](../packages/lsp/lsp/src/index.ts#L82)；stdio [`lsp-stdio/src/`](../packages/lsp/lsp-stdio/src/)；工具 [`tool-lsp/src/index.ts`](../packages/lsp/tool-lsp/src/index.ts)。

---

## 3. 组合（最小）

```yaml
- name: '@deepseek-ai/dsh-fs-local'   # 或 fs-sandbox；须与 subprocess 同执行世界
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-lsp'
- name: '@deepseek-ai/dsh-lsp-stdio'
  config:
    servers:
      typescript:
        command: typescript-language-server
        args: ['--stdio']
        extensionToLanguage: { '.ts': typescript }
- name: '@deepseek-ai/dsh-tool-lsp'
```

要点（源码 / README）：

- 加载时解析 `command`；坏配置 fail-loud，阻止注册。
- 首次匹配查询时惰性起 server；同工作区查询串行，跨工作区可并行。
- 每次查询重新读盘并临时 open/close，**不**在查询间保留文档状态。
- **不沙箱 language server 进程**——信任所配 command；隔离靠同世界的 fs/subprocess。
- 查询源须在工作区内；结果位置可以指向工作区外。

---

## 4. 与 search / read 怎么选

| | `lsp` | `glob`/`grep` + `read` |
|---|---|---|
| 擅长 | 同名消歧、跟 import、接口→实现、类型悬停 | 文本匹配、快速扫目录 |
| 提示词取向 | 精确符号关系时用 | 普通导航优先 search/read |

---

## 还没搞懂

1. 本机挂 typescript-language-server 一次真实 `goToDefinition` 的工具结果与超时表现。
2. 池化进程崩溃「重试一次」与 `LSP_MALFORMED_RESPONSE` 的边界案例。

## 读代码最短路径

1. 组 / 子系统：[packages/lsp/README.zh.md](../packages/lsp/README.zh.md)、[docs/subsystems/lsp.zh.md](../docs/subsystems/lsp.zh.md)
2. 注册表：[lsp/src/index.ts](../packages/lsp/lsp/src/index.ts)
3. Provider：[lsp-stdio/README.zh.md](../packages/lsp/lsp-stdio/README.zh.md)
4. 工具：[tool-lsp/README.zh.md](../packages/lsp/tool-lsp/README.zh.md)
