import { describe, expect, test } from "bun:test";
import { createAppActivationHandler } from "./app-activation";

describe("native app activation", () => {
	test("shows and focuses open windows", () => {
		const actions: string[] = [];
		const windows = ["main", "secondary"].map((label) => ({
			show: () => actions.push(`${label}:show`),
			focus: () => actions.push(`${label}:focus`),
		}));
		const createWindow = () => {
			throw new Error("an open window should be reused");
		};
		const activate = createAppActivationHandler({
			getWindows: () => windows,
			createWindow,
		});

		activate();

		expect(actions).toEqual([
			"main:show",
			"main:focus",
			"secondary:show",
			"secondary:focus",
		]);
	});

	test("creates one window when activation arrives while windowless", async () => {
		const windows: Array<{ show(): void; focus(): void }> = [];
		let createCalls = 0;
		let resolveCreation: (() => void) | undefined;
		const createWindow = () => {
			createCalls++;
			return new Promise<void>((resolve) => {
				resolveCreation = resolve;
			});
		};
		const activate = createAppActivationHandler({
			getWindows: () => windows,
			createWindow,
		});

		activate();
		activate();
		await Promise.resolve();

		expect(createCalls).toBe(1);
		expect(resolveCreation).toBeDefined();
		windows.push({ show: () => {}, focus: () => {} });
		resolveCreation?.();
		await Promise.resolve();

		activate();
		expect(createCalls).toBe(1);
	});

	test("reports failed creations, contains sync throws, and allows retries", async () => {
		const errors: unknown[] = [];
		const unhandledRejections: unknown[] = [];
		let createCalls = 0;
		const syncError = new Error("window creation threw");
		const asyncError = new Error("window creation rejected");
		const createWindow = () => {
			createCalls++;
			if (createCalls === 1) throw syncError;
			if (createCalls === 2) return Promise.reject(asyncError);
			return Promise.resolve();
		};
		const activate = createAppActivationHandler({
			getWindows: () => [],
			createWindow,
			onCreateError: (error) => errors.push(error),
		});
		const onUnhandledRejection = (error: unknown) =>
			unhandledRejections.push(error);
		process.on("unhandledRejection", onUnhandledRejection);

		try {
			activate();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(errors).toEqual([syncError]);

			activate();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(errors).toEqual([syncError, asyncError]);

			activate();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(createCalls).toBe(3);
			expect(unhandledRejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
		}
	});
});
