import { afterEach, beforeEach, expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import {
	WorkerPoolManager,
	type WorkerRenderingOptions,
	type WorkerRequest,
	type WorkerResponse,
} from "@pierre/diffs/worker";

class FakeWorker {
	listeners: Array<(event: { data: WorkerResponse }) => void> = [];
	requests: WorkerRequest[] = [];
	options!: WorkerRenderingOptions;
	terminated = false;
	holdInitialization = false;
	postMessage(request: WorkerRequest) {
		this.requests.push(request);
		if (
			request.type === "initialize" ||
			request.type === "set-render-options"
		) {
			this.options = request.renderOptions;
			if (request.type === "initialize" && this.holdInitialization) return;
			queueMicrotask(() =>
				this.reply({
					type: "success",
					requestType: request.type,
					id: request.id,
					sentAt: 0,
				}),
			);
		}
	}
	addEventListener(
		type: string,
		listener: (event: { data: WorkerResponse }) => void,
	) {
		if (type === "message") this.listeners.push(listener);
	}
	terminate() {
		this.terminated = true;
	}
	reply(response: WorkerResponse) {
		for (const listener of this.listeners) listener({ data: response });
	}
	finish() {
		const request = this.requests.find((r) => r.type === "file");
		if (!request || request.type !== "file") return;
		this.requests.splice(this.requests.indexOf(request), 1);
		this.reply({
			type: "success",
			requestType: "file",
			id: request.id,
			sentAt: 0,
			result: { code: [], themeStyles: "", baseThemeType: "dark" },
			options: this.options,
		});
	}
	releaseInitialization() {
		const request = this.requests.find((r) => r.type === "initialize");
		if (request)
			this.reply({
				type: "success",
				requestType: "initialize",
				id: request.id,
				sentAt: 0,
			});
	}
}
const pools: WorkerPoolManager[] = [];
const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;
beforeEach(() => {
	globalThis.requestAnimationFrame = () => 0;
	globalThis.cancelAnimationFrame = () => {};
});
afterEach(() => {
	for (const pool of pools) pool.terminate();
	pools.length = 0;
	globalThis.requestAnimationFrame = originalRaf;
	globalThis.cancelAnimationFrame = originalCancelRaf;
});
async function until(condition: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (condition()) return;
		await Bun.sleep(5);
	}
	throw new Error("Pool did not reach expected state");
}
function setup({
	lazy = true,
	cap = 4,
	holdGrowth = false,
	failGrowth = false,
} = {}) {
	const workers: FakeWorker[] = [];
	const pool = new WorkerPoolManager(
		{
			lazy,
			poolSize: cap,
			initialPoolSize: lazy ? 2 : undefined,
			workerFactory: () => {
				if (failGrowth && workers.length >= 2)
					throw new Error("test worker limit");
				const worker = new FakeWorker();
				worker.holdInitialization = holdGrowth && workers.length >= 2;
				workers.push(worker);
				return worker as unknown as Worker;
			},
		},
		{ preferredHighlighter: "shiki-js" },
	);
	pools.push(pool);
	return { pool, workers };
}
function enqueue(pool: WorkerPoolManager, count: number) {
	return Array.from({ length: count }, (_, i) =>
		pool.primeFileHighlightCache({
			name: `file-${i}.ts`,
			contents: `const item = ${i};`,
			cacheKey: `file-${i}`,
		}),
	);
}
test("stays idle through theme updates and starts with two workers on demand", async () => {
	const { pool, workers } = setup();
	await pool.setRenderOptions({ theme: "pierre-light" });
	expect(pool.getStats().managerState).toBe("waiting");
	expect(workers).toHaveLength(0);
	const jobs = enqueue(pool, 1);
	await until(() =>
		workers.some((w) => w.requests.some((r) => r.type === "file")),
	);
	expect(workers).toHaveLength(2);
	expect(workers[0].options.theme).toBe("pierre-light");
	for (const worker of workers) worker.finish();
	await Promise.all(jobs);
});
test("grows only for queued work and respects the cap while draining requests", async () => {
	const { pool, workers } = setup();
	const jobs = enqueue(pool, 7);
	await until(() => pool.getStats().busyWorkers === 4);
	expect(workers).toHaveLength(4);
	expect(pool.getStats().queuedTasks).toBe(3);
	await until(() => {
		for (const worker of workers) worker.finish();
		return (
			pool.getStats().activeTasks === 0 && pool.getStats().queuedTasks === 0
		);
	});
	await Promise.all(jobs);
	expect(pool.getStats().fileCacheSize).toBe(7);
});
test("theme changes wait for a growing worker before broadcasting", async () => {
	const { pool, workers } = setup({ holdGrowth: true, cap: 3 });
	const jobs = enqueue(pool, 3);
	const results = Promise.allSettled(jobs);
	await until(() => workers.length === 3);
	let settled = false;
	const change = pool.setRenderOptions({ theme: "pierre-light" }).then(() => {
		settled = true;
	});
	await Bun.sleep(10);
	expect(settled).toBe(false);
	workers[2].releaseInitialization();
	await change;
	expect(workers.every((w) => w.options.theme === "pierre-light")).toBe(true);
	pool.terminate();
	await results;
});
test("termination during growth neither leaks workers nor restarts the pool", async () => {
	const { pool, workers } = setup({ holdGrowth: true });
	const results = Promise.allSettled(enqueue(pool, 5));
	await until(() => workers.length === 3);
	pool.terminate();
	workers[2].releaseInitialization();
	await results;
	await Bun.sleep(10);
	expect(workers.every((w) => w.terminated)).toBe(true);
	expect(pool.getStats().totalWorkers).toBe(0);
	expect(workers).toHaveLength(3);
});
test("a growth failure keeps the original workers serving the queue", async () => {
	const { pool, workers } = setup({ failGrowth: true });
	const jobs = enqueue(pool, 3);
	await until(() => pool.getStats().busyWorkers === 2);
	await Bun.sleep(10);
	await until(() => {
		for (const worker of workers) worker.finish();
		return (
			pool.getStats().activeTasks === 0 && pool.getStats().queuedTasks === 0
		);
	});
	await Promise.all(jobs);
	expect(workers).toHaveLength(2);
	expect(pool.isWorkingPool()).toBe(true);
});
test("plain text diffs also trigger lazy initialization", async () => {
	const { pool, workers } = setup();
	const diff = parseDiffFromFile(
		{ name: "a.txt", contents: "old\n" },
		{ name: "a.txt", contents: "new\n" },
	);
	expect(pool.getPlainDiffAST(diff, 0, 2)).toBeUndefined();
	await until(() => pool.isInitialized());
	expect(workers).toHaveLength(2);
	expect(pool.getPlainDiffAST(diff, 0, 2)).toBeDefined();
});
test("existing eager configurations remain eager", async () => {
	const { pool, workers } = setup({ lazy: false });
	await until(() => pool.isInitialized());
	expect(workers).toHaveLength(4);
});
