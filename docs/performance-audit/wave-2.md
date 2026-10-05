# Performance: second implementation wave

Approved scope: P03, P06, P19 and P22, one commit per item, build and functional
checks without performance benchmarks. Work is isolated in `perf/performance-wave-2`
at `performance-wave-2`, starting from `b2394d151`. Uncommitted editor/LSP, settings
and database changes remain in the original `mulher-afogada` worktree.

Superset CLI workspace creation was unavailable because it was not logged in.
The dedicated worktree was created locally with Git. Its dependencies were
installed independently with Bun 1.3.14 and a frozen lockfile; workspace links
were checked to resolve to this worktree. No remote database setup was executed.

## P03

Packaging excludes TypeScript build caches, dependency tests/examples/demos,
SQLite/PTY compilation inputs, PTY prebuilds for other target architectures, and
react-icons/emojibase-data already compiled into renderer JavaScript. The filters
apply both to automatic dependency collection and explicit native copies.
Loaders, metadata, Release binaries, spawn-helper and target-architecture prebuilds
remain. Filtering changes distribution only; native rebuilds still have their
source inputs. The CLI and Claude SDK vendor assets remain packaged.

Validation:

- Five tests against electron-builder's real file matcher passed, including arm64,
  x64 and ia32 target filters and explicit native-copy filters.
- Arm64 release compiled and packaged with ad-hoc signing; native runtime and PTY
  bundle guards passed. No notarization or publication was performed.
- The final ASAR inventory has no maps, build caches, excluded renderer packages,
  SQLite/PTY sources, or foreign PTY architectures.
- Electron's embedded Node loaded native modules directly from the packaged ASAR:
  SQLite query in memory, PTY spawn/output, watcher subscribe/unsubscribe, ast-grep
  parse, keymap, keyring, and process metrics. No checkout node_modules were used
  for resolution; test files and the PTY were temporary. No keychain entries or
  user-profile databases were changed.
- Desktop suite: 4,009 passed, 42 failed, 2 errors. Failures/typecheck diagnostics
  outside the changed packaging code predate this wave and remain recorded in the
  local validation logs. No new packaging type diagnostics were found.

Foreign platforms/architectures received filter-compatibility tests, not native
Windows/Linux or x64 execution on this arm64 macOS machine. Real Sentry upload and
symbolication remain the explicitly deferred validation from wave 1.

## P06

Automation list content now lives under the Settings route's components rather
than being exported by the legacy redirect route. The redirect remains, and the
existing router code splitting can isolate the actual content and dependencies.
The task creation dialog is loaded only when opened, with speculative import on
pointer/focus intent; its existing editor, validation, reset and submission code
is retained. Rich-text and emoji dependencies follow these existing route/dialog
boundaries instead of changing editor initialization or paste semantics.

The shared Mermaid plugin retains its synchronous `getMermaid`/`initialize` API
and asynchronous `render` API, loading the vendor engine when a diagram renders.
Theme/config forwarding, error propagation and the existing native SVG text-label
policy remain. No auth/telemetry gating was changed.

Validation: eight Mermaid/message tests and nine task navigation/wiring tests
passed. A standalone Chromium/Electron harness rendered real diagrams in dark and
default themes and exported nonempty PNGs without foreignObject labels. It did
not start Superset or access the user profile. The compiled renderer's transitive
static import closure contains neither Mermaid's engine/plugin nor Tiptap emoji
or CodeMirror; dynamic diagram/editor chunks remain in the build.

Arm64 release build/package and both native guards passed. Desktop suite:
4,043 passed, 8 failed, 2 errors; every remaining failing test was already present
in the P03 baseline. Typecheck retained the same 12 preexisting diagnostics and
introduced none. The existing dialog/automation business logic was not submitted
against a live backend as part of these checks. No performance benchmark or
startup/CPU/RSS improvement number is claimed.

## P19

Diff sections/file panes select only display preferences and their stable actions;
infinite-scroll selects the section/view controls it actually reads. The changes
sidebar selects its current workspace's selection record rather than subscribing
to every workspace's selected-file map. The active dashboard SidebarToggle selects
the derived collapse boolean and its action, preserving the getter's semantics.
No stores, persistence formats or mutation behavior were changed.

React integration checks passed for unrelated-state render suppression, preference
updates, current-workspace selection, switching workspace, clearing selection,
and the real sidebar collapse action. These are behavioral assertions, not a
performance benchmark. Existing changes-store migration/selection tests passed.

Arm64 build/package and both native guards passed. Full desktop suite: 4,046
passed, 8 failed, 2 errors, with no newly failing test names relative to the base.
The focused checks also passed with real HotkeyLabel dependencies. Typecheck has
the same 12 preexisting diagnostics and no new ones. Live backend mutations were
not used for these UI/store tests.

## P22

The native contextBridge check exposed that callbacks passed to separate preload
calls have different proxy identities. The original bridge and a preload-only
per-channel WeakMap both failed to remove the intended listener. The user
explicitly approved the renderer-local facade with private subscription IDs.

The public `window.ipcRenderer` API remains `invoke`, `send`, `on`, and `off`.
The facade is installed in the main world via executeInMainWorld, keeping callback
identity local to the renderer. Its WeakMap tracks stacks of IDs per callback and
channel. A private transport retains each actual native wrapper by ID in preload;
the transport is passed into the facade's closure, not exposed as another global
API. The event object is still stripped from callbacks. `off` removes the latest
matching registration, one per call, preserving EventEmitter semantics. Empty
registries and subscription records are removed. Context isolation and sandboxing
remain enabled; no caller migration or new public subscription argument is needed.

Three regression tests cover independent channels, repeated registrations,
unknown removals and repeated mount/unmount cleanup. A real isolated Electron
renderer with the compiled preload passed the exact channel/duplicate test that
failed before the change. That check exercised contextBridge proxies, not only a
mock emitter; the profile and channels were temporary, without Superset startup
or user-data access.

Final arm64 build/package and both native guards passed. Native SQLite/PTY/watcher
and other loaders were smoke-tested again directly from the final package.
Desktop suite: 4,049 passed, 8 failed, 2 errors, all remaining failures already
present in the base; typecheck has the same 12 preexisting diagnostics and no new
ones. Focused checks and Biome for changed files passed. No benchmarks were run.

P03/P06/P19/P22 are complete on the isolated branch, one commit per item. The
original worktree's ongoing editor/LSP/settings/database edits were not moved,
committed or modified by this work. No push, merge, publication or remote DB setup
was performed. Real Sentry symbolication remains deferred from wave 1.
