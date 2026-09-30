# Language servers in the v2 editor

The desktop v2 editor connects CodeMirror 6 to language servers running in the local host-service. Supported features are completion, diagnostics, hover, and definition navigation. Remote hosts and the v1 editor do not attach LSP clients.

## Configuration

Open **Settings → Code Editor → Language servers**. Each language has an enable switch, executable path, argument array, initialization options, and server configuration. Settings are stored in the host's SQLite database; changing a server's configuration stops its sessions so clients reconnect with the new configuration.

Servers start automatically when a supported file is opened. Executable discovery prefers an explicit path, then workspace `node_modules/.bin` directories, then the host's shell-derived PATH. An empty argument array uses the adapter's standard arguments. No language server or SDK is downloaded by the application.

| Files | Default server | Standard arguments |
| --- | --- | --- |
| TS/JS, JSX/TSX, MJS/CJS, MTS/CTS | `typescript-language-server` | `--stdio` |
| Dart | `dart` | `language-server --protocol=lsp` |
| Kotlin and Kotlin scripts | `kotlin-lsp` | `--stdio` |
| JSON/JSONC | `vscode-json-language-server` | `--stdio` |
| XML/XSD/XSL | `lemminx` | none |
| YAML/YML | `yaml-language-server` | `--stdio` |

TypeScript requires both the language server and TypeScript. JSON's server is distributed by `vscode-langservers-extracted`. Dart discovery prefers a workspace `.fvm/flutter_sdk`, then a detected Flutter SDK, then standalone Dart. For LemMinX, an explicit `.jar` path launches `java -jar`; JAVA_HOME and PATH are used to locate Java.

Kotlin/Android support is experimental and depends on the installed Kotlin LSP, JDK, Gradle, and Android SDK. XML provides generic XML/XSD/DTD intelligence; Android resource resolution is outside this integration. Features are available according to the server's capabilities.

Schema associations use each server's native configuration. For example, YAML accepts:

```json
{
  "yaml": {
    "schemas": { "./schema.json": "*.yaml" }
  }
}
```

Use an absolute file URI when the schema is outside the server's root. JSON accepts a `json.schemas` array with `fileMatch` and `url` or inline `schema`. XML uses LemMinX's `xml` configuration, including catalogs and file associations.

## Editor behavior

- Completion appears while typing; Ctrl+Space requests it explicitly.
- Hover shows server documentation, with sanitized Markdown.
- F12 or Cmd/Ctrl+click navigates to a definition. Multiple destinations open a chooser.
- Diagnostics appear inline and in the gutter. Both server notifications and pull diagnostics are supported.
- Missing or failed servers leave the editor usable. The editor status offers installation guidance and retry.

## Lifecycle and contracts

The authenticated `lsp.resolve` mutation resolves a workspace, language, root, and server configuration. It returns a session ID and root URI, or a disabled/missing status. `/lsp/:sessionId` accepts authenticated WebSockets containing JSON-RPC messages; the host bridges them to stdio using `vscode-jsonrpc`. `lsp.status`, `availability`, `restart`, and `release` expose lifecycle operations. `settings.lsp.get/set` manage host settings.

The renderer shares one session across panes of the same server/root. Different desktop windows own separate sessions. The host chooses the launch command and root; WebSocket messages cannot change the launch command. TypeScript uses the worktree root, Dart respects pub workspace manifests, and Kotlin uses the outer Gradle settings root inside the workspace.

`SharedFileDocument` is the source of text for the custom CodeMirror LSP workspace. Splits emit one didOpen/didChange stream, with monotonically increasing UTF-16 document versions. Successful saves emit didSave when supported. Reloads and external changes use the same synchronization path. Read-only snapshots do not attach language servers.

Connections retry twice, after one and five seconds, and replay current buffers. Diagnostics clear on disconnect and versioned stale results are ignored. Sessions stop after 60 seconds without documents, on workspace deletion, or host shutdown. Shutdown sends the protocol request and exit notification, then terminates the process tree if necessary. Initialization has a 120-second limit; interactive requests have a ten-second limit.

## Verification

```sh
bun test packages/shared/src/lsp.test.ts
bun run --cwd packages/host-service test src/lsp
cd apps/desktop
bun test 'src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp'
```

The tests cover executable/root resolution, migration, stdio framing, reverse configuration requests, shared buffers, save notifications, stale diagnostics, pull diagnostics, and reconnection. Real-server protocol checks were also run in temporary projects with TypeScript, Dart, JSON, and YAML.

The authenticated desktop journey was subsequently verified in a temporary local project: opening a TypeScript file through the project panel, server readiness, editor preference import, and focus-loss autosave with project Biome formatting. A real Android/Gradle project still requires validation. Kotlin and LemMinX were not installed on the machine. Global host-service typechecking reports the same 24 errors on HEAD and the implementation tree, outside the LSP changes. The two failing main-loop architecture checks also fail on HEAD, in unchanged Git integration code. The focused LSP/regression tests, Electron coupling check, host-service build, desktop build, and i18n check pass.
