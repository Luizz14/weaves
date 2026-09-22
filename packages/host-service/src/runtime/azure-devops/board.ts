import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ExecAz } from "./exec-az";

const identitySchema = z.object({
	displayName: z.string(),
	uniqueName: z.string().optional(),
	imageUrl: z.string().optional(),
});

const queryWorkItemSchema = z.object({
	id: z.number(),
	rev: z.number(),
	fields: z.record(z.string(), z.unknown()),
	url: z.string(),
	relations: z
		.array(
			z.object({
				rel: z.string(),
				url: z.string(),
				attributes: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.nullable()
		.optional(),
	multilineFieldsFormat: z.record(z.string(), z.string()).optional(),
});

const queryWorkItemsSchema = z.array(queryWorkItemSchema);

const iterationSchema = z.object({
	id: z.string(),
	name: z.string(),
	path: z.string(),
	attributes: z
		.object({
			startDate: z.string().optional(),
			finishDate: z.string().optional(),
			timeFrame: z.string().optional(),
		})
		.optional(),
});

const iterationsSchema = z.array(iterationSchema);

const accountSchema = z.object({
	user: z.object({ name: z.string() }),
});

export type AzureDevOpsBoardConfig = {
	organizationUrl: string;
	workItemProject: string;
	team: string;
	areaPath: string;
	assignedTo: string | null;
	workItemTypes: string[];
};

export type AzureDevOpsIdentity = {
	displayName: string;
	uniqueName: string | null;
	imageUrl: string | null;
};

export type AzureDevOpsIteration = {
	id: string;
	name: string;
	path: string;
	startDate: string | null;
	finishDate: string | null;
	isCurrent: boolean;
};

export type AzureDevOpsBoardItem = {
	id: number;
	revision: number;
	title: string;
	state: string;
	type: string;
	tags: string[];
	storyPoints: number | null;
	iterationPath: string;
	areaPath: string;
	assignedTo: AzureDevOpsIdentity | null;
	claim: {
		childId: number;
		assignedTo: AzureDevOpsIdentity | null;
		state: string;
		isCurrentUser: boolean;
	} | null;
	url: string;
};

export type AzureDevOpsWorkItemClaim = {
	claim: AzureDevOpsBoardItem["claim"];
	stage: "backlog" | "implementation";
};

function field<T>(
	item: z.infer<typeof queryWorkItemSchema>,
	name: string,
): T | undefined {
	return item.fields[name] as T | undefined;
}

function parseIdentity(value: unknown): AzureDevOpsIdentity | null {
	const parsed = identitySchema.safeParse(value);
	if (!parsed.success) return null;
	return {
		displayName: parsed.data.displayName,
		uniqueName: parsed.data.uniqueName ?? null,
		imageUrl: parsed.data.imageUrl ?? null,
	};
}

function escapeWiql(value: string): string {
	return value.replaceAll("'", "''");
}

function quotedList(values: string[]): string {
	return values.map((value) => `'${escapeWiql(value)}'`).join(", ");
}

function workItemWebUrl(config: AzureDevOpsBoardConfig, id: number): string {
	return `${config.organizationUrl}/${encodeURIComponent(config.workItemProject)}/_workitems/edit/${id}`;
}

export async function resolveAzureDevOpsAccount(
	execAz: ExecAz,
	fallback: string | null,
): Promise<string | null> {
	try {
		const account = accountSchema.parse(await execAz(["account", "show"]));
		return account.user.name;
	} catch {
		return fallback;
	}
}

export async function listAzureDevOpsIterations(
	execAz: ExecAz,
	config: AzureDevOpsBoardConfig,
): Promise<AzureDevOpsIteration[]> {
	const data = iterationsSchema.parse(
		await execAz(
			[
				"boards",
				"iteration",
				"team",
				"list",
				"--team",
				config.team,
				"--organization",
				config.organizationUrl,
				"--project",
				config.workItemProject,
				"--detect",
				"false",
			],
			{ timeout: 45_000 },
		),
	);
	return data
		.map((iteration) => ({
			id: iteration.id,
			name: iteration.name,
			path: iteration.path,
			startDate: iteration.attributes?.startDate ?? null,
			finishDate: iteration.attributes?.finishDate ?? null,
			isCurrent: iteration.attributes?.timeFrame === "current",
		}))
		.sort((left, right) =>
			(right.startDate ?? "").localeCompare(left.startDate ?? ""),
		);
}

async function runWiql(
	execAz: ExecAz,
	config: AzureDevOpsBoardConfig,
	wiql: string,
) {
	return queryWorkItemsSchema.parse(
		await execAz([
			"boards",
			"query",
			"--organization",
			config.organizationUrl,
			"--project",
			config.workItemProject,
			"--wiql",
			wiql,
			"--detect",
			"false",
		]),
	);
}

export async function listAzureDevOpsBoardItems(
	execAz: ExecAz,
	config: AzureDevOpsBoardConfig,
	iterationPath: string,
): Promise<{ items: AzureDevOpsBoardItem[]; currentUser: string | null }> {
	const currentUser = await resolveAzureDevOpsAccount(
		execAz,
		config.assignedTo,
	);
	const areaPath = config.areaPath.replace(/^\\+/, "").replaceAll("/", "\\");
	const commonWhere = `[System.TeamProject] = '${escapeWiql(config.workItemProject)}' AND [System.AreaPath] UNDER '${escapeWiql(areaPath)}' AND [System.IterationPath] = '${escapeWiql(iterationPath)}'`;
	const parentQuery = `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.Tags], [System.IterationPath], [System.AreaPath], [Microsoft.VSTS.Scheduling.StoryPoints] FROM WorkItems WHERE ${commonWhere} AND [System.WorkItemType] IN (${quotedList(config.workItemTypes)}) AND [System.State] NOT IN ('Completed', 'Closed', 'Removed') ORDER BY [Microsoft.VSTS.Common.StackRank]`;
	const childQuery = `SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo], [System.Parent] FROM WorkItems WHERE ${commonWhere} AND [System.WorkItemType] = 'Task' AND [System.Title] = 'Em implementação' AND [System.State] NOT IN ('Closed', 'Removed')`;
	const [parents, children] = await Promise.all([
		runWiql(execAz, config, parentQuery),
		runWiql(execAz, config, childQuery),
	]);
	const childrenByParent = new Map<number, (typeof children)[number]>();
	for (const child of children) {
		const parentId = field<number>(child, "System.Parent");
		if (typeof parentId !== "number") continue;
		const assignedTo = parseIdentity(field(child, "System.AssignedTo"));
		const isCurrent =
			currentUser !== null &&
			assignedTo?.uniqueName?.toLowerCase() === currentUser.toLowerCase();
		const existing = childrenByParent.get(parentId);
		if (!existing || isCurrent) childrenByParent.set(parentId, child);
	}

	return {
		currentUser,
		items: parents.map((item) => {
			const child = childrenByParent.get(item.id);
			const claimIdentity = child
				? parseIdentity(field(child, "System.AssignedTo"))
				: null;
			const tags = field<string>(item, "System.Tags");
			return {
				id: item.id,
				revision: item.rev,
				title: field<string>(item, "System.Title") ?? `#${item.id}`,
				state: field<string>(item, "System.State") ?? "Unknown",
				type: field<string>(item, "System.WorkItemType") ?? "Work Item",
				tags: tags
					? tags
							.split(";")
							.map((tag) => tag.trim())
							.filter(Boolean)
					: [],
				storyPoints:
					field<number>(item, "Microsoft.VSTS.Scheduling.StoryPoints") ?? null,
				iterationPath:
					field<string>(item, "System.IterationPath") ?? iterationPath,
				areaPath: field<string>(item, "System.AreaPath") ?? config.areaPath,
				assignedTo: parseIdentity(field(item, "System.AssignedTo")),
				claim: child
					? {
							childId: child.id,
							assignedTo: claimIdentity,
							state: field<string>(child, "System.State") ?? "Unknown",
							isCurrentUser:
								currentUser !== null &&
								claimIdentity?.uniqueName?.toLowerCase() ===
									currentUser.toLowerCase(),
						}
					: null,
				url: workItemWebUrl(config, item.id),
			};
		}),
	};
}

export async function getAzureDevOpsWorkItem(
	execAz: ExecAz,
	config: AzureDevOpsBoardConfig,
	workItemId: number,
) {
	return queryWorkItemSchema.parse(
		await execAz(
			[
				"boards",
				"work-item",
				"show",
				"--id",
				String(workItemId),
				"--organization",
				config.organizationUrl,
				"--expand",
				"relations",
				"--detect",
				"false",
			],
			{ timeout: 45_000 },
		),
	);
}

export async function getAzureDevOpsWorkItemClaim(
	execAz: ExecAz,
	config: AzureDevOpsBoardConfig,
	workItemId: number,
): Promise<AzureDevOpsWorkItemClaim> {
	const wiql = `SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo], [System.Parent] FROM WorkItems WHERE [System.TeamProject] = '${escapeWiql(config.workItemProject)}' AND [System.Parent] = ${workItemId} AND [System.Title] = 'Em implementação' AND [System.WorkItemType] = 'Task' AND [System.State] NOT IN ('Closed', 'Removed')`;
	const [currentUser, children] = await Promise.all([
		resolveAzureDevOpsAccount(execAz, config.assignedTo),
		runWiql(execAz, config, wiql),
	]);
	let claim: AzureDevOpsBoardItem["claim"] = null;
	for (const child of children) {
		if (field<number>(child, "System.Parent") !== workItemId) continue;
		const assignedTo = parseIdentity(field(child, "System.AssignedTo"));
		const isCurrentUser =
			currentUser !== null &&
			assignedTo?.uniqueName?.toLowerCase() === currentUser.toLowerCase();
		const candidate = {
			childId: child.id,
			assignedTo,
			state: field<string>(child, "System.State") ?? "Unknown",
			isCurrentUser,
		};
		if (!claim || isCurrentUser) claim = candidate;
		if (isCurrentUser) break;
	}

	return {
		claim,
		stage: claim ? "implementation" : "backlog",
	};
}

export async function createAzureDevOpsImplementationChild(
	execAz: ExecAz,
	config: AzureDevOpsBoardConfig,
	parent: AzureDevOpsBoardItem,
	assignedTo: string,
): Promise<number> {
	const directory = await mkdtemp(join(tmpdir(), "superset-azure-work-item-"));
	const inputPath = join(directory, "create-child.json");
	const parentApiUrl = `${config.organizationUrl}/${encodeURIComponent(config.workItemProject)}/_apis/wit/workItems/${parent.id}`;
	const patch = [
		{ op: "add", path: "/fields/System.Title", value: "Em implementação" },
		{ op: "add", path: "/fields/System.AssignedTo", value: assignedTo },
		{ op: "add", path: "/fields/System.AreaPath", value: parent.areaPath },
		{
			op: "add",
			path: "/fields/System.IterationPath",
			value: parent.iterationPath,
		},
		{ op: "add", path: "/fields/System.State", value: "In Progress" },
		{
			op: "add",
			path: "/relations/-",
			value: {
				rel: "System.LinkTypes.Hierarchy-Reverse",
				url: parentApiUrl,
			},
		},
	];
	try {
		await writeFile(inputPath, JSON.stringify(patch), { mode: 0o600 });
		const created = queryWorkItemSchema.parse(
			await execAz([
				"devops",
				"invoke",
				"--organization",
				config.organizationUrl,
				"--area",
				"wit",
				"--resource",
				"workItems",
				"--route-parameters",
				`project=${config.workItemProject}`,
				"type=Task",
				"--query-parameters",
				"$expand=all",
				"--http-method",
				"POST",
				"--media-type",
				"application/json-patch+json",
				"--api-version",
				"7.1",
				"--in-file",
				inputPath,
			]),
		);
		return created.id;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
