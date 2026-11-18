#!/usr/bin/env bash
# On agent stop: commit local changes (if any) and push the current branch.
# Skips when clean, during rebase/merge, or when only secret-like paths remain.
set -euo pipefail

# Consume hook stdin (JSON) so the pipe does not stall.
cat >/dev/null

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  exit 0
fi
cd "$ROOT"

if [[ -d .git/rebase-merge || -d .git/rebase-apply || -f .git/MERGE_HEAD ]]; then
  exit 0
fi

# Drop common secret paths from the index if they were staged earlier.
git reset -q -- .env .env.* **/credentials.json 2>/dev/null || true

git add -A

# Unstage secrets if present.
git reset -q -- .env .env.* 2>/dev/null || true
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  case "$path" in
    *.pem|*.key|*credentials*.json|*secret*)
      git reset -q -- "$path" 2>/dev/null || true
      ;;
  esac
done < <(git diff --cached --name-only 2>/dev/null || true)

if git diff --cached --quiet && git diff --quiet; then
  # Still push if we are ahead of upstream.
  if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
    if [[ "$ahead" != 0 ]]; then
      git push
    fi
  fi
  exit 0
fi

# Nothing staged after secret filtering.
if git diff --cached --quiet; then
  exit 0
fi

summary="$(git diff --cached --name-only | head -n 5 | tr '\n' ' ')"
git commit -m "$(cat <<EOF
chore(zhp): auto-commit ${summary}

EOF
)" || exit 0

if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  git push
else
  git push -u origin HEAD
fi

exit 0
