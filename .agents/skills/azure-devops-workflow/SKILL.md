---
name: azure-devops-workflow
description: Maintain and extend the Superset Azure DevOps integration for the task board, work-item claiming and stages, linked worktrees, pull-request creation, PR review UI, Azure CLI execution, and per-host configuration. Use when changing Azure-backed Tasks or Pull Requests in this repository. Do not use for unrelated GitHub, Linear, or generic workspace changes.
---

# Azure DevOps Workflow

Keep Azure DevOps access in the host service and preserve the existing local-overlay model. Do not call `az`, Git, or the filesystem from the renderer.

## Before changing code

1. Use the relevant sections of [references/architecture.md](references/architecture.md) when changing ownership, persistence, or cross-process contracts, or when the affected layer is unclear.
2. Inspect the exact runtime, router, renderer component, schema, and focused tests affected by the request. This integration crosses process and persistence boundaries; do not infer a contract from the UI alone.
3. Check the current worktree before editing. Preserve unrelated changes, especially `bun.lock`, generated artifacts, and user work outside the Azure slice.
4. For visual or interaction design work, use `$make-interfaces-feel-better` when available and relevant; copy-only or data-wiring changes do not require it. Preserve the existing Tasks/Pull Requests layout, component colocation, accessibility, reduced-motion behavior, and Lingui usage.
5. If the request adds AI-generated PR content or another bounded suggestion, inspect `usePullRequestDraft` and use `$agy-quick-ai`; keep a deterministic, editable fallback.

## Preserve these contracts

- Azure commands run only through `packages/host-service/src/runtime/azure-devops/exec-az.ts`. Pass argument arrays, request JSON output, keep timeouts and the bounded environment, and never interpolate a shell command.
- Board configuration is per host and separate from repository configuration. One organization/work-item project can point to code repositories in different Azure projects.
- Azure owns work items and the child Task. Superset owns the extra `implementation`, `homologation`, and `review` stages in host SQLite; `completed` is derived when every linked worktree PR is merged.
- Claiming creates or reuses exactly one child Task titled `Em implementação`, assigned to the current/fallback identity and linked to the parent. Repeated or concurrent claims must remain idempotent.
- Items claimed by someone else stay hidden from “Mine”; in “All” they appear in Implementation and remain read-only in both card and detail views.
- Manual stage moves are adjacent only: Implementation ↔ Homologation ↔ Review. Backlog → Implementation performs the Azure claim. Backlog release and completion are automatic, not manual drops.
- A work item may own multiple worktrees. Persist the `azure-devops` provider, numeric work-item ID, and URL on every creation/adoption path.
- PR creation pushes the selected workspace branch, uses that workspace's per-project Azure repository configuration, links the Azure work item, and persists the generic PR/workspace history link. Once linked, show the existing PR instead of offering a duplicate.
- Re-read Azure PR state for completion; do not trust only the state captured at PR creation.
- `az repos pr list` has no `--skip`. If pagination is needed, request a larger `--top` window and slice locally.
- Mutating procedures are protected. Read-only diagnostics and queries may use the query procedure when the existing router convention permits it.
- Never exercise claim, stage, worktree, PR, comment, or thread mutations against the real Banese organization merely for smoke testing.

## Make changes at the right layer

- CLI parsing, WIQL, JSON Patch, PR normalization, diffs, and thread REST calls belong in `runtime/azure-devops/` with fake-`ExecAz` unit tests.
- Authorization, validation, config lookup, SQLite persistence, idempotence, and cross-runtime orchestration belong in the Azure tRPC router.
- Query fan-out, optimistic drag state, dialogs, navigation, and visual states belong in the renderer.
- Host SQLite schema changes go through `packages/host-service/src/db/schema.ts` and a generated host-service migration. Do not use the shared Postgres migration workflow for these tables and do not hand-edit generated migration SQL or snapshots.
- Keep one component per file and colocate single-use components under their parent with an `index.ts` barrel.

## Validate proportionally

Select the affected tests from these suites for runtime or router behavior changes. Include `migrations.test.ts` when changing schema or migrations:

```bash
bun test packages/host-service/src/runtime/azure-devops packages/host-service/src/trpc/router/azure-devops
```

For schema or migration changes:

```bash
bun test packages/host-service/src/db/migrations.test.ts
```

For renderer changes, select the affected desktop tests below with the command working directory set to `apps/desktop` so its Bun preload mocks Electron and Lingui correctly:

```bash
bun test src/renderer/routes/_authenticated/_dashboard/tasks/components/TasksView/TasksView.test.ts src/renderer/routes/_authenticated/_dashboard/tasks/stores/tasks-filter-state.test.ts src/renderer/routes/_authenticated/_dashboard/tasks/components/TasksView/components/AzureDevOpsContent/constants.test.ts
```

Also run Biome on changed sources, `bun run check:i18n` for user-facing copy, `git diff --check`, and `bun run --cwd apps/desktop compile:app` for cross-process/type-contract changes. Use `$cdp-verification` for real desktop UI verification when the authenticated local stack is available; keep Azure mutations disabled during visual QA.

If a global typecheck fails, distinguish errors in the changed Azure files from unrelated repository failures and report both accurately.
