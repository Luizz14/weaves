# Flutter execution in desktop v2

Flutter execution is available on local workspaces. Open a Flutter project (or a Dart file inside a nested Flutter project), select a launch configuration and a connected device, then choose **Run Flutter**. The toolbar provides hot reload, hot restart, stop, widget selection, Inspector and logs. Only one session can run per workspace.

## Launch configurations

Superset reads `.vscode/launch.json` as JSONC from the workspace root and from Flutter ancestors of the active file. Configurations use `type: "dart"` and `request: "launch"`. Supported fields include `name`, `program`, `cwd`, `args`, `toolArgs`, `env`, `envFile`, `deviceId`, `flutterMode` and `noDebug`. Relative program paths resolve against `cwd`; relative `cwd` and `envFile` resolve against the configuration folder. Host environment is overridden by the env file, then by explicit `env` entries. These values remain on the host and are not returned in profile metadata.

Supported substitutions include `${workspaceFolder}`, `${workspaceRoot}`, `${workspaceFolderBasename}`, `${file}`, `${fileDirname}`, `${fileBasename}`, `${fileBasenameNoExtension}`, `${relativeFile}`, `${pathSeparator}` and `${env:NAME}`. Variables requiring VS Code services (inputs, commands, config and named workspace folders) produce a disabled configuration with a reason.

Attach, compounds, tasks, custom tools, test entrypoints and external consoles are unsupported. Entrypoints, working directories and env files must stay inside the workspace, including symlink targets. A profile fingerprint is checked again at start, so edited configuration files require refreshing the selection. Without launch configurations, Flutter apps at the root or `example/lib/main.dart` receive a default profile.

SDK discovery checks the configured Dart executable's Flutter SDK, FVM and host PATH. Missing SDKs and devices produce errors; Superset does not download SDKs or manage emulators.

## Saving and session lifecycle

Start, reload and restart first save loaded dirty workspace buffers (including dirty buffers retained after closing a pane) through `SharedFileDocument`, including formatting. Conflicts and failed saves block the action. Successful manual Dart saves queue a debounced hot reload for the same session. Autosave and saves initiated by Flutter actions do not queue another reload. Profile and release sessions do not expose hot reload or Inspector.

Sessions live in the host runtime and survive workspace navigation and closing views. Stop, workspace deletion and host shutdown terminate the adapter and SDK service processes. Host restart does not reconnect an old session. Logs are bounded to 1 MiB and local service URLs are redacted.

## Inspector

The official SDK DevTools server is started lazily when opening Inspector, with a local Dart Tooling Daemon. DevTools embeds in an Electron browser surface. VM ToolEvent navigation and the DTD `Editor.navigateToCode` service reveal a validated workspace file and its 1-based line/column. **Open widget source** repeats the last navigation.

Inspector/output pane data contains only the session ID. VM service, DTD and DevTools URLs remain in runtime memory. Closing Inspector removes its browser surface without stopping the Flutter app. Hot restart refreshes the Inspector isolate before further selection commands.

## Implementation map and checks

- `packages/shared/src/flutter.ts`: public contracts.
- `packages/host-service/src/flutter/`: launch parsing, SDK discovery, framed DAP client, SDK services, session lifecycle and machine-only tRPC routes.
- Desktop v2 `components/FlutterControls`, `components/FlutterPane`: controls and transient DevTools embedding.
- `state/fileDocumentStore`: save-origin notifications; `state/lsp/coordinator.ts`: source reveal.

Run `bun test packages/host-service/src/flutter` and the desktop file-document tests for focused regressions, plus `bun run check:i18n` and desktop compilation. Test actual SDK compatibility using a temporary Flutter app and exercise launch/reload/restart/selection/Inspector/stop. A protocol smoke test alone is not desktop end-to-end evidence.
