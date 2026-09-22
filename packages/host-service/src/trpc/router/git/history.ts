import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { SimpleGit } from "simple-git";
import { z } from "zod";
import { queryProcedure, router } from "../../index";
import { resolveWorktreePath } from "./utils/resolve-worktree";

const hash = z.string().regex(/^[a-f0-9]{40,64}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const historyInput = z.object({
	workspaceId: z.string(),
	ref: z.string().max(1024).default("HEAD"),
	author: z.string().max(256).default(""),
	search: z.string().max(256).default(""),
	since: day.optional(),
	until: day.optional(),
	limit: z.number().int().min(1).max(200).default(100),
	cursor: z
		.object({ offset: z.number().int().min(0), tips: z.array(hash).max(10000) })
		.optional(),
});

export async function readHistoryRefs(git: SimpleGit) {
	const raw = await git.raw([
		"for-each-ref",
		"--format=%(refname)%00%(objectname)%00%(symref)",
		"refs/heads",
		"refs/remotes",
		"refs/tags",
	]);
	const refs = raw
		.trim()
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			const [name, tip, symbolic] = line.split("\0");
			return name && tip && !symbolic ? [{ name, tip }] : [];
		});
	const head = (
		await git.raw(["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "")
	).trim();
	const format = (await git.raw(["rev-parse", "--show-object-format"])).trim();
	return {
		refs,
		head,
		emptyTree: createHash(format === "sha256" ? "sha256" : "sha1")
			.update("tree 0\0")
			.digest("hex"),
	};
}

export async function readHistory(
	git: SimpleGit,
	input: z.infer<typeof historyInput>,
) {
	let tips = input.cursor?.tips;
	if (!tips) {
		const { refs, head } = await readHistoryRefs(git);
		if (input.ref === "all")
			tips = [
				...new Set([head, ...refs.map((ref) => ref.tip)].filter(Boolean)),
			];
		else if (input.ref === "HEAD") tips = head ? [head] : [];
		else {
			const ref = refs.find((ref) => ref.name === input.ref);
			if (!ref)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Unknown Git reference",
				});
			tips = [ref.tip];
		}
	}
	if (!tips.length) return { commits: [], nextCursor: undefined };
	const offset = input.cursor?.offset ?? 0;
	const args = [
		"log",
		"--topo-order",
		"--date-order",
		"--decorate=full",
		"--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%B%x00",
		"--fixed-strings",
		"--regexp-ignore-case",
		`--skip=${offset}`,
		`--max-count=${input.limit + 1}`,
	];
	if (input.author) args.push(`--author=${input.author}`);
	if (input.since) args.push(`--since-as-filter=${input.since}T00:00:00`);
	if (input.until) args.push(`--until=${input.until}T23:59:59`);
	const search = input.search.trim();
	const searchingHash = /^[a-f0-9]{7,64}$/i.test(search);
	if (search && !searchingHash) args.push(`--grep=${search}`);
	if (searchingHash) {
		const resolved = (
			await git
				.raw(["rev-parse", "--verify", "--quiet", `${search}^{commit}`])
				.catch(() => "")
		).trim();
		if (!resolved) return { commits: [], nextCursor: undefined };
		const reachable = await Promise.all(
			tips.map(async (tip) =>
				git.raw(["merge-base", resolved, tip]).then(
					(base) => base.trim() === resolved,
					() => false,
				),
			),
		);
		if (!reachable.some(Boolean)) return { commits: [], nextCursor: undefined };
		args.push("--no-walk");
		tips = [resolved];
	}
	const raw = await git.raw([...args, ...tips, "--"]);
	const fields = raw.split("\0");
	const commits = [];
	for (let index = 0; index + 6 < fields.length; index += 7) {
		const commitHash = fields[index]?.trim() ?? "";
		if (!commitHash) continue;
		const body = fields[index + 6]?.trimEnd() ?? "";
		commits.push({
			hash: commitHash,
			parents: fields[index + 1]?.split(" ").filter(Boolean) ?? [],
			author: fields[index + 2] ?? "",
			authorEmail: fields[index + 3] ?? "",
			date: fields[index + 4] ?? "",
			refs: fields[index + 5]?.split(", ").filter(Boolean) ?? [],
			message: body.split("\n")[0] ?? "",
			body,
		});
	}
	return {
		commits: commits.slice(0, input.limit),
		nextCursor:
			commits.length > input.limit
				? { offset: offset + input.limit, tips }
				: undefined,
	};
}

export const historyRouter = router({
	refs: queryProcedure
		.input(z.object({ workspaceId: z.string() }))
		.query(async ({ ctx, input }) =>
			readHistoryRefs(
				await ctx.git(resolveWorktreePath(ctx, input.workspaceId)),
			),
		),
	list: queryProcedure
		.meta({ timeoutMs: 30_000 })
		.input(historyInput)
		.query(async ({ ctx, input }) =>
			readHistory(
				await ctx.git(resolveWorktreePath(ctx, input.workspaceId)),
				input,
			),
		),
});
