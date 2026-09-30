#!/usr/bin/env bash
set -euo pipefail

APPLICATIONS_DIR="/Applications"
APPLICATIONS_APP="$APPLICATIONS_DIR/Superset.app"
LOCK_DIR="/tmp/superset-install-and-restart-$(id -u).lock"
PROCESS_PATTERN="^${APPLICATIONS_DIR}/Superset[.]app/Contents/"
MAIN_PROCESS_PATTERN="${PROCESS_PATTERN}MacOS/Superset([[:space:]]|$)"
PLIST_BUDDY="/usr/libexec/PlistBuddy"

validate_bundle() {
  local bundle="$1"
  local identifier executable
  identifier="$("$PLIST_BUDDY" -c 'Print :CFBundleIdentifier' "$bundle/Contents/Info.plist")"
  executable="$("$PLIST_BUDDY" -c 'Print :CFBundleExecutable' "$bundle/Contents/Info.plist")"
  if [ "$identifier" != "com.superset.desktop" ] || [ "$executable" != "Superset" ] || [ ! -x "$bundle/Contents/MacOS/Superset" ]; then
    echo "Bundle inválido: $bundle" >&2
    return 1
  fi
}

app_running() {
  local status=0
  pgrep -f "$1" >/dev/null || status=$?
  case "$status" in
    0) return 0 ;;
    1) return 1 ;;
    *) echo "Não foi possível consultar os processos do Superset." >&2; return 2 ;;
  esac
}

wait_for_exit() {
  local timeout="$1" attempt status
  for ((attempt = 0; attempt <= timeout; attempt++)); do
    if app_running "$PROCESS_PATTERN"; then
      status=0
    else
      status=$?
    fi
    case "$status" in
      1) return 0 ;;
      2) return 2 ;;
    esac
    if [ "$attempt" -eq "$timeout" ]; then return 1; fi
    sleep 1
  done
}

signal_app() {
  local status=0
  pkill "-$1" -f "$PROCESS_PATTERN" || status=$?
  [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
}

stop_app() {
  local status
  if app_running "$PROCESS_PATTERN"; then
    status=0
  else
    status=$?
    if [ "$status" -eq 1 ]; then return 0; fi
    return "$status"
  fi
  echo "Fechando $APPLICATIONS_APP..."
  osascript -e "with timeout of 20 seconds" -e "tell application \"$APPLICATIONS_APP\" to quit" -e "end timeout" &
  local quit_pid=$! stopped=false
  if wait_for_exit 20; then stopped=true; else status=$?; fi
  kill "$quit_pid" 2>/dev/null || true
  wait "$quit_pid" 2>/dev/null || true
  if [ "$stopped" = true ]; then return 0; fi
  if [ "$status" -ne 1 ]; then return "$status"; fi
  echo "Prazo excedido; encerrando os processos da instalação com SIGTERM."
  signal_app TERM || return $?
  if wait_for_exit 5; then return 0; else status=$?; fi
  if [ "$status" -ne 1 ]; then return "$status"; fi
  echo "Encerrando os processos restantes com SIGKILL."
  signal_app KILL || return $?
  if ! wait_for_exit 5; then
    echo "O aplicativo continua aberto; a instalação não será substituída." >&2
    return 1
  fi
}

start_app() {
  open "$APPLICATIONS_APP" || return $?
  local attempt status
  for ((attempt = 0; attempt < 10; attempt++)); do
    if app_running "$MAIN_PROCESS_PATTERN"; then return 0; else status=$?; fi
    if [ "$status" -ne 1 ]; then return "$status"; fi
    sleep 1
  done
  echo "O aplicativo não iniciou em 10 segundos." >&2
  return 1
}

finish_install() {
  STAGING_DIR="$1"
  JOB_LABEL="$2"
  NEW_INSTALLED=false
  COMPLETED=false

  case "$STAGING_DIR" in
    "$APPLICATIONS_DIR"/.superset-install.*) ;;
    *) echo "Diretório de instalação inválido." >&2; exit 2 ;;
  esac
  if [ ! -d "$LOCK_DIR" ] || [ -L "$STAGING_DIR" ]; then
    echo "Instalação sem bloqueio ou diretório inválido." >&2
    exit 1
  fi

  cleanup_install() {
    local status="$?"
    trap - EXIT INT TERM HUP
    set +e
    if [ "$COMPLETED" != true ]; then
      echo "Instalação interrompida; restaurando a versão anterior." >&2
      if [ "$NEW_INSTALLED" = true ]; then
        if stop_app; then
          rm -rf "$APPLICATIONS_APP"
        else
          echo "Não foi possível remover a nova instalação com o app aberto." >&2
        fi
      fi
      if [ -d "$STAGING_DIR/previous.app" ]; then
        if [ ! -e "$APPLICATIONS_APP" ] && mv "$STAGING_DIR/previous.app" "$APPLICATIONS_APP"; then
          start_app || echo "Versão anterior restaurada; abra $APPLICATIONS_APP manualmente." >&2
        else
          echo "A versão anterior foi preservada em $STAGING_DIR/previous.app" >&2
        fi
      elif [ -d "$APPLICATIONS_APP" ]; then
        start_app || true
      fi
      if [ "$status" -eq 0 ]; then status=1; fi
    fi
    if [ ! -d "$STAGING_DIR/previous.app" ] || [ "$COMPLETED" = true ]; then
      rm -rf "$STAGING_DIR"
    fi
    rmdir "$LOCK_DIR"
    echo "Instalação finalizada com status $status."
    launchctl remove "$JOB_LABEL" >/dev/null 2>&1 || true
    exit "$status"
  }

  trap cleanup_install EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP

  validate_bundle "$STAGING_DIR/Superset.app"
  stop_app
  if [ -e "$APPLICATIONS_APP" ]; then
    mv "$APPLICATIONS_APP" "$STAGING_DIR/previous.app"
  fi
  mv "$STAGING_DIR/Superset.app" "$APPLICATIONS_APP"
  NEW_INSTALLED=true
  echo "Nova versão instalada. Abrindo $APPLICATIONS_APP..."
  start_app
  COMPLETED=true
  echo "Superset instalado e reiniciado."
}

