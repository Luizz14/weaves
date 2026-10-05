import { resolveEditorSettings } from "@superset/shared/editor-settings";
import { useWorkspaceClient } from "@superset/workspace-client";
import { type ReactNode, useEffect } from "react";
import { useEditorSettings } from "renderer/hooks/useEditorSettings";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { detectLanguage } from "shared/detect-language";
import {
	hasDocumentReference,
	observeDocuments,
	registerSaveTransform,
} from "../../fileDocumentStore/fileDocumentStore";
import { useLspCoordinator } from "../LspProvider";

export function EditorAutomation({ children }: { children: ReactNode }) {
	const settings = useEditorSettings();
	const { workspace } = useWorkspace();
	const { machineId } = useLocalHostService();
	const { trpcClient } = useWorkspaceClient();
	const lsp = useLspCoordinator();
	useEffect(() => {
		const cleanup = new Map<string, () => void>();
		const stop = observeDocuments((document) => {
			if (
				document.workspaceId !== workspace.id ||
				!hasDocumentReference(document.id) ||
				cleanup.has(document.id)
			)
				return;
			let timer: ReturnType<typeof setTimeout> | null = null;
			let previousText: string | null = null;
			let wasPending = false;
			const options = () =>
				resolveEditorSettings(settings, detectLanguage(document.absolutePath));
			const save = (delayed = false) => {
				if (
					!document.dirty ||
					document.pendingSave ||
					document.conflict ||
					document.orphaned ||
					document.content.kind !== "text"
				)
					return;
				void document
					.save({ skipFormatting: delayed })
					.catch((error) => console.error("[editor] Autosave failed", error));
			};
			const unregister = registerSaveTransform(
				document.id,
				async (content, path) => {
					const preferences = options();
					if (
						!preferences.saving.formatOnSave ||
						preferences.saving.formatter === "none"
					)
						return { content };
					if (workspace.hostId !== machineId)
						return { content, warning: "unsupported-host" };
					const result = await trpcClient.editor.format.mutate({
						workspaceId: workspace.id,
						absolutePath: path,
						content,
						formatter: preferences.saving.formatter,
					});
					if (result.kind === "formatted") return { content: result.content };
					if (result.kind === "warning")
						return { content, warning: result.reason };
					if (result.kind === "none") return { content };
					if (!lsp) return { content, warning: "missing-server" };
					return {
						content: await lsp.formatDocument(
							document,
							content,
							preferences.editing,
						),
					};
				},
			);
			const onChange = () => {
				if (!hasDocumentReference(document.id)) {
					cleanup.get(document.id)?.();
					cleanup.delete(document.id);
					return;
				}
				if (document.content.kind !== "text") return;
				const text = document.content.value;
				const completed = wasPending && !document.pendingSave;
				wasPending = document.pendingSave;
				if (text === previousText && !completed) return;
				previousText = text;
				if (timer) clearTimeout(timer);
				if (
					options().saving.autosave === "delay" &&
					document.dirty &&
					!document.conflict &&
					!document.saveError
				)
					timer = setTimeout(() => save(true), options().saving.delayMs);
			};
			const unsubscribe = document.subscribe(onChange);
			onChange();
			const onFocus = (event: FocusEvent) => {
				if (options().saving.autosave !== "focus") return;
				const target = event.target;
				if (
					!(target instanceof HTMLElement) ||
					target
						.closest("[data-editor-document-id]")
						?.getAttribute("data-editor-document-id") !== document.id
				)
					return;
				if (
					event.relatedTarget instanceof HTMLElement &&
					event.relatedTarget
						.closest("[data-editor-document-id]")
						?.getAttribute("data-editor-document-id") === document.id
				)
					return;
				save();
			};
			const onBlur = () => {
				if (
					options().saving.autosave === "window" ||
					options().saving.autosave === "focus"
				)
					save();
			};
			window.addEventListener("focusout", onFocus);
			window.addEventListener("blur", onBlur);
			cleanup.set(document.id, () => {
				if (timer) clearTimeout(timer);
				unsubscribe();
				unregister();
				window.removeEventListener("focusout", onFocus);
				window.removeEventListener("blur", onBlur);
			});
		});
		return () => {
			stop();
			for (const dispose of cleanup.values()) dispose();
		};
	}, [workspace.id, workspace.hostId, machineId, trpcClient, lsp, settings]);
	return <>{children}</>;
}
