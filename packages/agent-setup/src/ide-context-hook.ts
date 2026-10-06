import fs from "node:fs";
import path from "node:path";
import { getTemplatePath } from "./config";
import { getHooksDir } from "./paths";
import { writeFileIfChanged } from "./write-file-if-changed";

export const IDE_CONTEXT_SCRIPT_NAME = "ide-context.cjs";

export function getIdeContextHookContent(): string {
	return fs.readFileSync(
		getTemplatePath("ide-context-hook.template.cjs"),
		"utf-8",
	);
}

export function createIdeContextHook(): void {
	writeFileIfChanged(
		path.join(getHooksDir(), IDE_CONTEXT_SCRIPT_NAME),
		getIdeContextHookContent(),
		0o755,
	);
}
