#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

readonly APPLICATIONS_APP="/Applications/Superset.app"
readonly APP_SUPPORT="$HOME/Library/Application Support/Superset"
readonly SUPERSET_HOME="$HOME/.superset"
readonly APP_IDENTIFIER="com.superset.desktop"
readonly APP_SCHEME="superset"
readonly LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
readonly TIMESTAMP="$(/bin/date +%Y%m%d-%H%M%S)"
readonly STAGING_APP="/Applications/.Superset-Tauri-stage-${TIMESTAMP}.app"

TAURI_APP=""
BACKUP_ROOT=""
BACKUP_ELECTRON_APP=""
DRY_RUN=0
BACKUP_ONLY=0
SKIPPED_SOCKET_COUNT=0

usage() {
	cat <<'EOF'
Usage:
  install-personal-macos.sh --app /absolute/path/Superset.app --backup-dir /absolute/path/new-backup-directory [--dry-run] [--backup-only]

The backup directory must not exist and must be on the same volume as /Applications.
The script backs up ~/.superset except its top-level worktrees directory,
~/Library/Application Support/Superset, and Superset preferences. It moves the
Electron app into the backup directory and installs the supplied Tauri app.
With --backup-only, it copies the Electron app and data without installing Tauri.
EOF
}

fail() {
	printf 'Erro: %s\n' "$*" >&2
	exit 1
}

is_within() {
	[[ "$1" == "$2" || "$1" == "$2/"* ]]
}

