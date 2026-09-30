import { Trans, useLingui } from "@lingui/react/macro";
import {
	LSP_INSTALL_INSTRUCTIONS,
	LSP_SERVER_LABELS,
	type LspServerId,
	type LspServerSettings,
	lspServerSettingsSchema,
} from "@superset/shared/lsp";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Switch } from "@superset/ui/switch";
import { Textarea } from "@superset/ui/textarea";
import { useEffect, useId, useState } from "react";

type Props = {
	serverId: LspServerId;
	settings: LspServerSettings;
	installed?: boolean;
	running: boolean;
	disabled: boolean;
	save: (settings: LspServerSettings) => void;
	restart: () => void;
};

export function LspServerCard({
	serverId,
	settings,
	installed,
	running,
	disabled,
	save,
	restart,
}: Props) {
	const { t } = useLingui();
	const id = useId();
	const [enabled, setEnabled] = useState(settings.enabled);
	const [command, setCommand] = useState(settings.command);
	const [argumentsText, setArgumentsText] = useState(
		JSON.stringify(settings.arguments),
	);
	const [configuration, setConfiguration] = useState(
		JSON.stringify(settings.configuration, null, 2),
	);
	const [initialization, setInitialization] = useState(
		JSON.stringify(settings.initializationOptions, null, 2),
	);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setEnabled(settings.enabled);
		setCommand(settings.command);
		setArgumentsText(JSON.stringify(settings.arguments));
		setConfiguration(JSON.stringify(settings.configuration, null, 2));
		setInitialization(JSON.stringify(settings.initializationOptions, null, 2));
	}, [settings]);
	const submit = () => {
		try {
			const next = lspServerSettingsSchema.parse({
				enabled,
				command,
				arguments: JSON.parse(argumentsText),
				configuration: JSON.parse(configuration),
				initializationOptions: JSON.parse(initialization),
			});
			setError(null);
			save(next);
		} catch {
			setError(
				t({
					message:
						"Use a JSON array for arguments and JSON objects for configuration and initialization options.",
				}),
			);
		}
	};
	return (
		<div className="rounded-lg border p-4 space-y-3">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h4 className="text-sm font-medium">{LSP_SERVER_LABELS[serverId]}</h4>
					<p className="text-xs text-muted-foreground">
						{running
							? t({ message: "Language server ready" })
							: installed
								? t({ message: "Installed" })
								: t({
										message:
											"Not found on PATH; workspace installations are detected when opening a file.",
									})}
					</p>
					{serverId === "kotlin" && (
						<p className="text-xs text-muted-foreground">
							<Trans>Experimental Android/Gradle support</Trans>
						</p>
					)}
				</div>
				<Switch
					aria-label={t({ message: "Enable language server" })}
					checked={enabled}
					onCheckedChange={setEnabled}
					disabled={disabled}
				/>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div className="space-y-1">
					<Label htmlFor={`${id}-command`}>
						<Trans>Executable or XML JAR path</Trans>
					</Label>
					<Input
						id={`${id}-command`}
						value={command}
						disabled={disabled}
						onChange={(event) => setCommand(event.target.value)}
						placeholder={t({ message: "Auto-detect" })}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor={`${id}-args`}>
						<Trans>Arguments (JSON array)</Trans>
					</Label>
					<Input
						id={`${id}-args`}
						value={argumentsText}
						disabled={disabled}
						onChange={(event) => setArgumentsText(event.target.value)}
					/>
				</div>
			</div>
			<details>
				<summary className="cursor-pointer text-sm">
					<Trans>Server configuration and schemas</Trans>
				</summary>
				<div className="mt-3 space-y-2">
					<Label htmlFor={`${id}-config`}>
						<Trans>Configuration (JSON object)</Trans>
					</Label>
					<Textarea
						id={`${id}-config`}
						value={configuration}
						disabled={disabled}
						onChange={(event) => setConfiguration(event.target.value)}
						className="font-mono text-xs"
					/>
					<Label htmlFor={`${id}-init`}>
						<Trans>Initialization options (JSON object)</Trans>
					</Label>
					<Textarea
						id={`${id}-init`}
						value={initialization}
						disabled={disabled}
						onChange={(event) => setInitialization(event.target.value)}
						className="font-mono text-xs"
					/>
				</div>
			</details>
			{installed === false && (
				<p className="text-xs text-muted-foreground select-text">
					<code>{LSP_INSTALL_INSTRUCTIONS[serverId]}</code>
				</p>
			)}
			{error && (
				<p className="text-xs text-destructive" role="alert">
					{error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={disabled || !running}
					onClick={restart}
				>
					<Trans>Restart server</Trans>
				</Button>
				<Button size="sm" disabled={disabled} onClick={submit}>
					<Trans>Save</Trans>
				</Button>
			</div>
		</div>
	);
}
