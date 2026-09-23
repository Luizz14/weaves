---
name: superset-settings
description: Read and update the Superset desktop app's user settings (theme, fonts, terminal, git, notifications, behavior) via the superset CLI, including creating and installing custom themes from JSON. Use when asked to change app settings, switch or create a theme, adjust fonts, or configure desktop preferences without opening the settings UI.
---

# Superset settings via CLI

Change the desktop app's user settings from the command line with
`superset settings`. Works offline, no login required; everything is local
to this machine.

## Commands

```bash
superset settings list                 # every key: value, default, allowed values
superset settings get <key>            # effective value (default if unset)
superset settings set <key> <value>    # validated write
superset settings reset <key>          # back to the app default

superset settings theme list           # system + built-ins + imported custom themes
superset settings theme get
superset settings theme set <id>       # e.g. dark | light | monokai | system | <custom id>
superset settings theme set system --system-light light --system-dark monokai

superset settings theme export <id> [--out <file>]  # dump full theme JSON (starter)
superset settings theme import <file>               # add/replace custom themes (validated)
superset settings theme remove <id>                 # delete a custom theme
```

Prefer `--json` (auto-on in agent environments; parse it rather than
matching the human sentences) and `superset settings list` to discover keys
and allowed values instead of guessing. In Superset terminals `superset` is
already on PATH. `SUPERSET_HOME_DIR` overrides the target profile
(`~/.superset` by default); useful for testing against a sandbox copy.

For custom theme creation or editing, read [custom-themes.md](references/custom-themes.md). Ordinary preference changes do not require that reference.

## How changes take effect

After every write the CLI nudges the running desktop app
(`POST /settings-changed` on its local server) and the app refreshes
immediately, themes included, no restart. The command output tells you
which happened: "refreshed immediately" / "Applied to the running desktop
app" means the nudge landed. The notes below are the fallback behavior when
no app acknowledged (app not running, or an older app version):

- **Regular settings** (most of `settings set`): written to
  `~/.superset/local.db`. A running older app picks them up the next time
  its window regains focus; no restart needed.
- **Git settings** (`branchPrefixMode`, `branchPrefixCustom`,
  `worktreeBaseDir`): host-wide values written through the local host
  service (auth via its manifest, no login needed). Requires the desktop app
  or `superset start` to be running; also refreshed on window focus.
- **Ringtone caveat**: `selectedRingtoneId` changes what sound plays
  immediately, but the checkmark in Settings → Notifications only updates
  after an app restart.
- **Theme** (`settings theme set`): applies live when the nudge lands. If
  the output shows the restart fallback instead: quit the app cleanly first,
  then set, then relaunch; a running older app overwrites the file on its
  own writes. If you are an agent running inside a Superset terminal, never
  kill the app yourself (that kills your own session); ask the user to
  restart instead.
- Both stores are created by the desktop app. On a machine that never ran
  the app, `set` commands fail with a hint to launch it once.

## Key reference (by section)

Booleans accept `true/false/on/off/1/0/yes/no`.

| Section | Keys |
| --- | --- |
| behavior | `confirmOnQuit`, `fileOpenMode` (`split-pane\|new-tab`), `showResourceMonitor`, `showUsageInSidebar`, `openLinksInApp`, `defaultEditor` (vscode, cursor, zed, ...) |
| git | `branchPrefixMode` (`none\|github\|author\|custom`), `branchPrefixCustom`, `worktreeBaseDir`; host-wide, written through the local host service, so the app (or `superset start`) must be running |
| notifications | `selectedRingtoneId` (shamisen, arcade, ping, quick, doowap, woman, african, afrobeat, edm, comeback, shabala), `notificationSoundsMuted`, `notificationVolume` (0-100) |
| terminal | `terminalLinkBehavior` (`external-editor\|file-viewer`), `terminalParkedRuntimeCap` (2-64), `showPresetsBar`, `useCompactTerminalAddButton`, `autoApplyDefaultPreset`, `waitForSetupBeforeAgent` |
| terminal appearance | `terminalFontFamily`, `terminalFontSize` (10-24, 0.5 steps), `terminalLineHeight` (1-2.5), `terminalLetterSpacing` (-2-4), `terminalFontWeight` (100-900), `terminalLigatures`, `terminalMinimumContrast` (1\|3\|4.5\|7), `terminalCursorStyle` (`block\|bar\|underline`), `terminalCursorBlink` |
| editor appearance | `editorFontFamily`, `editorFontSize`, `editorLineHeight`, `editorLetterSpacing`, `editorFontWeight`, `editorLigatures` |

## Not settable here (by design)

- `exposeHostServiceViaRelay`: security-sensitive; the app gates it behind
  a plan check and an explicit confirmation dialog. Point the user to
  Settings → Security.
- Structured settings (terminal presets, agent preset overrides/custom
  agents, disabled agent hooks); use `superset agents ...` or the app UI.
- `deleteLocalBranch` and other renderer-only prefs stored in the app's
  localStorage (diff view, chat model, hotkey rebinds) are not reachable
  from outside the renderer.

## Examples

```bash
# Dark theme with bigger terminal text
superset settings theme set dark
superset settings set terminalFontSize 16
superset settings set terminalLineHeight 1.4

# Quieter notifications
superset settings set notificationVolume 40
superset settings set selectedRingtoneId ping

# Git hygiene (host service must be running)
superset settings set branchPrefixMode custom
superset settings set branchPrefixCustom kiet/
```
