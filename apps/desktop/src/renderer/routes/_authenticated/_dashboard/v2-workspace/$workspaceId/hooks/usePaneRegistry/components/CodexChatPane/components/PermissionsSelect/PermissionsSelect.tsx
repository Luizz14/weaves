import { Trans, useLingui } from "@lingui/react/macro";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";

export function PermissionsSelect({
	value,
	disabled,
	onChange,
}: {
	value: string;
	disabled?: boolean;
	onChange: (value: string) => void;
}) {
	const { t } = useLingui();
	return (
		<Select value={value} disabled={disabled} onValueChange={onChange}>
			<SelectTrigger
				aria-label={t({ message: "Permissions" })}
				className="h-8 w-auto gap-2 border-none bg-transparent text-xs"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="read-only">
					<Trans>Read only</Trans>
				</SelectItem>
				<SelectItem value="auto">
					<Trans>Auto</Trans>
				</SelectItem>
				<SelectItem value="full-access">
					<Trans>Full access</Trans>
				</SelectItem>
			</SelectContent>
		</Select>
	);
}
