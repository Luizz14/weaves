# Code editor preferences

Desktop v2 exposes **Settings → Code Editor** for appearance, editing, saving, inlay hints, language overrides, language servers, and the project panel. The v1 editor remains unchanged. Defaults retain manual saving and disable format on save. Existing editor font preferences remain authoritative and are synchronized with this page.

## Project panel

The panel follows the current local Zed profile: Plex Sans, 24 px comfortable rows, 20 px indentation, colored file and folder icons, compact directory chains, hidden dotfiles and Git-ignored paths, and automatic reveal. Sidebar position and tabs are retained. Creation, rename, deletion, refresh, search and collapse remain available through the panel menu, context menu and keyboard. Structural preference changes retain expanded directories, selection and scroll position and wait for active renaming to finish.

## Saving and formatting

Autosave supports editor focus loss, window focus loss, and a configurable delay. Delayed autosave does not run formatting. Language overrides inherit absent values from global preferences. Conflicted or orphaned documents are not automatically saved. Split panes share one buffer and one save operation.

Automatic formatting uses installed project tools: Biome for supported files with a Biome configuration, then Prettier with a configuration, then LSP formatting. Dart uses the detected Dart SDK. Explicit formatter selection is also available. Tools consume the current buffer through stdin and return formatted text; they do not write files directly. No tools are downloaded. Formatter failures save the buffer and show a warning. Stale formatter output cannot overwrite newer edits. Existing revision checks still protect concurrent file changes. Formatting currently runs on local hosts only.

Inlay hints are view decorations requested for the visible editor range. They do not modify document content. Type, parameter and other hint categories can be filtered globally or by language. Features depend on the language server capabilities.

## Import from Zed

Import is manual. Preview detects the local Zed settings file or accepts a chosen JSON/JSON5 file, displays current and proposed values, and applies only selected compatible entries. The selected installed Zed theme is converted into an editor-only palette. Theme activation and palette selection are paired. Unavailable fonts use the editor fallback. External formatter definitions, unsupported hints and invalid values are excluded. Agent credentials, API keys and unrelated preferences are never imported. If the source or theme changes between preview and application, preview must be refreshed.

## Asset provenance

Project file associations and base icons follow the local Zed source. Colored overrides come from Colored Zed Icons Theme v0.3.1. SVG notices are retained in `apps/desktop/src/resources/zed-icons/LICENSES`; Plex font licensing is retained beside the bundled fonts. `bun run --cwd apps/desktop generate:icons` rebuilds dark and light sprites from source assets. Personal Zed themes are imported at runtime and are not bundled.
