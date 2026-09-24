import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { RpcDispatcher } from "../../rpc-dispatcher/rpc-dispatcher";
import { StdioPeer } from "../stdio-peer";

const t = initTRPC
	.context<{ windowLabel: string }>()
	.create({ transformer: superjson });
const router = t.router({
	context: t.procedure.query(({ ctx }) => ({
		windowLabel: ctx.windowLabel,
		date: new Date("2026-09-21T00:00:00Z"),
	})),
});
let peer: StdioPeer;
const rpc = new RpcDispatcher(
	router,
	async (windowLabel) => ({ windowLabel }),
	(windowLabel, response) => peer.emit("trpc:response", response, windowLabel),
);
peer = new StdioPeer(
	process.stdin,
	process.stdout,
	async (request) => {
		if (request.method === "echo") return request.params;
		if (request.method === "slow") {
			await new Promise((resolve) => setTimeout(resolve, 30));
			return request.params;
		}
		if (request.method === "trpc" && request.windowLabel) {
			rpc.handle(request.windowLabel, request.params);
			return null;
		}
		throw new Error("Unknown fixture request");
	},
	() => {
		rpc.dispose();
		process.exit(0);
	},
);
peer.emit("ready", { protocol: 1 });
