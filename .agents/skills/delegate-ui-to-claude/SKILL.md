---
name: delegate-ui-to-claude
description: Delegate implementation of UI, layout, styling, and visual interactions in this Superset repository to Claude Code while the coordinating agent retains ownership of architecture, other layers, integration, and verification. Use for UI-only tasks and the UI slice of mixed features. Read-only analysis and planning do not launch workers.
---

# Delegate UI to Claude

Apply this workflow as the coordinator whenever an implementation contains UI work. A worker
whose assignment includes `ROLE: UI_WORKER` implements that assignment directly, reads applicable
project and design instructions, and does not spawn another worker. Explicit user instructions
and runtime restrictions take precedence over this workflow.

## Establish the UI slice

- Inspect the relevant implementation, applicable `AGENTS.md` files, and existing user changes.
  Resolve material ambiguities before assigning dependent work.
- Keep architecture, domain behavior, APIs, persistence, and non-presentation state management
  with the coordinator. Give Claude components, layout, styling, accessibility, motion, and
  explicitly assigned presentation wiring and focused UI tests.
- Agree on component inputs, callbacks, data types, and loading, empty, error, and success states
  before dispatch. Give the worker actual contract definitions and paths, not just a feature title.
  The worker reports a missing contract rather than inventing one or editing another layer.
- Assign file ownership explicitly, including creation locations. Shared integration files,
  generated files, and translation catalogs need one owner; keep catalogs with the coordinator
  by default. Claude must use Lingui and report new or changed messages for integration.
- Use the current workspace when edits are disjoint. Continue independent non-UI work in parallel.
  If ownership overlaps, finish and hand off that file before the worker edits it; do not allow
  concurrent edits to the same file. An isolated worker workspace is an alternative when needed,
  but its baseline must include required local changes and its handoff must have an integration plan.

## Prepare a bounded worker brief

Pass the following in the launch prompt, with references or attachments the worker can access:

```text
ROLE: UI_WORKER
Task: <stable task ID>
Feature: <user goal and acceptance criteria>
UI assignment: <specific work to implement>
Workspace: <ID, host, absolute checkout path>
Allowed edits: <existing files and directories for new components/tests>
Coordinator-owned files: <files the worker must not edit>
Baseline: <existing changes to preserve and relevant current contracts>
Contracts: <types, props, callbacks, data flow, state ownership, relevant paths>
States: <loading, empty, error, success, disabled, and read-only behavior as applicable>
Design: <references, screenshots, existing components, tokens, responsive behavior>
Instructions: <applicable AGENTS.md and available design/domain SKILL.md paths>
Checks: <focused commands and visual acceptance criteria>

Implement only the assigned UI slice. Do not delegate again. Preserve existing work.
Do not change APIs, data models, persistence, or coordinator-owned files.
Use repository component conventions and Lingui. Report catalog changes to the coordinator.
Report ambiguities or missing dependencies before making related decisions.
Do not commit, publish, push, launch real builds, or mutate external systems unless this
assignment explicitly authorizes that action. Do not regenerate shared catalogs concurrently.

Finish with:
SUPERSET_WORKER_DONE
task: <task ID>
summary: <implemented behavior>
files: <changed paths>
checks: <commands, results, visual evidence and gaps>
handoff: <integration needs, translation messages, unresolved issues or none>

If blocked, use SUPERSET_WORKER_BLOCKED with task, reason, and needs instead.
```

Select relevant design skills that are actually available, such as `frontend-design`, `react`,
`make-interfaces-feel-better`, `motion`, or project-specific guidance. Pass their absolute paths;
do not assume an external Claude session inherits the coordinator's skill catalog or conversation.
Use `--attachment` for local screenshots when appropriate and verify remote references are readable
from the worker's host. Keep secrets out of the brief.

## Launch and manage Claude Code

Use the Superset CLI for the terminal session. Verify installed command support with `--help`,
resolve the current workspace and its host, and verify a Claude Code preset is available before
launching. Omit model and effort flags to use its configured defaults unless the user specifies them.
Use `--local` for a local workspace; replace it with `--host <host-id>` consistently for a remote
workspace. Do not assume the CLI's default host is the current machine.

```bash
superset workspaces get "$SUPERSET_WORKSPACE_ID" --local --json
superset agents list --local --json
superset agents create --workspace "$SUPERSET_WORKSPACE_ID" --local --agent claude --prompt "$ui_prompt" --json
```

Set `ui_prompt` to the complete brief using shell-safe quoting before the launch. Use the actual
Claude preset/config ID discovered on the host if it differs from `claude`. In a development
stack with a different organization, consult `docs/agent-tooling.md` and use its dev CLI wrapper
instead of switching accounts or changing organization settings.

Require a terminal result and retain its returned `sessionId`. Track task ID, workspace/host,
terminal ID, owned files, dependencies, and status in the coordinator's context. Reuse that terminal
for follow-ups instead of launching replacement agents for each correction.

```bash
superset terminals read --workspace "$SUPERSET_WORKSPACE_ID" --local --terminal "$ui_terminal_id" --max-lines 240 --json
superset terminals send --workspace "$SUPERSET_WORKSPACE_ID" --local --terminal "$ui_terminal_id" --text "$ui_followup" --json
```

Read progress at a measured cadence while continuing independent work and keeping the user updated.
Send contract changes, answers, and review feedback to the worker; update ownership before edits
move between agents. A live or idle terminal is not proof of completion: require the completion
envelope and inspect its evidence. If a worker is blocked, continue unrelated work and resolve
the specific dependency. Do not repeat the same failed launch or correction unchanged.

If Superset, the target host, or Claude Code is unavailable, report the concrete blocker and ask
whether the coordinator should implement the UI directly or wait. Do not silently substitute
another agent, install tooling, change authentication, or abandon independent work.

## Integrate and verify

- Review the worker's diff against the recorded baseline and file ownership. In a shared worktree,
  its edits are already present; review them rather than applying them again. Preserve other work.
- Integrate UI with the real contracts and behavior. Add the required English and Portuguese
  translations and regenerate catalogs once UI messages are stable.
- Send UI corrections back to the same worker. The coordinator owns shared-file integration and
  fixes in the other layers, and independently verifies the resulting feature.
- Run proportionate tests, source checks, and applicable build/type checks. For visual changes,
  verify the actual target app when available; use `.agents/skills/cdp-verification/SKILL.md` for
  desktop verification and report unavailable environments and unverified visual behavior accurately.
- Finish only after the feature's required work is handled or its concrete external blockers are
  reported. Distinguish worker-reported checks from independent verification. Keep the terminal
  available for inspection; close it only when cleanup is requested or part of the agreed workflow.
