import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Checkbox } from "@superset/ui/checkbox";
import { Input } from "@superset/ui/input";
import { toast } from "@superset/ui/sonner";
import { useState } from "react";
import type { ElectronRouterOutputs } from "renderer/lib/electron-trpc";
import { isFontAvailable } from "renderer/lib/font-availability";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export function ZedImport({ onImported }: { onImported: () => void }) {
	const { t } = useLingui();
	const [path, setPath] = useState("");
	const [preview, setPreview] = useState<
		ElectronRouterOutputs["settings"]["editor"]["previewImport"] | null
	>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const [pending, setPending] = useState(false);
	const load = async () => {
		setPending(true);
		try {
			const value =
				await electronTrpcClient.settings.editor.previewImport.query({
					path: path || undefined,
				});
			setPreview(value);
			setSelected(
				value.entries
					.filter((entry) => entry.compatible)
					.map((entry) => entry.path),
			);
		} catch (error) {
			toast.error(
				errorMessage(error, t({ message: "Could not read Zed preferences" })),
			);
		} finally {
			setPending(false);
		}
	};
	const selectEntry = (path: string, checked: boolean) => {
		const paths =
			path === "appearance.palette" || path === "appearance.theme"
				? ["appearance.palette", "appearance.theme"]
				: [path];
		setSelected((values) =>
			checked
				? [...new Set([...values, ...paths])]
				: values.filter((value) => !paths.includes(value)),
		);
	};
	const apply = async () => {
		if (!preview) return;
		setPending(true);
		try {
			await electronTrpcClient.settings.editor.applyImport.mutate({
				path: preview.path,
				hash: preview.hash,
				selected,
			});
			setPreview(null);
			onImported();
			toast.success(t({ message: "Editor preferences imported" }));
		} catch (error) {
			toast.error(
				errorMessage(error, t({ message: "Could not import Zed preferences" })),
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<section className="space-y-3" aria-labelledby="zed-import-title">
			<h3 id="zed-import-title" className="text-sm font-medium">
				<Trans>Import from Zed</Trans>
			</h3>
			<p className="text-xs text-muted-foreground">
				<Trans>
					Preview compatible editor preferences before applying them. Unselected
					values remain unchanged.
				</Trans>
			</p>
			<div className="flex gap-2">
				<Input
					aria-label={t({ message: "Zed settings file" })}
					value={path}
					onChange={(event) => {
						setPath(event.target.value);
						setPreview(null);
					}}
					placeholder={t({ message: "Detect installed Zed" })}
				/>
				<Button
					variant="outline"
					disabled={pending}
					onClick={async () => {
						const file =
							await electronTrpcClient.settings.editor.pickImportFile.mutate();
						if (file) {
							setPath(file);
							setPreview(null);
						}
					}}
				>
					<Trans>Browse</Trans>
				</Button>
				<Button disabled={pending} onClick={() => void load()}>
					<Trans>Preview import</Trans>
				</Button>
			</div>
			{preview && (
				<div className="space-y-3">
					{!preview.themeFound && (
						<p className="text-xs text-muted-foreground">
							<Trans>
								The Zed theme was not found. Other preferences can still be
								imported.
							</Trans>
						</p>
					)}
					<div className="max-h-80 overflow-auto rounded-lg border divide-y">
						{preview.entries.map((entry) => (
							<label
								key={entry.path}
								htmlFor={`zed-import-${entry.path}`}
								className="flex items-start gap-3 p-3 text-xs"
							>
								<Checkbox
									id={`zed-import-${entry.path}`}
									disabled={!entry.compatible || pending}
									checked={selected.includes(entry.path)}
									onCheckedChange={(checked) =>
										selectEntry(entry.path, checked === true)
									}
								/>
								<span className="min-w-0 flex-1">
									<span className="font-medium">{entry.source}</span>
									<span className="block break-all text-muted-foreground">
										{JSON.stringify(entry.current ?? null)} →{" "}
										{JSON.stringify(entry.value)}
									</span>
									{!entry.compatible && (
										<span className="block text-muted-foreground">
											<Trans>
												Not compatible; this value will not be imported.
											</Trans>
										</span>
									)}
									{entry.path === "appearance.fontFamily" &&
										typeof entry.value === "string" &&
										!isFontAvailable(entry.value) && (
											<span className="block text-muted-foreground">
												<Trans>
													This font is not installed. The editor will use its
													fallback font.
												</Trans>
											</span>
										)}
								</span>
							</label>
						))}
					</div>
					<Button
						disabled={pending || !selected.length}
						onClick={() => void apply()}
					>
						<Trans>Import selected preferences</Trans>
					</Button>
				</div>
			)}
		</section>
	);
}
