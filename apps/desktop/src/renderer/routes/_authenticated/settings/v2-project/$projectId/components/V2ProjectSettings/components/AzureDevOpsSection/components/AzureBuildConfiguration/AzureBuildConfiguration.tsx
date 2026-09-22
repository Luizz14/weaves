import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { LuKeyRound, LuLoaderCircle, LuPlus, LuTrash2 } from "react-icons/lu";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

type AzureBuildConfigurationProps = {
	projectId: string;
	hostUrl: string;
	isHostOnline: boolean;
};

type BuildPlatform = "android" | "ios";

const defaultAlphaVersion: Record<BuildPlatform, string> = {
	android: "3.15.",
	ios: "",
};

export function AzureBuildConfiguration({
	projectId,
	hostUrl,
	isHostOnline,
}: AzureBuildConfigurationProps) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const queryKey = useMemo(
		() => ["azure-devops", "build-config", hostUrl, projectId] as const,
		[hostUrl, projectId],
	);
	const configQuery = useQuery({
		queryKey,
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).azureDevOps.getBuildConfig.query({
				projectId,
			}),
		enabled: isHostOnline,
	});

	const [platform, setPlatform] = useState<BuildPlatform>("android");
	const [developerNames, setDeveloperNames] = useState<string[]>([]);
	const [nameDraft, setNameDraft] = useState("");
	const [alphaVersionValue, setAlphaVersionValue] = useState(
		defaultAlphaVersion.android,
	);
	const [bitriseToken, setBitriseToken] = useState("");

	useEffect(() => {
		if (configQuery.data === undefined) return;
		if (!configQuery.data) {
			setPlatform("android");
			setDeveloperNames([]);
			setAlphaVersionValue(defaultAlphaVersion.android);
			return;
		}
		setPlatform(configQuery.data.platform);
		setDeveloperNames(configQuery.data.developerNames);
		setAlphaVersionValue(configQuery.data.alphaVersionValue);
	}, [configQuery.data]);

	const saveMutation = useMutation({
		mutationFn: () =>
			getHostServiceClientByUrl(hostUrl).azureDevOps.setBuildConfig.mutate({
				projectId,
				platform,
				developerNames,
				alphaVersionValue: alphaVersionValue.trim(),
				bitriseToken: bitriseToken.trim() || undefined,
			}),
		onSuccess: (config) => {
			queryClient.setQueryData(queryKey, config);
			setBitriseToken("");
			toast.success(t({ message: "Build settings saved" }));
		},
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to save build settings" })),
			),
	});

	const removeTokenMutation = useMutation({
		mutationFn: () =>
			getHostServiceClientByUrl(hostUrl).azureDevOps.removeBitriseToken.mutate({
				projectId,
				platform,
			}),
		onSuccess: () => {
			queryClient.setQueryData(queryKey, (config) =>
				config ? { ...config, bitriseTokenConfigured: false } : config,
			);
			toast.success(t({ message: "Bitrise token removed" }));
		},
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to remove Bitrise token" })),
			),
	});

	const addDeveloperName = () => {
		const value = nameDraft.trim();
		if (
			value &&
			!developerNames.some(
				(name) =>
					name.toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US"),
			)
		) {
			setDeveloperNames((names) => [...names, value]);
			setNameDraft("");
		}
	};

	const config = configQuery.data;
	const isBusy =
		configQuery.isPending ||
		saveMutation.isPending ||
		removeTokenMutation.isPending;

	return (
		<div className="rounded-xl bg-muted/20 p-1 shadow-[0_0_0_1px_var(--border),0_1px_2px_-1px_rgb(0_0_0/0.08),0_2px_4px_rgb(0_0_0/0.04)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">
			<div className="rounded-lg bg-background p-4">
				<div className="mb-4">
					<h3 className="text-sm font-medium">
						<Trans>Mobile build generation</Trans>
					</h3>
					<p className="mt-1 text-pretty text-xs text-muted-foreground">
						<Trans>
							Configure the Bitrise app and the developer names available for
							this project.
						</Trans>
					</p>
				</div>

				{!isHostOnline ? (
					<p className="text-sm text-muted-foreground">
						<Trans>Connect to this host to configure mobile builds.</Trans>
					</p>
				) : configQuery.error ? (
					<p className="text-sm text-destructive">
						{errorMessage(configQuery.error)}
					</p>
				) : (
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="azure-build-platform">
								<Trans>Platform</Trans>
							</Label>
							<select
								id="azure-build-platform"
								className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								value={platform}
								disabled={isBusy}
								onChange={(event) => {
									if (
										event.target.value !== "android" &&
										event.target.value !== "ios"
									) {
										return;
									}
									setPlatform(event.target.value);
									setAlphaVersionValue(defaultAlphaVersion[event.target.value]);
								}}
							>
								<option value="android">Android</option>
								<option value="ios">iOS</option>
							</select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="azure-build-alpha-version">
								<Trans>Alpha version value</Trans>
							</Label>
							<Input
								id="azure-build-alpha-version"
								value={alphaVersionValue}
								onChange={(event) => setAlphaVersionValue(event.target.value)}
								placeholder={t({ message: "Optional" })}
								maxLength={80}
								disabled={isBusy}
							/>
							<p className="text-xs text-muted-foreground">
								<Trans>
									Used as the version name for alpha builds. Leave blank when
									the workflow generates it automatically.
								</Trans>
							</p>
						</div>

						<div className="space-y-1.5 md:col-span-2">
							<Label htmlFor="azure-build-developer-name">
								<Trans>Developer names</Trans>
							</Label>
							<div className="flex gap-2">
								<Input
									id="azure-build-developer-name"
									value={nameDraft}
									onChange={(event) => setNameDraft(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											addDeveloperName();
										}
									}}
									maxLength={120}
									disabled={isBusy || developerNames.length >= 100}
									placeholder={t({ message: "Add a developer name" })}
								/>
								<Button
									type="button"
									variant="outline"
									disabled={
										isBusy || !nameDraft.trim() || developerNames.length >= 100
									}
									onClick={addDeveloperName}
								>
									<LuPlus />
									<Trans>Add</Trans>
								</Button>
							</div>
							{developerNames.length > 0 ? (
								<ul className="mt-2 flex flex-wrap gap-2">
									{developerNames.map((name) => (
										<li
											key={name}
											className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs"
										>
											<span>{name}</span>
											<button
												type="button"
												className="text-muted-foreground hover:text-destructive"
												aria-label={t({ message: "Remove developer name" })}
												disabled={isBusy}
												onClick={() =>
													setDeveloperNames((names) =>
														names.filter((candidate) => candidate !== name),
													)
												}
											>
												<LuTrash2 className="size-3.5" />
											</button>
										</li>
									))}
								</ul>
							) : (
								<p className="mt-2 text-xs text-muted-foreground">
									<Trans>
										Add at least one name before generating a build.
									</Trans>
								</p>
							)}
						</div>

						<div className="space-y-1.5 md:col-span-2">
							<Label htmlFor="azure-bitrise-token">
								<Trans>Bitrise build trigger token</Trans>
							</Label>
							<div className="flex gap-2">
								<Input
									id="azure-bitrise-token"
									type="password"
									value={bitriseToken}
									onChange={(event) => setBitriseToken(event.target.value)}
									autoComplete="new-password"
									autoCapitalize="none"
									autoCorrect="off"
									spellCheck={false}
									maxLength={4096}
									placeholder={
										config?.platform === platform &&
										config.bitriseTokenConfigured
											? t({ message: "A token is already stored securely" })
											: t({ message: "Enter the Bitrise token" })
									}
									disabled={isBusy}
								/>
								{config?.platform === platform &&
								config.bitriseTokenConfigured ? (
									<Button
										type="button"
										variant="outline"
										disabled={isBusy}
										onClick={() => removeTokenMutation.mutate()}
										aria-label={t({ message: "Remove Bitrise token" })}
									>
										<LuTrash2 />
									</Button>
								) : null}
							</div>
							<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
								<LuKeyRound className="size-3.5" />
								{config?.platform === platform &&
								config.bitriseTokenConfigured ? (
									<Trans>
										A token is stored in this host's secure credential store.
									</Trans>
								) : (
									<Trans>
										The token is stored securely and is never displayed again.
									</Trans>
								)}
							</p>
						</div>
					</div>
				)}

				<div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
					<Button
						type="button"
						disabled={!isHostOnline || isBusy || developerNames.length === 0}
						onClick={() => saveMutation.mutate()}
					>
						{saveMutation.isPending ? (
							<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
						) : (
							<LuKeyRound />
						)}
						<Trans>Save build settings</Trans>
					</Button>
				</div>
			</div>
		</div>
	);
}
