# Tauri migration: compatibility gate

## Outcome

On 2026-09-22 the user explicitly approved raising the minimum to macOS 13 and continuing implementation. The existing Electron executable has Mach-O `minos 12.0`, while the pinned CEF 152 framework has `minos 13.0`; packaging must declare the new minimum truthfully. All earlier runtime, popup, patch and parallel-work approvals remain in force. The migration is still undergoing integration and real-application validation.

The full staged-native-binary audit found a more precise constraint: the bundled Node24.15 executable, `native-keymap` and `macos-process-metrics` declare `minos13.5`. CEF and the bundled CLI declare13.0; the other staged Darwin native modules declare11.0. The user subsequently explicitly approved macOS13.5. Tauri packaging and the CI deployment target now declare13.5. This compatibility decision is resolved; integration and real-app validation remain incomplete.

The user approved replacing the browser extensions with equivalent mechanisms after static inspection identified that the pinned official Tauri CEF runtime cannot load them. The compatibility proof has resumed; replacing Electron remains gated on runtime and packaging validation.

Confirmed scope: macOS first, retain React and TypeScript services, replace Electron directly after the compatibility gate, preserve the integrated browser and prioritize responsiveness under load.

## Current integration status — September 23

The user selected a personal replacement of the installed Electron app, preserving the
stable `com.superset.desktop` identity, `superset://` links and existing data. Public
Developer ID signing, notarization and distribution updater work are out of scope;
local ad hoc signing is still used to make the macOS/CEF bundle runnable. The
user approved backing up the Electron app and application data while leaving
the roughly 43 GB of worktrees in `~/.superset/worktrees` in place, untouched.
The real app/profile have not been replaced or migrated. The local-personal
packaging mode produced a 963 MiB debug `.app` with stable identity and
`superset://`; ad hoc deep/strict codesign, bundled Node 24.15.0, macOS 13.5
minimum across 27 native slices, resource validation and a bundle-only Tauri
build passed. The debug target was reused to avoid a second large release
cache. An opt-in recoverable cutover script is syntax-checked but has not run
against the real installation. The user's current Superset session must be
closed from an external Terminal before backup and replacement.
The first packaging attempt successfully produced the `.app` but then failed
while creating an unnecessary DMG (`hdiutil: Dispositivo não configurado`).
Repeating with `--bundles app` completed successfully. Re-running native
dependency preparation stalled in npm resolution, so that attempt was stopped;
the already staged Node 24.15.0 modules passed `validate:native-runtime` and
were used for the personal bundle.
After verifying that no process held the old isolated QA bundle open, that
superseded 984 MiB `Superset QA Ex18vx.app` was deleted. The personal
`Superset.app` bundle and migration source/test artifacts remain.

The isolated packaged QA host successfully created a project and worktree under
`/private/tmp/superset-tauri-qa.Ex18vx/worktrees`, opened a PTY, executed a
command and returned its output in a host terminal snapshot. The initial empty
snapshot was a QA harness mistake (`maxLines: 20` excludes output at the top
of a 32-row screen), not a product defect. The extra QA Node sandbox prevents
spawning macOS's setuid `ps`; the PTY daemon now handles both synchronous
`execFile` failure sites without crashing. The focused process-tree tests pass
10/10. This is backend integration evidence, not visual terminal QA.

The migration's Rust snapshot and marker writer now uses owner-only `0600`
permissions on Unix, including reused temporary files. Eighteen focused Rust
migration tests pass. A separate renderer-state audit found two active
localStorage keys missing from the import allowlist and a refetchable React
Query IndexedDB cache that could exceed the 4 MiB per-record limit. The user
approved importing those preferences and skipping only that cache when too
large. The source fix is in the personal bundle; 18 focused Rust migration
tests and 9 Bun exporter/importer tests pass. The current personal profile has
not been opened or copied for this audit. Interactive browser/popup/login flows,
real cookie/Keychain import, deep-link activation and restart still need
real-app verification before cutover.

The final personal marker test run passed 49 native library tests, one real
Node sidecar interoperability test and two window-origin security tests. The
whole desktop TypeScript check still reports 40 diagnostics from unrelated
auth/Azure/Pokédex areas; the one new command-palette inference diagnostic
introduced by hiding the updater action was fixed, returning to that same
count. At that checkpoint the personal `.app` had not been launched because
its stable identity selects the existing Electron profile before backup/cutover.

