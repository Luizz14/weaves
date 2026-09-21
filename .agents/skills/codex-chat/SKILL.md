---
name: codex-chat
description: Navigate, extend, debug, and test the Codex Chat feature in the Superset monorepo. Use when working on the Codex Chat UI (panes, composer, attachments, linked workspaces, plans, goals), chat protocol schemas, chat runtime, CodexAdapter, model discovery, or desktop settings.
---

# Codex Chat Architecture & Development Guide

This skill guides agents working on the **Codex Chat** feature in the Superset monorepo. Codex Chat integrates the external OpenAI/Codex app-server with the Superset Desktop IDE, providing conversational workflows, autonomous goals, implementation plans, multi-workspace context, file attachments, and persisted model preferences.

---

## 1. High-Level Architecture

The Codex Chat system spans five distinct layers across the monorepo:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Desktop UI (apps/desktop)                                                │
│    CodexChatPane ──► CodexSession ──► CodexComposer, CodexTurn, PlanCard,   │
│    GoalStatus, CodexQuestion, AttachmentTray, LinkedWorkspacesBar           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ React Hooks & tRPC Client
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 2. Client & Protocol (packages/chat, packages/shared)                       │
│    SessionClient ◄──► useChatSession ◄──► pure reducer                      │
│    Zod Protocol: Item, Turn, SessionState, CodexExecution, CodexGoal,       │
│    UserInputRequest, LinkedWorkspace                                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / WebSocket (/chat-v3/...)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 3. Host Service (packages/host-service)                                     │
│    mount.ts: WebSocket stream endpoint & tRPC router registration           │
│    resolveCwd, resolveWorkspace, resolveAttachmentPath                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ In-process ChatRuntime calls
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 4. Chat Runtime (packages/chat-runtime)                                     │
│    createChatRouter ──► ensureCodexSession (auto-resumption)                │
│    ChatRuntime (SQLite journal, event subscription)                         │
│    CodexAdapter (HarnessAdapter): manages state, turns, tools, goals        │
│    catalog.ts: model discovery (readCodexModels, validateCodexExecution)    │
│    codexModes.ts: sandbox policies & approval policies                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ JSON-RPC via stdio (CodexRpcClient)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 5. External Codex App Server                                                │
│    thread/start, turn/start, turn/interrupt, thread/resume, model/list      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory & Key File Map

### Desktop UI (`apps/desktop/src/renderer/`)
- **Pane Entry & Registration**:
  - `routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx`: Registers the `"codex-chat"` pane kind. Sets pane title and tab icons based on running/awaiting-input state.
  - `routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useWorkspacePaneOpeners/utils/openCodexSession/openCodexSession.ts`: Helper to switch to an existing tab or open a new one with `{ kind: "codex-chat", data: { sessionId, title } }`.
  - `routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useWorkspaceHotkeys/useWorkspaceHotkeys.ts`: Binds `NEW_CODEX_CHAT` hotkey (`⌘T` on macOS, `Ctrl+Shift+T` on Windows/Linux).
  - `routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/AddTabMenu/AddTabMenu.tsx`: Adds "Codex Chat" option and `RecentCodexChats` sub-menu.
  - `routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/AddTabMenu/components/RecentCodexChats/`: Lists past Codex sessions using `transport.listSessions({ workspaceId, harness: "codex" })`.
- **Main Chat Components**:
  - `routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/CodexChatPane/`:
    - `CodexChatPane.tsx`: Root container. Manages pre-session configuration, model selection, creation lifecycle, and initial prompt submission.
    - `components/CodexSession/CodexSession.tsx`: Active session view. Drives messages via `useChatSession` and `useTimeline`, handles goals, questions, and approvals.
    - `components/CodexComposer/CodexComposer.tsx`: Input area. Supports text prompt, goal armed toggle, file attachments (`Cmd+U`), linked workspaces dialog (`Cmd+I`), model picker, and stop button.
    - `components/CodexTurn/CodexTurn.tsx`: Groups items by turn (user message, agent message, reasoning, tool calls, plans, approvals, questions).
    - `components/CodexPlanCard/CodexPlanCard.tsx`: Renders written plans with copy and "Implement plan" action.
    - `components/GoalStatus/GoalStatus.tsx`: Displays active goal status, tokens used, and pause/resume/clear buttons.
    - `components/CodexQuestion/CodexQuestion.tsx`: Renders structured interactive multi-question prompts (`user_input_request`) using `ApprovalCard`.
    - `components/CodexWorkLog/CodexWorkLog.tsx`: Collapsible run of settled tool calls and internal steps.
    - `components/AttachmentTray/`: Displays uploaded attachments with retry and delete options.
    - `components/LinkedWorkspacesBar/` & `components/LinkWorkspacesDialog/`: Multi-workspace selection and chip bar.
