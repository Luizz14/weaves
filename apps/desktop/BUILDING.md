# Development

Run the dev server without env validation or auth:

```bash
SKIP_ENV_VALIDATION=1 bun run dev
```

This skips environment variable validation and the sign-in screen. Desktop chat also falls back to local-only session bootstrap in this mode, so you can test chat/streaming without the cloud API as long as you have local model credentials configured.

The Tauri dev wrapper derives `devUrl` from `DESKTOP_VITE_PORT` and writes an
ignored workspace config. Set `SUPERSET_WORKSPACE_ID` when running multiple
worktrees so their development bundle identity and CEF profile stay isolated.

For packaged CEF/Tauri QA, configure the existing API `NEXT_PUBLIC_DESKTOP_URL`
trusted-origin value for `https://tauri.localhost` (alongside any local
development origin). Do not disable CORS or browser web security to work around
the packaged origin.

Unsigned packaged QA must use a unique `TAURI_QA_PROFILE` slug. The build then
uses a separate bundle identifier, product name, updater fixture key, and a
workspace-specific deep-link registration; it will not point its updater at
the production feed. Set the same `SUPERSET_WORKSPACE_NAME`,
`SUPERSET_PRODUCT_NAME`, `SUPERSET_WORKSPACE_ID`, and explicit
`SUPERSET_HOME_DIR` at build and launch time so CEF and app-data profiles stay
separate from stable. With the default `tauri-qa-<slug>` workspace name, the
registered scheme is `superset-tauri-qa-<slug>`.

# Release

When building for release, use Node 24.15.0 for the target architecture and
run `bun run prepare:runtime` before `bun run tauri:build`. Native modules are
copied into the private sidecar tree; no shared workspace Electron rebuild is
used.

The release workflow provisions the pinned Rust toolchain, CMake, Ninja, and
CEF cache. It sets `TAURI_RELEASE_CHANNEL` to `stable` or `canary`; local builds
default to stable. Canary is a separate installation (`Superset Canary`) with
its own bundle identifier, CEF profile, icon, deep-link scheme, and updater
feed. The updater feed for each channel is signed with the release-time
`TAURI_SIGNING_PRIVATE_KEY` and verified against `TAURI_UPDATER_PUBKEY`; CI
fails if either is missing. Do not generate or commit production signing keys.

`TAURI_CLI_BINARY`, `NODE_RUNTIME_BINARY`, `NPM_BINARY`, `CEF_PATH`,
`TARGET_ARCH`, and `TARGET_PLATFORM` are local/CI build-tool inputs. The CLI
override is checked against the exact version in `src-tauri/runtime.json`, and
the Node override must be Node 24.15.0. They do not configure production
runtime behavior.

# macOS local build

Packaged macOS builds require macOS 13.5 or newer because the bundled Node runtime
and native modules require 13.5 (CEF itself requires 13.0). Tauri's `bundle.macOS.minimumSystemVersion`
sets `LSMinimumSystemVersion` and Cargo's deployment target; release CI sets the
same `MACOSX_DEPLOYMENT_TARGET` explicitly.

From `apps/desktop`:

```bash
bun run clean:dev
NEXT_PUBLIC_API_URL=http://localhost:3001 \
SUPERSET_WORKSPACE_NAME=tauri-qa-ex18vx \
NODE_ENV=development \
bun run compile:app
bun run prepare:runtime
TAURI_QA_PROFILE=Ex18vx \
SUPERSET_WORKSPACE_ID=tauri-qa-Ex18vx \
SUPERSET_WORKSPACE_NAME=tauri-qa-Ex18vx \
SUPERSET_PRODUCT_NAME="Superset QA Ex18vx" \
SUPERSET_HOME_DIR=/private/tmp/superset-tauri-qa.Ex18vx/superset-home \
TAURI_ALLOW_UNSIGNED_UPDATER=1 \
CARGO_INCREMENTAL=0 \
bun run tauri:build -- --debug --no-sign --ci
```

This explicit local-only mode uses Tauri's documented fixture public key and
does not create updater artifacts. This exact QA profile creates the isolated
bundle ID `com.superset.desktop.qa.ex18vx`, product `Superset QA Ex18vx`, and
deep-link scheme `superset-tauri-qa-ex18vx`. Do not launch a stable-identity or
other workspace's bundle against this QA profile. The renderer is built against
the local API and includes the local-admin development sign-in button. Do not
set `SKIP_ENV_VALIDATION` for this fixture, because that bypasses the sign-in
screen. Release builds must provide the real
`TAURI_UPDATER_PUBKEY` and `TAURI_SIGNING_PRIVATE_KEY` instead. Do not launch
an unsigned QA bundle with the stable product/profile variables.

## QA build outputs and cleanup

For repeated local QA, `CARGO_INCREMENTAL=0` avoids accumulating large Rust
incremental caches. Keep one active build target and the latest usable QA app;
remove superseded generated bundles only after stopping their processes. Old
`target/debug/incremental` data can be regenerated, but remove it only when no
Cargo process uses that target. Preserve runtime sources, patches, toolchains,
test evidence and application profiles when cleaning build output.

