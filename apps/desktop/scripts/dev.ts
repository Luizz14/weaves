#!/usr/bin/env bun

const child = Bun.spawn(["bun", "run", "tauri:dev", ...process.argv.slice(2)], {
	stdio: ["inherit", "inherit", "inherit"],
	env: {
		...process.env,
		NODE_ENV: "development",
		NODE_OPTIONS: "--max-old-space-size=8192",
	},
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.on(signal, () => child.kill(signal));
}

process.exit(await child.exited);
