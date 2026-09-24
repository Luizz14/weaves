#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import runtime from "../../src-tauri/runtime.json";
import { resolvePackagingIdentity } from "./packaging-identity";
import { prepareRuntime } from "./prepare-runtime";

const desktopDirectory = resolve(import.meta.dirname, "../..");
const repositoryDirectory = resolve(desktopDirectory, "../..");
const preservedEnvironment = Object.fromEntries(
	[
		"TAURI_CLI_BINARY",
		"TAURI_RELEASE_CHANNEL",
		"TAURI_QA_PROFILE",
		"TAURI_PERSONAL_INSTALL",
		"TAURI_ALLOW_UNSIGNED_UPDATER",
		"TAURI_UPDATER_PUBKEY",
		"TAURI_SIGNING_PRIVATE_KEY",
		"TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
		"CEF_PATH",
		"NODE_RUNTIME_BINARY",
		"NPM_BINARY",
		"SUPERSET_WORKSPACE_ID",
		"SUPERSET_WORKSPACE_NAME",
		"SUPERSET_PRODUCT_NAME",
		"SUPERSET_HOME_DIR",
	].flatMap((key) =>
		process.env[key] === undefined ? [] : [[key, process.env[key] as string]],
	),
);
loadEnv({
	path: join(repositoryDirectory, ".env"),
	override: true,
	quiet: true,
});
Object.assign(process.env, preservedEnvironment);
if (process.env.TAURI_PERSONAL_INSTALL === "1") {
	const releaseChannel = preservedEnvironment.TAURI_RELEASE_CHANNEL?.trim();
	if (releaseChannel && releaseChannel !== "stable") {
		fail("TAURI_PERSONAL_INSTALL requires TAURI_RELEASE_CHANNEL=stable.");
	}
	if (preservedEnvironment.TAURI_QA_PROFILE?.trim()) {
		fail("TAURI_PERSONAL_INSTALL cannot be combined with TAURI_QA_PROFILE.");
	}
	if (releaseChannel) process.env.TAURI_RELEASE_CHANNEL = releaseChannel;
	else delete process.env.TAURI_RELEASE_CHANNEL;
	delete process.env.TAURI_QA_PROFILE;
	delete process.env.TAURI_ALLOW_UNSIGNED_UPDATER;
	delete process.env.TAURI_UPDATER_PUBKEY;
	delete process.env.TAURI_SIGNING_PRIVATE_KEY;
	delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
	delete process.env.SUPERSET_WORKSPACE_ID;
	delete process.env.SUPERSET_WORKSPACE_NAME;
	delete process.env.SUPERSET_PRODUCT_NAME;
	delete process.env.SUPERSET_HOME_DIR;
	delete process.env.NODE_ENV;
	delete process.env.DESKTOP_VITE_PORT;
}
const LOCAL_TEST_UPDATER_PUBKEY =
	"dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE5QzMxNjYwNTM5OEUwNTgKUldSWTRKaFRZQmJER1h4d1ZMYVA3dnluSjdpN2RmMldJR09hUFFlZDY0SlFqckkvRUJhZDJVZXAK";

function fail(message: string): never {
	console.error(`[tauri] ${message}`);
	process.exit(1);
}

function findCli(): string {
	const configured = process.env.TAURI_CLI_BINARY;
	if (configured) return resolve(configured);

	const candidates = [
		join(desktopDirectory, "node_modules/.bin/tauri"),
		join(repositoryDirectory, "node_modules/.bin/tauri"),
		join(desktopDirectory, "node_modules/.bin/cargo-tauri"),
		join(repositoryDirectory, "node_modules/.bin/cargo-tauri"),
	];
	const binary = candidates.find((candidate) => existsSync(candidate));
	if (binary) return binary;
	return process.platform === "win32" ? "tauri.cmd" : "tauri";
}

