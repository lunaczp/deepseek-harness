#!/usr/bin/env python3
"""Generate the DSH architecture diagram as SVG (then rendered to PNG by Chrome)."""

W = 1560
M = 44
PANEL_W = W - M * 2
LABEL_W = 214
CHIP_X0 = M + LABEL_W + 10
CHIP_X1 = W - M - 22
CHIP_W_MAX = CHIP_X1 - CHIP_X0

BG = "#0B0E14"
PANEL = "#121722"
PANEL_BORDER = "#242C3C"
CHIP = "#1A2130"
CHIP_BORDER = "#2B3547"
CHIP_TEXT = "#C3CEE2"
MONO = "#7C8CA8"
TITLE = "#EEF3FF"
ACCENT = "#4D6BFE"

CORE_PANEL = "#121A2E"
CORE_BORDER = "#3D5BD9"
CORE_CHIP = "#1B2540"

STATE_PANEL = "#1B1610"
STATE_BORDER = "#6E5426"
STATE_CHIP = "#2A2216"
STATE_TEXT = "#DCC49B"

FONT = "'PingFang SC','Helvetica Neue','Arial',sans-serif"
FONT_MONO = "'SF Mono','Menlo','Consolas',monospace"


def text_w(s, size, mono=False):
    if mono:
        return len(s) * size * 0.60
    w = 0.0
    for ch in s:
        if ord(ch) > 0x2E80:
            w += size * 1.0
        elif ch in "·|/":
            w += size * 0.38
        elif ch.isupper():
            w += size * 0.66
        else:
            w += size * 0.56
    return w


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def mono_chip(x, y, label, fill=CHIP, border=CHIP_BORDER, color=CHIP_TEXT, size=12.5):
    w = text_w(label, size, True) + 20
    h = 29
    out = [
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h}" rx="6" '
        f'fill="{fill}" stroke="{border}" stroke-width="1"/>',
        f'<text x="{x + w / 2:.1f}" y="{y + h / 2 + 4.4:.1f}" fill="{color}" '
        f'font-family="{FONT_MONO}" font-size="{size}" text-anchor="middle">{esc(label)}</text>',
    ]
    return "".join(out), w


def wrap_chips(chips, x0, x1, y0, gap=7, row_h=37, **kw):
    """Lay chips out left-to-right, wrapping. Returns (svg, rows_used)."""
    svg = []
    x, y, row = x0, y0, 0
    for label in chips:
        w = text_w(label, 12.5, True) + 20
        if x + w > x1 and x > x0:
            x = x0
            y += row_h
            row += 1
        s, _ = mono_chip(x, y, label, **kw)
        svg.append(s)
        x += w + gap
    return "".join(svg), row + 1


layers = [
    {
        "idx": "01",
        "name": "入口层",
        "en": "ENTRY",
        "desc": ["你与 harness 的接触面", "每种形态各有一个入口"],
        "chips": [
            "apps/cli  →  dsh",
            "apps/web",
            "apps/desktop",
            "apps/desktop-host",
            "apps/plugin-market-generator",
            "packages/acp",
            "packages/sdk",
            "bundle/acp-app",
        ],
    },
    {
        "idx": "02",
        "name": "装配层",
        "en": "ASSEMBLY",
        "desc": ["按形态挑选插件并启动", "决定「你得到的是哪一套 dsh」"],
        "chips": [
            "bundle/base",
            "bundle/headless",
            "bundle/web-app",
            "bundle/sdk-app",
            "bundle/sdk-minimal",
            "boot/app-boot",
            "boot/config-editor",
            "boot/hmr",
            "boot/plugin-manager",
            "boot/plugin-market",
            "preset/agent-preset",
            "preset/persona",
            "preset/agent-preset-registry",
        ],
    },
    {
        "idx": "03",
        "name": "内核层",
        "en": "CORE",
        "desc": ["所谓「我在思考」就发生在这里", "turn / step 循环 · 提示词拼装 · 工具派发"],
        "chips": [
            "core/agent-loop",
            "core/agent",
            "core/system-prompt",
            "core/tools",
            "core/tool-executor-native",
            "core/tool-executor-ptc",
            "core/scope",
            "core/session",
            "core/agent-default-model",
            "core/agent-tool-presentation",
        ],
        "core": True,
    },
    {
        "idx": "04",
        "name": "能力层",
        "en": "CAPABILITIES",
        "desc": ["我实际能碰到世界的手和眼", "多数以工具形式挂进 prompt"],
        "chips": [
            "fs/tool-fs",
            "fs/tool-fs-search",
            "fs/tool-str-replace-editor",
            "fs/fs-sandbox",
            "shell/tool-bash",
            "shell/tool-bash-persistent",
            "shell/tool-pwsh",
            "web/tool-web",
            "subagent/subagent",
            "subagent/subagent-fork-in-process",
            "subagent/subagent-claude-code",
            "subagent/subagent-codex",
            "subagent/subagent-acp",
            "mcp/*",
            "lsp/*",
            "skill/*",
            "workflow/*",
            "team/*",
            "jobs/*",
            "goal/*",
            "plan/*",
            "todo/*",
            "schedule/*",
            "compaction/*",
            "context/*",
            "interaction/*",
            "document/*",
            "deliverables/*",
            "terminal/*",
            "browser-use",
            "computer-use",
            "＋ experimental/ 61 包",
        ],
    },
    {
        "idx": "05",
        "name": "模型层",
        "en": "LLM",
        "desc": ["换成哪家模型、怎么重试、怎么计费", "我在这一层之外，这一层只负责送与收"],
        "chips": [
            "llm/llm",
            "llm/llm-deepseek",
            "llm/llm-deepseek-api-key",
            "llm/llm-deepseek-account",
            "llm/llm-pi-ai",
            "llm/llm-retry",
            "llm/token-meter",
        ],
    },
    {
        "idx": "06",
        "name": "底座层",
        "en": "RUNTIME",
        "desc": ["权限、存储、进程、通信", "所有「不许碰」都由这层执行"],
        "chips": [
            "sandbox/sandbox-policy",
            "sandbox/sandbox-local",
            "sandbox/sandbox-windows-acl",
            "storage/storage-json",
            "storage/storage-sqlite",
            "credentials/*",
            "host/webserver",
            "host/frontend-static",
            "util/*",
            "typert/*",
            "spill/*",
            "workspace/*",
            "telemetry/*",
            "ssh/*",
            "api/*",
        ],
    },
]

