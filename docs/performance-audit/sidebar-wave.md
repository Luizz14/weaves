# Performance: sidebar wave

Scope approved: sidebar P18, P17 and status-side review of P11, on
`perf/performance-wave-2`. One commit per implemented item, local checks and
release builds, without launch/RSS/CPU benchmarks. The original worktree remains
untouched. No publication or remote setup is part of this work.

## P18

List reveal cascades have an explicit row count and a bounded total start delay:
180 ms on open and 100 ms on close. Small lists retain the previous 30/18 ms
spacing. Reduced motion disables both the cascade and container height/opacity
transition durations, including the expanded project wrapper and collapsed rail.
Row variants already honor reduced motion. This removes delay proportional to
list size; it does not establish a measured CPU or startup improvement.

Eight timing regression cases passed, including 100/500/1000 rows and reduced
motion. Desktop suite: 4057 passed, 8 failed, 2 errors; remaining failures match
P22. Typecheck retained the same 12 existing diagnostics, with none added.
Changed-file Biome and diff checks passed. Arm64 release compiled and packaged
with ad-hoc signing; validate:native-runtime and check:pty-daemon-bundle passed.
This item received source/timing checks, not a signed-in full-app animation QA.
No notarization or publication was performed.

## P17 decision

The user approved virtualization during navigation/scroll and the complete list
while any drag is active. Existing DnD geometry and hit-testing remain the model.
