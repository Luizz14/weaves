import { describe, expect, test } from "bun:test";
import { resolveDesktopEntryPath } from "./desktop-entry-path";

describe("resolveDesktopEntryPath", () => {
	test("resolves packaged entries from the native Resources/main root", () => {
		expect(
			resolveDesktopEntryPath("host-service.cjs", {
				isPackaged: true,
				appPath: "/Applications/Superset.app/Contents/MacOS",
				resourcePath: "/Applications/Superset.app/Contents/Resources",
			}),
		).toBe(
			"/Applications/Superset.app/Contents/Resources/main/host-service.cjs",
		);
	});

	test("resolves development entries from the desktop dist/main root", () => {
		expect(
			resolveDesktopEntryPath("terminal-host.cjs", {
				isPackaged: false,
				appPath: "/workspace/apps/desktop",
				resourcePath: "/workspace/apps/desktop",
			}),
		).toBe("/workspace/apps/desktop/dist/main/terminal-host.cjs");
	});

	test("rejects nested entry names so chunks cannot be selected", () => {
		expect(() =>
			resolveDesktopEntryPath("chunks/host-service.cjs", {
				isPackaged: true,
				appPath: "/app",
				resourcePath: "/resources",
			}),
		).toThrow("Invalid desktop entry name");
	});

	test("rejects entry names that escape the main directory", () => {
		for (const entryName of [".", ".."]) {
			expect(() =>
				resolveDesktopEntryPath(entryName, {
					isPackaged: true,
					appPath: "/app",
					resourcePath: "/resources",
				}),
			).toThrow("Invalid desktop entry name");
		}
	});
});
