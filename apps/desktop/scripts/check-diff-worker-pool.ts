import { parseDiffFromFile } from "@pierre/diffs";
import { WorkerPoolManager } from "@pierre/diffs/worker";

const workerPath = import.meta.resolve("@pierre/diffs/worker/worker.js");
globalThis.requestAnimationFrame = (callback) =>
	Number(setTimeout(() => callback(performance.now()), 0));
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

let createdWorkers = 0;
const pool = new WorkerPoolManager(
	{
		lazy: true,
		initialPoolSize: 2,
		poolSize: 4,
		workerFactory: () => {
			createdWorkers++;
			return new Worker(workerPath);
		},
	},
	{ preferredHighlighter: "shiki-wasm" },
);
const timeout = setTimeout(() => {
	pool.terminate();
	console.error("[check-diff-worker-pool] Worker response timed out");
	process.exit(1);
}, 20_000);

function makeDiff(index: number) {
	return parseDiffFromFile(
		{
			name: "counter.ts",
			contents: `const count = ${index};\n`,
			cacheKey: `old-${index}`,
		},
		{
			name: "counter.ts",
			contents: `const count = ${index + 1};\n`,
			cacheKey: `new-${index}`,
		},
	);
}

function assertHighlighted(diff: ReturnType<typeof makeDiff>) {
	const cached = pool.getDiffResultCache(diff);
	if (
		!cached?.result.code.additionLines.length ||
		!cached.result.code.deletionLines.length
	) {
		throw new Error("Expected highlighted additions and deletions");
	}
}

try {
	await pool.setRenderOptions({ theme: "pierre-light" });
	if (createdWorkers !== 0)
		throw new Error("Workers started without a consumer");
	const first = makeDiff(0);
	await pool.primeDiffHighlightCache(first);
	assertHighlighted(first);
	if (pool.getStats().totalWorkers !== 2)
		throw new Error("Expected two initial workers");

	const queued = Array.from({ length: 8 }, (_, index) => makeDiff(index + 1));
	await Promise.all(queued.map((diff) => pool.primeDiffHighlightCache(diff)));
	for (const diff of queued) assertHighlighted(diff);
	if (pool.getStats().totalWorkers <= 2 || pool.getStats().totalWorkers > 4) {
		throw new Error("Expected bounded growth under queued work");
	}
	console.log(
		"[check-diff-worker-pool] OK: lazy startup, real wasm highlighting and bounded queue growth",
	);
} finally {
	clearTimeout(timeout);
	pool.terminate();
}
