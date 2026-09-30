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

## P17

Expanded project and Sessions lists use the existing TanStack virtualizer from
80 model rows onward, with 8-row overscan and measured heights (workspace chips
can add a second line). Pinned/rail/user-story lists retain their current layout.
The SortableContext and bulk selection retain the complete ordered model. Folder
members are omitted from the idle render window while collapsed; every model row
is mounted during any drag. Visible row keys/components survive that switch.
Large-list entry animations are disabled during scrolling/dragging.

The shared sidebar scroll container supplies each list's measured offset. Resize
observation updates offsets when content above changes. A pre-mutation scroll
snapshot keeps the visible row anchored when switching render strategies. The
active workspace, pending folder rename and last focused/interacted row stay
mounted; Tab/Shift-Tab traverse adjacent model rows beyond the current window,
preserving the nested controls within a row.

Three DOM regression tests passed for window bounds, retention, component
identity, collapsed members, full drag fallback and natural small-list layout.
A standalone Electron/Chromium fixture used the real useSidebarDnd hook and
sorting/collision/section-unit model with fake persistence actions: 1000
workspaces, one 100-member folder, mixed 28/56px heights and an empty pin lane.
Native mouse/keyboard and CDP wheel input exercised scrolling, 45 Tab steps,
keyboard pickup, cancel, pointer oscillation, edge autoscroll, layout change above,
collapsed-folder unit movement and pin drop. All passed, including retention of
100 folder members and no renderer errors. Screenshots were captured and the
scroll state was inspected. The fixture is synthetic; this is not signed-in
Superset end-to-end evidence or validation of a live host persistence write.

| Structural behavior in the 1000-workspace fixture | Previous model | Current |
| --- | --- | --- |
| Mounted project rows during scroll | All 1001 | About 30 at the tested scroll positions |
| Mounted project rows during drag | All 1001 | All 1001 |
| Open cascade maximum start delay, 1000 rows | 29.97 s | 0.18 s (P18) |
| Close cascade maximum start delay, 1000 rows | 17.982 s | 0.1 s (P18) |

These are row counts and deterministic animation bounds, not CPU/RSS/startup
benchmarks. Desktop suite: 4060 passed, 8 failed, 2 errors; no new failing names
relative to P18. Typecheck retained the same 12 diagnostics with none added.
Biome and diff checks passed. The arm64 release build/package and both native
runtime/PTY bundle guards passed. No notarization or publication was performed.
