---
name: codex-chat
description: Develop or debug Superset Codex Chat UI, protocol, runtime, adapter, model discovery, and chat-specific settings. Excludes unrelated desktop preferences.
---

# Codex Chat Architecture & Development Guide

This skill guides agents working on the **Codex Chat** feature in the Superset monorepo. Codex Chat integrates the external OpenAI/Codex app-server with the Superset Desktop IDE, providing conversational workflows, autonomous goals, implementation plans, multi-workspace context, file attachments, and persisted model preferences.

---

## Read only what the task needs

- Use [architecture.md](references/architecture.md) to locate affected layers or understand cross-process dependencies.
- Use [workflows.md](references/workflows.md) for the specific implementation recipe or validation commands needed. Select affected tests; command examples are not a mandatory full-suite checklist.

## Critical Invariants & Rules

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