Subsequent startup finding: the user directly opened that stable debug bundle
with Electron closed, before installation/backup, and supplied crash reports
from two starts. One SIGSEGV reached `AppWebview::try_nsview` from the CEF
resize layout; an earlier SIGABRT happened while a Node menu request tried to
drop a native menu after the CEF event loop had begun shutdown. The attempted
legacy profile export also recorded an error: `profile migration export is not
in progress`. The exporter had started a poller on every `Finished` event,
including CEF's provisional page, so it now starts only once for the exact
export URL. The runtime patch now marks a host view closing before destroying
it, skips layout for closing/invalid browsers, and keeps undelivered main-thread
tasks from dropping native menu resources on a worker after loop shutdown.
The user approved keeping the hidden exporter alive until a registered app
window exists; it then closes. This avoids changing the runtime's global exit
policy. No source Electron profile data was deleted.

After those changes, 95 CEF runtime tests, four exact-patch tests, 51 native
library tests, the real Node interoperability test and two origin-security
tests passed. The personal `.app` was rebuilt in the same debug target, signed
ad hoc and passed strict/deep signature verification plus the 27-slice macOS
13.5 audit. It has **not** been launched against the personal profile since
the fixes. A verified backup and functional first-launch test remain the next
gate; the crashing old artifact must not be used for installation.

Later on September 24, the user opened the rebuilt `.app` directly from the
worktree. It showed a blank `tauri.localhost` window and was then closed; it
was not installed into `/Applications`. The migration completion marker was
written, so renderer migration reached completion, but the live DOM/console
was not captured. The exact cause of the blank content remains unknown. The
CEF log contains repeated macOS `NotifyMoveOrResizeStarted` usage warnings;
this is diagnostic evidence, not proof of the blank-screen cause. The Electron
app remains installed and running. The install script now offers an opt-in
`--backup-only` mode, and a read-only, exact-target CDP probe was added for
the next launch with an explicit debug port. A backup-only dry run failed
safely because Electron was active. No backup, installation or successful
post-fix UI validation has been performed yet.

The isolated Tauri QA `.app` builds and launches with the React renderer, bundled Node, local database, browser bridge, and host service. Its CORS preflight accepts `https://tauri.localhost`. The QA build has a separate identity and scoped Node write sandbox; its worktree location points into the QA temp directory. All 26 audited native slices meet the approved macOS 13.5 minimum. This is a debug QA artifact, not a signed release.

A real click on Settings → Permissions previously crashed in the pinned CEF runtime's evaluation-observer cleanup (`SIGSEGV`, two matching macOS crash reports). The approved versioned patch now defers observer registration cleanup until after the callback. The regression reproduced the unsafe destruction order before the fix; three focused callback tests, the runtime's 93 Rust unit tests, the desktop native tests, and the exact-patch preparation gate pass. In the rebuilt QA app, the authenticated Permissions page displayed its status rows and remained open during a later session check. No OS permission was granted as part of this verification.

The desktop TypeScript check reports 28 diagnostic headers, down from 31 in the frozen Electron baseline. The three removed diagnostics came from a confirmed preexisting `typedName` error in session creation; its three regression cases pass with temporary storage. No migration-only TypeScript diagnostic remains in the comparison.

The migration is still in functional QA. Interactive terminal UI, browser tabs/popups/downloads, profile import and restart recovery, deep-link activation, and comparable performance measurements are not yet proven end to end. Production signing/notarization and distribution updater migration are intentionally out of scope for this personal installation. Earlier checkpoints below describe what was known at their dates and may list blockers already corrected.

Subsequent source fixes: the canary updater now selects `desktop-canary/canary.json` while stable selects `latest.json` (two Bun tests and five Rust shell tests passed). Browser pane registration now reattaches after renderer reload and serializes concurrent registration through cookie import; 20 focused Bun tests passed. The Node main bundle was refreshed in the isolated QA app for the backend fixture test, but the later second PTY process-table fallback still awaits rebundling. A later full desktop typecheck reported 40 diagnostics; 12 additions versus the earlier 28 are in Azure/Pokédex UI files untouched by these migration fixes. The overall typecheck remains failing, so this result is not a clean-build claim.

## Reproducible upstream evidence