function developmentConfigPath(): string {
	const sourcePath = join(desktopDirectory, "src-tauri/tauri.conf.json");
	const config = JSON.parse(readFileSync(sourcePath, "utf8")) as {
		productName?: string;
		identifier?: string;
		plugins?: Record<string, Record<string, unknown>>;
		build?: { devUrl?: string; beforeDevCommand?: string };
	};
	const devPort = process.env.DESKTOP_VITE_PORT || "5173";
	config.build = {
		...config.build,
		devUrl: `http://127.0.0.1:${devPort}`,
		beforeDevCommand: config.build?.beforeDevCommand || "bun run dev:renderer",
	};

	// Keep development registrations and CEF profiles isolated when the caller
	// explicitly identifies a worktree. Stable production identity is untouched.
	const workspaceId =
		process.env.SUPERSET_WORKSPACE_ID?.trim() || desktopDirectory;
	{
		const suffix = createHash("sha256")
			.update(workspaceId)
			.digest("hex")
			.slice(0, 12);
		config.identifier = `com.superset.desktop.dev.${suffix}`;
		const workspaceName = process.env.SUPERSET_WORKSPACE_NAME?.trim();
		const normalizedWorkspaceName = workspaceName
			?.toLowerCase()
			.replace(/[^a-z0-9-]/g, "-");
		const protocolScheme =
			normalizedWorkspaceName && normalizedWorkspaceName !== "superset"
				? `superset-${normalizedWorkspaceName.slice(0, 32)}`
				: "superset";
		config.productName =
			process.env.SUPERSET_PRODUCT_NAME?.trim() ||
			(workspaceName ? `Superset Dev (${workspaceName})` : "Superset Dev");
		config.plugins = {
			...config.plugins,
			"deep-link": {
				desktop: {
					schemes: [protocolScheme],
					name: config.productName || "Superset Dev",
				},
			},
		};
	}

	// Keep the generated config beside src-tauri so all relative frontend/resource
	// paths retain the same base directory as the checked-in native config.
	const outputPath = join(
		desktopDirectory,
		"src-tauri/tauri.dev.generated.json",
	);
	writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
	return outputPath;
}

