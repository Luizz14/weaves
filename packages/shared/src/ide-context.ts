import { z } from "zod";

export const IDE_CONTEXT_MAX_PATHS = 100;
export const IDE_CONTEXT_MAX_SELECTION_BYTES = 8 * 1024;
export const IDE_CONTEXT_MAX_PAYLOAD_BYTES = 32 * 1024;
export const IDE_CONTEXT_TTL_MS = 60_000;
export const IDE_CONTEXT_REFRESH_MS = 20_000;

export function ideContextByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function truncateIdeContextText(
	value: string,
	maxBytes: number,
): string {
	let result = "";
	let bytes = 0;
	for (const character of value) {
		bytes += ideContextByteLength(character);
		if (bytes > maxBytes) break;
		result += character;
	}
	return result;
}

const pathSchema = z
	.string()
	.min(1)
	.max(4096)
	.refine(
		(value) => !value.includes("\0") && ideContextByteLength(value) <= 4096,
	);

export const ideContextSnapshotSchema = z
	.strictObject({
		workspaceId: z.string().min(1).max(128),
		producerId: z.string().uuid(),
		sequence: z.number().int().nonnegative(),
		activated: z.boolean(),
		openFiles: z.array(pathSchema).max(IDE_CONTEXT_MAX_PATHS),
		omittedFiles: z.number().int().nonnegative().max(100_000).default(0),
		activeFile: z
			.strictObject({
				path: pathSchema,
				documentId: z.string().min(1).max(128),
				version: z.number().int().nonnegative(),
				selection: z
					.strictObject({
						from: z.number().int().nonnegative(),
						to: z.number().int().nonnegative(),
						startLine: z.number().int().positive(),
						endLine: z.number().int().positive(),
						text: z
							.string()
							.refine(
								(value) =>
									ideContextByteLength(value) <=
									IDE_CONTEXT_MAX_SELECTION_BYTES,
							),
						truncated: z.boolean(),
					})
					.refine(
						(selection) =>
							selection.to > selection.from &&
							selection.endLine >= selection.startLine &&
							(selection.truncated
								? selection.text.length <= selection.to - selection.from
								: selection.text.length === selection.to - selection.from),
					)
					.nullable(),
			})
			.nullable(),
	})
	.refine(
		(snapshot) =>
			new Set(snapshot.openFiles).size === snapshot.openFiles.length,
	)
	.refine(
		(snapshot) =>
			!snapshot.activeFile ||
			snapshot.openFiles.includes(snapshot.activeFile.path),
	)
	.refine(
		(snapshot) =>
			ideContextByteLength(JSON.stringify(snapshot)) <=
			IDE_CONTEXT_MAX_PAYLOAD_BYTES,
	);

export type IdeContextSnapshot = z.infer<typeof ideContextSnapshotSchema>;

export const clearIdeContextSchema = z.strictObject({
	workspaceId: z.string().min(1).max(128),
	producerId: z.string().uuid(),
	sequence: z.number().int().nonnegative(),
});
