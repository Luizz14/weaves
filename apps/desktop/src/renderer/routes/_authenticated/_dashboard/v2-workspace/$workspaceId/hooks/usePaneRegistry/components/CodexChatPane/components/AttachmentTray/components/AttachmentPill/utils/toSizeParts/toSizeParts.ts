export type SizeUnit = "B" | "KB" | "MB" | "GB";

export type SizeParts = { value: number; unit: SizeUnit };

const UNITS: SizeUnit[] = ["B", "KB", "MB", "GB"];

export function toSizeParts(bytes: number): SizeParts {
	let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
	let step = 0;
	while (value >= 1024 && step < UNITS.length - 1) {
		value /= 1024;
		step += 1;
	}
	return { value, unit: UNITS[step] };
}