- Tauri tag: `tauri-v3.0.0-alpha.2`.
- Commit: `9c4f482d1e04347303c1f77a92a71a26c04470fc`, verified with `git ls-remote` and a checkout of that tag.
- Runtime: `tauri-runtime-cef` version `3.0.0-alpha.2`, depending on `cef` and `cef-dll-sys` `=152.3.0`.
- [Runtime source](https://github.com/tauri-apps/tauri/blob/9c4f482d1e04347303c1f77a92a71a26c04470fc/crates/tauri-runtime-cef/src/webview.rs#L239): `warn_about_unsupported_attributes` warns when either `browser_extensions_enabled` or `extensions_path` is requested; it states that CEF removed its extension-loading API. The attribute documentation at lines 166–167 identifies the same limitation.
- [Runtime dependencies](https://github.com/tauri-apps/tauri/blob/9c4f482d1e04347303c1f77a92a71a26c04470fc/crates/tauri-runtime-cef/Cargo.toml).

## Original Electron dependencies (inspection baseline)

- `apps/desktop/src/main/lib/extensions/index.ts` loads React DevTools in development and the bundled Superset Browser Tools extension into the persistent browser session.
- `apps/desktop/src/lib/electron-app/factories/app/setup.ts` calls the React DevTools loader. `apps/desktop/src/main/index.ts` calls the bundled extension loader.
- `apps/desktop/src/resources/browser-extension/manifest.json` defines a Manifest V3 extension with a background service worker and a content script. Its background script currently only responds to `ping` with `pong`; its content script is a placeholder. Losing this loader must not be described as losing an implemented element selector: the app's actual design-mode implementation is separate.
- The browser manager also depends on per-pane CDP, screenshots, cookies, downloads, popups and injected scripts. Complete product-level parity remains unverified.
- The original renderer used `trpc-electron` and preload globals. Local services include SQLite, PTY daemons and a separate host-service. Their replacement is now in progress in this worktree.

## Validation performed and remaining

Performed: checked worktree status, inspected desktop instructions and migration entry points, verified the official Tauri tag, downloaded its source into a temporary directory, and inspected the extension capability against the current application call sites.

The resumed proof installed Rust 1.95.0, CMake 4.4.3 and Ninja 1.13.2 in `/private/tmp/superset-tauri-validation.9iLofs`, without changing the global PATH. The official Tauri CLI 3.0.0-alpha.2 ARM64 release binary was downloaded and its SHA-256 matched `e7b7cca66103b03d660ee30aef8cbfbbb4c79ee6b4644aea24d032970905e884`.

The official CEF example compiled and bundled successfully on macOS ARM64. The running application reported Chromium `152.0.7977.83` and CEF API `15200`. Diagnostics confirmed native IPC, a native CDP `Runtime.evaluate` response of `42`, child-webview creation, and PNG capture. A native `browser_tools_ping` command returned `{"type":"pong"}`.

The proof also bundled Node 24.15.0, `better-sqlite3` 12.11.1 and `node-pty` 1.2.0-beta.14 into the `.app`. A Rust command launched the bundled Node executable, successfully queried an in-memory SQLite database and spawned a zsh PTY that emitted `tauri-pty-proof` and exited with code 0. Native modules were installed in the isolated proof, not rebuilt in the checkout. The example grew from 352.22 MiB to 546.02 MiB with these test resources; these are debug proof sizes, not production size or performance results.

React 19.2.3 rendered a counter in a CEF popup. `react-devtools-inline` 8.0.0 displayed its `CompatibilityCounter` component, and the inspected frame registered one React renderer. The popup had `window.opener`, and neither `window.__TAURI__` nor `window.__TAURI_INTERNALS__` was exposed in its remote document. This demonstrates the inspection alternative, not complete DevTools feature parity or Superset integration.

An initial Electron run from this checkout used renderer port 3145, API port 3141 and CDP port 19348, but is no longer a valid comparison target. A frozen source archive of HEAD `50bef5b076bf0f8ad5989daa74c23d6ddcf37ba8` was subsequently prepared at `/private/tmp/superset-electron-baseline.kcCc5f`, with four terminals and a local browser workload. Its manifest and preliminary measurements are in `.cache/tauri-baseline/electron-head/`. Measurements taken during concurrent compilation are not a final performance baseline; repeat both runtimes under equivalent idle-build conditions before making claims.

Still not performed: complete Superset integration, real provider OAuth, full browser end-to-end testing, profile import, production signing/notarization, updater validation or before/after performance measurements. The proof diagnostics and screenshot must not be presented as an end-to-end Superset migration.

The existing terminal-flood profiling script measures terminal echo and service response under load. It is useful baseline infrastructure, but does not alone establish visible typing latency or tab-switch responsiveness.

## Approved extension substitution

The user explicitly accepted equivalent mechanisms in place of both extensions. Replace the bundled extension's ping/pong with narrowly scoped native communication, and use React DevTools without a browser extension. Do not expose privileged commands to arbitrary browser content. The separate design-mode, DOM inspection and CDP features remain required.

## Approved native-popup ownership

The user also explicitly approved CEF-owned popups with Superset lifecycle management. The official example's `NewWindowResponse::Create` path deadlocked when it built a Tauri window synchronously inside `on_before_popup`. A native stack sample captured `create_window_detached -> Receiver::recv` on the main thread. Independently, the pinned runtime's `life_span.rs` documents that this path cancels the original popup and does not preserve `window.opener`.

The `NewWindowResponse::Allow` path opened a real CEF popup, preserved its opener, and kept it outside `getAllWindows()` while making it observable through `with_cef_webview(...).popups()`. The migration must own this separate lifecycle, carry navigation guards into nested popups, share the original session and close dependents with their opener.

An additional compatibility gap exists in this alpha: `on_before_popup` receives Chromium's `WindowOpenDisposition` but discards it before calling the application. Window geometry alone cannot distinguish an ordinary new tab from a popup requested without dimensions. The current Superset explicitly relies on this distinction in `popup-window.ts`.

A candidate patch is preserved at `apps/desktop/src-tauri/patches/cef-popup-disposition.patch`. It exposes the native disposition through `NewWindowOpener` without changing window creation or navigation decisions. Its focused Rust test passed against the pinned upstream checkout. A recompiled `.app` also reported `CEF_WOD_NEW_POPUP` for `window.open(url, "_blank", "popup=yes")` and `CEF_WOD_NEW_FOREGROUND_TAB` for `window.open(url, "_blank", "")`, using the same local target URL. This was a diagnostic CDP-triggered comparison, not a user-journey test. Reverse application of the saved patch was checked against the tested sources.

The user explicitly approved maintaining the versioned patch. `scripts/tauri/prepare-runtime.ts` now checks out the exact revision, verifies/applies the reviewed patch and rejects unexpected tracked source changes. The native Cargo manifest resolves its Tauri dependencies to that prepared source. Four preparation tests cover idempotence, revision mismatch, unexpected edits and Git display configuration. This approval, native CEF popup ownership and equivalent extension replacements do not need to be reconfirmed.

## Integration work in progress

The user approved parallel implementation. The Superset CLI was checked first but had no authenticated session; the available session agents are implementing disjoint native-shell, Node-host, renderer, browser and build areas, with a separate parity audit. The integration contract is recorded in the checkout's `.cache/tauri-migration-contract.md`.

Root-owned transport work includes bounded JSON framing in Rust, the TypeScript stdio peer, a window-scoped tRPC dispatcher and a shared renderer request schema. The real-process integration test builds a Node fixture, exchanges messages with Rust and verifies serialized dates and trusted window context. Current focused TypeScript tests pass: eleven stdio-peer tests, seven dispatcher tests, five real renderer-link round trips, four native-link tests, three bootstrap-schema tests and four runtime-preparation tests (34 total). Coverage includes fragmented UTF-8, out-of-order replies, failure/EOF/timeout handling, transformed values, scoped cancellation, window-generation reuse and failed-delivery cleanup. Two newly reproduced renderer issues were fixed: wire IDs now use per-operation UUIDs and settled operations release disconnect listeners. Focal TypeScript checking passed after including the renderer's global declarations; this is not a whole-monorepo typecheck.

The worktree now contains the native shell, Node service, renderer transport/bootstrap, native browser integration and replacement build/release wiring. These remain under integration review. Profile snapshot persistence, browser download cancellation, native notification lifecycle, signed updater wiring and deterministic bundled-resource paths are explicit review gates, not presumed complete features.

A disposable Electron file-origin profile and a separate CEF profile demonstrated that localStorage and `keyval-store/keyval` IndexedDB data (including a Date value) can be read after copying only the stopped fixture profile's relevant storage directories. No real user profile was migrated by this proof. The product importer must still be verified for exact source selection, restart recovery, bounded batches and hydration ordering.

The latest integrated Rust command (`cargo test --offline --lib --test window_registry_security --test sidecar_interoperability`) passed all 16 tests: 13 library tests, the real-process Node exchange and two renderer origin-trust tests. These foundational checks do not establish complete application migration or performance parity. The workers' integration, whole-app checks and actual Tauri workflows remain necessary.

## Product integration checkpoint — September 22

The second disposable QA candidate launches the actual Superset renderer and bundled Node service under Tauri/CEF. Its identity is `com.superset.desktop.qa.ex18vx`, distinct from the installed product. The packaged Node executable and descendants have an additional QA-only write/network sandbox; the native application is not wrapped by that extra sandbox because it conflicts with CEF helper sandbox initialization. CEF's own sandbox remains enabled. No production profile was copied into this candidate.

Verified on this candidate:

- The native window remains responsive after fixing a synchronous `webview.url()` call inside the CEF permission callback. The reproduced deadlock was captured in a native stack sample before the fix.
- The emitted Node bundle honors runtime `SUPERSET_HOME_DIR` and loads Node's `ws.WebSocketServer`, after switching the main build to Vite SSR/Node resolution.
- Real UI navigation reaches Account settings. The inline React DevTools panel opens, displays a component tree, and closes; screenshots were captured. This does not establish parity for every DevTools feature.
- The fresh native suite passes 42 unit tests, one real-process sidecar test and two origin-security tests. The packaged runtime validator passes, and all 26 audited Mach-O slices fit the declared macOS 13.5 minimum.
- The temporary QA copy passes ad hoc deep/strict code-signature verification. This is not production signing or notarization.

Remaining reproduced blockers include the local host service's packaged entrypoint/CORS handling and the native New Window action, which currently has no effect. Workspace creation, interactive terminals, full browser/popup/download flows, restart/profile migration, updater behavior and comparable performance measurements remain unverified. The September 22 whole-desktop TypeScript check reports 42 diagnostic headers versus 31 in the frozen baseline. The 11 additional diagnostics are in browser ownership/cookie/overlay code and legacy-profile exporter tests; fixes are in progress. Logs: `.cache/tauri-desktop-tsc.log` and `.cache/electron-head-desktop-tsc.log`.

The versioned runtime patch also carries download progress/cancellation callback plumbing needed by the existing download UI. The preparation gate verifies the complete patch against the pinned source and rejects unrelated cache edits.

## Proof artifact locations

September 23: superseded proof build targets, the old product release target,
the accumulated product incremental cache and QA candidate 1 were removed at
the user's request to recover disk space. Proof sources, evidence, toolchain,
CEF dependencies and QA candidate 2 remain. Paths below describe the original
experiments; removed binaries must be rebuilt before reuse.

Implementation resumed with explicitly selected `gpt-6-luna` subagents at
`max` effort. The first fresh native validation passed 48 tests with
`CARGO_INCREMENTAL=0` (45 library, one sidecar interoperability, two origin
security); 39 focused transport/bootstrap/runtime-preparation tests also
passed. These are source-level checks, not validation of a new packaged app.

The September 23 complete desktop typecheck now reports 31 diagnostics, matching
the frozen Electron baseline with no migration-only diagnostic headers. The
11 additional errors recorded above have been resolved. Root also reran nine
activation/menu/exporter tests successfully. Native macOS reopen and windowless
tray activation now reach the Node window lifecycle; this compiled and passed
three focused shell tests, but the newly packaged UI flow still needs validation.

Temporary source, toolchains and dependencies: `/private/tmp/superset-tauri-validation.9iLofs`.

- Bundle: `tauri/target/debug/bundle/macos/Tauri CEF Example.app`.
- Diagnostic driver: `cdp-probe.ts` (requires the isolated proof's local endpoints).
- React/DevTools fixture and native Node smoke: `node-proof/`.
- Screenshots and main-thread samples: `evidence/`.
- Main CEF proof profile: `proof-profile/`; initial runs also created the example-specific cache under `~/Library/Caches/com.tauri.cef-example`, separate from Superset profiles.

Product application sources have now changed substantially as part of the requested migration. Preexisting changes in `bun.lock` and `packages/db/package.json` are being preserved. The earlier local development login and startup provisioning affected development state. No production migration, commit, push or release was performed.
