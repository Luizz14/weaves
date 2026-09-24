import { cpus } from "node:os";
import { TRPCError } from "@trpc/server";
import { resolveNativeDesktopEntryPath } from "main/lib/desktop-entry-path";
import { onNativeEventNamed } from "main/native/platform";
import {
	type WorkerTaskAbortedError,
	WorkerTaskError,
	type WorkerTaskOptions,
	WorkerTaskRunner,
} from "../../../workers/WorkerTaskRunner";
import { NotGitRepoError } from "../../workspaces/utils/git";
import { GitEnvironmentError } from "../../workspaces/utils/git-errors";
import type {
	GitTaskPayloadMap,
	GitTaskResultMap,
	GitTaskType,
} from "./git-task-types";

const WORKER_COUNT = Math.max(1, Math.min(4, cpus().length - 1));
const WORKER_DEBUG = process.env.SUPERSET_WORKER_DEBUG === "1";

let gitTaskRunner: WorkerTaskRunner | null = null;
let didRegisterDisposeHook = false;

function getWorkerScriptPath(): string {
	return resolveNativeDesktopEntryPath("git-task-worker.cjs");
}

function getRunner(): WorkerTaskRunner {
	if (!gitTaskRunner) {
		gitTaskRunner = new WorkerTaskRunner({
			workerScriptPath: getWorkerScriptPath(),
			concurrency: WORKER_COUNT,
			name: "changes-git",
			debug: WORKER_DEBUG,
		});

		if (!didRegisterDisposeHook) {
			onNativeEventNamed("app:before-quit", () => {
				void gitTaskRunner?.dispose();
				gitTaskRunner = null;
			});
			didRegisterDisposeHook = true;
		}
	}
	return gitTaskRunner;
}

export function runGitTask<TTask extends GitTaskType>(
	taskType: TTask,
	payload: GitTaskPayloadMap[TTask],
	options?: WorkerTaskOptions,
): Promise<GitTaskResultMap[TTask]> {
	return getRunner()
		.runTask<GitTaskResultMap[TTask]>(taskType, payload, options)
		.catch(translateGitTaskFailure);
}

export function translateGitTaskFailure(error: unknown): never {
	// The worker boundary serializes errors down to {name, message, stack,
	// code}; rebuild the domain classes here so callers can use instanceof.
	// Runner timeouts are an environment condition (huge repos, cold
	// network volumes), not a worker bug.
	if (error instanceof WorkerTaskError) {
		if (error.name === "NotGitRepoError") {
			throw new NotGitRepoError(error.message);
		}
		if (error.name === "GitEnvironmentError") {
			throw new GitEnvironmentError(error.message);
		}
		if (
			error.name === "WorkerTaskError" &&
			/ timed out after \d+ms$/.test(error.message)
		) {
			throw new GitEnvironmentError(error.message);
		}
		throw error;
	}

	// The runner only aborts on purpose (app quit, a newer request for the
	// same key, the caller's signal). Those are expected states, so they
	// leave as non-500s; anything else is a real failure and stays reported.
	if (error instanceof Error && error.name === "WorkerTaskAbortedError") {
		const kind = (error as WorkerTaskAbortedError).kind;
		switch (kind) {
			case "disposed":
				throw new TRPCError({
					code: "SERVICE_UNAVAILABLE",
					message: error.message,
				});
			case "superseded":
			case "cancelled":
				throw new TRPCError({
					code: "CLIENT_CLOSED_REQUEST",
					message: error.message,
				});
			default: {
				const exhaustive: never = kind;
				throw new Error(`Unhandled worker abort kind: ${exhaustive}`, {
					cause: error,
				});
			}
		}
	}

	throw error;
}
