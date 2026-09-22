import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { Switch } from "@superset/ui/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useIntegrationError } from "./hooks/useIntegrationError";

type Settings = {
	mergeTargetBranch: string | null;
	updateRemote: string | null;
	mergeToMainEnabled: boolean;
	updateFromMainEnabled: boolean;
};
export function BranchIntegrationSettings({
	projectId,
	hostUrl,
	onChanged,
}: {
	projectId: string;
	hostUrl: string;
	onChanged?: () => void;
}) {
	const { t } = useLingui();
	const controlId = useId();
	const errorText = useIntegrationError();
	const client = getHostServiceClientByUrl(hostUrl);
	const query = useQuery({
		queryKey: ["branch-integration-settings", hostUrl, projectId],
		queryFn: () => client.branchIntegration.settings.query({ projectId }),
	});
	const [draft, setDraft] = useState<Settings | null>(null);
	const save = useMutation({
		mutationFn: (settings: Settings) =>
			client.branchIntegration.setSettings.mutate({ projectId, ...settings }),
		onSuccess: async () => {
			await query.refetch();
			setDraft(null);
			onChanged?.();
			toast.success(t({ message: "Settings saved" }));
		},
		onError: (error) => toast.error(errorText(error)),
	});
	if (query.isError)
		return (
			<div role="alert" className="text-sm">
				<p>{errorText(query.error)}</p>
				<Button variant="outline" onClick={() => query.refetch()}>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	if (!query.data)
		return (
			<p className="text-sm text-muted-foreground">
				<Trans>Loading...</Trans>
			</p>
		);
	const data = query.data;
	const value = draft ?? {
		mergeTargetBranch: data.mergeTargetBranch ?? data.suggestedBranch,
		updateRemote: data.updateRemote ?? data.suggestedRemote,
		mergeToMainEnabled: data.mergeToMainEnabled,
		updateFromMainEnabled: data.updateFromMainEnabled,
	};
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				<Trans>
					Integrate committed changes locally. These settings do not change
					workspace creation or pull requests.
				</Trans>
			</p>
			<label
				htmlFor={`${controlId}-merge`}
				className="flex items-center justify-between gap-4 text-sm"
			>
				<Trans>Allow merge into principal</Trans>
				<Switch
					id={`${controlId}-merge`}
					checked={value.mergeToMainEnabled}
					disabled={save.isPending}
					onCheckedChange={(checked) =>
						setDraft({ ...value, mergeToMainEnabled: checked })
					}
				/>
			</label>
			<label
				htmlFor={`${controlId}-update`}
				className="flex items-center justify-between gap-4 text-sm"
			>
				<Trans>Allow update from remote principal</Trans>
				<Switch
					id={`${controlId}-update`}
					checked={value.updateFromMainEnabled}
					disabled={save.isPending}
					onCheckedChange={(checked) =>
						setDraft({ ...value, updateFromMainEnabled: checked })
					}
				/>
			</label>
			<label className="grid gap-2 text-sm">
				<Trans>Principal branch</Trans>
				<select
					className="h-9 rounded-md border border-input bg-background px-3"
					value={value.mergeTargetBranch ?? ""}
					disabled={save.isPending}
					onChange={(event) =>
						setDraft({
							...value,
							mergeTargetBranch: event.target.value || null,
						})
					}
				>
					<option value="">{t({ message: "Select a branch" })}</option>
					{[
						...new Set([
							...data.branches,
							...(value.mergeTargetBranch ? [value.mergeTargetBranch] : []),
						]),
					].map((branch) => (
						<option key={branch} value={branch}>
							{branch}
						</option>
					))}
				</select>
			</label>
			<label className="grid gap-2 text-sm">
				<Trans>Remote for updates</Trans>
				<select
					className="h-9 rounded-md border border-input bg-background px-3"
					value={value.updateRemote ?? ""}
					disabled={save.isPending}
					onChange={(event) =>
						setDraft({ ...value, updateRemote: event.target.value || null })
					}
				>
					<option value="">{t({ message: "Select a remote" })}</option>
					{[
						...new Set([
							...data.remotes,
							...(value.updateRemote ? [value.updateRemote] : []),
						]),
					].map((remote) => (
						<option key={remote} value={remote}>
							{remote}
						</option>
					))}
				</select>
			</label>
			<Button disabled={save.isPending} onClick={() => save.mutate(value)}>
				<Trans>Save</Trans>
			</Button>
		</div>
	);
}
