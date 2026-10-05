# P20: bounded Git status base variants

Approved scope: P20 only, on `perf/performance-wave-2`, starting from `993d69d5c`.
The user confirmed eight named bases per watched workspace plus the common
null/empty-base entry, with temporary overflow while reads are pending. Returning
to an evicted base performs a fresh full read. No performance benchmark is claimed.

## Implementation

Each read promotes its variant in the workspace map's insertion order. A pending
read count covers both computation in progress and requests queued behind it.
Trimming evicts only the least recently requested eligible named variants; the
common entry is never an LRU victim. Trimming also runs after success or failure,
so the count returns to the cap when pending work settles. The finalizer checks
workspace-map identity so a dropped/re-attached generation is not affected by an
older read finishing.

Existing per-variant serialization, scoped and broad invalidations, partial
patching, watcher attach/drop and read results retain their behavior. Evicted
variants are reconstructed through the existing full computation. No watcher,
host lifecycle, auth, polling, persistence, API response or frontend code changed.
The limit is variant cardinality, not a byte budget. Individual snapshots and
pending path sets still depend on repository/activity size; the existing
adversarial finding about unread variants accumulating pending paths was left
unchanged because this approved slice is the base-variant LRU.

## Structural comparison

| Synthetic cache scenario, after reads settle | Previous behavior | P20 |
| --- | --- | --- |
| 300 distinct named bases | 300 variants | 8 variants |
| 2000 ChangedFile entries per variant in that scenario | 600000 retained entries | 16000 retained entries |
| 50 named bases plus common status | 51 variants | At most 9 variants |
| Busy or queued variant | Retained | Retained, even during temporary overflow |
| Return to an evicted base | Cached indefinitely | Fresh full computation |

These are deterministic retention counts and cache behavior, not measured heap,
RSS, CPU, Git latency or startup improvements. The old adversarial test asserting
unbounded retention was updated to assert the approved LRU keys/count/entry bound.

## Validation

- 22 unit cases passed, including six new LRU cases: 50-base pressure, recency,
  workspace isolation, busy/queued reads, pending changes, temporary overflow,
  failure cleanup, and drop/re-attach during a read.
- The three cache unit/adversarial files passed 43 cases. The existing real-watcher
  case and six seeded real-Git fuzz cases also passed: 120 mixed steps per seed,
  both common and named variants, compared with fresh full snapshots.
- A new real-Git integration passed with 50 locally tracked base refs: recent
  cache hits, protected common snapshot, scoped updates versus fresh snapshots,
  eviction/refetch, staging and checkout. The fixture uses temporary repositories
  and no network remotes or shared databases. Its bases have local upstreams to
  satisfy the existing base-comparison contract.
- Existing staging/discard router checks passed 15 cases. Together the focused
  cache/watcher/fuzz/router/integration checks passed 66 cases.
- The monolithic host suite crashed in Bun 1.3.14 during the unchanged baseline,
  before P20 edits. The official --isolate run completed: 2064 passed, 8 todo,
  5 failed, 2 errors. Two partial-status cases timed out; repeated separately
  with the same default timeout they both passed. The two errors were follow-on
  assertions after timeout cleanup. The remaining three static guard failures
  report unchanged call sites/fields outside this patch (including Azure DevOps);
  two were already observed before the baseline crash. No allowlist/guard was
  weakened and those unrelated violations were not edited.
- Host typecheck retains the same two baseline diagnostics (Bitrise fetch typing
  and history ProcessEnv typing); none were added by P20. Desktop typecheck has
  the same 12 prior diagnostics. Desktop suite: 4088 passed, 8 failed, 2 errors,
  matching the previous wave's failing names.
- Changed-file Biome and diff checks passed. The standalone host-service and
  host-worker build passed.

The arm64 release compiled and packaged successfully with ad-hoc signing.
validate:native-runtime and check:pty-daemon-bundle passed before the commit.
The packaged ASAR passed native smoke checks for SQLite in memory, PTY
spawn/output, watcher, keymap, keyring, ast-grep and process metrics without
checkout-module resolution or user-profile mutation. No notarization was run.

P20 is complete locally. Only the Git status cache, its tests and this report
changed. No push, merge, publication, migration or other performance item was
included. The original worktree remains untouched.
