# Performance: conservative startup wave

Approved scope: P04 conservative startup work, P07 telemetry only, and P16
optional terminal addons. Work stays in `perf/performance-wave-2`, starting from
`0b0afab7e`, with one commit per item. Performance benchmarks remain waived.
The user explicitly confirmed loading search on open while keeping the field
usable and replaying typed text after loading; ligatures load when enabled, and
the image parser remains installed before terminal replay.

## P04: bounded startup changes

Legacy network-log and stranded dev-profile sweeps start on a later event-loop
turn after the first window shows, including a restored window already visible.
The existing sweep logic, current-profile exclusion and live-lock checks remain.
Both sweeps already used asynchronous filesystem operations; this postpones their
I/O initiation and callbacks rather than claiming a removed synchronous VACUUM.

The bundled CLI shim compares managed content before replacing the file. An
identical shim retains its inode and mtime; an identical POSIX shim with incorrect
permissions is chmodded without replacement. A changed binary path/content still
replaces the shim. Missing binaries and unmanaged files/symlinks retain the prior
statuses and behavior. The public status remains `installed` for a correct shim.

| Structural behavior | Before | After |
| --- | --- | --- |
| Sweep initiation | Before window creation | After first show, on a later turn |
| Identical managed shim | Unlink and rewrite each launch | No content write or unlink |

Database/migration readiness, daemon reconciliation, browser bridge startup,
agent/plugin provisioning and CLI availability remain in their existing order.
Auth and host lifecycle are unchanged. The broader bootstrap/DB split from P04
is not part of this conservative slice.

Thirteen focused tests passed (seven new cases), including event ordering,
restored-window scheduling, POSIX/Windows identical content, permissions, changed
paths and unmanaged symlinks. Desktop suite: 4075 passed, 8 failed, 2 errors;
remaining failing names match the sidebar baseline. Typecheck retains the same
12 existing diagnostics, with none added. Biome and diff checks passed. Arm64
release build/package and validate:native-runtime plus check:pty-daemon-bundle
passed, with ad-hoc signing and no notarization/publication. Startup behavior was
checked via source/event/filesystem regressions, not live signed-in profile QA
or launch-time/CPU/RSS measurements.

## P07: telemetry-independent content, preserving cached flags

The user approved the public PostHog React context bootstrap after inspection
showed that simply mounting the tree earlier can leave feature-flag hooks with
an uninitialized initial value offline. The provider now always renders content
and publishes the same client through the SDK's public PostHogContext. On the
existing initialization effect's completion, it supplies the supported bootstrap
flags/payloads to React consumers. Getter-backed bootstrap reads current SDK
cache values instead of retaining an account's initial snapshot. It neither
changes SDK persistence/config nor duplicates the PostHog client.

Only UserIdentifier, SurfaceTagger, TelemetrySync and LocaleTagger wait behind
PostHogReady. The latter remains inside I18nProvider. AuthProvider, locale
readiness, desktop notices and their session/JWT/organization gates retain their
existing implementations. Content remains in the same tree slot across readiness
updates; it is not remounted to refresh the flags.

Two regression tests passed for the first render and current cache/reset values.
A standalone Electron fixture used the real public PostHog React flag/payload
hooks and the actual provider, with a synthetic offline client. It passed content
commit before initialization, cached flags/payloads without a network response,
later flag updates, empty cache after reset, preserved input/node identity and
initialization failure without a blank screen/remount. Telemetry effects still
start after initialization and desktop_opened. This is component-level synthetic
evidence, not a real authenticated SDK/account-switch/backend QA result.

| Structural behavior | Before | After |
| --- | --- | --- |
| Content before initialization effect | Absent | Mounted |
| Telemetry effects | After initialization | After initialization |
| Cached flags/payloads before network response | Read on delayed tree mount | Forwarded through public React bootstrap |

