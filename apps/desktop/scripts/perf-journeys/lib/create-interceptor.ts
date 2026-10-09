import type { Cdp } from "./cdp";

const CREATE_PROCEDURES = [
	"workspaces.createEnqueued",
	"workspaces.createLocalEnqueued",
	"workspaces.create",
];

export interface CreateRequestInput {
	id?: string;
	projectId?: string;
	checkout?: string;
	name?: string;
	branch?: string;
	runSetup?: boolean;
	namingPrompt?: string;
	agents?: unknown[];
	[key: string]: unknown;
}

interface Envelope {
	json?: CreateRequestInput;
	meta?: { values?: Record<string, unknown>; v?: number };
}

const OVERRIDDEN_KEYS = ["name", "branch", "runSetup", "namingPrompt"];

export interface CreateDecision {
	allow: boolean;
	reason?: string;
	name: string;
	branch: string;
}

type Decide = (input: CreateRequestInput) => CreateDecision;

export function procedureNames(url: string): string[] {
	const path = new URL(url).pathname;
	const marker = "/trpc/";
	const index = path.indexOf(marker);
	if (index === -1) return [];
	return decodeURIComponent(path.slice(index + marker.length)).split(",");
}

export function patchCreateBody(
	url: string,
	body: unknown,
	decide: Decide,
): {
	body: unknown;
	decisions: CreateDecision[];
	inputs: CreateRequestInput[];
} {
	const names = procedureNames(url);
	const decisions: CreateDecision[] = [];
	const inputs: CreateRequestInput[] = [];
	const patch = (envelope: Envelope | undefined) => {
		if (!envelope?.json) return;
		const input = envelope.json;
		const decision = decide(input);
		decisions.push(decision);
		inputs.push(input);
		if (!decision.allow) return;
		input.name = decision.name;
		input.branch = decision.branch;
		input.runSetup = false;
		delete input.namingPrompt;
		const values = envelope.meta?.values;
		if (values) {
			for (const key of OVERRIDDEN_KEYS) delete values[key];
			if (Object.keys(values).length === 0) delete envelope.meta?.values;
		}
	};
	const record = body as Record<string, Envelope> & Envelope;
	if (record && "json" in record) {
		if (names.some((name) => CREATE_PROCEDURES.includes(name))) patch(record);
	} else if (record) {
		names.forEach((name, index) => {
			if (CREATE_PROCEDURES.includes(name)) patch(record[String(index)]);
		});
	}
	return { body, decisions, inputs };
}

export class CreateInterceptor {
	private unsubscribe: (() => void) | null = null;
	onForwarded?: (status: number) => void;
	onError?: (error: Error) => void;

	constructor(
		private cdp: Cdp,
		private decide: Decide,
		private onDecision: (
			input: CreateRequestInput,
			decision: CreateDecision,
		) => void,
	) {}

	async enable(): Promise<void> {
		this.unsubscribe = this.cdp.on("Fetch.requestPaused", (params) => {
			void this.handle(params as unknown as PausedRequest);
		});
		await this.cdp.send("Fetch.enable", {
			patterns: CREATE_PROCEDURES.map((name) => ({
				urlPattern: `*/trpc/*${name}*`,
				requestStage: "Request",
			})),
		});
	}

	async disable(): Promise<void> {
		await this.cdp.send("Fetch.disable").catch(() => undefined);
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private async handle(paused: PausedRequest): Promise<void> {
		const { requestId, request } = paused;
		if (request.method !== "POST") {
			await this.cdp.send("Fetch.continueRequest", { requestId });
			return;
		}
		try {
			if (!request.postData) throw new Error("create request without a body");
			const body = JSON.parse(request.postData) as unknown;
			const { decisions, inputs } = patchCreateBody(
				request.url,
				body,
				this.decide,
			);
			decisions.forEach((decision, index) => {
				const input = inputs[index];
				if (input) this.onDecision(input, decision);
			});
			if (decisions.length === 0 || decisions.some((d) => !d.allow)) {
				throw new Error("create request refused by the guard");
			}
			const headers = Object.fromEntries(
				Object.entries(request.headers).filter(
					([name]) => !FORWARD_SKIP.has(name.toLowerCase()),
				),
			);
			const response = await fetch(request.url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			const responseBody = Buffer.from(await response.arrayBuffer());
			const responseHeaders = [...response.headers.entries()]
				.filter(([name]) => !RESPONSE_SKIP.has(name.toLowerCase()))
				.map(([name, value]) => ({ name, value }));
			await this.cdp.send("Fetch.fulfillRequest", {
				requestId,
				responseCode: response.status,
				responseHeaders,
				body: responseBody.toString("base64"),
			});
			this.onForwarded?.(response.status);
		} catch (error) {
			this.onError?.(error as Error);
			await this.cdp
				.send("Fetch.failRequest", { requestId, errorReason: "Aborted" })
				.catch(() => undefined);
		}
	}
}

const FORWARD_SKIP = new Set(["content-length", "host", "connection"]);
const RESPONSE_SKIP = new Set([
	"content-length",
	"content-encoding",
	"transfer-encoding",
	"connection",
]);

interface PausedRequest {
	requestId: string;
	request: {
		url: string;
		method: string;
		postData?: string;
		headers: Record<string, string>;
	};
}
