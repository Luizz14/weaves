# Performance: editor stable on open (no visual bump)

Branch `perf/editor-stable-open`. Target: opening or switching to a file in the
v2 editor paints it in its final state. Before this branch the file appeared
plain, and its layout, colors and language-server status changed after the
first frame, on every switch.

Numbers come from the packaged arm64 build of each step, on the author's
signed-in profile (Apple Mac17,3, macOS 27.0.1). The new `editor-switch`
journey measured them on the perf-bench workspace, with the TypeScript server
already warm and 30 measured samples per variant after 2 warmups.
Milliseconds are nearest-rank percentiles from the click or the Enter.

- **Paint** is the first frame showing the new document's lines.
- **Settled** is the last visual change other than diagnostics, within the
  2.5 s after paint.
- **Late** columns are the share of samples where that aspect changed after
  paint.

## Result

| Variant | Build | Paint p50 / p95 | Settled p50 / p95 | Late layout | Late colors | Late status | "Loading…" shown | Diagnostics p50 | CSS rules per open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `revisit` | Baseline | 96 / 128 | 121 / 157 | 100% | 100% | 100% | 100% | 490 | 88 |
| `revisit` | Phase 1 | 82 / 87 | 100 / 104 | 0% | 0% | 87% | 100% | 457 | 0 |
| `revisit` | Final | 64 / 66 | 64 / 66 | 0% | 0% | 0% | 0% | 64 | 0 |
| `revisit-scrolled` | Baseline | 103 / 135 | 235 / 284 | 100% | 100% | 100% | 100% | — | 88 |
| `revisit-scrolled` | Phase 1 | 83 / 102 | 116 / 125 | 100% | 0% | 90% | 100% | — | 0 |
| `revisit-scrolled` | Final | 67 / 70 | 67 / 70 | 0% | 0% | 0% | 0% | 68 | 0 |
| `tab-switch` | Baseline | 74 / 95 | 102 / 140 | 100% | 100% | 100% | 100% | 471 | 95 |
| `tab-switch` | Phase 1 | 51 / 66 | 67 / 83 | 0% | 0% | 97% | 100% | 436 | 1 |
| `tab-switch` | Final | 44 / 48 | 44 / 48 | 0% | 0% | 0% | 0% | 44 | 0 |
| `first` | Baseline | 74 / 94 | 105 / 144 | 100% | 60% | 100% | 100% | 2,068 | 88 |
| `first` | Phase 1 | 52 / 77 | 69 / 117 | 0% | 0% | 83% | 100% | 2,052 | 0 |
| `first` | Final | 67 / 104 | 67 / 104 | 0% | 0% | 0% | 0% | 434 | 0 |

The first three variants are now identical to their final state from the
first frame: no late change, no layout shift, no "Loading…" frame.

`first` opens a file that has never been loaded:

- In about half of the samples the file is not read yet. Two or three blank
  frames (the editor background, as in VS Code) come before paint.
- Its diagnostics arrive after paint whenever the Quick Open result was not
  highlighted long enough to prefetch it. The journey types the name and
  presses Enter at once. Someone reading the result list rests on it for more
  than the 120 ms dwell, and then the file is already open on the server.
- Its paint is 15 ms later than in Phase 1 (p50 67 vs 52, p95 104 vs 77). The
  language features and the status are now installed before the first frame
  instead of one round trip after it. The editor settles at the same time
  (p50 67 vs 69) and no longer changes after appearing.

Runs:

| Run | Build | Run id |
| --- | --- | --- |
| Baseline | `perf/startup-wave-3` | `20261009-155444` |
| Phase 1 | C1–C4 | `20261009-160345` |
| Final | every commit through `8aa81e046` | `20261009-161726` |

Raw output stays in `apps/desktop/.tmp/perf-journeys/`.

## What changed

Phase 1, the first frame in its final layout and colors:

- **Styles reused** (`1b055bcbb`). Each mount created the highlight style and
  the editor theme twice, and `style-mod` never removes rules. Every open added
  about 88 CSS rules. They are now memoized per theme, font and preferences.
- **Settings and language before the editor** (`f2116f15a`). The editor waits
  for the font and editor settings queries and for its language support, which
  are prefetched when the workspace mounts. It is created with them instead of
  being reconfigured one frame later.
