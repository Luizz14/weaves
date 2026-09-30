import { useLingui } from "@lingui/react/macro";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Switch } from "@superset/ui/switch";
import { useId } from "react";

export function EditorSettingField({
	label,
	value,
	kind,
	options,
	onChange,
	disabled = false,
}: {
	label: string;
	value: unknown;
	kind: "boolean" | "number" | "string" | "choice";
	options?: { value: string; label: string }[];
	onChange: (value: unknown) => void;
	disabled?: boolean;
}) {
	const id = useId();
	const { t } = useLingui();
	return (
		<div className="flex items-center justify-between gap-6 py-2">
			<Label htmlFor={id} className="text-sm">
				{label}
			</Label>
			{kind === "boolean" ? (
				<Switch
					id={id}
					checked={value === true}
					disabled={disabled}
					onCheckedChange={onChange}
				/>
			) : kind === "choice" ? (
				<Select
					value={String(value)}
					disabled={disabled}
					onValueChange={onChange}
				>
					<SelectTrigger id={id} className="w-48">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{options?.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : (
				<Input
					id={id}
					className="w-48"
					type={kind === "number" ? "number" : "text"}
					placeholder={
						value === null || value === undefined
							? t({ message: "Application default" })
							: undefined
					}
					step="any"
					disabled={disabled}
					value={value === null || value === undefined ? "" : String(value)}
					onChange={(event) =>
						onChange(
							event.target.value === ""
								? null
								: kind === "number"
									? Number(event.target.value)
									: event.target.value,
						)
					}
				/>
			)}
		</div>
	);
}
