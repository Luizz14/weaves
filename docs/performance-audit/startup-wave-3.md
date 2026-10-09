# Performance: startup wave 3 (launch and new terminal)

Branch `perf/startup-wave-3`. Targets, from the 2026-10-08 journey baseline
(`journeys.md`): window visible, shell interactive and terminal usable at
launch, and opening a new terminal.

All numbers are milliseconds, nearest-rank percentiles, from the packaged arm64
build of each step on the author's signed-in profile (Apple M5, macOS 27.0.1).
Launch numbers are P00 markers measured from Node start; each launch run is 21
launches with the first one discarded. A change was kept when its target
improved by more than max(15 ms, 3%) without regressing another marker;
otherwise it was reverted.

## Result

| Milestone (p50 / p75) | Baseline (P0) | Final (E) | |
| --- | --- | --- | --- |
| Window visible | 574 / 584 | 428 / 434 | 1.3x |
| First React commit | 584 / 593 | 557 / 561 | |
| Shell interactive | 2,118 / 2,282 | 821 / 828 | 2.6x |
| Host-service healthy | 2,069 / 4,584 | 710 / 717 | 2.9x (6.4x p75) |
| Terminal usable | 3,601 / 5,322 | 1,192 / 1,200 | 3.0x (4.4x p75) |
| New terminal, ⌘J → first output (p50 / p95) | 588 / 633 | 139 / 158 | 4.2x |

The full journey run after the wave (`20261009-053108`, every journey, see
`journeys.md`) confirms it: from Node start, window visible 432 ms, shell
interactive 829 ms, terminal usable 1,186 ms (p50); new terminal 144 / 153 ms
(p50 / p95); no other journey regressed.

P0 is the rebaseline taken with the new markers (run `20261009-034016`); it is
slower than the 2026-10-08 run in `journeys.md` (terminal usable p50 3,601 vs
2,807) because 8 of its 20 launches hit the cancelled-start bug below.

## Steps

| Run | Window visible | React commit | Auth hydrated | Shell interactive | Host healthy | Host URL in renderer | Terminal usable | New terminal p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 baseline | 574 / 584 | 584 / 593 | 1,645 / 1,831 | 2,118 / 2,282 | 2,069 / 4,584 | 2,446 / 4,713 | 3,601 / 5,322 | 588 / 633 |
| Phase 1 (host) | 560 / 568 | 569 / 578 | 1,852 / 2,011 | 2,284 / 2,552 | 1,058 / 1,256 | 2,294 / 2,580 | 3,061 / 3,966 | 583 / 595 |
| Phase 2 (renderer) | 557 / 567 | 565 / 575 | 1,247 / 1,387 | 1,327 / 1,566 | 1,022 / 1,092 | 1,308 / 1,589 | 1,864 / 2,127 | 581 / 599 |
| C (session, host spawn) | 633 / 641 | 642 / 650 | 842 / 847 | 922 / 934 | 794 / 825 | 904 / 913 | 1,314 / 1,722 | 578 / 597 |
| D (window, host order) | 426 / 433 | 555 / 560 | 741 / 749 | 820 / 826 | 704 / 711 | 803 / 821 | 1,188 / 1,241 | 583 / 666 |
| E (spare shells) | 428 / 434 | 557 / 561 | 746 / 751 | 821 / 828 | 710 / 717 | 805 / 811 | 1,192 / 1,200 | 139 / 158 |

Runs: P0 `20261009-034016`, Phase 1 `20261009-035831`, Phase 2
`20261009-042420`, C `20261009-044553`, D `20261009-050049`, E
`20261009-052406`. Raw output stays in `apps/desktop/.tmp/perf-journeys/`.

## What was slow, and what changed

Instrumentation (`97be8019a`) added main, host-service child and renderer
markers to P00; the host child reports its markers on stdout and main stays the
only writer.

Terminal usable (host-service path):

- **A booting host was killed on every launch where it was slow.** The renderer
  re-confirms the organization membership each launch; main reacted with a
  reconcile that bumped the start generation and SIGTERMed the host mid-boot
  (8 of 20 launches, +2.3 s each). Unchanged membership no longer bumps the
  generation (`877e85d68`).
- **Two login-shell probes before the spawn.** main's boot probe was still
  running when the spawn path started its own; one in-flight probe per process
  now (`35e86d5df`).
- **The host waited for its own `zsh -il` before listening.** The probe now
  resolves in the background like the standalone host, the pty-daemon bootstrap
  starts at boot (`e7cc1469d`), and adopting a live terminal no longer waits for
  the probe at all (`740691ee3`).
- **The health poll slept 200 ms.** The child announces it is listening on
  stdout and the poll retries at once (`6d4461d9b`).
