# Architecture and file map

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
