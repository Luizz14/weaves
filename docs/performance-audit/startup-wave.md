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
