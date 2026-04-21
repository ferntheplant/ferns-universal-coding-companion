#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_PATH="${SCRIPT_DIR}/manifest.json"
PI_AGENT_DIR="${HOME}/.pi/agent"

fail() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found on PATH: $1"
}

json_query_lines() {
  local expr="$1"
  python3 - "$MANIFEST_PATH" "$expr" <<'PY'
import json
import sys

manifest_path = sys.argv[1]
expr = sys.argv[2]

with open(manifest_path, "r", encoding="utf-8") as f:
    data = json.load(f)

def print_list(value):
    if value is None:
        return
    if isinstance(value, list):
        for item in value:
            if item is not None:
                print(str(item))
        return
    print(str(value))

if expr == "settings":
    print_list(data.get("settings"))
elif expr == "extensions":
    print_list(data.get("extensions"))
elif expr == "skills":
    print_list(data.get("skills"))
elif expr == "packages":
    print_list(data.get("packages"))
elif expr == "themes_type":
    val = data.get("themes")
    if isinstance(val, list):
        print("array")
    elif isinstance(val, str):
        print("string")
    elif val is None:
        print("none")
    else:
        print("other")
elif expr == "themes":
    print_list(data.get("themes"))
else:
    raise SystemExit(f"unknown query: {expr}")
PY
}

resolve_abs_path() {
  local rel="$1"
  if [[ "$rel" = /* ]]; then
    echo "$rel"
  else
    echo "${SCRIPT_DIR}/${rel}"
  fi
}

force_link() {
  local src="$1"
  local dst="$2"

  rm -rf "$dst"
  ln -s "$src" "$dst"
  echo "linked: $dst -> $src"
}

link_array_entries() {
  local key_name="$1"
  local target_dir="$2"

  mkdir -p "$target_dir"

  local entry matched found
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    found=0

    if [[ "$entry" == *"*"* || "$entry" == *"?"* || "$entry" == *"["* ]]; then
      shopt -s nullglob
      for matched in "${SCRIPT_DIR}"/$entry; do
        found=1
        force_link "$matched" "${target_dir}/$(basename "$matched")"
      done
      shopt -u nullglob
      [[ $found -eq 1 ]] || fail "${key_name} entry matched nothing: $entry"
    else
      matched="$(resolve_abs_path "$entry")"
      [[ -e "$matched" ]] || fail "${key_name} entry does not exist: $entry"
      force_link "$matched" "${target_dir}/$(basename "$matched")"
    fi
  done < <(json_query_lines "$key_name")
}

[[ -f "$MANIFEST_PATH" ]] || fail "manifest not found: $MANIFEST_PATH"
require_cmd "pi"
require_cmd "python3"

mkdir -p "$PI_AGENT_DIR"

SETTINGS_REL="$(json_query_lines settings | head -n1 || true)"
if [[ -n "${SETTINGS_REL}" ]]; then
  SETTINGS_SRC="$(resolve_abs_path "$SETTINGS_REL")"
  [[ -e "$SETTINGS_SRC" ]] || fail "settings path does not exist: $SETTINGS_REL"
  force_link "$SETTINGS_SRC" "${PI_AGENT_DIR}/settings.json"
fi

link_array_entries "extensions" "${PI_AGENT_DIR}/extensions"
link_array_entries "skills" "${PI_AGENT_DIR}/skills"

THEMES_TYPE="$(json_query_lines themes_type | head -n1 || true)"
case "$THEMES_TYPE" in
  none)
    ;;
  string)
    THEME_REL="$(json_query_lines themes | head -n1 || true)"
    [[ -n "$THEME_REL" ]] || fail "themes is string type but empty"
    THEME_SRC="$(resolve_abs_path "$THEME_REL")"
    [[ -e "$THEME_SRC" ]] || fail "themes path does not exist: $THEME_REL"
    force_link "$THEME_SRC" "${PI_AGENT_DIR}/themes"
    ;;
  array)
    link_array_entries "themes" "${PI_AGENT_DIR}/themes"
    ;;
  *)
    fail "themes must be a string path, array of paths/globs, or omitted"
    ;;
esac

while IFS= read -r package; do
  [[ -z "$package" ]] && continue
  echo "installing package: $package"
  pi install "$package"
done < <(json_query_lines "packages")

echo "install complete"
