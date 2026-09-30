import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtures: string[] = [];

const mockCommands = `#!/usr/bin/env python3
import json, pathlib, plistlib, shutil, subprocess, sys, time

root = pathlib.Path(__file__).resolve().parent.parent
command = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
scenario = (root / "scenario").read_text()
applications = root / "Applications"
app = applications / "Superset.app"
running = root / "running"
pattern = "^" + str(applications) + "/Superset[.]app/Contents/"
with (root / "events").open("a") as events:
    events.write(json.dumps([command, *args]) + "\\n")

def bundle(path, version):
    (path / "Contents/MacOS").mkdir(parents=True)
    (path / "Contents/Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": "com.superset.desktop",
        "CFBundleExecutable": "Superset",
    }))
    executable = path / "Contents/MacOS/Superset"
    executable.write_text(version)
    executable.chmod(0o755)

if command == "uname":
    print("Darwin" if args == ["-s"] else "arm64")
elif command == "bun":
    if (root / ".env").exists():
        sys.exit(9)
    if scenario == "build-fails":
        sys.exit(2)
    bundle(root / "apps/desktop/release/mac-arm64/Superset.app", "new")
    if scenario == "invalid-bundle":
        (root / "apps/desktop/release/mac-arm64/Superset.app/Contents/MacOS/Superset").chmod(0o644)
elif command == "PlistBuddy":
    print(plistlib.loads(pathlib.Path(args[2]).read_bytes())[args[1].split(":")[1]])
elif command == "ditto":
    if scenario == "copy-fails":
        sys.exit(2)
    shutil.copytree(args[0], args[1])
elif command == "pgrep":
    if scenario == "query-fails":
        sys.exit(2)
    if args not in (["-f", pattern], ["-f", pattern + "MacOS/Superset([[:space:]]|$)"]):
        sys.exit(2)
    if not running.exists():
        sys.exit(1)
    print(12345)
elif command == "osascript":
    if str(app) not in " ".join(args):
        sys.exit(2)
    if scenario == "detached":
        (root / "worker-waits").touch()
        while not (root / "continue-worker").exists():
            time.sleep(0.01)
    if scenario not in ("term-required", "kill-required", "cannot-stop"):
        running.unlink(missing_ok=True)
elif command == "pkill":
    if args[1:] != ["-f", pattern]:
        sys.exit(2)
    if scenario != "cannot-stop" and (args[0] == "-KILL" or scenario != "kill-required"):
        running.unlink(missing_ok=True)
elif command == "open":
    if args != [str(app)]:
        sys.exit(2)
    version = (app / "Contents/MacOS/Superset").read_text()
    if scenario in ("open-fails", "restore-fails") and version == "new":
        sys.exit(2)
    if scenario == "start-timeout" and version == "new":
        sys.exit(0)
    running.write_text(version)
elif command == "launchctl":
    if args[0] == "submit":
        if scenario == "handoff-fails":
            sys.exit(2)
        log = args[args.index("-o") + 1]
        with open(log, "ab", buffering=0) as output:
            worker = subprocess.Popen(args[args.index("--") + 1:], stdin=subprocess.DEVNULL,
                stdout=output, stderr=output, start_new_session=True)
        (root / "worker.pid").write_text(str(worker.pid))
elif command == "mv":
    if scenario == "restore-fails" and pathlib.Path(args[0]).name == "previous.app":
        sys.exit(2)
    if scenario == "swap-fails" and args == [str(pathlib.Path(args[0]).parent / "Superset.app"), str(app)]:
        sys.exit(2)
    sys.exit(subprocess.call(["/bin/mv", *args]))
elif command == "sleep":
    time.sleep(0.01)
else:
    sys.exit(2)
`;

