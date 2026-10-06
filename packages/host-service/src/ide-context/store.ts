import {
	IDE_CONTEXT_TTL_MS,
	type IdeContextSnapshot,
	ideContextSnapshotSchema,
} from "@superset/shared/ide-context";

const MAX_SNAPSHOTS = 128;
const MAX_PRODUCERS = 256;
export const IDE_CONTEXT_REPLAY_RETENTION_MS = IDE_CONTEXT_TTL_MS * 2;

export class IdeContextStore {
	private readonly snapshots = new Map<
		string,
		{ snapshot: IdeContextSnapshot; expiresAt: number; activation: number }
	>();
	private readonly producers = new Map<
		string,
		{
			workspaceId: string;
			expiresAt: number;
			sequence: number;
			retired: boolean;
		}
	>();
	private activation = 0;

	constructor(private readonly now: () => number = Date.now) {}

	private producerKey(workspaceId: string, producerId: string): string {
		return JSON.stringify([workspaceId, producerId]);
	}

	private sweep(): void {
		for (const [key, entry] of this.snapshots) {
			if (entry.expiresAt <= this.now()) this.snapshots.delete(key);
		}
		for (const [key, producer] of this.producers) {
			if (producer.expiresAt <= this.now()) this.producers.delete(key);
		}
	}

	private remember(
		key: string,
		workspaceId: string,
		sequence: number,
		retired: boolean,
	): void {
		this.producers.delete(key);
		this.producers.set(key, {
			workspaceId,
			expiresAt: this.now() + IDE_CONTEXT_REPLAY_RETENTION_MS,
			sequence,
			retired,
		});
		while (this.producers.size > MAX_PRODUCERS) {
			const oldest = this.producers.keys().next().value;
			if (oldest !== undefined) this.producers.delete(oldest);
		}
	}

	publish(input: IdeContextSnapshot): boolean {
		const snapshot = ideContextSnapshotSchema.parse(input);
		this.sweep();
		const key = this.producerKey(snapshot.workspaceId, snapshot.producerId);
		const producer = this.producers.get(key);
		if (
			producer &&
			(producer.retired || snapshot.sequence <= producer.sequence)
		)
			return false;
		const activation = snapshot.activated
			? ++this.activation
			: (this.snapshots.get(key)?.activation ?? 0);
		this.remember(key, snapshot.workspaceId, snapshot.sequence, false);
		this.snapshots.delete(key);
		this.snapshots.set(key, {
			snapshot,
			expiresAt: this.now() + IDE_CONTEXT_TTL_MS,
			activation,
		});
		while (this.snapshots.size > MAX_SNAPSHOTS) {
			const oldest = this.snapshots.keys().next().value;
			if (oldest !== undefined) this.snapshots.delete(oldest);
		}
		return true;
	}

	read(workspaceId: string): IdeContextSnapshot | null {
		this.sweep();
		let active: { snapshot: IdeContextSnapshot; activation: number } | null =
			null;
		for (const entry of this.snapshots.values()) {
			if (
				entry.snapshot.workspaceId === workspaceId &&
				(!active || entry.activation >= active.activation)
			)
				active = entry;
		}
		return active?.snapshot ?? null;
	}

	clear(workspaceId: string, producerId: string, sequence: number): boolean {
		this.sweep();
		const key = this.producerKey(workspaceId, producerId);
		const producer = this.producers.get(key);
		if (producer && sequence <= producer.sequence) return false;
		this.remember(key, workspaceId, Number.MAX_SAFE_INTEGER, true);
		return this.snapshots.delete(key);
	}

	deleteWorkspace(workspaceId: string): void {
		for (const [key, entry] of this.snapshots) {
			if (entry.snapshot.workspaceId === workspaceId)
				this.snapshots.delete(key);
		}
		for (const [key, producer] of [...this.producers]) {
			if (producer.workspaceId === workspaceId)
				this.remember(key, workspaceId, Number.MAX_SAFE_INTEGER, true);
		}
	}

	dispose(): void {
		this.snapshots.clear();
		this.producers.clear();
	}
}
