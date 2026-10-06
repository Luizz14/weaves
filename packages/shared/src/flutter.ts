import { z } from "zod";

export const flutterActionSchema = z.enum([
	"reload",
	"restart",
	"stop",
	"select-widget",
]);
export type FlutterAction = z.infer<typeof flutterActionSchema>;
export type FlutterPhase =
	| "starting"
	| "running"
	| "reloading"
	| "restarting"
	| "stopping"
	| "exited"
	| "error";
export interface FlutterLaunchProfile {
	id: string;
	name: string;
	source: string;
	hash: string;
	mode: "debug" | "profile" | "release";
	deviceId?: string;
	diagnostics: string[];
}
export interface FlutterDevice {
	id: string;
	name: string;
	platform: string;
}
export interface FlutterLocation {
	sequence: number;
	path: string;
	line: number;
	column: number;
}
export interface FlutterSessionSnapshot {
	id: string;
	workspaceId: string;
	profileName: string;
	deviceId: string;
	phase: FlutterPhase;
	mode: FlutterLaunchProfile["mode"];
	canReload: boolean;
	canInspect: boolean;
	selectingWidget: boolean;
	output: string;
	error?: string;
	location?: FlutterLocation;
}
export const flutterWorkspaceInput = z.object({
	workspaceId: z.string(),
	activeFile: z.string().max(4096).optional(),
});
export const flutterStartInput = flutterWorkspaceInput.extend({
	profileId: z.string(),
	hash: z.string(),
	deviceId: z.string().optional(),
});
