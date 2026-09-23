import {
	filterMatchingPresetsForProject,
	isProjectTargetedPreset,
} from "./preset-project-targeting";

export type WorkspaceRunDefinition =
	| {
			source: "project-config";
			projectId: string;
			commands: string[];
			cwd?: string;
	  }
	| {
			source: "terminal-preset";
			presetId: string;
			name: string;
			commands: string[];
			cwd?: string;
	  };

export interface WorkspaceRunPresetLike {
	id: string;
	name: string;
	commands: string[];
	cwd?: string;
	projectIds?: string[] | null;
	useAsWorkspaceRun?: boolean;
}

function nonEmptyCommands(commands: readonly string[] | null | undefined) {
	return (commands ?? []).filter((command) => command.trim().length > 0);
}

function normalizeCwd(cwd: string | undefined): string | undefined {
	const trimmed = cwd?.trim();
	return trimmed ? trimmed : undefined;
}

export function configRunToWorkspaceRun({
	projectId,
	commands,
	cwd,
}: {
	projectId: string;
	commands: readonly string[] | null | undefined;
	cwd?: string;
}): WorkspaceRunDefinition | null {
	const resolvedCommands = nonEmptyCommands(commands);
	if (resolvedCommands.length === 0) return null;
	return {
		source: "project-config",
		projectId,
		commands: resolvedCommands,
		cwd: normalizeCwd(cwd),
	};
}

export function presetToWorkspaceRun(
	preset: WorkspaceRunPresetLike,
): WorkspaceRunDefinition | null {
	if (!preset.useAsWorkspaceRun) return null;
	const commands = nonEmptyCommands(preset.commands);
	if (commands.length === 0) return null;
	return {
		source: "terminal-preset",
		presetId: preset.id,
		name: preset.name,
		commands,
		cwd: normalizeCwd(preset.cwd),
	};
}

export function getWorkspaceRunDefinitionId(
	definition: WorkspaceRunDefinition,
): string {
	return definition.source === "terminal-preset"
		? definition.presetId
		: definition.projectId;
}

function isDefinition(
	definition: WorkspaceRunDefinition | null,
): definition is WorkspaceRunDefinition {
	return Boolean(definition);
}

/** Every configured run, in priority order: project-targeted presets, project config, global presets. */
export function listWorkspaceRunDefinitions({
	presets,
	configRunCommands,
	projectId,
	configCwd,
}: {
	presets: readonly WorkspaceRunPresetLike[];
	configRunCommands?: readonly string[] | null;
	/** Null for project-less "session" workspaces — only global presets apply. */
	projectId: string | null;
	configCwd?: string;
}): WorkspaceRunDefinition[] {
	const matchingPresets = filterMatchingPresetsForProject(presets, projectId);
	const configRun =
		projectId !== null
			? configRunToWorkspaceRun({
					projectId,
					commands: configRunCommands,
					cwd: configCwd,
				})
			: null;
	return [
		...matchingPresets
			.filter(isProjectTargetedPreset)
			.map(presetToWorkspaceRun)
			.filter(isDefinition),
		...(configRun ? [configRun] : []),
		...matchingPresets
			.filter((preset) => !isProjectTargetedPreset(preset))
			.map(presetToWorkspaceRun)
			.filter(isDefinition),
	];
}

export function selectWorkspaceRunDefinition(
	args: Parameters<typeof listWorkspaceRunDefinitions>[0],
): WorkspaceRunDefinition | null {
	return listWorkspaceRunDefinitions(args)[0] ?? null;
}
