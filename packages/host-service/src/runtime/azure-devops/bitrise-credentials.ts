import { createRequire } from "node:module";

import type { AsyncEntry as KeyringAsyncEntry } from "@napi-rs/keyring";

const require = createRequire(import.meta.url);

const BITRISE_KEYRING_SERVICE = "com.superset.desktop.bitrise";

export type BitriseCredentialStore = {
	get: (key: string) => Promise<string | undefined>;
	set: (key: string, value: string) => Promise<void>;
	delete: (key: string) => Promise<void>;
};

export class SystemBitriseCredentialStore implements BitriseCredentialStore {
	async get(key: string): Promise<string | undefined> {
		return (await this.entry(key)).getPassword();
	}

	async set(key: string, value: string): Promise<void> {
		await (await this.entry(key)).setPassword(value);
	}

	async delete(key: string): Promise<void> {
		await (await this.entry(key)).deletePassword();
	}

	private async entry(key: string): Promise<KeyringAsyncEntry> {
		const { AsyncEntry } =
			require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
		return new AsyncEntry(BITRISE_KEYRING_SERVICE, key, {
			linux: { store: "secret-service" },
		});
	}
}