- **The spawn waited for main's probe.** At launch, before main's probe has
  ever finished, the child merges the login-shell env itself (`92902008b`,
  `6a95be6bf`).
- **All organizations booted at once, mid-boot.** Host services start after the
  first window, and organizations no window shows start after those that do
  (`faf4b77ab`).
- Adopting a manifest whose pid is dead skips the 2.5 s health poll
  (`f914a71a6`); it only shows after an unclean exit.

Shell interactive (renderer path):

- The persisted query cache gated every boot IPC query behind IndexedDB
  (`8662c60a5`).
- Hydration awaited a `/token` round trip that get-session's `set-auth-jwt`
  header already covers (`bedb257c2`).
- The window organization waited for `organization.list`; the session carries
  the membership (`f7fd10274`).
- **Optimistic session** (`17d96cb10`): the last session the server confirmed is
  kept in the encrypted auth file and seeds the auth client at launch; the
  server answer revalidates it in the background. Only snapshots that would not
  redirect are used, so sign-in, onboarding, deletion and create-organization
  redirects still come from the server (#5729).
- Every token-file read and write ran a 31 ms `scryptSync` on the main thread,
  four to five times per launch; the key is now derived once, off-thread
  (`c69584364`).

Window visible:

- The window was shown at `did-finish-load`; it is now shown as soon as it is
  created, on the active theme's background (`5e6c1128f`). Windows with a
  persisted zoom keep the old behavior.
- Notification Center registration, the Apple Events and local-network prompts
  and the dock icon moved after the first show; the unused TanStack DB
  persistence (a 58 MB SQLite opened every launch) was removed (`2d4b6a81c`).
- Node's compile cache for main and the host child (`aaa0b150e`): small, not
  isolated (bootstrap imports 164 → 144 ms together with the removed imports).

New terminal:

- ~480 ms of the ~580 ms was the user's shell reaching its prompt. The host now
  keeps a pre-started shell per active workspace and the next ⌘J adopts it
  (`04154629b`, `a51870dff`). At most three spares per host, ten minutes each,
  desktop hosts only, discarded when rc files, the worktree's HEAD, the default
  account env or the theme change. `SUPERSET_TERMINAL_SPARE_SHELLS=0` turns it
  off.

## Not kept

- **Deferring the host's boot sweeps** (first terminal reap, port-scan warm-up
  and pull-request sweeps 5 s after boot): attach p50 85 → 108 ms, p75 110 → 122,
  p95 207 → 323; mixed and confounded, reverted.
- **Starting host services before `app.whenReady()`**: the token read only
  resumed when the main thread yielded, and the spawns then landed on the
  window path (window created 379 → 449 ms). Replaced by starting them after the
  first window.

## Not done

- **`app://` scheme with V8 code cache, with storage migration (phase 5).** The
  remaining renderer cost before the first React commit is ~130 ms after the
  window shows; the change moves every localStorage and IndexedDB key to a new
  origin and needs a CORS bridge for the API, so it needs its own spike.
- **Router and bundle work (W3-03, W3-06, W3-09..13).** First React commit →
  auth hydrated is ~185 ms and not instrumented yet; route chunks loading
  before the root layout mounts are the likely part. Next target for shell
  interactive, after a marker for the root layout's first mount.
- `onStatusChange` snapshot on subscribe and the `getConnection` race: no longer
  on the critical path, since the host is healthy ~100 ms before the renderer
  asks for its URL.
- Spawning new terminals at the pane's real size and fork-free zsh wrappers:
  superseded by spare shells for the measured journey.
- Moving agent-integration provisioning after the window (~17 ms).

## Behavior changes to know

- An offline launch with a confirmed session snapshot shows the app with its
  local features instead of "You're offline". The first launch after updating
  has no snapshot yet and waits for the server once.
- The window appears on the theme's background ~130 ms before its content.
- At launch the host child merges the login-shell env itself; a NODE_OPTIONS
  set only in a shell rc no longer reaches a host spawned before main's probe
  finished (later respawns still receive it, as before).
- Up to three idle shells per host are kept for new terminals.

## Verification

- Unit and integration tests for every change; the host-service node tests run
  under Electron's Node (`ELECTRON_RUN_AS_NODE=1`), whose native modules match.
- Suites compared with the tree before each change: renderer 16 failures and 6
  load errors, host-service 6 failures, all pre-existing and in untouched areas.
- Not exercised by the harness, still to check by hand: sign out and in, switch
  account, join and leave an organization, offline launch, multiple windows,
  light and dark themes, a maximized window, a persisted zoom level, `kill -9`
  and relaunch, `git push` and `gh` right after launch, editing `.zshrc` then
  ⌘J, switching branch then ⌘J.
