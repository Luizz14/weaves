# Workflows and validation

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
