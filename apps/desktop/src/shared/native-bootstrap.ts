import { z } from "zod";

const absolutePath = z
	.string()
	.min(1)
	.refine(
		(value) =>
			value.startsWith("/") ||
			/^[A-Za-z]:[\\/]/.test(value) ||
			value.startsWith("\\\\"),
		"Native bootstrap paths must be absolute",
	);

export const nativeBootstrapSchema = z
	.object({
		schemaVersion: z.literal(1),
		appName: z.string().min(1),
		appVersion: z.string().min(1),
		isPackaged: z.boolean(),
		paths: z
			.object({
				appPath: absolutePath,
				resourcePath: absolutePath,
				userDataPath: absolutePath,
				sessionDataPath: absolutePath,
				downloads: absolutePath,
			})
			.strict(),
		platform: z.enum(["darwin", "win32", "linux"]),
		arch: z.enum(["arm64", "x64"]),
		preferredLanguages: z.array(z.string()),
		username: z.string().optional(),
		permissions: z
			.record(z.string(), z.union([z.string(), z.boolean()]))
			.optional(),
		runtime: z.literal("tauri"),
	})
	.strict();

export type NativeBootstrap = z.infer<typeof nativeBootstrapSchema>;
