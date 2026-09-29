# Performance: first implementation wave

Source audit: `relatorio.md`, reconstructed from the 2026-09-24 audit of
`331e0229f92434219d4e79f28c700c7296ea92f4`. Its historic figures are not a
baseline for this wave. Cold launches were deferred by the user. P00 and the
baseline are measurement infrastructure; smaller bundle/package bytes qualify
as a measurable gain for P01/P02.

## P00: startup diagnostics

Set `SUPERSET_STARTUP_DIAGNOSTICS` to an absolute JSONL output path when launching
the release executable directly. The parent directory must already exist. Use a
new file for each launch; the logger appends. Without this runtime variable, no
file, timer, diagnostic IPC listener, or diagnostic terminal callback is installed.
This is a local diagnostic switch, not a deployment secret or build-time flag.

Each line contains only `marker` and `durationMs`. No wall-clock timestamps,
account/workspace IDs, terminal output, file paths, or authentication data are
written to this log. Each marker is emitted at most once per main process.

All durations use the main process's monotonic `hrtime`, with an origin recovered
from Node's `process.uptime()`. `process-start` is zero at Node runtime startup;
it does **not** include the OS launcher or Electron's native work before Node
starts. Renderer milestones are timed on IPC receipt in the main process, so they
include IPC delivery latency. We never subtract unrelated renderer and main
clocks or use `Date.now()` for duration measurements.

| Marker | Observable boundary |
| --- | --- |
| `process-start` | Node runtime startup, defined as zero |
| `bootstrap-imports-end` | First statements in main after static imports evaluate |
| `app-ready` | `app.whenReady()` resolves |
| `window-created` | First main window factory returns |
| `window-show` | First window's `show` event, or visible confirmation after `show()` returns |
| `react-commit` | `RendererRouter`'s first React effect, after commit |
| `shell-interactive` | Dashboard's committed effect followed by a timer task; authenticated shell is mounted |
| `terminal-usable` | Visible terminal with an attached session processes its first output batch in xterm's write callback |

The shell and terminal markers are readiness observations, not proof of an input
round trip. Verify a real dashboard action and terminal input/echo separately.
The terminal protocol sends `synced` **before** catch-up bytes, so it cannot prove
replay completion. The terminal marker does not claim the entire replay has
finished, and absent markers must be reported as missing, never replaced by zero.

The preload enables diagnostic IPC only for windows launched with the main
process's diagnostic argument. The receiver accepts only known renderer markers
from that window's main frame. Normal startup, authentication, host lifecycle,
persistence, throttling, and terminal input/output ordering are unchanged.

## Measurement protocol

Use the same packaged arm64 release configuration, profile, visible workspace,
window geometry, power state, and idle terminals for every round. Record the
source revision and patch, Bun/Electron versions, package bytes, and machine
conditions alongside (not inside) the duration-only startup log.

Warm: terminate the main app normally and relaunch, preserving caches and the
profile, ten times. Do not stop persistent PTY daemons or agents to manufacture
an idle result. Cold: deferred; no cold p50/p95 will be claimed. With ten warm
observations, report all samples and nearest-rank p50/p95; p95 is the maximum
and should not be treated as a stable tail estimate.

R0: authenticated, visible, without relevant jobs/output. After stabilization,
sample process RSS and cumulative CPU time for at least 300 seconds. Compute
CPU as `100 * delta(cpu_seconds) / delta(monotonic_seconds)` (100% = one core).
Report each PID/role separately and RSS median/p95 in MiB. Identify detached
host/PTY processes; do not silently include unrelated sessions or omit them.
Sum of RSS includes shared pages and is not exclusive physical memory.

No optimization is retained on the basis of an unmeasured estimate. P02 also
requires real symbolicated test events in both Sentry projects (main/renderer in
`desktop`, host in `host-service`); local source-map presence is insufficient.

Aggregate warm startup logs with:

```sh
python3 apps/desktop/scripts/summarize-startup.py /path/to/warm-*.jsonl
```

The summary retains raw samples and missing counts; never interpret a percentile
with missing milestones as a complete ten-launch result.

### P00 validation (2026-09-28)

- Built the arm64 release with Bun 1.3.14 and Electron 41.10.3, ad-hoc signing,
  no notarization or publication. Production endpoint defaults match the installed
  app. The development `.env` was temporarily set aside and restored unchanged.
- `validate:native-runtime` and `check:pty-daemon-bundle`: passed.
- Focused recorder/write-coalescer tests: 14 passed. Collector syntax, nearest-rank
  percentiles and missing-sample handling: passed.
- Full desktop suite outside the sandbox: 3,989 passed, 42 failed, 2 errors.
  Repeating with the six edited source files restored to HEAD produced the same
  counts and failing test names. These failures predate P00.
- Desktop typecheck: 40 existing diagnostic lines; none in the changed code.
  Original-source comparison reproduced all 40. Its two additional errors were
  from leaving the new untracked diagnostic helper beside the old preload type;
  those disappear with P00's preload. Global typecheck also fails in unchanged
  `packages/auth` (Better Auth plugin/API type incompatibility).
