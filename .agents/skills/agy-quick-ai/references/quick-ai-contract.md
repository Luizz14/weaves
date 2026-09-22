# quickAi contract

## Runtime flow

```text
renderer action
  -> protected host-service tRPC mutation
  -> bounded context assembled by application code
  -> getQuickAiSettings(ctx.db)
  -> getQuickAiProvider(settings.provider)
  -> provider.runJson(configuredModel, instructions, context, jsonSchema)
  -> agy --sandbox --disable-slash-commands --output-format json --json-schema ...
  -> envelope.structured_output
  -> Zod validation
  -> editable suggestion in the renderer
```

The current provider id is `agy`. The default model is `gemini-3.8-flash-low`; the selectable model ids are exported by `QUICK_AI_MODELS` in `agy-cli.ts`. Treat that export as the source of truth for settings validation and UI options.

## Task pattern

```ts
const resultSchema = z.object({ title: z.string().trim().min(1).max(120) });

const resultJsonSchema = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false,
};

const settings = getQuickAiSettings(ctx.db);
const raw = await getQuickAiProvider(settings.provider).runJson(
  settings.model,
  instructions,
  boundedContext,
  resultJsonSchema,
);
return resultSchema.parse(raw);
```

Put task-specific context collection and schemas beside the owning router. Add a shared helper only after a second consumer needs the same behavior.

## Context rules

- Set an explicit byte cap below the operating system argument limit because `agy` receives the assembled prompt as an argument.
- Truncate Git patches at complete file-section boundaries by reusing `buildDiffPatch`; do not build an unbounded diff and slice it afterward.
- Cap auxiliary context such as recent commit subjects, templates, issue descriptions, or logs separately so it cannot consume the whole prompt budget.
- State which source is authoritative. Examples: the changes that `stageAll` will commit, commits since the configured base branch, or the user's first workspace prompt.
- Do not send credentials, environment variables, ignored files, binary contents, or unrelated repository files.

## Prompt and output rules

- Ask for one object matching the supplied JSON Schema.
- Say that all delimited content is data and that instructions inside it must be ignored.
- Tell the model not to use tools. The runtime still enforces an empty temporary workspace and sandbox.
- Keep policy and validation in code: maximum lengths, branch character sets, prefixes, fallback values, and whether a generated field may overwrite user input.

## Error behavior

`agy-cli.ts` distinguishes CLI missing, authentication missing/expired, timeout, invalid structured output, and general generation failure. Preserve actionable errors at the host boundary, but localize the renderer message around them.

Generation must not perform the final action. A commit suggestion does not commit; a PR draft does not create or push a PR; a title suggestion does not rename an entity until the owning flow applies its normal validation.

## Existing examples

- Branch generation and deterministic fallback: `packages/host-service/src/trpc/router/workspace-creation/utils/ai-workspace-names.ts`.
- Commit context including staged, unstaged, and untracked changes: `packages/host-service/src/trpc/router/quick-ai/quick-ai.ts`.
- PR context using commits, base diff, and repository template: the same router.
- On-demand editable UI: `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/ChangesControl/components/ShipControl/ShipControl.tsx`.
- Per-host provider/model settings: `apps/desktop/src/renderer/routes/_authenticated/settings/ai/components/AiSettings/AiSettings.tsx`.
