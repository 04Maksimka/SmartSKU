#!/usr/bin/env bash
# PostToolUse hook: format + lint an edited Python file with the ruff of its uv project.
# Exit code 2 feeds remaining lint errors back to Claude.
file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[[ "$file" == *.py ]] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
case "$file" in
  "$root"/backend/*) project="$root/backend" ;;
  "$root"/emulator/*) project="$root/emulator" ;;
  *) exit 0 ;;
esac

cd "$project" || exit 0
uv run --quiet ruff format --quiet "$file" >/dev/null 2>&1
if ! output=$(uv run --quiet ruff check --fix --quiet "$file" 2>&1); then
  echo "ruff found issues in $file:" >&2
  echo "$output" >&2
  exit 2
fi