- Packaged smoke test restored the authenticated production profile and its
  workspace/terminal. All eight markers were recorded. The first host connection
  took longer than the dashboard commit; early workspace-unavailable UI recovered
  once the three hosts came online.
- The directory-only package has no `app-update.yml`: the updater reports that
  missing file after its check. No update was installed. This packaging caveat
  must be held constant across rounds.

Smoke timings are not the ten-launch baseline and are not a performance claim.

The first R0 attempt was rejected: the main process exited around 132 seconds
into sampling and remained a zombie. The collector now excludes zombies and
rejects decreasing CPU counters, so an exited/reused PID cannot become a valid
idle sample. The ten startup samples completed before that exit. No crash report
was found; the cause of the exit is unconfirmed. R0 must be repeated.

A second R0 attempt reported a decreasing CPU counter in a short-lived child.
Process identity is now `(pid, startedAt)` to distinguish potential PID reuse;
a reused child PID has its own independent CPU counter. Regression tests cover both zombie exclusion and child PID reuse.
Raw samples are saved before aggregation so an aggregation error preserves the
evidence. Neither invalid attempt is used as an R0 baseline.

A subsequent launch was visibly open without emitting Electron's `show` event.
P00 also records the milestone when `show()` returns with `isVisible() === true`;
the recorder deduplicates it when the event already arrived. This only observes
the existing show operation. Incomplete startup samples are not aggregated.

## Handoff: measurement blocked (2026-09-29)

P00's final build and native guards passed; 44 focused startup/terminal tests
passed, and the full desktop suite again reproduced the same 3,989 passes,
42 failures and 2 errors as the original code. The visible terminal accepted a
`P00_PROBE` input and nine Backspaces removed it; no Enter, command or agent
prompt was sent. Screenshots were inspected locally and are not committed
because they contain the user's session content.

The corrected release completed another ten launches with all eight markers,
but the OS session was confirmed locked (`CGSSessionScreenIsLocked=Yes`).
Electron reported the window visible yet unfocused even after activation. These
launches and the attempted R0 are **not an accepted visible-app baseline**.
The measurement jobs are no longer running; the release and persistent terminal sessions
were left running. Unlocking the OS session is required before repeating the
baseline and starting P01 under the requested measurement gates.

Sanitized startup evidence is preserved in `evidence/p00-baseline.json` and
`evidence/p00-baseline-verified.json`. Both explicitly set `acceptedBaseline`
to `false`. Their artifact hashes/revisions refer to the binaries measured;
earlier P00 commit IDs were subsequently amended. Do not merge these rounds or
compare their timings as optimization results.

Remaining gates:

- Baseline: ten warm launches plus a valid 300-second R0 with an unlocked,
  visible app. Cold launches remain deferred by the user.
- P01: not applied; waits for the baseline. Selective name preservation is
  needed for PostHog feature-flag error classes, Claude SDK user-agent names,
  and MCP transport classification, alongside esbuild minification and targets.
- P02: not applied. The local env has no Sentry upload token or desktop/host DSNs;
  no `.sentryclirc` exists, no Sentry tool is exposed, and the installed Superset
  CLI reports that it is not logged in. Upload and main/renderer/host event
  symbolication cannot be claimed. The user was asked about supplying access or
  deferring this item.
- P08: not applied. Installed `@pierre/diffs` 1.3.6 initializes workers in its
  constructor and exposes a fixed `poolSize`, with no public dynamic growth API.
  A versioned dependency patch was proposed; user confirmation is pending.

No P01/P02/P08 performance gains, successful Sentry verification, cold-launch
numbers, or completed R0 results are claimed. No authentication, host lifecycle,
throttling, or persistence behavior was changed.

The saved samples from the last attempt identified a terminating child whose
RSS and CPU both became zero before `ps` marked it as a zombie. Such unavailable
rows are now excluded as well; the regression suite covers that race. Other
decreasing counters still invalidate the sample. This correction does not make
a locked-session run an accepted R0.

## Revised scope and P01 (2026-09-29)

The user waived the baseline and repeated performance measurements and asked to
proceed directly with the optimizations. Runtime improvement numbers and
measurement-based acceptance are no longer gates for this wave. Cold launches
remain deferred. The user also approved a versioned `@pierre/diffs` patch for P08
and implementing P02 with real Sentry symbolication explicitly left pending.
These instructions supersede the measurement blockers above.

P01 enables esbuild minification with `node24` for main/preload (including the
main build's child entrypoints) and `chrome146` for renderer. A build-only
transform preserves names selectively in PostHog feature-flag errors, the Claude
SDK's constructor-based user agent, MCP transport classes used by Sentry, and
the PTY adapter whose function name is checked by the existing handoff guard.
Other application modules remain eligible for identifier minification. Source
maps remain generated and the name-preserving transform supplies a composed map.

Validation: five targeted name/source-map tests passed, the arm64 release built
and packaged with ad-hoc signing, and `validate-native-runtime` plus
`check-pty-daemon-bundle` passed without weakening either guard. The full desktop
suite reported 3,993 passes with the same 42 failures and 2 errors as the original
code; the additional fifth name-preservation case passed in the focused rerun.
Desktop typecheck reproduced the same 40 diagnostic lines, with no new ones.
There is no claim of measured startup, RSS, or CPU improvement.
