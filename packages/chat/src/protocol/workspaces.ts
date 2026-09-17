import { z } from "zod";

export const linkedWorkspaceSchema = z.object({
	workspaceId: z.string().min(1),
	name: z.string(),
	branch: z.string().optional(),
	path: z.string().min(1),
});
export type LinkedWorkspace = z.infer<typeof linkedWorkspaceSchema>;