function packagingConfigPath(): string {
	const sourcePath = join(desktopDirectory, "src-tauri/tauri.conf.json");
	const config = JSON.parse(readFileSync(sourcePath, "utf8")) as {
		bundle?: {
			resources?: unknown;
			createUpdaterArtifacts?: unknown;
			icon?: unknown;
		};
		plugins?: Record<string, Record<string, unknown>>;
		version?: string;
		identifier?: string;
		productName?: string;
	};
	config.version = JSON.parse(
		readFileSync(join(desktopDirectory, "package.json"), "utf8"),
	).version;
	const publicKey = process.env.TAURI_UPDATER_PUBKEY?.trim();
	const personalInstallValue = process.env.TAURI_PERSONAL_INSTALL?.trim();
	if (personalInstallValue && personalInstallValue !== "1") {
		fail("TAURI_PERSONAL_INSTALL must be set to 1 when enabled.");
	}
	const personalInstall = personalInstallValue === "1";
	const allowUnsigned =
		personalInstall || process.env.TAURI_ALLOW_UNSIGNED_UPDATER === "1";
	const releaseChannel = process.env.TAURI_RELEASE_CHANNEL?.trim() || "stable";
	const qaProfile = process.env.TAURI_QA_PROFILE?.trim();
	if (releaseChannel !== "stable" && releaseChannel !== "canary") {
		fail(`Unsupported TAURI_RELEASE_CHANNEL: ${releaseChannel}`);
	}
	if (personalInstall && releaseChannel !== "stable") {
		fail("TAURI_PERSONAL_INSTALL requires TAURI_RELEASE_CHANNEL=stable.");
	}
	if (personalInstall && qaProfile) {
		fail("TAURI_PERSONAL_INSTALL cannot be combined with TAURI_QA_PROFILE.");
	}
	if (!personalInstall && !publicKey && !allowUnsigned) {
		fail(
			"TAURI_UPDATER_PUBKEY is required for `tauri build`; set TAURI_ALLOW_UNSIGNED_UPDATER=1 only for an explicit local unsigned build.",
		);
	}
	if (
		!personalInstall &&
		publicKey &&
		!process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()
	) {
		fail(
			"TAURI_SIGNING_PRIVATE_KEY is required when TAURI_UPDATER_PUBKEY is configured so updater artifacts can be signed.",
		);
	}
	if (!personalInstall && allowUnsigned && !qaProfile) {
		fail(
			"TAURI_QA_PROFILE is required for local unsigned builds so the app cannot share the production identity, profile, or deep-link scheme.",
		);
	}
	if (!personalInstall && publicKey && qaProfile) {
		fail(
			"TAURI_QA_PROFILE is only for explicit local unsigned builds; use the stable identity for signed releases.",
		);
	}

	config.bundle = {
		...config.bundle,
		resources: {
			"../dist/main": "main",
			"../dist/node": "node",
			"../dist/node_modules": "node_modules",
			"../dist/resources": "resources",
			"../src/resources/tray/iconTemplate.png": "tray/iconTemplate.png",
			"../src/resources/build/icons": "icons",
			"../src/resources/build": "resources/build",
		},
		createUpdaterArtifacts: personalInstall ? false : Boolean(publicKey),
	};
	const updaterPubkey = personalInstall
		? LOCAL_TEST_UPDATER_PUBKEY
		: (publicKey ?? LOCAL_TEST_UPDATER_PUBKEY);
	config.plugins = {
		...config.plugins,
		updater: {
			...config.plugins?.updater,
			pubkey: updaterPubkey,
			...(personalInstall
				? { requireSignedVersion: false }
				: publicKey
					? { requireSignedVersion: true }
					: allowUnsigned
						? { requireSignedVersion: false }
						: {}),
		},
	};
	const identity = resolvePackagingIdentity({
		channel: releaseChannel,
		qaProfile,
		personalInstall,
		productName: process.env.SUPERSET_PRODUCT_NAME,
		workspaceName: process.env.SUPERSET_WORKSPACE_NAME,
	});
	config.identifier = identity.identifier;
	config.productName = identity.productName;
	if (identity.icons) config.bundle.icon = identity.icons;
	config.plugins = {
		...config.plugins,
		"deep-link": {
			desktop: {
				schemes: [identity.deepLinkScheme],
				name: identity.productName,
			},
		},
		updater: {
			...config.plugins?.updater,
			endpoints: [identity.updaterEndpoint],
		},
	};
	if (personalInstall) {
		console.log(
			`[tauri] local personal build: ${config.identifier}; product=${config.productName}; protocol=${identity.deepLinkScheme}; updater checks and artifacts disabled`,
		);
	}
	if (qaProfile) {
		const workspaceName =
			process.env.SUPERSET_WORKSPACE_NAME?.trim() || `tauri-qa-${qaProfile}`;
		console.log(
			`[tauri] isolated unsigned QA identity: ${config.identifier}; product=${config.productName}; protocol=${identity.deepLinkScheme}; runtime SUPERSET_WORKSPACE_NAME=${workspaceName}`,
		);
	}

	const outputPath = join(
		desktopDirectory,
		"src-tauri/tauri.release.generated.json",
	);
	writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
	return outputPath;
}

async function assertCliVersion(binary: string): Promise<void> {
	const child = Bun.spawn([binary, "--version"], {
		cwd: desktopDirectory,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	const version = `${stdout}\n${stderr}`.trim();
	if (exitCode !== 0 || !version.includes(runtime.cliVersion)) {
		fail(
			`Tauri CLI mismatch: expected ${runtime.cliVersion}, got ${version || `exit ${exitCode}`}. Set TAURI_CLI_BINARY to the pinned CLI.`,
		);
	}
}

const args = process.argv.slice(2);
await prepareRuntime();

const cli = findCli();
await assertCliVersion(cli);
const command =
	args[0] === "dev" && !args.includes("--config")
		? [args[0], "--config", developmentConfigPath(), ...args.slice(1)]
		: args[0] === "build" && !args.includes("--config")
			? [args[0], "--config", packagingConfigPath(), ...args.slice(1)]
			: args;
const child = Bun.spawn([cli, ...command], {
	cwd: desktopDirectory,
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
const exitCode = await child.exited;
if (exitCode !== 0) fail(`Tauri CLI exited with status ${exitCode}.`);