absolute_path() {
	local input="$1"
	local parent
	local name
	[[ "$input" == /* ]] || fail "O caminho precisa ser absoluto: $input"
	[[ ! -L "$input" ]] || fail "Não aceito caminho que seja symlink: $input"
	parent="$(cd -P -- "$(/usr/bin/dirname "$input")" 2>/dev/null && pwd)" ||
		fail "Diretório pai não encontrado: $(/usr/bin/dirname "$input")"
	name="$(/usr/bin/basename "$input")"
	[[ "$name" != "." && "$name" != ".." ]] || fail "Caminho inválido: $input"
	printf '%s/%s\n' "$parent" "$name"
}

plist_value() {
	/usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null
}

verify_tauri_app() {
	local app="$1"
	local bundle_id
	local executable
	local url_types
	local signature
	[[ -d "$app" && ! -L "$app" && -f "$app/Contents/Info.plist" ]] || fail "Bundle .app inválido: $app"
	bundle_id="$(plist_value "$app" CFBundleIdentifier)" || fail "Não foi possível ler o bundle ID de $app"
	[[ "$bundle_id" == "$APP_IDENTIFIER" ]] || fail "Esperado bundle ID $APP_IDENTIFIER; encontrado $bundle_id"
	executable="$(plist_value "$app" CFBundleExecutable)" || fail "Executável ausente no Info.plist de $app"
	[[ -x "$app/Contents/MacOS/$executable" ]] || fail "Executável Tauri ausente em $app"
	[[ -x "$app/Contents/Resources/node/bin/node" && -f "$app/Contents/Resources/main/desktop-service.cjs" ]] ||
		fail "Recursos do runtime Tauri/Node ausentes em $app"
	[[ ! -e "$app/Contents/Resources/app.asar" && ! -d "$app/Contents/Frameworks/Electron Framework.framework" ]] ||
		fail "O bundle indicado ainda contém artefatos Electron: $app"
	url_types="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes' "$app/Contents/Info.plist" 2>/dev/null)" || fail "CFBundleURLTypes ausente em $app"
	printf '%s\n' "$url_types" | /usr/bin/grep -Eq "^[[:space:]]+${APP_SCHEME}$" ||
		fail "O bundle não registra o protocolo ${APP_SCHEME}://"
	/usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1 || fail "A verificação de assinatura ad hoc falhou em $app"
	signature="$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1)" || fail "Não foi possível inspecionar a assinatura de $app"
	printf '%s\n' "$signature" | /usr/bin/grep -Fxq "Identifier=$APP_IDENTIFIER" || fail "A assinatura não declara $APP_IDENTIFIER"
	printf '%s\n' "$signature" | /usr/bin/grep -Fxq 'Signature=adhoc' || fail "O bundle precisa de assinatura ad hoc local (codesign --sign -)"
}

verify_electron_app() {
	local bundle_id
	[[ -d "$APPLICATIONS_APP" && ! -L "$APPLICATIONS_APP" && -f "$APPLICATIONS_APP/Contents/Info.plist" ]] ||
		fail "Electron existente não encontrado em $APPLICATIONS_APP"
	bundle_id="$(plist_value "$APPLICATIONS_APP" CFBundleIdentifier)" || fail "Não foi possível ler o bundle ID do Electron"
	[[ "$bundle_id" == "$APP_IDENTIFIER" ]] || fail "O app existente usa um bundle ID inesperado: $bundle_id"
	[[ -d "$APPLICATIONS_APP/Contents/Frameworks/Electron Framework.framework" || -f "$APPLICATIONS_APP/Contents/Resources/app.asar" ]] ||
		fail "$APPLICATIONS_APP não parece ser o app Electron esperado"
}

check_open_files() {
	local path="$1"
	local recursive="$2"
	local errors
	local openers
	local status
	errors="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/superset-tauri-lsof.XXXXXX")" || fail "Não foi possível preparar a verificação de bloqueios"
	set +e
	if [[ "$recursive" == "yes" ]]; then
		openers="$(/usr/sbin/lsof -nP -t +D "$path" 2>"$errors")"
	else
		openers="$(/usr/sbin/lsof -nP -t "$path" 2>"$errors")"
	fi
	status=$?
	set -e
	if [[ -n "$openers" ]]; then
		/bin/rm -f "$errors"
		fail "Há processos com arquivos abertos em $path (PIDs: $(printf '%s' "$openers" | /usr/bin/tr '\n' ' ')); feche o Electron e os serviços antes de continuar"
	fi
	if [[ "$status" -gt 1 || -s "$errors" ]]; then
		local detail
		detail="$(/bin/cat "$errors" 2>/dev/null || true)"
		/bin/rm -f "$errors"
		fail "Não consegui verificar bloqueios em $path: ${detail:-lsof status $status}"
	fi
	/bin/rm -f "$errors"
}

check_profile_is_idle() {
	local snapshot
	local entry
	local name
	snapshot="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/superset-tauri-ps.XXXXXX")" || fail "Não foi possível preparar a verificação de processos"
	/bin/ps -axo pid=,command= > "$snapshot" || fail "Não foi possível listar processos"
	if /usr/bin/grep -Fq "$APPLICATIONS_APP/Contents/" "$snapshot"; then
		/bin/rm -f "$snapshot"
		fail "Ainda há um processo iniciado pelo Electron em $APPLICATIONS_APP. Encerre-o manualmente e tente de novo."
	fi
	/bin/rm -f "$snapshot"
	[[ ! -L "$SUPERSET_HOME" ]] || fail "$SUPERSET_HOME é um symlink; interrompendo por segurança"
	if [[ -d "$SUPERSET_HOME" ]]; then
		shopt -s dotglob nullglob
		for entry in "$SUPERSET_HOME"/*; do
			[[ -e "$entry" || -L "$entry" ]] || continue
			name="${entry##*/}"
			[[ "$name" == "worktrees" ]] && continue
			[[ ! -L "$entry" || ! -d "$entry" ]] || fail "Não consigo inspecionar com segurança o diretório symlink $entry"
			if [[ -d "$entry" ]]; then check_open_files "$entry" yes; else check_open_files "$entry" no; fi
		done
		shopt -u dotglob nullglob
	fi
	[[ ! -L "$APP_SUPPORT" ]] || fail "$APP_SUPPORT é um symlink; interrompendo por segurança"
	check_open_files "$APP_SUPPORT" yes
	if [[ -e "$HOME/Library/Preferences/com.superset.desktop.plist" ]]; then
		check_open_files "$HOME/Library/Preferences/com.superset.desktop.plist" no
	fi
}

size_kb() {
	local output
	output="$(/usr/bin/du -sk "$1" 2>/dev/null)" || fail "Não foi possível medir $1"
	printf '%s\n' "$output" | /usr/bin/awk 'NR == 1 { print $1; exit }'
}

superset_data_size_kb() {
	local total=0
	local entry
	local name
	if [[ -d "$SUPERSET_HOME" ]]; then
		[[ ! -L "$SUPERSET_HOME" ]] || fail "$SUPERSET_HOME é symlink; interrompendo por segurança"
		shopt -s dotglob nullglob
		for entry in "$SUPERSET_HOME"/*; do
			[[ -e "$entry" || -L "$entry" ]] || continue
			name="${entry##*/}"
			[[ "$name" == "worktrees" ]] && continue
			[[ ! -S "$entry" ]] || continue
			total=$((total + $(size_kb "$entry")))
		done
		shopt -u dotglob nullglob
	fi
	printf '%s\n' "$total"
}