Desktop suite: 4077 passed, 8 failed, 2 errors, with no new failing names relative
to P04. Typecheck retains the same 12 diagnostics and adds none. Biome/diff checks
and the arm64 release build/package passed, including both required native/PTY
guards. No startup/CPU/RSS benchmark or production telemetry event was measured.

## P16: search and ligatures on demand

Both v2 runtime creation and the v1 helper now use the same per-terminal optional
addon controller. Search imports and activates on search open; simultaneous calls
share the pending activation and an installed addon is reused. Ligatures import
when enabled and respect the latest enable/disable intent across loading. v1
retains its previous enabled-by-default behavior; v2 follows its existing
appearance preference. Disposed runtimes skip pending activation, and failed
imports can retry. Partial activation failures dispose the failed addon.

The runtime/cache expose the current search addon through a getter plus an async
ensure method. Existing synchronous registry getters/find methods remain, and
old/HMR entries without an ensure method use their existing addon. UI loaders are
bound to the live terminal instance. The search field remains available while
loading and applies the saved query afterward. Closing ignores the pending UI
result; reopening reuses the addon/query. Replacing a loader discards the previous
reference and does not report No results while the new addon is still pending.

Image parsing, Unicode 11 activation, clipboard, progress and WebGL initialization
retain their existing order. ImageAddon is installed before the first replay;
no deferred image-protocol interception or decoder redesign was introduced.

| Structural behavior | Before | After |
| --- | --- | --- |
| Search module imports in v1/v2 | Static | Dynamic, on demand |
| Search addon per newly created terminal | Instantiated immediately | Absent until search is opened |
| Ligature module import | Static | Dynamic when enabled |
| Image/Unicode parser before replay | Installed | Installed |

Eight controller regressions and three search UI regressions passed: concurrent
loads, retry, partial failure cleanup, dispose during import, toggles, independent
instances, typing before readiness, close/reopen and replacement/No results state.
A standalone Electron fixture exercised real xterm and TerminalSearch with a
controlled loading gate. It passed native/CDP typing before loading, Escape
before completion, automatic query replay on reopen, next-match navigation,
ligature toggles, preserved CJK/emoji width and text, a valid inline PNG in the
first replay, and the UTF-8 clipboard codec. There were no renderer errors; a
screenshot was captured and inspected. The first PNG fixture had invalid image
bytes and was corrected; this did not require changing production image code.
This is synthetic component/protocol evidence, not signed-in full-app or system
clipboard QA.

The final compiled renderer graph was parsed from all HTML scripts/preloads and
the renderer index source-map entry. Search and ligature vendor sources are absent
from the static startup closure and present in distinct dynamic addon chunks.
The release includes those JavaScript assets. No benchmark for 16-terminal
creation, heap, CPU, RSS or launch timing is claimed.

The first concurrent full suite hit two Git timeouts and a follow-on assertion
after timeout cleanup. An obsolete build was stopped after the final UI fix.
The normal serial suite, without the concurrent compiler and without relaxing
its timeouts, passed those Git cases and reported 4088 passed, 8 failed, 2 errors.
Remaining failed names and the two errors match P07. Final typecheck retains the
same 12 diagnostics and introduces none. All changed-file Biome and diff checks
passed. The rebuilt final arm64 release and both required native/PTY guards
passed, with ad-hoc signing and no notarization/publication. The final ASAR also
passed SQLite in memory, PTY spawn/output, watcher, keymap, keyring, ast-grep and
process-metrics loading without resolving checkout modules or modifying the user
profile.

P04 conservative/P07 telemetry/P16 approved addons are complete locally, one
commit per item. Twenty new regression cases pass across this wave. The broader
P04 bootstrap/DB split and P07 auth changes remain outside the implemented slice.
Live authenticated/account-switch and multi-window/profile QA remain verification
gaps. Sentry symbolication is still the explicitly deferred wave-1 check. The
original worktree was preserved; this branch was not pushed or merged.
