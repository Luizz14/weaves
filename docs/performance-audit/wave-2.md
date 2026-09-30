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