copy_and_verify() {
	local source="$1"
	local destination="$2"
	local differences
	/usr/bin/ditto --rsrc --extattr --acl "$source" "$destination" || fail "Cópia falhou: $source"
	if [[ -d "$source" ]]; then
		differences="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/superset-tauri-diff.XXXXXX")" || fail "Não foi possível verificar o backup"
		if ! /usr/bin/diff -qr "$source" "$destination" > "$differences"; then
			/bin/cat "$differences" >&2
			/bin/rm -f "$differences"
			fail "Backup diferente da origem: $source"
		fi
		/bin/rm -f "$differences"
	else
		/usr/bin/cmp -s "$source" "$destination" || fail "Backup diferente da origem: $source"
	fi
}

backup_user_data() {
	local data="$BACKUP_ROOT/user-data"
	local entry
	local name
	/bin/mkdir -m 700 -p "$data/superset"
	if [[ -d "$SUPERSET_HOME" ]]; then
		shopt -s dotglob nullglob
		for entry in "$SUPERSET_HOME"/*; do
			[[ -e "$entry" || -L "$entry" ]] || continue
			name="${entry##*/}"
			[[ "$name" == "worktrees" ]] && continue
			if [[ -S "$entry" ]]; then
				SKIPPED_SOCKET_COUNT=$((SKIPPED_SOCKET_COUNT + 1))
				continue
			fi
			[[ ! -L "$entry" ]] || fail "Entrada symlink de perfil não copiada por segurança: $entry"
			copy_and_verify "$entry" "$data/superset/$name"
		done
		shopt -u dotglob nullglob
	fi
	[[ ! -e "$data/superset/worktrees" && ! -L "$data/superset/worktrees" ]] || fail "O backup incluiria ~/.superset/worktrees; interrompendo"
	if [[ -d "$APP_SUPPORT" ]]; then
		/bin/mkdir -m 700 -p "$data/application-support"
		copy_and_verify "$APP_SUPPORT" "$data/application-support/Superset"
	fi
	if [[ -f "$HOME/Library/Preferences/com.superset.desktop.plist" ]]; then
		/bin/mkdir -m 700 -p "$data/preferences"
		copy_and_verify "$HOME/Library/Preferences/com.superset.desktop.plist" "$data/preferences/com.superset.desktop.plist"
	fi
}

