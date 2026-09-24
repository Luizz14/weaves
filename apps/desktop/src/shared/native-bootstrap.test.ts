import { expect, test } from "bun:test";
import {
	type NativeBootstrap,
	nativeBootstrapSchema,
} from "./native-bootstrap";

const metadata: NativeBootstrap = {
	schemaVersion: 1,
	appName: "Superset",
	appVersion: "1.29.0",
	isPackaged: true,
	paths: {
		appPath: "/Applications/Superset.app",
		resourcePath: "/Applications/Superset.app/Contents/Resources",
		userDataPath: "/fixture/Superset",
		sessionDataPath: "/fixture/Superset/cef",
		downloads: "/fixture/Downloads",
	},
	platform: "darwin",
	arch: "arm64",
	preferredLanguages: ["pt-BR"],
	runtime: "tauri",
} satisfies NativeBootstrap;

test("accepts the versioned bootstrap shared by Node and renderer", () => {
	expect(nativeBootstrapSchema.parse(metadata)).toEqual(metadata);
});

test("rejects Rust target spellings that do not match Node platform contracts", () => {
	expect(
		nativeBootstrapSchema.safeParse({ ...metadata, platform: "macos" }).success,
	).toBe(false);
	expect(
		nativeBootstrapSchema.safeParse({ ...metadata, arch: "aarch64" }).success,
	).toBe(false);
});

test("fails startup on missing, relative or unknown storage path fields", () => {
	expect(
		nativeBootstrapSchema.safeParse({
			...metadata,
			paths: { ...metadata.paths, userDataPath: "." },
		}).success,
	).toBe(false);
	expect(
		nativeBootstrapSchema.safeParse({
			...metadata,
			paths: { ...metadata.paths, downloads: undefined },
		}).success,
	).toBe(false);
	expect(
		nativeBootstrapSchema.safeParse({
			...metadata,
			paths: { ...metadata.paths, cachePath: "/unexpected" },
		}).success,
	).toBe(false);
});