- **Settings & Preferences**:
  - `routes/_authenticated/settings/codex-chat/components/CodexChatSettingsPage/`: UI for ordering presets, selecting default model/effort, and adding new shortcuts.
  - `hooks/useCodexChatSettings/useCodexChatSettings.ts`: Wraps `electronTrpc.settings.getCodexChat`.

### Protocol Layer (`packages/chat/` & `packages/shared/`)
- `packages/chat/src/protocol/`:
  - `items.ts`: Defines `Item` union: `user_message`, `agent_message`, `reasoning`, `tool_call`, `plan`, `approval_request`, `notice`, and `user_input_request`.
  - `codex.ts`: `CodexExecution` (`modelId`, `reasoningEffort`, `collaborationMode`, `fast`), `CodexModel`, `CodexGoal`, `CodexGoalAction`, `UserInputAnswers`.
  - `commands.ts`: Zod schemas for all mutating and querying procedures (`createSession`, `prompt`, `configureCodex`, `updateCodexGoal`, `respondToUserInput`, `setLinkedWorkspaces`, etc.).
  - `workspaces.ts`: `LinkedWorkspace` schema (`workspaceId`, `name`, `branch`, `path`).
- `packages/chat/src/client/sessionClient/`: Client transport and WebSocket streaming subscriber.
- `packages/shared/src/codex-chat-settings.ts`: Default presets and schema validation for user settings.

### Chat Runtime (`packages/chat-runtime/`)
- `src/harness/codex/`:
  - `codexAdapter/codexAdapter.ts`: Core adapter implementing `HarnessAdapter`. Handles Codex process lifecycle, turn management, tool mapping, streaming deltas, questions, goals, and sandbox policies.
  - `catalog.ts`: `readCodexModels`, `validateCodexExecution`, and cached `listCodexModels`.
  - `rpcClient/rpcClient.ts`: Low-level JSON-RPC client over stdio communicating with `codex app-server`.
  - `codexAdapter/codexModes/`: Approval policies (`untrusted`, `on-request`, `never`) and sandbox policies (`readOnly`, `workspaceWrite`, `dangerFullAccess`).
- `src/router/router/`:
  - `router.ts`: tRPC router exposing procedures to the client.
  - `ensureCodexSession.ts`: Auto-resumes dormant sessions, cleans up orphaned in-flight turns/tools/approvals, and restores execution context.

### Host Service (`packages/host-service/`)
- `src/chat-v3/mount.ts`: Mounts tRPC endpoint (`/chat-v3/trpc`) and WebSocket stream (`/chat-v3/sessions/:sessionId/stream`).
- `src/chat-v3/resolveCwd.ts`: Resolves workspace working directories and linked workspace paths from the host database.

### Local Database (`packages/local-db/`)
- `src/schema/schema.ts` / `drizzle/0057_codex_chat_settings.sql`: Desktop SQLite table storing user-configured model presets and default selections.

---

## 3. Critical Invariants & Rules

When modifying or adding features to Codex Chat, you **MUST** follow these rules:

### 1. Authoritative Snapshots vs Deltas
- **Items are flat and snapshots are full**: The client reducer simply runs `items.set(item.id, item)`. There is no patch format.
- **Deltas are volatile**: Live text/terminal deltas arrive on WebSocket for rendering responsiveness, but are **never persisted** and are immediately superseded when the authoritative item snapshot arrives.

### 2. Generational Goal Tracking
- When `updateGoal({ action: "set" | "resume" })` is called, `goalActivationGeneration` is incremented.
- Starting a goal involves pausing, canceling any running turn, waiting for idle, starting a kickoff turn, and setting status to `active`.
- Every asynchronous continuation must check:
  ```ts
  if (generation !== this.goalActivationGeneration || this.disposed) return;
  ```
  This prevents race conditions if the user rapidly pauses or starts another goal while turn cancellation is pending.

