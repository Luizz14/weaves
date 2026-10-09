# Performance: core user journeys

First journey-level latency baseline of the desktop app, measured on the
current tree against the author's real signed-in profile. There is no
before/after comparison; this is the reference for future waves.

Harness: `apps/desktop/scripts/perf-journeys/` (`bun run --cwd apps/desktop
perf:journeys`). Raw output stays in `apps/desktop/.tmp/perf-journeys/<run>/`;
the sanitized summary is in `evidence/`.

## What is measured

| Section | Journey | Start | End |
| --- | --- | --- | --- |
| Launching the app | Window visible, shell interactive, terminal usable | `open -a` of the packaged app | P00 markers `window-show`, `shell-interactive`, `terminal-usable` |
| Starting a session | New terminal | ⌘J keydown | first PTY bytes after `synced` on the new socket, painted |
| | New Codex Chat | ⌘T keydown | composer `textarea` enabled, painted (warm and cold model catalog) |
| | Claude Code | click on the `claude` preset | CLI idle footer seen in the PTY bytes, painted |
| | Create workspace | ⌘↵ on the new-workspace screen | new `[data-workspace-id]` painted |
| Loading | Switch workspace | pointerdown on the sidebar row | workspace mounted and terminal re-attached (`synced`; first bytes on a first visit), painted |
| | Codex conversation | pointerdown on the sidebar row | message count stable for 750 ms with the composer enabled |
| | Quick open | ⌘P keydown / Enter on the result | palette input painted / CodeMirror lines painted |
| | Changes panel | ⌘⇧L keydown | first diff rows inside the `diffs-container` shadow root (cold after reload, warm) |
| Typing | Terminal keystroke | keydown `x` | echoed byte painted |
| | Composer keystroke | keydown `a` | textarea value painted |

Sending a message to a model is not measured: it requires a real model call,
which was not approved.

## Clocks

Interaction journeys use one clock, the renderer's `performance` timeline. The
start is the `timeStamp` of the trusted input event dispatched over CDP (the
same start INP uses), captured by a capture-phase listener installed at document
start. The end is the first frame that contains the result: a `MutationObserver`
or WebSocket frame detects it, then `requestAnimationFrame` plus a
`MessageChannel` task marks the frame commit. Terminal output takes one more
frame because the write coalescer batches into `xterm.write` on the next frame
and xterm draws in its own frame after that. Pixels reach the screen up to two
vsyncs later; that is not included.

The probe wraps `window.WebSocket` at document start to see terminal and event
frames. It keeps socket kinds, terminal ids and timestamps only: no URLs,
tokens or payloads leave the renderer. Claude readiness is a heuristic match on
the CLI's footer text, decoded in memory and discarded.

Launch uses the P00 markers (Node-start origin). For the spawn-origin numbers,
the harness reads `CLOCK_MONOTONIC_RAW` before `open -a` and reads the P00 origin
from the main process inspector (`process.hrtime` minus `process.uptime`). Node's
`hrtime` uses the same counter, verified by bracketing one read between two FFI
reads on every launch. Launches with the inspector are interleaved with plain
launches to quantify its cost.

## Protocol

1. Packaged arm64 build of the current tree with
   `scripts/build-local-desktop-release.sh --build-only`; migrations identical to
   the installed app.
2. The installed app is quit (SIGTERM, verified graceful by the persisted window
   state; AppleScript fallback). `confirmOnQuit` is switched off for the run and
   reset to default afterwards. `DISABLE_UPDATE_CHECK=1` on every launch.
3. A dedicated `perf-bench` workspace in this repository receives every
   state-changing journey; a fixture line in its `README.md` feeds the changes
   panel and is reverted at the end. Real workspaces are only visited.
4. Launch loop, then one interaction session. Cheap journeys run in three
   round-robin passes; reload cycles produce the first-visit, cold-diff and
   conversation samples; Claude and workspace creation run last.
