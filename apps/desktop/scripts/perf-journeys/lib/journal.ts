import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CreatedWorkspace {
	id: string;
	branch: string;
	destroyed: boolean;
}

export interface JournalState {
	runId: string;
	installedQuitByHarness: boolean;
	confirmOnQuitOriginallySet: boolean | null;
	confirmOnQuitChanged: boolean;
	benchPid: number | null;
	perfBench: { id: string; branch: string; projectId: string } | null;
	createdWorkspaces: CreatedWorkspace[];
	fixture: {
		path: string;
		backupPath: string;
		originalSha256: string;
		reverted: boolean;
	} | null;
	originalWorkspaceId: string | null;
	ptyDaemonPids: number[];
	installedAsarSha256: string | null;
	backupDir: string | null;
	restored: boolean;
}

export class Journal {
	private constructor(
		private path: string,
		public state: JournalState,
	) {}

	static create(path: string, runId: string): Journal {
		mkdirSync(dirname(path), { recursive: true });
		const journal = new Journal(path, {
			runId,
			installedQuitByHarness: false,
			confirmOnQuitOriginallySet: null,
			confirmOnQuitChanged: false,
			benchPid: null,
			perfBench: null,
			createdWorkspaces: [],
			fixture: null,
			originalWorkspaceId: null,
			ptyDaemonPids: [],
			installedAsarSha256: null,
			backupDir: null,
			restored: false,
		});
		journal.save();
		return journal;
	}

	static load(path: string): Journal {
		return new Journal(
			path,
			JSON.parse(readFileSync(path, "utf8")) as JournalState,
		);
	}

	update(patch: Partial<JournalState>): void {
		Object.assign(this.state, patch);
		this.save();
	}

	save(): void {
		writeFileSync(this.path, `${JSON.stringify(this.state, null, 2)}\n`, {
			mode: 0o600,
		});
	}
}