### 3. Linked Workspace Idempotence & Mentions
- Codex app-server only learns about linked workspaces through `@mention` objects in `turn/start` input.
- To prevent prompt bloat, `CodexAdapter.linkedWorkspaceMentions()` computes a signature and **only includes mentions on the first turn after a change**.
- Linked workspace directories are also added to `writableRoots` in `codexSandboxPolicy(modeId, cwd, extraWritableRoots)`.

### 4. File Attachments: Images vs Documents
- When transforming attachments into Codex input in `toCodexInput`:
  - `image/*` MIME types are mapped to `{ type: "localImage", path: attachment.path }`.
  - All other MIME types are mapped to `{ type: "mention", name: entry.name, path: attachment.path }`.
  - Unresolvable attachments emit a transient `info` notice instead of crashing the turn.

### 5. Resumption of Dormant Sessions (`ensureCodexSession`)
- The host lazily keeps sessions alive. If a session is cold (`not_loaded`), any mutating command (`prompt`, `configureCodex`, `setMode`, `setLinkedWorkspaces`) triggers `ensureCodexSession`.
- `ensureCodexSession` replays history from the journal, marks running turns as `interrupted`, pending approvals/questions as `stale`, and running tool calls as `canceled` before creating the live adapter instance.

---

## 4. Developer Workflows & Recipes

### A. Adding a New Command to the Chat Router
1. **Define Schema**: Add input schema in `packages/chat/src/protocol/commands.ts`.
2. **Add to Router**: Add procedure in `packages/chat-runtime/src/router/router/router.ts`. If it targets an existing session, wrap with `await ensureCodexSession(input.sessionId)`.
3. **Add to Commands Handler**: Add execution logic in `packages/chat-runtime/src/commands/commands/commands.ts`.
4. **Update Harness Adapter**: If harness-specific, define method in `packages/chat-runtime/src/harness/types.ts` and implement in `CodexAdapter`.
5. **Expose in Client**: Add method to `SessionClient` in `packages/chat/src/client/sessionClient/sessionClient.ts`.

### B. Handling New Codex Notifications or Requests
1. **Wire Schemas**: Check/add schema in `packages/chat-runtime/src/harness/codex/wire/wire.ts`.
2. **Ignored vs Handled**:
   - If not relevant to UI/state, add to `IGNORED_METHODS` in `codexAdapter.ts`.
   - If it is a notification, route it in `onNotification` (e.g. `TEXT_DELTA_METHODS`, `NOTICE_METHODS`).
   - If it is a server request (requires a response), handle in `onServerRequest` and ensure `client.respond(...)` or `client.respondWithError(...)` is called so Codex is never left hanging.

### C. Updating Desktop UI & Components
- Follow the monorepo conventions:
  - One folder per component: `ComponentName/ComponentName.tsx` + `index.ts`.
  - Colocate tests: `ComponentName.test.tsx`.
  - Use `@lingui/react/macro` (`<Trans>`, `useLingui().t`) for all user-facing strings.
  - Check motion preferences with `useReducedMotion()`.

---

## 5. Testing Guide

### Running Chat Package Tests
From the monorepo root:
```bash
bun test packages/chat/ packages/chat-runtime/ packages/shared/src/codex-chat-settings.test.ts packages/local-db/src/schema/codexSettings.test.ts
```

### Running Desktop Chat Tests
> [!IMPORTANT]
> Desktop tests **MUST** be executed with `cwd` set to `apps/desktop`. Running `bun test apps/desktop/...` from root will fail because `apps/desktop/bunfig.toml` preloads `./test-setup.ts` (which mocks electron APIs and Lingui macros).

```bash
# Correct way:
cd apps/desktop
bun test src/renderer/routes/_authenticated/_dashboard/v2-workspace/\$workspaceId/hooks/usePaneRegistry/components/CodexChatPane/
bun test src/renderer/hotkeys/hooks/useHotkey/codexCreation.test.tsx
bun test src/renderer/routes/_authenticated/_dashboard/v2-workspace/\$workspaceId/hooks/useWorkspacePaneOpeners/utils/openCodexSession/
```

### Checking Translations
When adding or altering user-facing text:
```bash
bun run check:i18n
```
Update all `locales/*/messages.po` accordingly.
