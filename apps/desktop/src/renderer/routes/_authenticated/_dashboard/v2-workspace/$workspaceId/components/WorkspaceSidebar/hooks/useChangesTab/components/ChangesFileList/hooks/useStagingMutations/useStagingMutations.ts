import { useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import type { ChangesetFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useChangeset";

export function useStagingMutations(workspaceId: string) {
	const { t } = useLingui();
	const utils = workspaceTrpc.useUtils();
	const invalidate = () =>
		Promise.all([
			utils.git.getStatus.invalidate({ workspaceId }),
			utils.git.getDiff.invalidate({ workspaceId }),
		]);
	const { mutateAsync: stage } = workspaceTrpc.git.stageFile.useMutation({
		onSuccess: invalidate,
		onError: (err) => {
			toast.error(t({ message: "Couldn't stage file" }), {
				description: errorMessage(err),
			});
		},
	});
	const { mutateAsync: unstage } = workspaceTrpc.git.unstageFile.useMutation({
		onSuccess: invalidate,
		onError: (err) => {
			toast.error(t({ message: "Couldn't unstage file" }), {
				description: errorMessage(err),
			});
		},
	});

	const stageFile = useCallback(
		async (file: ChangesetFile) => {
			try {
				await stage({
					workspaceId,
					filePath: file.path,
					oldPath: file.oldPath,
				});
			} catch {}
		},
		[stage, workspaceId],
	);
	const unstageFile = useCallback(
		async (file: ChangesetFile) => {
			try {
				await unstage({
					workspaceId,
					filePath: file.path,
					oldPath: file.oldPath,
				});
			} catch {}
		},
		[unstage, workspaceId],
	);

	return { stageFile, unstageFile };
}
