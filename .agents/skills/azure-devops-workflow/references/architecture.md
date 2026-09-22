# Azure DevOps integration architecture

Read the sections relevant to the requested change. Search the listed roots again before editing because file names may evolve.

## Data flow

```text
Desktop renderer
  -> host-service tRPC azureDevOps router
    -> Azure runtime
      -> execAz argument-array boundary
        -> Azure CLI / Azure DevOps extension

Desktop renderer
  -> workspace creation store
    -> host-service workspace router/store
      -> host SQLite external work-item link
```

The board combines live Azure data with local host state:

- Live: iterations, parent work items, exact `Em implementação` child Tasks, identities, PRs, policies, reviewers, and threads.
- Local: board configuration, manual workflow stage, child ID cache, repository configuration, workspace links, and generic PR history.

## Host-service map

- `packages/host-service/src/runtime/azure-devops/exec-az.ts`: single Azure CLI process boundary and public error redaction.
- `packages/host-service/src/runtime/azure-devops/diagnostics.ts`: CLI, extension, authentication, and repository probes.
- `packages/host-service/src/runtime/azure-devops/board.ts`: iterations, WIQL, work-item detail, claim discovery, and child creation.
- `packages/host-service/src/runtime/azure-devops/pull-requests.ts`: PR list/detail/create, policy checks, local Git diff, and Azure thread REST calls.
- `packages/host-service/src/trpc/router/azure-devops/azure-devops.ts`: validation, configuration, stage transitions, workspace/PR linking, and exposed API.
- `packages/host-service/src/db/schema.ts`: `azure_devops_project_configs`, `azure_devops_board_configs`, `azure_devops_work_item_states`, workspace external-link columns, and `pull_requests.repo_project`.
- `packages/host-service/drizzle/0036_azure_devops_project_configs.sql` and `0037_azure_devops_board.sql`: initial generated migrations. Generate a new migration for later schema changes; never rewrite applied history.
- Workspace propagation paths: `packages/host-service/src/events/types.ts`, `packages/host-service/src/workspaces/local-workspace-store.ts`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts`, `packages/host-service/src/trpc/router/project/utils/create-local-workspace.ts`, and `packages/host-service/src/trpc/router/workspace-creation/shared/adopt-existing-worktree.ts`.

## Renderer map

- Tasks source routing/filtering: `apps/desktop/src/renderer/routes/_authenticated/_dashboard/tasks/layout.tsx`, `TasksView`, `TasksTopBar`, and `tasks-filter-state.ts`.
- Board root: `TasksView/components/AzureDevOpsContent/AzureDevOpsContent.tsx`.
- Board interaction: sibling `components/AzureDevOpsBoard/`, `AzureDevOpsBoardColumn/`, and `AzureDevOpsWorkItemCard/`; transition policy is in `constants.ts`.
- Work-item detail: `tasks/azure/$workItemId/page.tsx`.
- Worktree and PR actions: the detail route's `CreateAzureWorktreeDialog`, `AzureWorktreeRow`, and `CreateAzurePullRequestDialog`.
- Future AI seam: `tasks/azure/$workItemId/hooks/usePullRequestDraft/usePullRequestDraft.ts`.
- Per-code-project configuration: `settings/v2-project/$projectId/.../AzureDevOpsSection/`.
- PR source/list: `pull-requests/components/PullRequestsView/` and its `AzurePullRequestsContent`.
- Azure PR detail: `pull-requests/$prNumber/components/AzurePullRequestDetail/`, including `AzurePullRequestThreads`.

## Domain details

### Configuration split

`azure_devops_board_configs` is a singleton on the host for the one Banese work-item board: organization URL, work-item project, team, area path, fallback identity, and allowed parent types.

`azure_devops_project_configs` is keyed by Superset project ID and describes the code repository: organization URL, Azure project, and repository. Do not merge these models; a Banese work item can lead to worktrees in several repositories and Azure projects.

### Board composition

The runtime executes separate flat WIQL queries for parent work items and child Tasks. Join children by `System.Parent`; prefer the current user's child if more than one legacy child exists. Escape WIQL literals and keep allowed work-item types configured rather than hard-coded in the renderer.

The default view excludes items with another user's implementation child. The All view includes them as read-only. Local stages override the inferred implementation stage only for items Superset has claimed.

### PR persistence

Azure PR IDs are unique only within their Azure project/repository identity. The generic `pull_requests` unique key includes provider, organization owner, Azure project, repository, and PR number. GitHub rows use the empty default for `repoProject` to preserve their prior identity.

Workspace completion must prefer a fresh Azure `getPullRequest` state and fall back to the stored generic row only when the live read is unavailable.

### External mutation boundary

Treat these as consequential operations requiring the user's requested flow: child creation, stage changes that alter persisted Superset state, branch push, PR creation, PR replies, and thread resolution. Automated tests use fake `ExecAz`; UI verification may read real Azure data but must not perform those mutations unless explicitly authorized.

For `az devops invoke` bodies, write JSON to a mode-`0600` temporary directory and remove it in `finally`. Never place PATs, command output, or Azure response bodies into public error messages.