function fixture(scenario: string) {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "superset-install-test-")),
	);
	fixtures.push(root);
	const bin = join(root, "bin");
	const scripts = join(root, "scripts");
	const applications = join(root, "Applications");
	const app = join(applications, "Superset.app");
	const lock = join(root, "install.lock");
	mkdirSync(bin);
	mkdirSync(scripts);
	mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
	writeFileSync(join(app, "Contents/MacOS/Superset"), "old");
	writeFileSync(join(root, "scenario"), scenario);
	writeFileSync(join(root, "running"), "old");
	writeFileSync(join(root, ".env"), "TEST_SECRET=preserved\n");
	writeFileSync(join(bin, "mock.py"), mockCommands);
	chmodSync(join(bin, "mock.py"), 0o755);
	for (const command of [
		"uname",
		"bun",
		"PlistBuddy",
		"ditto",
		"pgrep",
		"pkill",
		"osascript",
		"open",
		"launchctl",
		"mv",
		"sleep",
	]) {
		symlinkSync("mock.py", join(bin, command));
	}
	for (const name of [
		"build-local-desktop-release.sh",
		"install-and-restart.sh",
	]) {
		const source = readFileSync(join(import.meta.dir, name), "utf8")
			.replace(
				'APPLICATIONS_DIR="/Applications"',
				`APPLICATIONS_DIR="${applications}"`,
			)
			.replace(
				'APPLICATIONS_APP="/Applications/Superset.app"',
				`APPLICATIONS_APP="${app}"`,
			)
			.replace(
				'LOCK_DIR="/tmp/superset-install-and-restart-$(id -u).lock"',
				`LOCK_DIR="${lock}"`,
			)
			.replace(
				'PLIST_BUDDY="/usr/libexec/PlistBuddy"',
				`PLIST_BUDDY="${bin}/PlistBuddy"`,
			);
		writeFileSync(join(scripts, name), source);
	}
	return {
		root,
		app,
		lock,
		command: join(scripts, "install-and-restart.sh"),
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root },
	};
}

