import {
	ALL_STARTUP_MARKERS,
	type StartupMarker,
} from "../../../src/shared/startup-diagnostics";
import type { SampleRecord } from "./session";
import { type DistributionSummary, summarizeDistribution } from "./stats";

export const P00_MARKERS: readonly StartupMarker[] = ALL_STARTUP_MARKERS;

export const LAUNCH_SPANS: ReadonlyArray<[StartupMarker, StartupMarker]> = [
	["window-created", "window-show"],
	["react-commit", "shell-interactive"],
	["shell-interactive", "terminal-usable"],
	["active-host-spawned", "active-host-healthy"],
	["active-host-healthy", "host-url-ready"],
	["host-url-ready", "terminal-usable"],
];

export interface LaunchRecord {
	index: number;
	phase: "warmup" | "measured";
	inspect: boolean;
	markersMs: Partial<Record<StartupMarker, number>>;
	preNodeMs: number | null;
	bracketOk: boolean | null;
	frontmost: boolean;
	screenLocked: boolean;
	gracefulQuit: boolean;
	windowsStatePersisted: boolean;
}

export interface JourneySummary {
	journey: string;
	variant: string;
	distribution: DistributionSummary;
	attempts: number;
	timeouts: number;
	invalid: number;
	invalidReasons: Record<string, number>;
	markMediansMs: Record<string, number>;
	markShare?: Record<string, number>;
	loafMedianBlockingMs: number | null;
}

export interface LaunchMarkerSummary {
	marker: string;
	nodeOrigin: DistributionSummary;
	spawnOrigin: DistributionSummary;
	missing: number;
}

export interface RunSummary {
	journeys: JourneySummary[];
	launch: {
		launches: number;
		accepted: number;
		frontmostConfirmed: number;
		spans: Array<{
			from: StartupMarker;
			to: StartupMarker;
			distribution: DistributionSummary;
		}>;
		markers: LaunchMarkerSummary[];
		preNode: DistributionSummary;
		perturbation: {
			marker: string;
			withInspectP50: number | null;
			withoutInspectP50: number | null;
			deltaPct: number | null;
		} | null;
	} | null;
}

function median(values: number[]): number | null {
	return summarizeDistribution(values).p50;
}

export function summarizeJourneys(records: SampleRecord[]): JourneySummary[] {
	const groups = new Map<string, SampleRecord[]>();
	for (const record of records) {
		if (record.phase !== "measured") continue;
		const key = `${record.journey}\u0000${record.variant}`;
		const list = groups.get(key) ?? [];
		list.push(record);
		groups.set(key, list);
	}
	return [...groups.entries()].map(([key, list]) => {
		const [journey, variant] = key.split("\u0000") as [string, string];
		const ok = list.filter((r) => r.status === "ok" && r.durationMs !== null);
		const invalidReasons: Record<string, number> = {};
		for (const r of list) {
			if (r.status !== "invalid") continue;
			const reason = (r.invalidReason ?? "unknown").split(":")[0] as string;
			invalidReasons[reason] = (invalidReasons[reason] ?? 0) + 1;
		}
		const markNames = new Set(ok.flatMap((r) => Object.keys(r.marks)));
		const markMediansMs: Record<string, number> = {};
		for (const name of markNames) {
			const value = median(
				ok
					.map((r) => r.marks[name])
					.filter((v): v is number => v !== undefined),
			);
			if (value !== null) markMediansMs[name] = value;
		}
		const markShare: Record<string, number> = {};
		for (const name of markNames) {
			const positive = ok.filter((r) => (r.marks[name] ?? 0) > 0).length;
			markShare[name] = ok.length ? positive / ok.length : 0;
		}
		return {
			journey,
			variant,
			distribution: summarizeDistribution(
				ok.map((r) => r.durationMs as number),
			),
			attempts: list.length,
			timeouts: list.filter((r) => r.status === "timeout").length,
			invalid: list.filter((r) => r.status === "invalid").length,
			invalidReasons,
			markMediansMs,
			markShare,
			loafMedianBlockingMs: median(ok.map((r) => r.loafBlockingMs)),
		};
	});
}

export function summarizeLaunches(
	launches: LaunchRecord[],
): RunSummary["launch"] {
	if (launches.length === 0) return null;
	const accepted = launches.filter(
		(l) => l.phase === "measured" && !l.screenLocked,
	);
	const inspected = accepted.filter((l) => l.inspect);
	const markers = P00_MARKERS.map((marker) => {
		const node = inspected
			.map((l) => l.markersMs[marker])
			.filter((v): v is number => v !== undefined);
		const spawn = inspected
			.filter((l) => l.bracketOk && l.preNodeMs !== null)
			.map((l) => {
				const value = l.markersMs[marker];
				return value === undefined
					? undefined
					: (l.preNodeMs as number) + value;
			})
			.filter((v): v is number => v !== undefined);
		return {
			marker,
			nodeOrigin: summarizeDistribution(node),
			spawnOrigin: summarizeDistribution(spawn),
			missing: inspected.length - node.length,
		};
	});
	const plain = accepted.filter((l) => !l.inspect);
	const perturbationMarker = "shell-interactive";
	const withInspect = median(
		inspected
			.map((l) => l.markersMs[perturbationMarker])
			.filter((v): v is number => v !== undefined),
	);
	const withoutInspect = median(
		plain
			.map((l) => l.markersMs[perturbationMarker])
			.filter((v): v is number => v !== undefined),
	);
	const spans = LAUNCH_SPANS.map(([from, to]) => ({
		from,
		to,
		distribution: summarizeDistribution(
			accepted
				.map((l) => {
					const start = l.markersMs[from];
					const end = l.markersMs[to];
					return start === undefined || end === undefined
						? undefined
						: end - start;
				})
				.filter((v): v is number => v !== undefined),
		),
	}));
	return {
		launches: launches.length,
		accepted: accepted.length,
		frontmostConfirmed: accepted.filter((l) => l.frontmost).length,
		markers,
		spans,
		preNode: summarizeDistribution(
			inspected
				.filter((l) => l.bracketOk && l.preNodeMs !== null)
				.map((l) => l.preNodeMs as number),
		),
		perturbation:
			plain.length > 0
				? {
						marker: perturbationMarker,
						withInspectP50: withInspect,
						withoutInspectP50: withoutInspect,
						deltaPct:
							withInspect !== null && withoutInspect
								? ((withInspect - withoutInspect) / withoutInspect) * 100
								: null,
					}
				: null,
	};
}
