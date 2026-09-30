# Git changes panel

The desktop v2 Changes panel follows the local Zed presentation: a flat path-sorted list, Plex Sans, 24 px rows, colored file icons, status-colored labels and staging checkboxes. Its background uses the same application background token as the sidebar. Tree view and search remain available; large lists are virtualized.

## Staging and diff selection

Local changes are represented once per path. The checkbox is empty for unstaged files, checked for staged files, and mixed for partially staged files. Checking an empty or mixed checkbox stages the remaining worktree changes for that file. Unchecking a checked checkbox unstages the file without modifying its worktree content. Pending staging operations disable duplicate actions.

All, Staged and Unstaged filters select the displayed source and its diff statistics. The default source is unstaged when present, otherwise staged. Partial-file context menus expose the other side explicitly. Existing diff navigation, modifier shortcuts, historical comparisons, commit and remote synchronization remain unchanged. Header bulk operations apply to the repository, retain explicit Stage all/Unstage all labels, and follow the active staging filter.

## Discard

Individual discard restores tracked files from the index using `git restore --worktree`, preserving staged changes. Untracked files retain the existing deletion behavior and confirmation. Unmerged files reject restore and preserve the conflict/index. Bulk discard keeps the existing explicit staged/unstaged confirmations.

## Preferences

The existing v2 preference row contains a bounded presentation-version marker. On the first Changes-panel mount after upgrading, the migration initializes flat view and local-change filters once. Subsequent explicit view/filter choices are preserved. No new storage keys, database migrations or Git endpoints are introduced.