function events(root: string): string[][] {
	if (!existsSync(join(root, "events"))) return [];
	return readFileSync(join(root, "events"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

function log(root: string) {
	const directory = readdirSync(root).find((name) =>
		name.startsWith("superset-install-and-restart."),
	);
	if (!directory) return "";
	const file = join(root, directory, "install.log");
	return existsSync(file) ? readFileSync(file, "utf8") : "";
}

async function until(check: () => boolean) {
	const deadline = Date.now() + 15_000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Fixture timed out");
		await Bun.sleep(20);
	}
}

async function run(
	input: ReturnType<typeof fixture>,
	script = input.command,
	args: string[] = [],
) {
	const process = Bun.spawn(["/bin/bash", script, ...args], {
		cwd: input.root,
		env: input.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [status, output, error] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	]);
	return { status, output, error };
}

function assertClean(input: ReturnType<typeof fixture>) {
	expect(readFileSync(join(input.root, ".env"), "utf8")).toBe(
		"TEST_SECRET=preserved\n",
	);
	expect(existsSync(input.lock)).toBe(false);
	expect(readdirSync(join(input.root, "Applications"))).toEqual([
		"Superset.app",
	]);
}

afterEach(() => {
	for (const root of fixtures.splice(0)) {
		const pidFile = join(root, "worker.pid");
		if (existsSync(pidFile) && !log(root).includes("Instalação finalizada")) {
			try {
				process.kill(-Number(readFileSync(pidFile, "utf8")), "SIGKILL");
			} catch {}
		}
		rmSync(root, { recursive: true, force: true });
	}
});

describe("local desktop install and restart", () => {
	for (const scenario of ["success", "term-required", "kill-required"]) {
		test(scenario, async () => {
			const input = fixture(scenario);
			expect((await run(input)).status).toBe(0);
			await until(() => log(input.root).includes("Instalação finalizada"));
			expect(log(input.root)).toContain("status 0");
			expect(
				readFileSync(join(input.app, "Contents/MacOS/Superset"), "utf8"),
			).toBe("new");
			expect(readFileSync(join(input.root, "running"), "utf8")).toBe("new");
			const signals = events(input.root)
				.filter(([name]) => name === "pkill")
				.map(([, signal]) => signal);
			expect(signals).toEqual(
				scenario === "success"
					? []
					: scenario === "term-required"
						? ["-TERM"]
						: ["-TERM", "-KILL"],
			);
			assertClean(input);
		}, 20_000);
	}

	for (const scenario of [
		"build-fails",
		"invalid-bundle",
		"copy-fails",
		"handoff-fails",
	]) {
		test(`${scenario} preserves the installed app`, async () => {
			const input = fixture(scenario);
			expect((await run(input)).status).not.toBe(0);
			expect(
				readFileSync(join(input.app, "Contents/MacOS/Superset"), "utf8"),
			).toBe("old");
			expect(
				events(input.root).some(
					([name]) => name === "osascript" || name === "open",
				),
			).toBe(false);
			assertClean(input);
		});
	}

	for (const scenario of [
		"swap-fails",
		"open-fails",
		"start-timeout",
		"cannot-stop",
		"query-fails",
	]) {
		test(`${scenario} restores the previous app`, async () => {
			const input = fixture(scenario);
			expect((await run(input)).status).toBe(0);
			await until(() => log(input.root).includes("Instalação finalizada"));
			expect(log(input.root)).toMatch(/status [1-9][0-9]*\./);
			expect(
				readFileSync(join(input.app, "Contents/MacOS/Superset"), "utf8"),
			).toBe("old");
			expect(readFileSync(join(input.root, "running"), "utf8")).toBe("old");
			assertClean(input);
		}, 20_000);
	}

	test("rejects another install before building", async () => {
		const input = fixture("success");
		mkdirSync(input.lock);
		expect((await run(input)).status).toBe(1);
		expect(events(input.root).some(([name]) => name === "bun")).toBe(false);
		expect(existsSync(input.lock)).toBe(true);
	});

	test("preserves the backup if restoring it fails", async () => {
		const input = fixture("restore-fails");
		expect((await run(input)).status).toBe(0);
		await until(() => log(input.root).includes("Instalação finalizada"));
		expect(log(input.root)).toContain("A versão anterior foi preservada");
		const staging = readdirSync(join(input.root, "Applications")).find((name) =>
			name.startsWith(".superset-install."),
		);
		if (!staging) throw new Error("Missing preserved backup");
		expect(
			readFileSync(
				join(
					input.root,
					"Applications",
					staging,
					"previous.app/Contents/MacOS/Superset",
				),
				"utf8",
			),
		).toBe("old");
		expect(existsSync(input.lock)).toBe(false);
		expect(existsSync(input.app)).toBe(false);
	});

	test("keeps the original build command and supports build-only", async () => {
		for (const args of [[], ["--build-only"]]) {
			const input = fixture("success");
			const script = join(input.root, "scripts/build-local-desktop-release.sh");
			expect((await run(input, script, args)).status).toBe(0);
			expect(
				readFileSync(join(input.app, "Contents/MacOS/Superset"), "utf8"),
			).toBe(args.length ? "old" : "new");
			assertClean(input);
		}
	});

	test("continues after the launching terminal process group receives SIGHUP", async () => {
		const input = fixture("detached");
		const terminal = spawn(
			"/bin/bash",
			[
				"-c",
				'bash "$1"; touch "$2"; /bin/sleep 60',
				"bash",
				input.command,
				join(input.root, "terminal-ready"),
			],
			{
				cwd: input.root,
				env: input.env,
				detached: true,
				stdio: "ignore",
			},
		);
		const pid = terminal.pid;
		if (!pid) throw new Error("Terminal process did not start");
		try {
			await until(
				() =>
					existsSync(join(input.root, "terminal-ready")) &&
					existsSync(join(input.root, "worker-waits")),
			);
			process.kill(-pid, "SIGHUP");
			writeFileSync(join(input.root, "continue-worker"), "");
			await until(() => log(input.root).includes("Instalação finalizada"));
			expect(log(input.root)).toContain("status 0");
			assertClean(input);
		} finally {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {}
		}
	}, 20_000);
});