5. Before each sample: screen unlocked, window focused, no dialog, no terminal
   bytes for 300 ms, an idle callback and 250–500 ms of jitter. An invalid
   sample is retried up to three times and counted, never trimmed.
6. Created workspaces are destroyed through the host-service with
   `skipTeardown` (setup never ran), only for ids this run minted. The harness
   journals every state change and `--restore <journal>` replays the cleanup.

Workspace creation goes through the real UI, but CDP rewrites the
`createEnqueued` request to add `runSetup:false` and a `perf-bench-*` name: the
project's setup script would otherwise start a Docker stack per sample. The
numbers are for creation without setup.

Percentiles are nearest-rank, as in `summarize-startup.py`. With fewer than 20
samples the p95 is the maximum.

## Results (2026-10-08)

Run `20261009-013614`: HEAD `34a638019` plus the uncommitted local-build
packaging changes, app 1.29.0, Apple M5, 16 GB, macOS 27.0.1, 60 Hz display, UI
in pt-BR. Evidence: `evidence/journeys-2026-10-08.json`. All values in ms,
nearest-rank; with fewer than 20 samples, p95 is the maximum.

### Launching the app

20 accepted launches with the inspector (the first launch discarded), plus 10
plain launches. The inspector changed the shell-interactive p50 by −1.1%, which
is within noise, so spawn-origin numbers are reported. Process creation to Node
start took p50 126 ms.

| Milestone | From `open -a` p50 / p75 / p95 | From Node start p50 / p75 / p95 |
| --- | --- | --- |
| Window visible | 702 / 707 / 712 | 574 / 576 / 580 |
| First React commit | 711 / 717 / 722 | 584 / 586 / 589 |
| Shell interactive | 2,299 / 2,348 / 2,899 | 2,173 / 2,233 / 2,776 |
| Terminal usable | 2,926 / 3,695 / 3,936 | 2,807 / 3,564 / 3,818 |

The window paints in 0.7 s; the authenticated shell takes another 1.6 s; the
restored terminal shows output after another 0.6 s to 1.3 s (wide p75–p50 gap).

### Interactions

| Journey | n | p50 | p75 | p95 |
| --- | ---: | ---: | ---: | ---: |
| New terminal (⌘J → first output) | 30 | 591 | 615 | 749 |
| New Codex Chat, warm catalog | 30 | 43 | 49 | 52 |
| New Codex Chat, cold catalog | 5 | 56 | 63 | 146 (max) |
| Claude Code (`claude` in a shell → CLI ready) | 10 | 406 | 415 | 476 (max) |
| Create workspace, worktree without setup | 10 | 1,290 | 1,327 | 1,937 (max) |
| Switch workspace, revisit | 30 | 82 | 86 | 103 |
| Switch workspace, first visit after reload | 30 | 129 | 151 | 209 |
| Quick open palette (⌘P) | 30 | 43 | 48 | 61 |
| Open file from quick open | 30 | 97 | 104 | 133 |
| Changes panel, warm | 30 | 46 | 52 | 60 |
| Changes panel, cold after reload | 10 | 112 | 133 | 208 (max) |
| Terminal keystroke → echo | 102 | 22 | 28 | 41 |
| Codex composer keystroke | 51 | 8.8 | 9.6 | 13.9 |

Four attempts were invalid and retried: three focus/dialog gates on new
terminal and one dialog gate on cold Codex Chat. No sample timed out. A new
terminal is dominated by shell startup: the socket is created at a median of
54 ms and synced at 71 ms, and the first PTY bytes arrive at 569 ms.

Not measured: loading an existing Codex conversation (no visited workspace had
an open Codex Chat tab) and sending a message to a model (not approved).

## Results after startup wave 3 (2026-10-09)

Run `20261009-053108`: branch `perf/startup-wave-3` at `a51870dff` plus the
uncommitted local-build packaging changes, same machine and protocol, on AC
power. Evidence: `evidence/journeys-2026-10-09.json`. What changed is in
`startup-wave-3.md`.