state_layer = {
    "idx": "07",
    "name": "状态层",
    "en": "STATE",
    "desc": ["不在 checkout 里", "代码在 Github 目录，历史在这里"],
    "chips": [
        "~/.dsh/profiles/web",
        "~/.dsh/sessions",
        "~/.dsh/storages",
        "~/.dsh/logs",
        "~/.dsh/.credentials.yaml",
        "default-workspace/",
    ],
}


def render_layer(layer, y, core=False, state=False):
    fill = STATE_PANEL if state else (CORE_PANEL if core else PANEL)
    border = STATE_BORDER if state else (CORE_BORDER if core else PANEL_BORDER)
    chip_fill = STATE_CHIP if state else (CORE_CHIP if core else CHIP)
    chip_text = STATE_TEXT if state else CHIP_TEXT
    accent = "#C79B4E" if state else ACCENT

    body, rows = wrap_chips(
        layer["chips"],
        CHIP_X0,
        CHIP_X1,
        y + 17,
        fill=chip_fill,
        border=border if state else CHIP_BORDER,
        color=chip_text,
    )
    # The label column (index / name / EN / two desc lines) needs its own floor,
    # otherwise single-row layers render their description outside the panel.
    h = max(17 + rows * 37 + 14, 146)

    svg = [
        f'<rect x="{M}" y="{y}" width="{PANEL_W}" height="{h}" rx="12" '
        f'fill="{fill}" stroke="{border}" stroke-width="1.2"/>',
        f'<rect x="{M}" y="{y}" width="4" height="{h}" rx="2" fill="{accent}" opacity="0.85"/>',
        f'<text x="{M + 26}" y="{y + 33}" fill="{accent}" font-family="{FONT_MONO}" '
        f'font-size="15" font-weight="600" opacity="0.75">{layer["idx"]}</text>',
        f'<text x="{M + 26}" y="{y + 62}" fill="{TITLE}" font-family="{FONT}" '
        f'font-size="20" font-weight="600">{esc(layer["name"])}</text>',
        f'<text x="{M + 26}" y="{y + 80}" fill="{MONO}" font-family="{FONT_MONO}" '
        f'font-size="10.5" letter-spacing="1.3">{layer["en"]}</text>',
        body,
    ]
    for i, line in enumerate(layer["desc"]):
        svg.append(
            f'<text x="{M + 26}" y="{y + 104 + i * 16}" fill="{MONO}" '
            f'font-family="{FONT}" font-size="11.5" opacity="0.85">{esc(line)}</text>'
        )
    return "".join(svg), h


parts = []
y = 26

parts.append(
    f'<rect x="0" y="0" width="{W}" height="100%" fill="{BG}"/>'
    f'<rect x="{M - 20}" y="{y - 8}" width="{PANEL_W + 40}" height="74" rx="14" '
    f'fill="url(#hdr)" stroke="#1E2737" stroke-width="1"/>'
    f'<text x="{M}" y="{y + 26}" fill="{TITLE}" font-family="{FONT}" font-size="27" '
    f'font-weight="700">DeepSeek Harness · 架构总览</text>'
    f'<text x="{M}" y="{y + 50}" fill="{MONO}" font-family="{FONT_MONO}" font-size="12">'
    f'v0.2.2-rc.1 · master @ fcc0ad4621 · 370 workspace packages · '
    f'/Users/lux/Github/lunaczp/deepseek-harness</text>'
)
y += 74 + 22