rollback() {
	local status=$?
	trap - EXIT INT TERM
	if [[ "$status" -ne 0 ]]; then
		printf 'Falha durante a troca; tentando restaurar o Electron.\n' >&2
		if [[ -n "$BACKUP_ELECTRON_APP" && ( -e "$BACKUP_ELECTRON_APP" || -L "$BACKUP_ELECTRON_APP" ) ]]; then
			if [[ -e "$APPLICATIONS_APP" || -L "$APPLICATIONS_APP" ]]; then
				local failed="$BACKUP_ROOT/failed-tauri-app/Superset.app"
				/bin/mkdir -m 700 -p "$(/usr/bin/dirname "$failed")"
				if ! /usr/bin/sudo /bin/mv "$APPLICATIONS_APP" "$failed"; then
					printf 'Não consegui preservar o Tauri com falha; app e backup do Electron estão em seus caminhos atuais.\n' >&2
					exit "$status"
				fi
			elif [[ -e "$STAGING_APP" || -L "$STAGING_APP" ]]; then
				local failed_stage="$BACKUP_ROOT/failed-tauri-stage.app"
				if ! /usr/bin/sudo /bin/mv "$STAGING_APP" "$failed_stage"; then
					printf 'Não consegui mover o estágio Tauri; Electron recuperável em %s\n' "$BACKUP_ELECTRON_APP" >&2
					exit "$status"
				fi
			fi
			if ! /usr/bin/sudo /bin/mv "$BACKUP_ELECTRON_APP" "$APPLICATIONS_APP"; then
				printf 'Restauração automática falhou; Electron recuperável em %s\n' "$BACKUP_ELECTRON_APP" >&2
			elif ! "$LSREGISTER" -f "$APPLICATIONS_APP"; then
				printf 'Electron restaurado, mas não consegui atualizá-lo no LaunchServices.\n' >&2
			fi
		elif [[ -n "$BACKUP_ROOT" && -e "$STAGING_APP" ]]; then
			local failed_stage="$BACKUP_ROOT/failed-tauri-stage.app"
			/bin/mkdir -m 700 -p "$BACKUP_ROOT"
			if ! /usr/bin/sudo /bin/mv "$STAGING_APP" "$failed_stage"; then
				printf 'Não consegui mover o estágio Tauri; ele permanece em %s\n' "$STAGING_APP" >&2
				exit "$status"
			fi
		fi
	fi
	exit "$status"
}

