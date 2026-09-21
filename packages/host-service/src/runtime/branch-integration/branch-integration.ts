import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SimpleGit } from "simple-git";
import { z } from "zod";
import { createUserSimpleGit } from "../git/simple-git";

export const integrationKind = z.enum(["merge", "update"]);
export type IntegrationSettings = {
	mergeTargetBranch: string | null;
	updateRemote: string | null;
	mergeToMainEnabled: boolean;
	updateFromMainEnabled: boolean;
};
const stageSchema = z.object({
	mode: z.string(),
	oid: z.string(),
	stage: z.number(),
});
const conflictSchema = z.object({
	path: z.string(),
	stages: z.array(stageSchema),
});
const sessionSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string(),
	workspaceId: z.string(),
	workspacePath: z.string(),
	kind: integrationKind,
	sourceRef: z.string(),
	sourceLabel: z.string(),
	sourceSha: z.string(),
	destinationRef: z.string(),
	destinationLabel: z.string(),
	destinationSha: z.string(),
	configuredBranch: z.string(),
	configuredRemote: z.string().nullable(),
	state: z.enum([
		"preparing",
		"resolving",
		"ready",
		"applying",
		"completed",
		"cancelled",
	]),
	resultSha: z.string().nullable(),
	conflicts: z.array(conflictSchema),
	cleanupPending: z.boolean(),
});
export type IntegrationSession = z.infer<typeof sessionSchema>;
const MAX_TEXT_BYTES = 1024 * 1024;
const busyRepositories = new Set<string>();

export class IntegrationError extends Error {
	constructor(public readonly code: string) {
		super(code);
	}
}

export async function withIntegrationRepository<T>(
	repoPath: string,
	action: (root: string) => Promise<T>,
	readOnly = false,
): Promise<T> {
	const git = createUserSimpleGit(repoPath);
	const common = (
		await git.raw(["rev-parse", "--path-format=absolute", "--git-common-dir"])
	).trim();
	const root = join(common, "superset-integrations");
	if (readOnly) return action(root);
	if (busyRepositories.has(root)) throw new IntegrationError("BUSY");
	busyRepositories.add(root);
	try {
		return await action(root);
	} finally {
		busyRepositories.delete(root);
	}
}

async function saveSession(root: string, session: IntegrationSession) {
	await mkdir(root, { recursive: true });
	const temp = join(root, "session.json.tmp");
	await writeFile(temp, JSON.stringify(session), { mode: 0o600 });
	await rename(temp, join(root, "session.json"));
}

export async function readIntegrationSession(
	root: string,
): Promise<IntegrationSession | null> {
	try {
		return sessionSchema.parse(
			JSON.parse(await readFile(join(root, "session.json"), "utf8")),
		);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return null;
		throw error;
	}
}

function temporaryPath(root: string, session: IntegrationSession) {
	return join(root, session.id);
}
async function sha(git: SimpleGit, ref: string) {
	return (await git.raw(["rev-parse", "--verify", `${ref}^{commit}`])).trim();
}
async function currentBranch(git: SimpleGit) {
	const branch = await git
		.raw(["symbolic-ref", "--quiet", "HEAD"])
		.catch(() => "");
	if (!branch.trim()) throw new IntegrationError("DETACHED");
	return branch.trim();
}
async function assertClean(path: string) {
	const git = createUserSimpleGit(path);
	for (const marker of [
		"MERGE_HEAD",
		"CHERRY_PICK_HEAD",
		"REVERT_HEAD",
		"rebase-merge",
		"rebase-apply",
		"sequencer",
	]) {
		const markerPath = (
			await git.raw(["rev-parse", "--git-path", marker])
		).trim();
		if (existsSync(resolve(path, markerPath)))
			throw new IntegrationError("GIT_OPERATION_PENDING");
	}
	if (
		(await git.raw(["status", "--porcelain=v1", "--untracked-files=all"]))
			.length
	)
		throw new IntegrationError("DIRTY");
}
async function checkedOutPaths(git: SimpleGit, ref: string): Promise<string[]> {
	const raw = await git.raw(["worktree", "list", "--porcelain", "-z"]);
	return raw.split("\0\0").flatMap((record) => {
		const fields = record.split("\0");
		return fields.includes(`branch ${ref}`)
			? fields
					.filter((field) => field.startsWith("worktree "))
					.map((field) => field.slice(9))
			: [];
	});
}
async function conflicts(git: SimpleGit) {
	const raw = await git.raw(["ls-files", "--unmerged", "-z"]);
	const entries = new Map<string, z.infer<typeof conflictSchema>>();
	for (const entry of raw.split("\0").filter(Boolean)) {
		const tab = entry.indexOf("\t");
		const path = entry.slice(tab + 1);
		const [mode, oid, stage] = entry.slice(0, tab).split(" ");
		if (!mode || !oid || !stage) throw new IntegrationError("INVALID_CONFLICT");
		const item = entries.get(path) ?? { path, stages: [] };
		item.stages.push({ mode, oid, stage: Number(stage) });
		entries.set(path, item);
	}
	return [...entries.values()];
}

