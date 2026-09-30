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