if [ "${1:-}" = "--finish-install" ] && [ "$#" -eq 3 ]; then
  finish_install "$2" "$3"
  exit 0
fi

if [ "$#" -ne 0 ]; then
  echo "Uso: bash scripts/install-and-restart.sh" >&2
  exit 2
fi
if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "Este script requer macOS Apple Silicon." >&2
  exit 1
fi
for tool in bun ditto launchctl osascript open pgrep pkill; do
  if ! command -v "$tool" >/dev/null; then
    echo "Comando necessário não encontrado: $tool" >&2
    exit 1
  fi
done
if [ ! -w "$APPLICATIONS_DIR" ] || [ -L "$APPLICATIONS_APP" ]; then
  echo "O destino precisa ser gravável e não pode ser um link: $APPLICATIONS_APP" >&2
  exit 1
fi
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Outra instalação pode estar em andamento. Bloqueio: $LOCK_DIR" >&2
  exit 1
fi

STAGING_DIR=""
RUN_DIR=""
HANDED_OFF=false
cleanup_build() {
  if [ "$HANDED_OFF" != true ]; then
    if [ -n "$STAGING_DIR" ]; then rm -rf "$STAGING_DIR"; fi
    if [ -n "$RUN_DIR" ]; then rm -rf "$RUN_DIR"; fi
    rmdir "$LOCK_DIR"
  fi
}
trap cleanup_build EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_BUNDLE="$SCRIPT_DIR/../apps/desktop/release/mac-arm64/Superset.app"
bash "$SCRIPT_DIR/build-local-desktop-release.sh" --build-only
validate_bundle "$APP_BUNDLE"
STAGING_DIR="$(mktemp -d "$APPLICATIONS_DIR/.superset-install.XXXXXX")"
ditto "$APP_BUNDLE" "$STAGING_DIR/Superset.app"
validate_bundle "$STAGING_DIR/Superset.app"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/superset-install-and-restart.XXXXXX")"
cp "$SCRIPT_DIR/install-and-restart.sh" "$RUN_DIR/worker.sh"
LOG_FILE="$RUN_DIR/install.log"
JOB_LABEL="com.superset.local-install.$(basename "$RUN_DIR")"

echo "Build concluída. A troca e o reinício continuarão fora deste terminal."
echo "Log: $LOG_FILE"
launchctl submit -l "$JOB_LABEL" -o "$LOG_FILE" -e "$LOG_FILE" -- /bin/bash "$RUN_DIR/worker.sh" --finish-install "$STAGING_DIR" "$JOB_LABEL"
HANDED_OFF=true
