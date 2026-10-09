export function nearestRank(values: number[], fraction: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.max(1, Math.ceil(sorted.length * fraction));
	return sorted[rank - 1] ?? null;
}

export interface DistributionSummary {
	n: number;
	p50: number | null;
	p75: number | null;
	p95: number | null;
	min: number | null;
	max: number | null;
	p95IsMax: boolean;
}

export function summarizeDistribution(values: number[]): DistributionSummary {
	const finite = values.filter((value) => Number.isFinite(value));
	return {
		n: finite.length,
		p50: nearestRank(finite, 0.5),
		p75: nearestRank(finite, 0.75),
		p95: nearestRank(finite, 0.95),
		min: finite.length ? Math.min(...finite) : null,
		max: finite.length ? Math.max(...finite) : null,
		p95IsMax: finite.length < 20,
	};
}

export function median(values: number[]): number | null {
	return nearestRank(values, 0.5);
}
