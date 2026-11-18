#!/usr/bin/env bash
# DeepSeek 官方 chat/completions：无 tools，对比原始返回。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${DEEPSEEK_API_KEY:-}" && -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a && source "$ROOT/.env" && set +a
fi
: "${DEEPSEEK_API_KEY:?set DEEPSEEK_API_KEY (or put it in repo-root .env)}"

BASE_URL="${DEEPSEEK_BASE_URL:-https://api.deepseek.com}"
MODEL="${DEEPSEEK_MODEL:-deepseek-flash}"
OUT="${1:-"$ROOT/zhp-test/out-no-tools.json"}"

curl -sS "${BASE_URL%/}/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  -d "$(cat <<EOF
{
  "model": "${MODEL}",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello! Reply in one short sentence."}
  ],
  "thinking": {"type": "enabled"},
  "reasoning_effort": "high",
  "stream": false
}
EOF
)" | tee "$OUT" | python3 -m json.tool

echo "wrote $OUT" >&2
