import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scrypt,
	scryptSync,
} from "node:crypto";
import { getMachineId } from "@superset/shared/host-info";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MAX_CACHED_KEYS = 8;

// scrypt costs tens of milliseconds of main-thread time by design, and boot
// reads and rewrites the token file several times; derive once per salt.
const derivedKeys = new Map<string, Buffer>();
let lastSalt: Buffer | null = null;

function rememberKey(salt: Buffer, key: Buffer): void {
	const id = salt.toString("hex");
	derivedKeys.delete(id);
	derivedKeys.set(id, key);
	if (derivedKeys.size > MAX_CACHED_KEYS) {
		const oldest = derivedKeys.keys().next().value;
		if (oldest !== undefined) derivedKeys.delete(oldest);
	}
	lastSalt = Buffer.from(salt);
}

function deriveKey(salt: Buffer): Buffer {
	const key =
		derivedKeys.get(salt.toString("hex")) ??
		scryptSync(getMachineId(), salt, KEY_LENGTH);
	rememberKey(salt, key);
	return key;
}

/**
 * Derives the key for `data`'s salt on the libuv pool, so the next decrypt of
 * the same file finds it cached instead of blocking the main thread.
 */
export function primeKeyFor(data: Buffer): Promise<void> {
	if (data.length < SALT_LENGTH) return Promise.resolve();
	const salt = Buffer.from(data.subarray(0, SALT_LENGTH));
	if (derivedKeys.has(salt.toString("hex"))) return Promise.resolve();
	return new Promise((resolve) => {
		scrypt(getMachineId(), salt, KEY_LENGTH, (error, key) => {
			if (!error) rememberKey(salt, key);
			resolve();
		});
	});
}

/**
 * Encrypts a string using AES-256-GCM with a machine-derived key.
 * Returns: salt (16) + iv (12) + authTag (16) + ciphertext
 */
export function encrypt(plaintext: string): Buffer {
	// Reusing the salt reuses the derived key; every message still gets its own
	// random IV, which is what AES-GCM requires.
	const salt = lastSalt ?? randomBytes(SALT_LENGTH);
	const key = deriveKey(salt);
	const iv = randomBytes(IV_LENGTH);

	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	// Combine all components: salt + iv + authTag + ciphertext
	return Buffer.concat([salt, iv, authTag, encrypted]);
}

const MIN_ENCRYPTED_LENGTH = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;

/**
 * Decrypts data encrypted with the encrypt function.
 */
export function decrypt(data: Buffer): string {
	if (data.length < MIN_ENCRYPTED_LENGTH) {
		throw new Error("Encrypted data too short");
	}

	// Extract components
	const salt = data.subarray(0, SALT_LENGTH);
	const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
	const authTag = data.subarray(
		SALT_LENGTH + IV_LENGTH,
		SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
	);
	const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

	const key = deriveKey(salt);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	return Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]).toString("utf8");
}