while (($#)); do
	case "$1" in
		--app) (($# >= 2)) || { usage >&2; exit 2; }; TAURI_APP="$2"; shift 2 ;;
		--backup-dir) (($# >= 2)) || { usage >&2; exit 2; }; BACKUP_ROOT="$2"; shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		--backup-only) BACKUP_ONLY=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) usage >&2; exit 2 ;;
	esac
done

[[ "$(/usr/bin/uname -s)" == "Darwin" ]] || fail "Este script só funciona no macOS"
[[ -x "$LSREGISTER" ]] || fail "Ferramenta LaunchServices não encontrada: $LSREGISTER"
[[ "$EUID" -ne 0 ]] || fail "Execute como usuário normal no Terminal; sudo será usado apenas após confirmação"
[[ -n "$TAURI_APP" && -n "$BACKUP_ROOT" ]] || { usage >&2; exit 2; }
TAURI_APP="$(absolute_path "$TAURI_APP")"
BACKUP_ROOT="$(absolute_path "$BACKUP_ROOT")"
[[ -d "$TAURI_APP" && "$TAURI_APP" == *.app ]] || fail "Informe um bundle .app Tauri existente"
[[ ! -e "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT" ]] || fail "O destino de backup já existe: $BACKUP_ROOT"
BACKUP_PARENT="$(/usr/bin/dirname "$BACKUP_ROOT")"
[[ -d "$BACKUP_PARENT" && -w "$BACKUP_PARENT" ]] || fail "O diretório pai do backup deve existir e permitir escrita"
is_within "$BACKUP_ROOT" "$SUPERSET_HOME" && fail "O backup não pode ficar dentro de ~/.superset"
is_within "$BACKUP_ROOT" "$APP_SUPPORT" && fail "O backup não pode ficar dentro do perfil Electron"
is_within "$BACKUP_ROOT" "/Applications" && fail "O backup não pode ficar dentro de /Applications"
is_within "$BACKUP_ROOT" "$TAURI_APP" && fail "O backup não pode ficar dentro do app Tauri"
is_within "$TAURI_APP" "$BACKUP_ROOT" && fail "O app Tauri não pode ficar dentro do backup"
verify_electron_app
verify_tauri_app "$TAURI_APP"
check_profile_is_idle
if [[ "$BACKUP_ONLY" -eq 0 ]]; then
	[[ ! -e "$STAGING_APP" && ! -L "$STAGING_APP" ]] || fail "O caminho de estágio já existe: $STAGING_APP"
fi
BACKUP_ELECTRON_APP="$BACKUP_ROOT/electron-app/Superset.app"
backup_volume="$(/usr/bin/stat -f '%d' "$BACKUP_PARENT")" || fail "Não foi possível identificar o volume do backup"
[[ "$backup_volume" == "$(/usr/bin/stat -f '%d' /Applications)" ]] ||
	fail "Use um backup novo no mesmo volume de /Applications (por exemplo, em ~/Documents) para mover o Electron sem uma segunda cópia."

profile_kb="$(superset_data_size_kb)"
support_kb=0
[[ ! -d "$APP_SUPPORT" ]] || support_kb="$(size_kb "$APP_SUPPORT")"
preferences_kb=0
[[ ! -f "$HOME/Library/Preferences/com.superset.desktop.plist" ]] || preferences_kb="$(size_kb "$HOME/Library/Preferences/com.superset.desktop.plist")"
tauri_kb="$(size_kb "$TAURI_APP")"
extra_kb="$tauri_kb"
if [[ "$BACKUP_ONLY" -eq 1 ]]; then
	electron_kb="$(size_kb "$APPLICATIONS_APP")"
	extra_kb="$electron_kb"
fi
free_kb="$(/bin/df -Pk /Applications | /usr/bin/awk 'END { print $4 }')"
required_kb=$((profile_kb + support_kb + preferences_kb + extra_kb + 1024 * 1024))
((free_kb >= required_kb)) || fail "Espaço insuficiente: ${free_kb} KiB livres; estimados ${required_kb} KiB incluindo margem de 1 GiB."

printf 'Tauri validado: %s\n' "$TAURI_APP"
printf 'Electron atual: %s\n' "$APPLICATIONS_APP"
printf 'Backup durável: %s (modo 0700; ~/.superset/worktrees fica intacta)\n' "$BACKUP_ROOT"
if [[ "$BACKUP_ONLY" -eq 1 ]]; then
	printf 'Modo backup somente: %s KiB de dados + %s KiB do Electron; nenhum app será trocado.\n' "$((profile_kb + support_kb + preferences_kb))" "$electron_kb"
else
	printf 'Espaço estimado: %s KiB de backup de dados + %s KiB para o estágio Tauri.\n' "$((profile_kb + support_kb + preferences_kb))" "$tauri_kb"
fi
if [[ "$DRY_RUN" -eq 1 ]]; then
	printf 'Dry run concluído: nenhuma cópia, troca de app ou chamada sudo foi executada.\n'
	exit 0
fi
[[ -t 0 ]] || fail "A operação exige um Terminal interativo"
if [[ "$BACKUP_ONLY" -eq 1 ]]; then
	printf 'Confirme que encerrou o Electron. Digite BACKUP /Applications/Superset.app para continuar:\n> '
else
	printf 'Confirme que encerrou o Electron. Digite REPLACE /Applications/Superset.app para continuar:\n> '
fi
IFS= read -r confirmation
if [[ "$BACKUP_ONLY" -eq 1 ]]; then
	[[ "$confirmation" == 'BACKUP /Applications/Superset.app' ]] || fail "Confirmação incorreta; nenhuma mudança foi feita"
else
	[[ "$confirmation" == 'REPLACE /Applications/Superset.app' ]] || fail "Confirmação incorreta; nenhuma mudança foi feita"
fi

if [[ "$BACKUP_ONLY" -eq 0 ]]; then
	trap rollback EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM
	/usr/bin/sudo -v
fi
/bin/mkdir -m 700 "$BACKUP_ROOT"
/bin/mkdir -m 700 -p "$BACKUP_ROOT/electron-app"
{
	printf 'status=backup-in-progress\ncreated=%s\nelectron_original=%s\nelectron_backup=%s\ntauri_source=%s\nsuperset_home=%s\nsuperset_worktrees=excluded-and-left-in-place\napp_support=%s\n' \
		"$TIMESTAMP" "$APPLICATIONS_APP" "$BACKUP_ELECTRON_APP" "$TAURI_APP" "$SUPERSET_HOME" "$APP_SUPPORT"
} > "$BACKUP_ROOT/manifest.txt"
/bin/chmod 600 "$BACKUP_ROOT/manifest.txt"
printf 'superset_socket_nodes=excluded\n' >> "$BACKUP_ROOT/manifest.txt"
backup_user_data
if [[ "$BACKUP_ONLY" -eq 1 ]]; then
	copy_and_verify "$APPLICATIONS_APP" "$BACKUP_ELECTRON_APP"
	check_profile_is_idle
	printf 'status=backup-complete\ncreated=%s\nelectron_original=%s\nelectron_backup=%s\ntauri_source=%s\nprofile_data_backup=%s/user-data\nsuperset_worktrees=preserved-at-%s/worktrees\nsuperset_socket_nodes_skipped=%s\n' \
		"$TIMESTAMP" "$APPLICATIONS_APP" "$BACKUP_ELECTRON_APP" "$TAURI_APP" "$BACKUP_ROOT" "$SUPERSET_HOME" "$SKIPPED_SOCKET_COUNT" > "$BACKUP_ROOT/manifest.txt"
	/bin/chmod 600 "$BACKUP_ROOT/manifest.txt"
	printf 'Backup concluído; /Applications/Superset.app não foi alterado.\nBackup: %s\n' "$BACKUP_ROOT"
	exit 0
fi
/usr/bin/sudo /usr/bin/ditto --rsrc --extattr --acl "$TAURI_APP" "$STAGING_APP" || fail "Não foi possível preparar o Tauri em $STAGING_APP"
verify_tauri_app "$STAGING_APP"
check_profile_is_idle

/usr/bin/sudo /bin/mv "$APPLICATIONS_APP" "$BACKUP_ELECTRON_APP"
/usr/bin/sudo /bin/mv "$STAGING_APP" "$APPLICATIONS_APP"
verify_tauri_app "$APPLICATIONS_APP"
"$LSREGISTER" -f "$APPLICATIONS_APP" || fail "Não consegui registrar o app no LaunchServices"
{
	printf 'status=installed\ncompleted=%s\ntauri_installed=%s\nelectron_backup=%s\nprofile_data_backup=%s/user-data\nsuperset_worktrees=preserved-at-%s/worktrees\n' \
		"$TIMESTAMP" "$APPLICATIONS_APP" "$BACKUP_ELECTRON_APP" "$BACKUP_ROOT" "$SUPERSET_HOME"
} > "$BACKUP_ROOT/manifest.txt"
printf 'superset_socket_nodes_skipped=%s\n' "$SKIPPED_SOCKET_COUNT" >> "$BACKUP_ROOT/manifest.txt"
/bin/chmod 600 "$BACKUP_ROOT/manifest.txt"
trap - EXIT INT TERM
printf 'Instalação concluída. Electron recuperável em: %s\n' "$BACKUP_ELECTRON_APP"
printf 'Backup dos dados em: %s/user-data\n' "$BACKUP_ROOT"
