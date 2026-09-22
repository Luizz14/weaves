import { Label } from "@superset/ui/label";
import { toHex } from "shared/themes";

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

interface ColorFieldProps {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
}

function toSwatchColor(value: string): string {
	if (HEX_COLOR_PATTERN.test(value)) return value;
	try {
		return toHex(value);
	} catch {
		return "#000000";
	}
}

export function ColorField({ id, label, value, onChange }: ColorFieldProps) {
	const swatchColor = toSwatchColor(value);

	return (
		<div className="flex items-center justify-between gap-4 py-2.5">
			<Label htmlFor={id} className="text-sm">
				{label}
			</Label>
			<div className="flex items-center gap-2 rounded-md border border-input px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
				<span className="relative inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-inset ring-border transition-transform active:scale-[0.96]">
					<input
						type="color"
						value={swatchColor}
						onChange={(event) => onChange(event.target.value)}
						className="absolute -inset-1 cursor-pointer appearance-none border-0 bg-transparent p-0"
						aria-label={label}
					/>
				</span>
				<input
					id={id}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					spellCheck={false}
					className="w-24 bg-transparent font-mono text-xs uppercase tabular-nums outline-none"
				/>
			</div>
		</div>
	);
}
