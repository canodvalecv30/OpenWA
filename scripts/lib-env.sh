#!/usr/bin/env bash
# shellcheck shell=bash
#
# Shared configuration resolution for backup.sh and restore.sh.
#
# The application fills its configuration from three layers (src/config/load-env.ts), each supplying
# only what the previous one left unset:
#
#   1. the process environment
#   2. ./.env
#   3. <data dir>/.env.generated   — written by Dashboard > Infrastructure
#
# These scripts used to read layer 1 only, so an install configured through the dashboard was backed
# up at the DEFAULT paths. That is not reliably loud: a missing database fails the run, but a
# database left at a default path from BEFORE the operator switched is archived instead, and the run
# exits 0. A backup that captured an abandoned database only reveals itself during a restore.
#
# Deliberately conservative: only the `KEY=value` forms dotenv reads plainly are honoured. Blanks
# around the `=` and the value, CRLF line endings, a value wrapped in one pair of quotes and a comment
# after an unquoted value are read as dotenv reads them. Anything else (a quoted value followed by a
# comment, a double-quoted value with escapes, a `KEY: value` line) is reported rather than guessed
# at, because a silently mis-parsed path is the exact failure this exists to prevent. Nothing here
# exports anything: each key is looked up by name, so a stray entry in an operator's .env can never
# reach the script's own environment.

# openwa_env_file_value <file> <key> - print the value from one env-file layer. Returns 1 when the layer
# does not set the key and 2 when it sets it in a form reported below; a blank value succeeds and prints
# nothing.
openwa_env_file_value() {
  local file="$1" key="$2" line value
  [ -f "$file" ] || return 1
  # The last line naming the key wins, as in dotenv. `KEY: value` is matched only to be reported.
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*[=:]" "$file" 2>/dev/null | tail -n 1)" || true
  [ -n "$line" ] || return 1
  value="${line#*"$key"}"
  value="${value#"${value%%[![:space:]]*}"}"
  case "$value" in
    =*)
      value="${value#=}"
      # Trim both ends, which also drops the CR of a CRLF line.
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      case "$value" in
        \"*\\*) ;; # dotenv expands \n and \r inside double quotes
        \"*\" | \'*\' | \`*\`)
          # A quote inside means the pair does not wrap the whole value: a comment ending in one follows it.
          case "${value:1:${#value}-2}" in
            *"${value:0:1}"*) ;;
            *)
              printf '%s' "${value:1:${#value}-2}"
              return 0
              ;;
          esac
          ;;
        \"* | \'* | \`*) ;; # the quote does not close the value, as with a trailing comment
        *)
          # An unquoted value ends at a `#`, as in dotenv.
          value="${value%%#*}"
          printf '%s' "${value%"${value##*[![:space:]]}"}"
          return 0
          ;;
      esac
      ;;
  esac
  echo "[config] WARN: $file sets $key in a form these scripts do not parse (a quoted value with a trailing" >&2
  echo "[config]       comment or escapes, or KEY: value); using the default. Pass $key in the environment if it matters here." >&2
  return 2
}

# openwa_writable <path> - whether <path> can be written, or created when it does not exist yet (its
# nearest existing ancestor is then the directory that has to take it).
openwa_writable() {
  local p="$1"
  if [ -e "$p" ]; then
    [ -w "$p" ]
    return
  fi
  while [ ! -e "$p" ]; do p="$(dirname "$p")"; done
  [ -d "$p" ] && [ -w "$p" ]
}

# openwa_media_dir - STORAGE_LOCAL_PATH as the app settles it (src/config/storage-root.ts). v0.2.0 to
# v0.7.3 persisted ./uploads into .env.generated; where that cannot be created, as under the image's
# root-owned /app, the app keeps media in ./data/media instead, so the scripts have to look there too.
# Writability alone cannot tell: `docker exec` runs these as root, which can create /app/uploads while
# the app's own user cannot. The app creates a ./uploads it uses at boot, so a missing one beside an
# existing ./data/media means ./data/media is in use.
openwa_media_dir() {
  local dir
  dir="$(openwa_resolve STORAGE_LOCAL_PATH "$DATA_DIR/media")"
  case "$dir" in
    ./uploads | uploads)
      if ! openwa_writable "$dir" || { [ ! -d "$dir" ] && [ -d ./data/media ]; }; then
        echo "[config] WARN: STORAGE_LOCAL_PATH=$dir is a leftover the app does not use here, so it keeps" >&2
        echo "[config]       media in ./data/media; using that. Remove the line from .env.generated." >&2
        dir=./data/media
      fi
      ;;
  esac
  printf '%s' "$dir"
}

# Layer 3. Set here rather than read from the environment, so it can never arrive from an operator's
# shell; restore.sh points it at the archive's copy, which replaces this file during the restore.
OPENWA_GENERATED_ENV="${DATA_DIR:-./data}/.env.generated"

# openwa_resolve <key> <default> - the application's precedence: environment, then ./.env, then
# $OPENWA_GENERATED_ENV, then the built-in default. Requires DATA_DIR to be set before sourcing.
openwa_resolve() {
  local key="$1" fallback="$2" current value layer rc
  current="$(printenv "$key" 2>/dev/null || true)"
  if [ -n "$current" ]; then
    printf '%s' "$current"
    return 0
  fi
  # The first layer that sets the key ends the lookup, even with a blank value: dotenv sets a blank
  # line to '' and never overwrites a key already set, so the app reads its built-in default. A line
  # these scripts cannot parse still sets the key for the app, so it ends the lookup too.
  for layer in "./.env" "$OPENWA_GENERATED_ENV"; do
    rc=0
    value="$(openwa_env_file_value "$layer" "$key")" || rc=$?
    case "$rc" in
      0)
        printf '%s' "${value:-$fallback}"
        return 0
        ;;
      2)
        printf '%s' "$fallback"
        return 0
        ;;
    esac
  done
  printf '%s' "$fallback"
}
