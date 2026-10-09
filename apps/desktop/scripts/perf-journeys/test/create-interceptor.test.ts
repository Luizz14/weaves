import { describe, expect, test } from "bun:test";
import { patchCreateBody, procedureNames } from "../lib/create-interceptor";

const allow = () => ({
	allow: true,
	name: "perf-bench-x-1",
	branch: "perf-bench-x-1",
});

describe("patchCreateBody", () => {
	test("patches only the create procedure inside a batch", () => {
		const url =
			"http://127.0.0.1:1/trpc/workspaces.list,workspaces.createEnqueued?batch=1";
		const body = {
			"0": { json: { projectId: "p" } },
			"1": { json: { id: "w", projectId: "p", namingPrompt: "x" } },
		};
		const { decisions } = patchCreateBody(url, body, allow);
		expect(decisions).toHaveLength(1);
		expect(body["0"].json).toEqual({ projectId: "p" });
		expect(body["1"].json).toMatchObject({
			name: "perf-bench-x-1",
			branch: "perf-bench-x-1",
			runSetup: false,
		});
		expect("namingPrompt" in body["1"].json).toBe(false);
	});

	test("patches a non-batched body", () => {
		const body = {
			json: { id: "w", projectId: "p" } as Record<string, unknown>,
		};
		patchCreateBody("http://h/trpc/workspaces.createEnqueued", body, allow);
		expect(body.json.runSetup).toBe(false);
	});

	test("leaves the body untouched when the guard refuses", () => {
		const body = {
			json: { id: "w", projectId: "p" } as Record<string, unknown>,
		};
		const { decisions } = patchCreateBody(
			"http://h/trpc/workspaces.createEnqueued",
			body,
			() => ({ allow: false, name: "n", branch: "b" }),
		);
		expect(decisions[0]?.allow).toBe(false);
		expect(body.json.runSetup).toBeUndefined();
	});

	test("reads procedure names from the path", () => {
		expect(procedureNames("http://h/trpc/a.b,c.d?batch=1")).toEqual([
			"a.b",
			"c.d",
		]);
	});
});

describe("CreateInterceptor", () => {
	function fakeCdp() {
		const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
		let handler: ((params: Record<string, unknown>) => void) | null = null;
		const cdp = {
			on: (_method: string, fn: (params: Record<string, unknown>) => void) => {
				handler = fn;
				return () => {
					handler = null;
				};
			},
			send: async (method: string, params: Record<string, unknown> = {}) => {
				sent.push({ method, params });
				return {};
			},
		};
		const pause = async (request: Record<string, unknown>) => {
			handler?.({ requestId: "r1", request });
			await new Promise((resolve) => setTimeout(resolve, 50));
		};
		return { cdp, sent, pause };
	}

	test("aborts a create request without a readable body", async () => {
		const { CreateInterceptor } = await import("../lib/create-interceptor");
		const { cdp, sent, pause } = fakeCdp();
		const interceptor = new CreateInterceptor(cdp as never, allow, () => {});
		await interceptor.enable();
		await pause({
			url: "http://127.0.0.1:1/trpc/workspaces.createEnqueued",
			method: "POST",
			headers: {},
		});
		expect(sent.at(-1)?.method).toBe("Fetch.failRequest");
	});

	test("aborts when the guard refuses", async () => {
		const { CreateInterceptor } = await import("../lib/create-interceptor");
		const { cdp, sent, pause } = fakeCdp();
		const interceptor = new CreateInterceptor(
			cdp as never,
			() => ({ allow: false, name: "n", branch: "b" }),
			() => {},
		);
		await interceptor.enable();
		await pause({
			url: "http://127.0.0.1:1/trpc/workspaces.createEnqueued",
			method: "POST",
			headers: {},
			postData: JSON.stringify({ json: { id: "w", projectId: "p" } }),
		});
		expect(sent.at(-1)?.method).toBe("Fetch.failRequest");
	});

	test("forwards the patched body and fulfills with the real response", async () => {
		const { CreateInterceptor } = await import("../lib/create-interceptor");
		let received: unknown = null;
		const server = Bun.serve({
			port: 0,
			fetch: async (request) => {
				received = await request.json();
				return Response.json({ result: { data: { json: { ok: true } } } });
			},
		});
		try {
			const { cdp, sent, pause } = fakeCdp();
			const interceptor = new CreateInterceptor(cdp as never, allow, () => {});
			await interceptor.enable();
			await pause({
				url: `http://127.0.0.1:${server.port}/trpc/workspaces.createEnqueued`,
				method: "POST",
				headers: { "content-type": "application/json", "content-length": "1" },
				postData: JSON.stringify({ json: { id: "w", projectId: "p" } }),
			});
			const fulfilled = sent.find((s) => s.method === "Fetch.fulfillRequest");
			expect(fulfilled?.params.responseCode).toBe(200);
			expect(received).toEqual({
				json: {
					id: "w",
					projectId: "p",
					name: "perf-bench-x-1",
					branch: "perf-bench-x-1",
					runSetup: false,
				},
			});
		} finally {
			server.stop(true);
		}
	});
});

describe("patchCreateBody with superjson", () => {
	test("the server sees the injected fields even when the client sent undefined", async () => {
		const superjson = (await import("superjson")).default;
		const envelope = superjson.serialize({
			id: "w",
			projectId: "p",
			name: undefined,
			branch: undefined,
			namingPrompt: undefined,
		});
		const body = JSON.parse(JSON.stringify({ "0": envelope }));
		patchCreateBody(
			"http://h/trpc/workspaces.createEnqueued?batch=1",
			body,
			allow,
		);
		const received = superjson.deserialize(body["0"]) as Record<
			string,
			unknown
		>;
		expect(received.name).toBe("perf-bench-x-1");
		expect(received.branch).toBe("perf-bench-x-1");
		expect(received.runSetup).toBe(false);
		expect("namingPrompt" in received).toBe(false);
	});
});