Expected outputs in `apps/desktop/src-tauri/target/**/bundle/macos/`:

- `*.app`
- `*.dmg`
- signed updater archive/signature when updater keys are provided

## Personal macOS replacement (local only)

Use this mode only to replace the Electron app on this Mac. It keeps the stable
bundle ID `com.superset.desktop`, product name `Superset`, and `superset://`
handler, reuses the normal Superset data paths, disables updater checks, and
does not generate updater artifacts. It is not a distribution build. Set the
mode for both the Vite compile and Tauri package so the Node and Rust updater
guards are embedded in the app. The build wrapper clears workspace-specific
`SUPERSET_*` values and distribution updater/signing keys loaded from `.env`;
keep the explicit `env -u` list below so the Vite compile and launch also use
the default personal profile. The Vite compile forces the production
API/service origins despite local `.env` values and skips Sentry source-map
uploads for this personal build.

From `apps/desktop`:

```bash
env -u NODE_ENV \
  -u DESKTOP_VITE_PORT \
  -u SUPERSET_WORKSPACE_ID \
  -u SUPERSET_WORKSPACE_NAME \
  -u SUPERSET_PRODUCT_NAME \
  -u SUPERSET_HOME_DIR \
  TAURI_PERSONAL_INSTALL=1 \
  NODE_ENV=production \
  bun run compile:app
env -u NODE_ENV \
  -u DESKTOP_VITE_PORT \
  -u SUPERSET_WORKSPACE_ID \
  -u SUPERSET_WORKSPACE_NAME \
  -u SUPERSET_PRODUCT_NAME \
  -u SUPERSET_HOME_DIR \
  TAURI_PERSONAL_INSTALL=1 \
  NODE_ENV=production \
  NODE_RUNTIME_BINARY="$(node -p 'process.execPath')" \
  NPM_BINARY="$(dirname "$(node -p 'process.execPath')")/npm" \
  bun run prepare:runtime
env -u NODE_ENV \
  -u DESKTOP_VITE_PORT \
  -u SUPERSET_WORKSPACE_ID \
  -u SUPERSET_WORKSPACE_NAME \
  -u SUPERSET_PRODUCT_NAME \
  -u SUPERSET_HOME_DIR \
  TAURI_PERSONAL_INSTALL=1 \
  NODE_ENV=production \
  CARGO_INCREMENTAL=0 \
  bun run tauri:build -- --debug --bundles app --no-sign --ci
APP_PATH="src-tauri/target/debug/bundle/macos/Superset.app"
codesign --force --deep --sign - "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
```

Use Node 24.15.0 for the two explicit runtime paths. If isolated npm
resolution is unavailable but this checkout already has a staged runtime,
`bun run validate:native-runtime` must pass before reusing it; this local
fallback was used for the personal QA bundle.

The local ad hoc signature (`codesign --sign -`) lets macOS run the CEF bundle;
it is not a Developer ID signature, notarization, or public distribution
signing. The app's update menu/check path is disabled in this build.

To back up before a diagnostic launch without replacing Electron, quit both
apps from a separate macOS Terminal and run
`scripts/tauri/install-personal-macos.sh --app "$PWD/src-tauri/target/debug/bundle/macos/Superset.app" --backup-dir "$HOME/Documents/Superset-Electron-Backup-<unique>" --backup-only --dry-run`,
then repeat without `--dry-run` if the preflight passes. This mode does not
install or launch Tauri. Use a new backup directory name for each attempt.

Before installing or first launching this app, save active work, quit Electron,
and make a dated, verified backup of the existing `Superset.app`,
`~/Library/Application Support/Superset`, and `~/.superset` excluding its
top-level `worktrees/` directory. The existing worktrees remain in place and
are not deleted or copied. Fully quitting
Superset also stops background host services and kills open terminal sessions,
so close those sessions deliberately first. Do not run Electron and Tauri at
the same time: both use the same Superset data directories. Keep the backups
until the Tauri app, browser login, and `superset://` links have been checked.
If launching from a terminal instead of Finder, clear the same inherited values:

```bash
env -u NODE_ENV \
  -u DESKTOP_VITE_PORT \
  -u SUPERSET_WORKSPACE_ID \
  -u SUPERSET_WORKSPACE_NAME \
  -u SUPERSET_PRODUCT_NAME \
  -u SUPERSET_HOME_DIR \
  open "/Applications/Superset.app"
```

Adjust the app path if the existing installation is not in `/Applications`.

On first launch, the app imports the supported renderer state and persistent
`superset` browser partition from the stopped Electron profile. Browser cookies
may require signing in again if macOS Keychain does not allow their decryption.

# Legacy Electron migration artifact (local)

From `apps/desktop` after packaging:

```bash
APP_DIR=$(find src-tauri/target -path '*/bundle/macos/*.app' -type d | head -1)
bun run tauri:legacy-update -- --app "$APP_DIR" --version "$(node -p "require('./package.json').version")" --arch "$(uname -m)" --output release
ls -la release/*-mac.zip release/*-mac.yml
```
