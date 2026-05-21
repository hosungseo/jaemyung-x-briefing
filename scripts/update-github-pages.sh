#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$ROOT"

git pull --ff-only >/dev/null

node scripts/build-data.js
node scripts/link-policy-press.js

git add data reports

if git diff --cached --quiet; then
  echo "no GitHub Pages data changes"
  exit 0
fi

commit_subject="Update X briefing data $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST')"
git commit -m "$commit_subject"
git push

echo "$commit_subject"
