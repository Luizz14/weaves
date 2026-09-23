---
name: automate
description: Turn a recurring chore into a Superset automation. Drafts the agent prompt, confirms schedule and target, creates it with the CLI, and reviews the first run together. Use when the user wants a scheduled or recurring agent, a daily or weekly job, or says things like "every morning do X", "automate this", "set up a cron agent", "run this on a schedule".
argument-hint: describe the recurring task
allowed-tools: Bash(superset:*)
---

# Superset Automate

Turn "I keep doing X every morning" into an automation that does X on a schedule.

## 1. Understand the chore

Pin down: the outcome, the cadence, the inputs it reads, and what "done" looks like. Then draft the automation prompt as instructions for an agent with zero context. If the task has rules that will evolve (triage criteria, formats), put them in a document the automation reads at runtime so they can be edited without touching the prompt.

A digest, report, or scorecard needs an agreed delivery destination. Include the output format, destination, visibility, and any recurring publication in the automation approval. Write locally when sharing was not requested. Only add publication to the prompt when that delivery is authorized; for example:

```
...write the digest to digest.html, then publish it:
superset pages publish digest.html --visibility just_me --title "Nightly triage" --label "what changed today"
```

A page is identified by its workspace plus its path, so **which target you picked in step 2 decides whether history accumulates**. A project target creates a fresh workspace per run, which means a new page every run rather than a new version of one. For a report meant to build up history, use a workspace target, or capture the page id from the first run and have the prompt pass `--page <id>` from then on.

## 2. Pick the target

- `superset projects list`: a project target creates a fresh workspace per run (most tasks)
- `superset workspaces list --local`: a workspace target reuses the same workspace every run (stateful tasks)

## 3. Confirm before creating

Show the user (use the ask_user tool if available): the name, schedule as an RRULE, agent, target, complete prompt, delivery destination and visibility, first-run effects, and exact command. Create only with explicit authorization for those details; reuse that authorization if already given, and ask only about unresolved choices or changed effects.

## 4. Create and shake down

```bash
superset automations create \
  --name "Daily issue triage" \
  --rrule "FREQ=DAILY;BYHOUR=9;BYMINUTE=0" \
  --timezone America/Los_Angeles \
  --project <id> \
  --agent claude \
  --prompt-file /tmp/automation-prompt.md
```

(`--workspace <id>` instead of `--project` for reuse mode; `--host <id>` if it should run on another machine; prefer `--prompt-file` for multiline prompts.)

Then trigger a first run now with `superset automations run <id>`, review `superset automations logs <id>` with the user, and refine the prompt via `superset automations prompt set <id>` until the run output is right. An automation isn't done until one real run looked good. If the prompt publishes a page, open the published page as part of that review, not just the run log.
