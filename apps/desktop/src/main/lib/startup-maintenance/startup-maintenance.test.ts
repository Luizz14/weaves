import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { scheduleStartupMaintenance } from "./startup-maintenance";

class StartupWindow extends EventEmitter {
	constructor(private visible: boolean) {
		super();
	}
	isVisible() {
		return this.visible;
	}
	show() {
		this.visible = true;
		this.emit("show");
	}
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("maintenance waits for show and runs once on a later event-loop turn", async () => {
	const window = new StartupWindow(false);
	let calls = 0;
	scheduleStartupMaintenance(window, () => calls++);
	await nextTurn();
	expect(calls).toBe(0);
	window.show();
	expect(calls).toBe(0);
	await nextTurn();
	expect(calls).toBe(1);
	window.show();
	await nextTurn();
	expect(calls).toBe(1);
	expect(window.listenerCount("show")).toBe(0);
});

test("already-visible restored windows schedule maintenance without waiting for another show", async () => {
	const window = new StartupWindow(true);
	let calls = 0;
	scheduleStartupMaintenance(window, () => calls++);
	expect(calls).toBe(0);
	await nextTurn();
	expect(calls).toBe(1);
	expect(window.listenerCount("show")).toBe(0);
});
