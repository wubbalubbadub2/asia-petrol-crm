#!/usr/bin/env bash
# PreToolUse guard: migrations are append-only.
# Blocks Edit/Write to any file under supabase/migrations/ that already
# exists in HEAD (i.e. a committed — and therefore possibly applied —
# migration). New, not-yet-committed migration files are allowed.
#
# Exit codes: 0 = allow; 2 = block (stderr is shown to Claude).
# Any other failure falls through to exit 0 (fail-open) so a broken
# environment never blocks unrelated edits.
#
# Disable: remove the PreToolUse entry from .claude/settings.json.
set -uo pipefail

input=$(cat) || exit 0
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[[ -z "$file_path" ]] && exit 0

case "$file_path" in
  *supabase/migrations/*) ;;
  *) exit 0 ;;
esac

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
rel=${file_path#"$repo_root"/}

if git -C "$repo_root" rev-parse -q --verify "HEAD:$rel" >/dev/null 2>&1; then
  echo "Blocked: $rel is a committed migration and migrations are append-only. Create a new supabase/migrations/NNNNN_slug.sql instead (see .claude/rules/database.md)." >&2
  exit 2
fi

exit 0
