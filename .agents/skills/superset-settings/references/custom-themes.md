## Creating custom themes

Two paths; both end with import → set (a running app restyles live).

**From scratch**: a minimal file is enough. Every color you omit is filled
in from the built-in base theme for your declared `type`, so start small and
override only what you care about:

```json
{
  "name": "Midnight Ocean",
  "type": "dark",
  "ui": {
    "background": "#071A2E",
    "sidebar": "#061426",
    "primary": "#38BDF8"
  },
  "terminal": { "background": "#071A2E", "cursor": "#38BDF8" }
}
```

```bash
superset settings theme import ocean.json   # -> Imported 1 theme: midnight-ocean
superset settings theme set midnight-ocean  # a running app applies it live
```

**From a starter**: export any theme's complete definition (all ~38 ui +
21 terminal colors) and edit it. Best when restyling everything:

```bash
superset settings theme export dark --out my-theme.json
# edit, then:
superset settings theme import my-theme.json && superset settings theme set my-theme
```

### Theme file anatomy

| Field | Notes |
| --- | --- |
| `name` / `id` | either works; the id is slugified (`"Midnight Ocean"` → `midnight-ocean`). Reserved: `dark`, `light`, `monokai`, `system` |
| `type` | `"dark"` or `"light"` (defaults to dark); picks the base theme that fills omitted colors |
| `ui` | app chrome. Highest-impact keys: `background`, `foreground`, `sidebar`, `card`, `popover`, `primary`, `accent`, `muted`, `border`, `input`, `ring`, plus `sidebar*` variants |
| `terminal` | xterm colors: `background`, `foreground`, `cursor`, `selectionBackground`, and the 16 ANSI names (`red`, `brightRed`, ...) |
| `editor` | optional `{ "colors": {...}, "syntax": {...} }` for the file editor; generated from `ui`/`type` when omitted |
| `author`, `version`, `description` | optional metadata |

Rules (same parser as the app's Appearance → Import): all colors are CSS color
strings; missing colors inherit from the base; a file can hold one theme, an
array, or a pack `{ "themes": [...] }`; max 256 KB; re-importing an id
replaces that theme; import never activates; `theme set` does.

### Verify and iterate

```bash
superset settings theme list      # SOURCE column shows custom; * marks active
superset settings theme get       # active theme id
superset settings theme export midnight-ocean   # round-trip the stored result
```

Iterating on colors: each `import` replaces the theme, and a running app
applies it live; the loop is edit → import → `theme set <id>` (re-set to
re-apply the active theme after edits).

## Optional cleanup

Remove a theme only when it is a disposable test theme created for this task or removal was requested. Removal is not a verification step; removing the active theme falls back to dark.

```bash
superset settings theme remove <disposable-theme-id>
```