| Journey | Before p50 / p75 / p95 | After p50 / p75 / p95 |
| --- | --- | --- |
| Window visible, from `open -a` | 702 / 707 / 712 | 552 / 558 / 570 |
| Shell interactive, from `open -a` | 2,299 / 2,348 / 2,899 | 948 / 955 / 971 |
| Terminal usable, from `open -a` | 2,926 / 3,695 / 3,936 | 1,308 / 1,323 / 1,347 |
| New terminal (⌘J → first output) | 591 / 615 / 749 | 144 / 147 / 153 |
| New Codex Chat, warm catalog | 43 / 49 / 52 | 41 / 47 / 50 |
| New Codex Chat, cold catalog | 56 / 63 / 146 (max) | 48 / 53 / 133 (max) |
| Claude Code (`claude` in a shell → CLI ready) | 406 / 415 / 476 (max) | 399 / 400 / 407 (max) |
| Create workspace, worktree without setup | 1,290 / 1,327 / 1,937 (max) | 1,271 / 1,287 / 1,318 (max) |
| Switch workspace, revisit | 82 / 86 / 103 | 73 / 78 / 96 |
| Switch workspace, first visit after reload | 129 / 151 / 209 | 127 / 151 / 168 |
| Quick open palette (⌘P) | 43 / 48 / 61 | 34 / 50 / 56 |
| Open file from quick open | 97 / 104 / 133 | 89 / 93 / 100 |
| Changes panel, warm | 46 / 52 / 60 | 44 / 50 / 58 |
| Changes panel, cold after reload | 112 / 133 / 208 (max) | 84 / 105 / 150 (max) |
| Terminal keystroke → echo | 22 / 28 / 41 | 21 / 29 / 41 |
| Codex composer keystroke | 8.8 / 9.6 / 13.9 | 9.8 / 10.6 / 11.5 |

From Node start, p50: window visible 574 → 432 ms, shell interactive
2,173 → 829 ms, terminal usable 2,807 → 1,186 ms. Process creation to Node
start took p50 120 ms. All 30 accepted launches confirmed the app frontmost;
the inspector changed the shell-interactive p50 by +0.4%.

New terminals now open on a shell started ahead of time; the 30 samples all
landed on one. One first-visit workspace switch timed out waiting for its
terminal socket to sync (the baseline had none); that sample is excluded from
the distribution above and not explained yet. The composer keystroke moved by
1 ms at p50 with a lower p95, which is within this journey's spread.

## Caveats (2026-10-08 run)

- The run was on battery with Low Power Mode off; the AC gate therefore marks it
  `acceptedRun: false`.
- The foreground-window check returned nothing during this run (an
  `lsappinfo` parsing bug, fixed afterwards). Launches used `open -a`, which
  activates the app, and the screen was unlocked for every launch.
- Workspace switching starts from a click in the command palette's workspace
  list, because the project sections in the sidebar were collapsed. It
  navigates to the same route as a sidebar click.
- Claude readiness is a heuristic: the CLI's prompt box, "Try" suggestion or
  `shift+tab` hint in the PTY output. Folder trust for the `perf-bench`
  worktree was accepted once by hand before the run.
- A workspace switch ends when the workspace and its terminal are visible.
  Revisits did not redial the socket (`no-redial`): the parked xterm is
  re-parented. On first visits after a reload the socket often redials after
  that point (created at a median of 124 ms, synced at 168 ms), so the first-visit
  number covers mount and paint, not reconnection.

## Findings outside the measurement

- A local ad-hoc build downloads the 356 MB 1.37.0 update on every launch and
  then fails Squirrel's code-signature validation. While that download runs, a
  SIGTERM quit stalls until it finishes. Launch measurements disable the
  updater for this reason.
- tRPC serializes `undefined` inputs into superjson `meta.values`, which the
  server reapplies over the JSON body. A proxy that edits only `json` silently
  loses its changes; the harness also deletes the matching `meta.values` keys.
