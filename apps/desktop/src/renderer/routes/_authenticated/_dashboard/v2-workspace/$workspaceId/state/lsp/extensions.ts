import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import {
	hoverTooltips,
	LSPPlugin,
	serverCompletion,
} from "@codemirror/lsp-client";
import { EditorView, keymap, showDialog } from "@codemirror/view";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import type {
	Definition,
	DefinitionLink,
	DefinitionParams,
} from "vscode-languageserver-protocol";
import { z } from "zod";

const positionSchema = z.object({
	line: z.number().int().nonnegative(),
	character: z.number().int().nonnegative(),
});
const diagnosticsSchema = z.object({
	uri: z.string(),
	version: z.number().optional(),
	diagnostics: z.array(
		z.object({
			range: z.object({ start: positionSchema, end: positionSchema }),
			message: z.string(),
			severity: z.number().optional(),
		}),
	),
});

export function publishDiagnostics(
	client: import("@codemirror/lsp-client").LSPClient,
	input: unknown,
) {
	const parsed = diagnosticsSchema.safeParse(input);
	if (!parsed.success) return true;
	const params = parsed.data;
	const file = client.workspace.getFile(params.uri);
	if (
		!file ||
		(params.version !== undefined && params.version !== file.version)
	)
		return true;
	const views =
		"views" in file && file.views instanceof Set
			? file.views
			: new Set([file.getView()]);
	for (const view of views) {
		if (!(view instanceof EditorView)) continue;
		const plugin = LSPPlugin.get(view);
		if (!plugin) continue;
		const diagnostics: Diagnostic[] = params.diagnostics.map((item) => ({
			from: plugin.unsyncedChanges.mapPos(
				plugin.fromPosition(item.range.start, plugin.syncedDoc),
			),
			to: plugin.unsyncedChanges.mapPos(
				plugin.fromPosition(item.range.end, plugin.syncedDoc),
			),
			message: item.message,
			severity:
				item.severity === 2
					? "warning"
					: item.severity === 3
						? "info"
						: item.severity === 4
							? "hint"
							: "error",
		}));
		view.dispatch(setDiagnostics(view.state, diagnostics));
	}
	return true;
}

export function languageFeatures(
	navigate: (uri: string) => Promise<EditorView | null>,
) {
	let pending: { plugin: LSPPlugin; params: DefinitionParams } | null = null;
	const definition = (
		view: EditorView,
		position = view.state.selection.main.head,
	) => {
		const plugin = LSPPlugin.get(view);
		if (!plugin || !plugin.client.serverCapabilities?.definitionProvider)
			return false;
		if (pending) pending.plugin.client.cancelRequest(pending.params);
		plugin.client.sync();
		const params: DefinitionParams = {
			textDocument: { uri: plugin.uri },
			position: plugin.toPosition(position),
		};
		const request = { plugin, params };
		pending = request;
		const version = plugin.client.workspace.getFile(plugin.uri)?.version;
		const snapshots = new Map(
			plugin.client.workspace.files.map((file) => [file.uri, file.doc]),
		);
		void plugin.client
			.request<DefinitionParams, Definition | DefinitionLink[] | null>(
				"textDocument/definition",
				params,
			)
			.then(async (response) => {
				if (
					pending !== request ||
					plugin.client.workspace.getFile(plugin.uri)?.version !== version ||
					!view.state.doc.eq(plugin.syncedDoc)
				)
					return;
				const locations = (
					Array.isArray(response) ? response : response ? [response] : []
				).map((location) =>
					"targetUri" in location
						? { uri: location.targetUri, range: location.targetSelectionRange }
						: location,
				);
				if (!locations.length) return;
				const open = async (location: (typeof locations)[number]) => {
					if (
						pending !== request ||
						plugin.client.workspace.getFile(plugin.uri)?.version !== version
					)
						return;
					const target =
						location.uri === plugin.uri ? view : await navigate(location.uri);
					if (!target)
						throw new Error(
							i18n._(msg({ message: "Could not open the definition" })),
						);
					const snapshot = snapshots.get(location.uri);
					if (snapshot && !target.state.doc.eq(snapshot)) return;
					const from = plugin.fromPosition(
						location.range.start,
						target.state.doc,
					);
					const to = plugin.fromPosition(location.range.end, target.state.doc);
					target.dispatch({
						selection: { anchor: from, head: to },
						scrollIntoView: true,
					});
					target.focus();
				};
				if (locations.length === 1) {
					await open(locations[0]);
					return;
				}
				showDialog(view, {
					focus: true,
					content: (_view, close) => {
						const list = document.createElement("form");
						const label = document.createElement("p");
						label.textContent = i18n._(msg({ message: "Choose a definition" }));
						list.appendChild(label);
						for (const location of locations) {
							const button = document.createElement("button");
							button.type = "button";
							button.className =
								"block w-full text-left px-2 py-1 hover:bg-muted";
							button.textContent = `${decodeURIComponent(location.uri.split("/").pop() ?? location.uri)}:${location.range.start.line + 1}`;
							button.addEventListener("click", () => {
								close();
								void open(location).catch((error) =>
									plugin.reportError(
										i18n._(msg({ message: "Could not open the definition" })),
										error,
									),
								);
							});
							list.appendChild(button);
						}
						return list;
					},
				});
			})
			.catch((error) => {
				if (pending === request)
					plugin.reportError(
						i18n._(msg({ message: "Could not open the definition" })),
						error,
					);
			});
		return true;
	};
	return [
		autocompletion(),
		serverCompletion(),
		hoverTooltips(),
		lintGutter(),
		keymap.of([...completionKeymap, { key: "F12", run: definition }]),
		EditorView.domEventHandlers({
			click(event, view) {
				if (!(event.metaKey || event.ctrlKey) || event.button !== 0)
					return false;
				const position = view.posAtCoords({
					x: event.clientX,
					y: event.clientY,
				});
				if (position === null) return false;
				return definition(view, position);
			},
		}),
	];
}