export async function startIntegration(input: {
	root: string;
	repoPath: string;
	projectId: string;
	workspaceId: string;
	workspacePath: string;
	kind: z.infer<typeof integrationKind>;
	settings: IntegrationSettings;
	fetchEnv?: Record<string, string>;
}) {
	const { root, repoPath, settings, kind, workspacePath } = input;
	const previous = await readIntegrationSession(root);
	if (
		previous &&
		(!["completed", "cancelled"].includes(previous.state) ||
			previous.cleanupPending)
	)
		throw new IntegrationError("SESSION_EXISTS");
	if (
		!(kind === "merge"
			? settings.mergeToMainEnabled
			: settings.updateFromMainEnabled)
	)
		throw new IntegrationError("DISABLED");
	const branch = settings.mergeTargetBranch;
	if (!branch || (kind === "update" && !settings.updateRemote))
		throw new IntegrationError("CONFIGURE");
	const git = createUserSimpleGit(repoPath);
	await git.raw(["check-ref-format", `refs/heads/${branch}`]);
	const workspaceGit = createUserSimpleGit(workspacePath);
	const workspaceRef = await currentBranch(workspaceGit);
	const principalRef = `refs/heads/${branch}`;
	if (workspaceRef === principalRef) throw new IntegrationError("SAME_BRANCH");
	await assertClean(workspacePath);
	const destinationRef = kind === "merge" ? principalRef : workspaceRef;
	const destinationSha = await sha(git, destinationRef).catch(() => {
		throw new IntegrationError("BRANCH_MISSING");
	});
	for (const path of await checkedOutPaths(git, destinationRef))
		await assertClean(path);
	let sourceRef = workspaceRef;
	if (kind === "update") {
		const remote = settings.updateRemote;
		if (
			!remote ||
			!(await git.getRemotes()).some((item) => item.name === remote)
		)
			throw new IntegrationError("REMOTE_MISSING");
		sourceRef = `refs/remotes/${remote}/${branch}`;
		try {
			await createUserSimpleGit(repoPath)
				.env({ ...process.env, ...input.fetchEnv })
				.raw([
					"fetch",
					"--no-tags",
					"--",
					remote,
					`+refs/heads/${branch}:${sourceRef}`,
				]);
		} catch {
			throw new IntegrationError("FETCH_FAILED");
		}
	}
	const session: IntegrationSession = {
		id: randomUUID(),
		projectId: input.projectId,
		workspaceId: input.workspaceId,
		workspacePath,
		kind,
		sourceRef,
		sourceLabel: sourceRef.replace(/^refs\/(heads|remotes)\//, ""),
		sourceSha: await sha(git, sourceRef),
		destinationRef,
		destinationLabel: destinationRef.slice("refs/heads/".length),
		destinationSha,
		configuredBranch: branch,
		configuredRemote: settings.updateRemote,
		state: "preparing",
		resultSha: null,
		conflicts: [],
		cleanupPending: true,
	};
	await saveSession(root, session);
	await git.raw([
		"worktree",
		"add",
		"--detach",
		temporaryPath(root, session),
		destinationSha,
	]);
	const temporaryGit = createUserSimpleGit(temporaryPath(root, session));
	try {
		await temporaryGit.raw([
			"merge",
			"--no-commit",
			"--no-edit",
			"--ff",
			session.sourceSha,
		]);
	} catch (error) {
		const pending = await conflicts(temporaryGit);
		if (!pending.length) throw error;
	}
	session.conflicts = await conflicts(temporaryGit);
	session.state = session.conflicts.length ? "resolving" : "ready";
	await saveSession(root, session);
	return session;
}

async function cleanTemporary(
	repoPath: string,
	root: string,
	session: IntegrationSession,
) {
	const path = temporaryPath(root, session);
	const git = createUserSimpleGit(repoPath);
	const registered = (await git.raw(["worktree", "list", "--porcelain", "-z"]))
		.split("\0")
		.includes(`worktree ${path}`);
	if (registered) await git.raw(["worktree", "remove", "--force", path]);
	else await rm(path, { recursive: true, force: true });
	session.cleanupPending = false;
	await saveSession(root, session);
}

export async function cancelIntegration(
	repoPath: string,
	root: string,
	session: IntegrationSession,
) {
	if (session.state === "applying") {
		const destination = await sha(
			createUserSimpleGit(repoPath),
			session.destinationRef,
		);
		if (destination === session.resultSha) session.state = "completed";
	}
	if (session.state !== "completed") session.state = "cancelled";
	await saveSession(root, session);
	await cleanTemporary(repoPath, root, session);
	return session;
}

export async function finishIntegration(
	repoPath: string,
	root: string,
	session: IntegrationSession,
	settings: IntegrationSettings,
) {
	if (["completed", "cancelled"].includes(session.state)) {
		if (session.cleanupPending) await cleanTemporary(repoPath, root, session);
		return session;
	}
	const git = createUserSimpleGit(repoPath);
	const destination = await sha(git, session.destinationRef);
	if (session.state === "applying" && destination === session.resultSha) {
		session.state = "completed";
		await saveSession(root, session);
		await cleanTemporary(repoPath, root, session);
		return session;
	}
	if (session.state === "preparing")
		throw new IntegrationError("RESTART_REQUIRED");
	if (
		settings.mergeTargetBranch !== session.configuredBranch ||
		(session.kind === "update" &&
			settings.updateRemote !== session.configuredRemote)
	)
		throw new IntegrationError("CONFIG_CHANGED");
	if (
		destination !== session.destinationSha ||
		(await sha(git, session.sourceRef)) !== session.sourceSha
	)
		throw new IntegrationError("BRANCH_CHANGED");
	const expectedWorkspaceRef =
		session.kind === "merge" ? session.sourceRef : session.destinationRef;
	if (
		(await currentBranch(createUserSimpleGit(session.workspacePath))) !==
		expectedWorkspaceRef
	)
		throw new IntegrationError("BRANCH_CHANGED");
	await assertClean(session.workspacePath);
	const paths = await checkedOutPaths(git, session.destinationRef);
	if (paths.length > 1) throw new IntegrationError("MULTIPLE_CHECKOUTS");
	for (const path of paths) await assertClean(path);
	const temporaryGit = createUserSimpleGit(temporaryPath(root, session));
	if ((await conflicts(temporaryGit)).length)
		throw new IntegrationError("UNRESOLVED");
	if (!session.resultSha) {
		const mergeHead = (
			await temporaryGit.raw(["rev-parse", "--git-path", "MERGE_HEAD"])
		).trim();
		if (existsSync(resolve(temporaryPath(root, session), mergeHead)))
			await temporaryGit.raw(["commit", "--no-edit"]);
		session.resultSha = await sha(temporaryGit, "HEAD");
	}
	session.state = "applying";
	await saveSession(root, session);
	if (paths[0]) {
		const destinationGit = createUserSimpleGit(paths[0]);
		if (
			(await currentBranch(destinationGit)) !== session.destinationRef ||
			(await sha(destinationGit, "HEAD")) !== session.destinationSha
		)
			throw new IntegrationError("BRANCH_CHANGED");
		await destinationGit.raw([
			"merge",
			"--ff-only",
			"--no-edit",
			session.resultSha,
		]);
	} else {
		await git.raw([
			"update-ref",
			"-m",
			"Superset branch integration",
			session.destinationRef,
			session.resultSha,
			session.destinationSha,
		]);
	}
	session.state = "completed";
	await saveSession(root, session);
	await cleanTemporary(repoPath, root, session);
	return session;
}

export async function readConflict(
	root: string,
	session: IntegrationSession,
	path: string,
) {
	const conflict = session.conflicts.find((item) => item.path === path);
	if (!conflict) throw new IntegrationError("INVALID_CONFLICT");
	const git = createUserSimpleGit(temporaryPath(root, session));
	const sides = await Promise.all(
		[2, 3].map(async (number) => {
			const stage = conflict.stages.find((item) => item.stage === number);
			if (!stage) return { content: null, editable: true, exists: false };
			if (!/^100(644|755)$/.test(stage.mode))
				return { content: null, editable: false, exists: true };
			const size = Number(
				(await git.raw(["cat-file", "-s", stage.oid])).trim(),
			);
			if (size > MAX_TEXT_BYTES)
				return { content: null, editable: false, exists: true };
			const content = await git.raw(["cat-file", "blob", stage.oid]);
			const editable = !content.includes("\0") && !content.includes("\uFFFD");
			return { content: editable ? content : null, editable, exists: true };
		}),
	);
	return { path, destination: sides[0], source: sides[1] };
}

export async function resolveConflict(
	root: string,
	session: IntegrationSession,
	path: string,
	choice: "source" | "destination" | "delete" | "manual",
	content?: string,
) {
	if (session.state !== "resolving") throw new IntegrationError("UNRESOLVED");
	const git = createUserSimpleGit(temporaryPath(root, session));
	const conflict = (await conflicts(git)).find((item) => item.path === path);
	if (!conflict || !session.conflicts.some((item) => item.path === path))
		throw new IntegrationError("INVALID_CONFLICT");
	let stage = conflict.stages.find(
		(item) => item.stage === (choice === "source" ? 3 : 2),
	);
	if (choice === "manual") {
		const sides = await readConflict(root, session, path);
		if (
			!sides.source?.editable ||
			!sides.destination?.editable ||
			content === undefined ||
			Buffer.byteLength(content) > MAX_TEXT_BYTES
		)
			throw new IntegrationError("INVALID_CONTENT");
		const scratch = join(root, `${session.id}.blob`);
		try {
			await writeFile(scratch, content, { mode: 0o600 });
			const oid = (await git.raw(["hash-object", "-w", scratch])).trim();
			stage = {
				mode:
					stage?.mode ??
					conflict.stages.find((item) => item.stage === 3)?.mode ??
					"100644",
				oid,
				stage: 0,
			};
		} finally {
			await rm(scratch, { force: true });
		}
	}
	if (choice === "delete" || !stage)
		await git.raw(["update-index", "--force-remove", "--", path]);
	else
		await git.raw([
			"update-index",
			"--add",
			"--cacheinfo",
			stage.mode,
			stage.oid,
			path,
		]);
	if (!(await conflicts(git)).length) session.state = "ready";
	await saveSession(root, session);
	return session;
}

export async function pendingConflictPaths(
	root: string,
	session: IntegrationSession,
) {
	if (!["resolving", "ready"].includes(session.state)) return [];
	return (
		await conflicts(createUserSimpleGit(temporaryPath(root, session)))
	).map((item) => item.path);
}