positions = []
for layer in layers:
    svg, h = render_layer(layer, y, core=layer.get("core", False))
    parts.append(svg)
    positions.append((y, h))
    y += h + 30

svg, h = render_layer(state_layer, y, state=True)
parts.append(svg)
state_pos = (y, h)
y += h + 34

# ---- step loop inset ----
INSET_H = 188
parts.append(
    f'<rect x="{M}" y="{y}" width="{PANEL_W}" height="{INSET_H}" rx="12" '
    f'fill="#0E1420" stroke="#2A3346" stroke-width="1"/>'
    f'<text x="{M + 24}" y="{y + 32}" fill="{TITLE}" font-family="{FONT}" font-size="17" '
    f'font-weight="600">一次 step 的真实路径</text>'
    f'<text x="{M + 24}" y="{y + 52}" fill="{MONO}" font-family="{FONT_MONO}" font-size="11">'
    f'core/agent-loop/src/agent.ts:344 · while (true) 里的单次循环</text>'
)

steps = [
    ("用户输入 / 唤醒", "inbox"),
    ("组装提示词", "system-prompt"),
    ("模型请求", "llm"),
    ("tool_use", "解析调用"),
    ("沙箱校验 + 执行", "sandbox / tool-*"),
    ("tool_result 回填", "session.append"),
]
bx0, by = M + 24, y + 76
bw, bh, gap = 196, 68, 26
flow = []
for i, (label, sub) in enumerate(steps):
    x = bx0 + i * (bw + gap)
    flow.append(
        f'<rect x="{x}" y="{by}" width="{bw}" height="{bh}" rx="9" fill="#172033" '
        f'stroke="#33405A" stroke-width="1"/>'
        f'<text x="{x + bw / 2}" y="{by + 28}" fill="#DCE5F5" font-family="{FONT}" '
        f'font-size="13.5" text-anchor="middle">{esc(label)}</text>'
        f'<text x="{x + bw / 2}" y="{by + 48}" fill="{MONO}" font-family="{FONT_MONO}" '
        f'font-size="10.5" text-anchor="middle">{esc(sub)}</text>'
    )
    if i < len(steps) - 1:
        ax = x + bw + 6
        flow.append(
            f'<path d="M {ax} {by + bh / 2} L {ax + gap - 12} {by + bh / 2}" '
            f'stroke="{ACCENT}" stroke-width="1.6" opacity="0.7"/>'
            f'<path d="M {ax + gap - 18} {by + bh / 2 - 4} L {ax + gap - 11} {by + bh / 2} '
            f'L {ax + gap - 18} {by + bh / 2 + 4}" fill="none" stroke="{ACCENT}" '
            f'stroke-width="1.6" opacity="0.7"/>'
        )
parts.append("".join(flow))

# loop-back arc
last_x = bx0 + 5 * (bw + gap) + bw
parts.append(
    f'<path d="M {last_x - bw / 2} {by + bh + 6} L {last_x - bw / 2} {by + bh + 22} '
    f'L {bx0 + 2 * (bw + gap) + bw / 2} {by + bh + 26} '
    f'L {bx0 + 2 * (bw + gap) + bw / 2} {by + bh + 8}" fill="none" '
    f'stroke="#4D6BFE" stroke-width="1.4" stroke-dasharray="5 4" opacity="0.8"/>'
    f'<path d="M {bx0 + 2 * (bw + gap) + bw / 2 - 4} {by + bh + 14} '
    f'L {bx0 + 2 * (bw + gap) + bw / 2} {by + bh + 7} '
    f'L {bx0 + 2 * (bw + gap) + bw / 2 + 4} {by + bh + 14}" fill="none" '
    f'stroke="#4D6BFE" stroke-width="1.4" opacity="0.8"/>'
    f'<text x="{bx0 + 3.6 * (bw + gap)}" y="{by + bh + 39}" fill="#6E83B8" '
    f'font-family="{FONT}" font-size="11">没有工具调用 → 本 step 结束</text>'
)
y += INSET_H + 22

# footer note
parts.append(
    f'<text x="{M}" y="{y + 12}" fill="{MONO}" font-family="{FONT}" font-size="11.5" opacity="0.8">'
    f'注：层序是依赖方向，不是调用顺序。内核层依赖能力层与底座层，能力层依赖底座层；模型层独立于其余各层，只被内核层调用。</text>'
)
y += 44

H = int(y)
svg_out = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
    f'viewBox="0 0 {W} {H}">'
    f'<defs><linearGradient id="hdr" x1="0" y1="0" x2="1" y2="1">'
    f'<stop offset="0%" stop-color="#16203A"/><stop offset="100%" stop-color="#0F1524"/>'
    f"</linearGradient></defs>" + "".join(parts) + "</svg>"
)

with open("/Users/lux/Documents/deepseek-harness/default-workspace/dsh-architecture.svg", "w") as f:
    f.write(svg_out)
print(f"ok {W}x{H}")