- **Viewport parsed before paint** (`b04d4ae39`). CodeMirror parses 3,000
  characters for a new state and the rest when idle, at least 100 ms later;
  30% of the repository's TypeScript files are longer. The visible range is now
  parsed in a microtask, with a 150 ms budget per view. A full parse costs
  1.5 ms at the p90 file size and 3.4 ms at the p99. The view is created in a
  layout effect.
- **Gutters and status reserved** (`d51cd20bc`). The lint gutter used to arrive
  with the server and pushed the text right. It is now present from the first
  frame whenever the file is eligible for a server. Line numbers keep a
  three-digit minimum, like VS Code's workbench editors. The status starts
  from a prediction (running, disabled, missing or starting) instead of empty.

Phase 2, files ready when switching, as VS Code keeps models:

- **Documents stay loaded** (`7a860e24d`). Files in any tab of the layout stay
  in the store. Closed or replaced files stay in an LRU of 30 for 10 minutes,
  capped at 32 MB. Retained files are revalidated on reopen, away from the
  paint. "Loading…" only shows after 800 ms, the delay of VS Code's progress
  bar.
- **Editor state per document** (`33613d83a`). Unmounting saves the
  `EditorState` (syntax tree, diagnostics, folds, selection, undo) and the
  scroll snapshot. Remounting restores them, and an external change is applied
  as a minimal edit outside the undo history.
- **Attach without a round trip** (`1c02ee5f5`, `8aa81e046`). A running session
  that covers the file installs the language features in the same frame.
  Every server but Dart and Kotlin is rooted at the worktree, so this covers
  any directory. Inlay hints:
  - no plugin when every category is off;
  - first request immediate;
  - later requests use VS Code's adaptive debounce (25–625 ms);
  - a cache of 50 entries.
- **Diagnostics per file** (`59fedde91`). Tab files stay open on the server
  (up to 20), so switching tabs sends no didClose/didOpen. The last diagnostics
  of each file are applied when an editor attaches.
- **Scroll applied before paint** (`77cb984db`). The restored offset was
  applied in CodeMirror's first measure. When the editor mounted inside an
  animation frame, that measure ran one frame later: the file painted at the
  top and jumped 20,000–30,000 px, with a 0.17 layout shift. Reading layout
  right after creating the view runs the measure at once.

Phase 3, the server ready before the file:

- **Ten-minute lifetime** (`2467830fb`, `f6eab5d2f`). A workspace's
  coordinator survives leaving it for 10 minutes, at most two idle at a time.
  Its sessions, and the host's, stop 10 minutes after their last file closes
  instead of 60 seconds. Switching organization drops the other organization's
  idle ones.
- **Prefetch on intent** (`35e506146`). Highlighting a Quick Open result, or
  resting on a tree file for 120 ms, loads the document and opens it on its
  server (two at a time, for 30 s). Opening Quick Open warms the project of the
  last viewed file.

## Compared with VS Code

The design follows VS Code (`Projetos/Meus/vscode`) where the two editors
match:

- Models outlive their editor while a tab holds them.
- didOpen follows the model, not the visible editor.
- Gutter widths come from options, not from data.
- View state and inlay hints are restored synchronously.
- Feature requests use an adaptive debounce.
- A blank editor shows while loading, with progress only after 800 ms.

It goes further in four places, because Superset's Quick Open replaces the
pane while VS Code's opens a pinned tab:

- closed documents are kept for 10 minutes;
- the server survives leaving the workspace, which in VS Code is a window;
- servers are prefetched on intent, where VS Code starts them on the first
  model;
- a retained file's diagnostics are kept until it expires.

## Behavior changes

- Hidden tabs' files stay open on their language server, and their
  diagnostics stay current.
- Closed documents and their editor state are kept for 10 minutes, so reopening
  restores undo, selection, folds and scroll.
- Language servers keep running for 10 minutes after the last file closes or
  after leaving the workspace.
- "Loading…" appears only for reads longer than 800 ms; shorter ones show the
  editor background.

## Harness

`apps/desktop/scripts/perf-journeys/journeys/editor-switch.ts`. Its
`editorSettled` probe condition samples every animation frame for 2.5 s after
the new document appears:

- layout keys: content left, scroller box, scroll offset, gutter width, lint
  gutter;
- a highlight signature of the visible lines;
- the status text;
- diagnostics and inlay hints;
- "Loading…" and blank frames;
- layout shifts inside the pane;
- CSS rules added.

The first changed layout key and its delta are recorded as
`layoutDelta_<key>`, which is how the scroll jump was found.
