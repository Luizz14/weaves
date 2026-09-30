import { type LspSettings, lspSettingsSchema } from "@superset/shared/lsp";
import { eq } from "drizzle-orm";
import type { HostDb } from "../db";
import { hostSettings } from "../db/schema";

export function readLspSettings(db: HostDb): LspSettings {
	const row = db
		.select({ json: hostSettings.lspSettingsJson })
		.from(hostSettings)
		.where(eq(hostSettings.id, 1))
		.get();
	if (!row?.json) return lspSettingsSchema.parse({});
	try {
		return lspSettingsSchema.parse(JSON.parse(row.json));
	} catch (error) {
		console.error("[lsp] Invalid stored settings", error);
		return lspSettingsSchema.parse({});
	}
}

export function writeLspSettings(db: HostDb, settings: LspSettings): void {
	const json = JSON.stringify(lspSettingsSchema.parse(settings));
	db.insert(hostSettings)
		.values({ id: 1, lspSettingsJson: json })
		.onConflictDoUpdate({
			target: hostSettings.id,
			set: { lspSettingsJson: json },
		})
		.run();
}
